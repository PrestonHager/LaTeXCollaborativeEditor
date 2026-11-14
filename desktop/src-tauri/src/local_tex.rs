//! Compile with a TeX Live already installed on this computer (issue #264, docs/desktop.md
//! "Local TeX Live"). Off by default: the page only calls this from an explicit Compile action,
//! after the person turned it on in a desktop-only setting.
//!
//! What keeps it narrow:
//! - Only `latexmk`, `pdflatex`, `xelatex` and `lualatex`, found on PATH or in the folder the
//!   setting names. They're started directly, never through a shell.
//! - TeX runs with `-no-shell-escape`, and `openout_any=p` and `openin_any=p` (and
//!   `shell_escape=f`) in its environment, so it can't run programs or read or write outside the
//!   folder it works in (paranoid mode). latexmk runs with `-norc`, so a project's `latexmkrc`
//!   (Perl) is never read.
//! - It works on a temporary copy of the project, removed afterwards, with a time limit and size
//!   limits on what goes in and what comes back.
//! - The project's files are data. Only the main file's name reaches the command line, and only
//!   after it's checked: a relative `.tex` path inside the copy, plain characters, not starting
//!   with `-`, `&` or `\`.

use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// The only programs this runs.
pub const PROGRAMS: [&str; 4] = ["latexmk", "pdflatex", "xelatex", "lualatex"];
/// The engines latexmk may drive.
pub const ENGINES: [&str; 3] = ["pdflatex", "xelatex", "lualatex"];

#[derive(Debug, Clone, PartialEq)]
pub struct Limits {
    pub timeout: Duration,
    /// All the project's files together.
    pub max_input_bytes: usize,
    pub max_files: usize,
    pub max_pdf_bytes: u64,
    /// The end of the log is kept, since the error is usually there.
    pub max_log_bytes: usize,
    /// stdout and stderr each, kept from the end too.
    pub max_output_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            timeout: Duration::from_secs(180),
            max_input_bytes: 200 * 1024 * 1024,
            max_files: 5000,
            max_pdf_bytes: 200 * 1024 * 1024,
            max_log_bytes: 1024 * 1024,
            max_output_bytes: 256 * 1024,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum TexError {
    BadRequest(String),
    /// The program isn't on PATH or in the folder the setting names.
    NotFound(String),
    TooLarge(String),
    TimedOut,
    Io(String),
}

impl From<TexError> for String {
    fn from(error: TexError) -> String {
        match error {
            TexError::BadRequest(detail) => format!("bad_request: {detail}"),
            TexError::NotFound(program) => format!("not_found: {program}"),
            TexError::TooLarge(detail) => format!("too_large: {detail}"),
            TexError::TimedOut => "timed_out".into(),
            TexError::Io(detail) => format!("io: {detail}"),
        }
    }
}

/// What a compile asks for.
#[derive(Debug, Clone, PartialEq)]
pub struct Job {
    /// One of PROGRAMS.
    pub program: String,
    /// With latexmk: which engine it drives. Ignored otherwise.
    pub engine: String,
    /// The main file, a project path like `main.tex` or `chapters/thesis.tex`.
    pub main: String,
    /// The folder holding the TeX programs, when the setting names one. Otherwise PATH.
    pub tex_dir: Option<PathBuf>,
}

#[derive(Debug, PartialEq)]
pub struct Outcome {
    /// TeX's exit status was 0 and the PDF is there.
    pub ok: bool,
    pub pdf: Option<Vec<u8>>,
    /// The end of the main file's .log, or of stdout and stderr when there's no log.
    pub log: String,
}

/// A project path that's safe to write inside the copy: relative, `/`-separated, no `.` or `..`,
/// no backslashes, colons or control characters.
pub fn safe_relative_path(path: &str) -> Result<PathBuf, TexError> {
    let bad = |why: &str| TexError::BadRequest(format!("{why}: {path:?}"));
    if path.is_empty() || path.len() > 512 {
        return Err(bad("path length"));
    }
    if path.starts_with('/')
        || path.contains('\\')
        || path.contains(':')
        || path.chars().any(char::is_control)
    {
        return Err(bad("not a plain relative path"));
    }
    let mut out = PathBuf::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err(bad("not a plain relative path"));
        }
        out.push(part);
    }
    Ok(out)
}

/// The main file name, as it may appear on TeX's command line.
pub fn safe_main(main: &str) -> Result<PathBuf, TexError> {
    let path = safe_relative_path(main)?;
    let plain = main
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'));
    let first_ok = main
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
    if !plain
        || !first_ok
        || !main.ends_with(".tex")
        || main.split('/').any(|part| part.starts_with('-'))
    {
        return Err(TexError::BadRequest(format!(
            "the main file must be a .tex file whose name uses only letters, digits, '.', '_', '-' and '/': {main:?}"
        )));
    }
    Ok(path)
}

/// Find a program: in `tex_dir` when given, else on PATH. Only names from PROGRAMS.
pub fn find_program(
    program: &str,
    tex_dir: Option<&Path>,
    path_var: Option<OsString>,
) -> Result<PathBuf, TexError> {
    if !PROGRAMS.contains(&program) {
        return Err(TexError::BadRequest(format!(
            "{program:?} isn't one of {PROGRAMS:?}"
        )));
    }
    let names: Vec<String> = if cfg!(windows) {
        vec![
            format!("{program}.exe"),
            format!("{program}.bat"),
            format!("{program}.cmd"),
        ]
    } else {
        vec![program.to_string()]
    };
    let dirs: Vec<PathBuf> = match tex_dir {
        Some(dir) => {
            if !dir.is_absolute() {
                return Err(TexError::BadRequest(
                    "the TeX folder must be an absolute path".into(),
                ));
            }
            vec![dir.to_path_buf()]
        }
        None => path_var
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default(),
    };
    for dir in dirs {
        for name in &names {
            let candidate = dir.join(name);
            if is_executable(&candidate) {
                return Ok(candidate);
            }
        }
    }
    Err(TexError::NotFound(program.to_string()))
}

fn is_executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// The command line: fixed options, then the checked main file name, last.
pub fn arguments(job: &Job, main: &Path) -> Result<Vec<OsString>, TexError> {
    let mut args: Vec<OsString> = Vec::new();
    if job.program == "latexmk" {
        let engine_flag = match job.engine.as_str() {
            "pdflatex" => "-pdf",
            "xelatex" => "-xelatex",
            "lualatex" => "-lualatex",
            other => {
                return Err(TexError::BadRequest(format!(
                    "{other:?} isn't one of {ENGINES:?}"
                )))
            }
        };
        // -norc first: never read a latexmkrc, the project's or anyone's (they're Perl).
        for arg in [
            "-norc",
            engine_flag,
            "-no-shell-escape",
            "-interaction=nonstopmode",
            "-file-line-error",
            "-halt-on-error",
        ] {
            args.push(arg.into());
        }
    } else {
        for arg in [
            "-no-shell-escape",
            "-interaction=nonstopmode",
            "-file-line-error",
            "-halt-on-error",
        ] {
            args.push(arg.into());
        }
    }
    args.push(main.as_os_str().to_owned());
    Ok(args)
}

/// Parse the page's request body: repeated [path length u32][path][data length u32][data].
pub fn parse_files(body: &[u8], limits: &Limits) -> Result<Vec<(PathBuf, Vec<u8>)>, TexError> {
    if body.len() > limits.max_input_bytes {
        return Err(TexError::TooLarge(format!(
            "the project is over {} MB",
            limits.max_input_bytes / (1024 * 1024)
        )));
    }
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    let mut at = 0usize;
    let read_u32 = |at: usize| -> Result<usize, TexError> {
        body.get(at..at + 4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
            .ok_or_else(|| TexError::BadRequest("truncated file list".into()))
    };
    while at < body.len() {
        let path_len = read_u32(at)?;
        at += 4;
        let path = body
            .get(at..at + path_len)
            .ok_or_else(|| TexError::BadRequest("truncated file list".into()))?;
        let path = std::str::from_utf8(path)
            .map_err(|_| TexError::BadRequest("a path isn't UTF-8".into()))?;
        at += path_len;
        let data_len = read_u32(at)?;
        at += 4;
        let data = body
            .get(at..at + data_len)
            .ok_or_else(|| TexError::BadRequest("truncated file list".into()))?;
        at += data_len;
        let safe = safe_relative_path(path)?;
        if !seen.insert(safe.clone()) {
            return Err(TexError::BadRequest(format!(
                "{path:?} is in the project twice"
            )));
        }
        files.push((safe, data.to_vec()));
        if files.len() > limits.max_files {
            return Err(TexError::TooLarge(format!(
                "the project has over {} files",
                limits.max_files
            )));
        }
    }
    Ok(files)
}

/// A temporary folder removed when dropped, even after a failure or a timeout.
pub struct WorkDir(pub PathBuf);

impl WorkDir {
    pub fn new() -> Result<WorkDir, TexError> {
        let mut suffix = [0u8; 8];
        getrandom::fill(&mut suffix).map_err(|e| TexError::Io(e.to_string()))?;
        let hex: String = suffix.iter().map(|b| format!("{b:02x}")).collect();
        let dir = std::env::temp_dir().join(format!("latex-editor-tex-{hex}"));
        std::fs::create_dir(&dir).map_err(|e| TexError::Io(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
        Ok(WorkDir(dir))
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Keep the last `max` bytes of a stream, reading it all so the child never blocks on a full pipe.
async fn tail_of<R: AsyncReadExt + Unpin>(mut reader: R, max: usize) -> Vec<u8> {
    let mut kept: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                kept.extend_from_slice(&chunk[..n]);
                if kept.len() > max * 2 {
                    kept.drain(..kept.len() - max);
                }
            }
        }
    }
    if kept.len() > max {
        kept.drain(..kept.len() - max);
    }
    kept
}

/// The end of a file, at most `max` bytes, as text.
fn read_tail(path: &Path, max: usize) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(max as u64);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    file.take(max as u64).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// Stop the program and everything it started (latexmk runs the engine, bibtex and so on).
fn stop(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        // The child leads its own process group (process_group(0) below).
        unsafe {
            libc::killpg(pid as libc::pid_t, libc::SIGKILL);
        }
    }
    let _ = child.start_kill();
}

/// Copy the project, run TeX on it, and bring back the PDF and the end of the log.
pub async fn compile(
    job: &Job,
    files: Vec<(PathBuf, Vec<u8>)>,
    limits: &Limits,
    path_var: Option<OsString>,
) -> Result<Outcome, TexError> {
    let main = safe_main(&job.main)?;
    if !files.iter().any(|(path, _)| *path == main) {
        return Err(TexError::BadRequest(format!(
            "{} isn't in the project",
            job.main
        )));
    }
    let program = find_program(&job.program, job.tex_dir.as_deref(), path_var.clone())?;
    let args = arguments(job, &main)?;

    let work = WorkDir::new()?;
    for (path, data) in &files {
        let target = work.0.join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| TexError::Io(e.to_string()))?;
        }
        std::fs::write(&target, data).map_err(|e| TexError::Io(e.to_string()))?;
    }

    let mut command = Command::new(&program);
    command
        .args(&args)
        .current_dir(&work.0)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Paranoid kpathsea: TeX reads and writes only below the working folder (and its own
        // trees for reading), and no \write18 whatever the system texmf.cnf says.
        .env("openout_any", "p")
        .env("openin_any", "p")
        .env("shell_escape", "f")
        .env_remove("TEXMFOUTPUT")
        .kill_on_drop(true);
    // latexmk calls the engine by name: the configured folder goes first on its PATH.
    if let Some(dir) = &job.tex_dir {
        let mut dirs = vec![dir.clone()];
        if let Some(path) = &path_var {
            dirs.extend(std::env::split_paths(path));
        }
        if let Ok(joined) = std::env::join_paths(dirs) {
            command.env("PATH", joined);
        }
    }
    #[cfg(unix)]
    command.process_group(0);

    let mut child = command
        .spawn()
        .map_err(|e| TexError::Io(format!("couldn't start {}: {e}", job.program)))?;
    let stdout = child
        .stdout
        .take()
        .map(|s| tokio::spawn(tail_of(s, limits.max_output_bytes)));
    let stderr = child
        .stderr
        .take()
        .map(|s| tokio::spawn(tail_of(s, limits.max_output_bytes)));
    let status = match tokio::time::timeout(limits.timeout, child.wait()).await {
        Ok(status) => status.map_err(|e| TexError::Io(e.to_string()))?,
        Err(_) => {
            stop(&mut child);
            let _ = child.wait().await;
            return Err(TexError::TimedOut);
        }
    };
    let out = match stdout {
        Some(task) => task.await.unwrap_or_default(),
        None => Vec::new(),
    };
    let err = match stderr {
        Some(task) => task.await.unwrap_or_default(),
        None => Vec::new(),
    };

    let pdf_path = work.0.join(main.with_extension("pdf"));
    let pdf = match std::fs::metadata(&pdf_path) {
        Ok(meta) if meta.len() > limits.max_pdf_bytes => {
            return Err(TexError::TooLarge(format!(
                "the PDF is over {} MB",
                limits.max_pdf_bytes / (1024 * 1024)
            )))
        }
        Ok(_) => Some(std::fs::read(&pdf_path).map_err(|e| TexError::Io(e.to_string()))?),
        Err(_) => None,
    };
    let log = read_tail(
        &work.0.join(main.with_extension("log")),
        limits.max_log_bytes,
    )
    .unwrap_or_else(|| {
        let mut text = String::from_utf8_lossy(&out).into_owned();
        text.push_str(&String::from_utf8_lossy(&err));
        text
    });
    Ok(Outcome {
        ok: status.success() && pdf.is_some(),
        pdf,
        log,
    })
}

/// The answer to the page: [ok u8][pdf length u32][pdf][log UTF-8].
pub fn encode_outcome(outcome: &Outcome) -> Vec<u8> {
    let pdf = outcome.pdf.as_deref().unwrap_or(&[]);
    let mut out = Vec::with_capacity(5 + pdf.len() + outcome.log.len());
    out.push(u8::from(outcome.ok));
    out.extend_from_slice(&(pdf.len() as u32).to_be_bytes());
    out.extend_from_slice(pdf);
    out.extend_from_slice(outcome.log.as_bytes());
    out
}

fn header(request: &tauri::ipc::Request<'_>, name: &str) -> Option<String> {
    percent_decode(request.headers().get(name)?.to_str().ok()?)
}

/// Header values are percent-encoded UTF-8 (encodeURIComponent on the page).
fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The one command (frontend/src/app/desktopLocalTex.ts). The project's files come as the raw
/// request body; the program, engine, main file and TeX folder as `x-tex-*` headers.
#[tauri::command]
pub async fn tex_compile(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(TexError::BadRequest("expected the project as bytes".into()).into());
    };
    let job = Job {
        program: header(&request, "x-tex-program")
            .ok_or(TexError::BadRequest("no program".into()))?,
        engine: header(&request, "x-tex-engine").unwrap_or_else(|| "pdflatex".into()),
        main: header(&request, "x-tex-main").ok_or(TexError::BadRequest("no main file".into()))?,
        tex_dir: header(&request, "x-tex-dir")
            .filter(|d| !d.is_empty())
            .map(PathBuf::from),
    };
    let limits = Limits::default();
    let files = parse_files(body, &limits)?;
    let outcome = compile(&job, files, &limits, std::env::var_os("PATH")).await?;
    Ok(tauri::ipc::Response::new(encode_outcome(&outcome)))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A fake TeX program: a shell script in its own folder, named like the real one.
    fn fake_tex(name: &str, script: &str) -> (tempdir::Dir, PathBuf) {
        let dir = tempdir::Dir::new();
        let path = dir.0.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let folder = dir.0.clone();
        (dir, folder)
    }

    mod tempdir {
        pub struct Dir(pub std::path::PathBuf);
        impl Dir {
            pub fn new() -> Dir {
                let dir = super::WorkDir::new().unwrap();
                let path = dir.0.clone();
                std::mem::forget(dir);
                Dir(path)
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    /// The system PATH, which the real command passes too, so the fake scripts find sleep and cat.
    fn path() -> Option<OsString> {
        std::env::var_os("PATH")
    }

    fn job(program: &str, dir: &Path) -> Job {
        Job {
            program: program.into(),
            engine: "pdflatex".into(),
            main: "main.tex".into(),
            tex_dir: Some(dir.to_path_buf()),
        }
    }

    fn project() -> Vec<(PathBuf, Vec<u8>)> {
        vec![
            (
                PathBuf::from("main.tex"),
                b"\\documentclass{article}".to_vec(),
            ),
            (PathBuf::from("ch/one.tex"), b"x".to_vec()),
        ]
    }

    #[test]
    fn paths_must_stay_inside_the_copy() {
        assert_eq!(
            safe_relative_path("ch/one.tex").unwrap(),
            PathBuf::from("ch").join("one.tex")
        );
        for bad in [
            "",
            "/etc/passwd",
            "../x",
            "a/../b",
            "a//b",
            "./a",
            "a\\b",
            "C:/x",
            "a\u{0}b",
        ] {
            assert!(safe_relative_path(bad).is_err(), "{bad:?}");
        }
        assert!(safe_relative_path(&"a".repeat(513)).is_err());
    }

    #[test]
    fn the_main_file_cant_be_an_option_or_a_command() {
        assert!(safe_main("main.tex").is_ok());
        assert!(safe_main("thesis/main-2.tex").is_ok());
        for bad in [
            "-shell-escape.tex",
            "&pdflatex.tex",
            "\\input.tex",
            "main.txt",
            "my main.tex",
            "a/-b.tex",
            "ma$in.tex",
            "../main.tex",
        ] {
            assert!(safe_main(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn only_the_four_programs_from_path_or_the_folder() {
        let (_dir, folder) = fake_tex("pdflatex", "exit 0");
        assert_eq!(
            find_program("pdflatex", Some(&folder), None).unwrap(),
            folder.join("pdflatex")
        );
        assert_eq!(
            find_program("pdflatex", None, Some(folder.clone().into_os_string())).unwrap(),
            folder.join("pdflatex")
        );
        assert_eq!(
            find_program("xelatex", Some(&folder), None),
            Err(TexError::NotFound("xelatex".into()))
        );
        assert!(matches!(
            find_program("bash", Some(&folder), None),
            Err(TexError::BadRequest(_))
        ));
        assert!(matches!(
            find_program("pdflatex", Some(Path::new("relative")), None),
            Err(TexError::BadRequest(_))
        ));
        // Not executable: not found.
        std::fs::set_permissions(
            folder.join("pdflatex"),
            std::fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        assert_eq!(
            find_program("pdflatex", Some(&folder), None),
            Err(TexError::NotFound("pdflatex".into()))
        );
    }

    #[test]
    fn the_command_line_is_fixed_but_for_the_main_file() {
        let mut j = job("pdflatex", Path::new("/x"));
        let args = arguments(&j, Path::new("main.tex")).unwrap();
        assert_eq!(args.first().unwrap(), "-no-shell-escape");
        assert_eq!(args.last().unwrap(), "main.tex");
        j.program = "latexmk".into();
        j.engine = "xelatex".into();
        let args = arguments(&j, Path::new("main.tex")).unwrap();
        assert_eq!(
            &args[..3],
            &["-norc", "-xelatex", "-no-shell-escape"].map(OsString::from)
        );
        j.engine = "bash".into();
        assert!(arguments(&j, Path::new("main.tex")).is_err());
    }

    #[test]
    fn files_parse_and_refuse_bad_input() {
        let limits = Limits::default();
        let mut body = Vec::new();
        for (path, data) in [("main.tex", &b"hi"[..]), ("img/a.png", &b"\x89PNG"[..])] {
            body.extend_from_slice(&(path.len() as u32).to_be_bytes());
            body.extend_from_slice(path.as_bytes());
            body.extend_from_slice(&(data.len() as u32).to_be_bytes());
            body.extend_from_slice(data);
        }
        let files = parse_files(&body, &limits).unwrap();
        assert_eq!(files[1].0, PathBuf::from("img").join("a.png"));
        assert!(parse_files(&body[..body.len() - 1], &limits).is_err());
        let mut twice = body.clone();
        twice.extend_from_slice(&body[..14]);
        assert!(parse_files(&twice, &limits).is_err());
        let small = Limits {
            max_input_bytes: 4,
            ..Limits::default()
        };
        assert!(matches!(
            parse_files(&body, &small),
            Err(TexError::TooLarge(_))
        ));
        let one = Limits {
            max_files: 1,
            ..Limits::default()
        };
        assert!(matches!(
            parse_files(&body, &one),
            Err(TexError::TooLarge(_))
        ));
        let mut evil = Vec::new();
        evil.extend_from_slice(&5u32.to_be_bytes());
        evil.extend_from_slice(b"../x0");
        evil.extend_from_slice(&0u32.to_be_bytes());
        assert!(parse_files(&evil, &limits).is_err());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_run_gets_a_locked_down_environment_and_returns_the_pdf_and_log() {
        // The fake engine records its arguments and environment, then writes a PDF and a log.
        let (_dir, folder) = fake_tex(
            "pdflatex",
            r#"printf '%s\n' "$@" > args.txt
               echo "out=$openout_any in=$openin_any esc=$shell_escape" > env.txt
               [ -f ch/one.tex ] || exit 3
               printf '%%PDF-1.4 fake' > main.pdf
               { cat args.txt env.txt; echo 'Output written on main.pdf'; } > main.log"#,
        );
        let outcome = compile(
            &job("pdflatex", &folder),
            project(),
            &Limits::default(),
            path(),
        )
        .await
        .unwrap();
        assert!(outcome.ok);
        assert_eq!(outcome.pdf.as_deref(), Some(&b"%PDF-1.4 fake"[..]));
        assert!(outcome
            .log
            .contains("-no-shell-escape\n-interaction=nonstopmode"));
        assert!(
            outcome.log.contains("main.tex\nout=p in=p esc=f"),
            "{}",
            outcome.log
        );
        let encoded = encode_outcome(&outcome);
        assert_eq!(encoded[0], 1);
        assert_eq!(u32::from_be_bytes(encoded[1..5].try_into().unwrap()), 13);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_failed_run_keeps_the_log_and_no_pdf() {
        let (_dir, folder) = fake_tex(
            "pdflatex",
            "echo './main.tex:3: Undefined control sequence.' > main.log; exit 1",
        );
        let outcome = compile(
            &job("pdflatex", &folder),
            project(),
            &Limits::default(),
            path(),
        )
        .await
        .unwrap();
        assert!(!outcome.ok);
        assert_eq!(outcome.pdf, None);
        assert!(outcome.log.contains("Undefined control sequence"));
        // No log file: stdout and stderr stand in.
        let (_dir2, folder2) = fake_tex("pdflatex", "echo to-stdout; echo to-stderr >&2; exit 1");
        let outcome = compile(
            &job("pdflatex", &folder2),
            project(),
            &Limits::default(),
            path(),
        )
        .await
        .unwrap();
        assert!(outcome.log.contains("to-stdout") && outcome.log.contains("to-stderr"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_run_that_takes_too_long_is_stopped_with_its_children_and_cleaned_up() {
        // The engine starts a child that would outlive it, and both sleep. Each writes its pid.
        let (_dir, folder) = fake_tex("pdflatex", "sleep 30 & echo $! > ../latex-editor-test-child; pwd > ../latex-editor-test-workdir; sleep 30");
        let limits = Limits {
            timeout: Duration::from_millis(500),
            ..Limits::default()
        };
        let started = std::time::Instant::now();
        let result = compile(&job("pdflatex", &folder), project(), &limits, path()).await;
        assert_eq!(result, Err(TexError::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(10));
        // The working folder is gone.
        let marker = std::env::temp_dir().join("latex-editor-test-workdir");
        if let Ok(workdir) = std::fs::read_to_string(&marker) {
            let _ = std::fs::remove_file(&marker);
            assert!(
                !Path::new(workdir.trim()).exists(),
                "the temporary copy should be removed"
            );
        }
        // The engine's own child was stopped too (gone, or a zombie waiting to be reaped).
        let child_marker = std::env::temp_dir().join("latex-editor-test-child");
        if let Ok(pid) = std::fs::read_to_string(&child_marker) {
            let _ = std::fs::remove_file(&child_marker);
            tokio::time::sleep(Duration::from_millis(200)).await;
            let stat =
                std::fs::read_to_string(format!("/proc/{}/stat", pid.trim())).unwrap_or_default();
            let state = stat
                .rsplit(')')
                .next()
                .unwrap_or("")
                .split_whitespace()
                .next()
                .unwrap_or("");
            assert!(
                stat.is_empty() || state == "Z",
                "the background child is still running: {stat}"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn output_and_logs_are_capped_from_the_end() {
        // 2 MB on stdout with no log file, and a PDF over the cap on a second run.
        let (_dir, folder) = fake_tex(
            "pdflatex",
            "head -c 2000000 /dev/zero | tr '\\0' 'a'; echo END; exit 1",
        );
        let limits = Limits {
            max_output_bytes: 1000,
            ..Limits::default()
        };
        let outcome = compile(&job("pdflatex", &folder), project(), &limits, path())
            .await
            .unwrap();
        assert!(outcome.log.len() <= 2000, "{}", outcome.log.len());
        assert!(outcome.log.contains("END"));

        let (_dir2, folder2) = fake_tex("pdflatex", "head -c 5000 /dev/zero > main.pdf; head -c 50000 /dev/zero | tr '\\0' 'b' > main.log; echo LAST >> main.log");
        let limits = Limits {
            max_log_bytes: 100,
            ..Limits::default()
        };
        let outcome = compile(&job("pdflatex", &folder2), project(), &limits, path())
            .await
            .unwrap();
        assert!(outcome.log.len() <= 100 && outcome.log.ends_with("LAST\n"));
        let tiny_pdf = Limits {
            max_pdf_bytes: 10,
            ..Limits::default()
        };
        assert!(matches!(
            compile(&job("pdflatex", &folder2), project(), &tiny_pdf, path()).await,
            Err(TexError::TooLarge(_))
        ));
    }

    #[tokio::test]
    async fn bad_jobs_never_start_anything() {
        let (_dir, folder) = fake_tex("pdflatex", "touch ran; exit 0");
        let mut j = job("pdflatex", &folder);
        j.main = "missing.tex".into();
        assert!(matches!(
            compile(&j, project(), &Limits::default(), path()).await,
            Err(TexError::BadRequest(_))
        ));
        j.main = "-output-directory=/tmp.tex".into();
        assert!(matches!(
            compile(&j, project(), &Limits::default(), path()).await,
            Err(TexError::BadRequest(_))
        ));
        j.main = "main.tex".into();
        j.program = "sh".into();
        assert!(matches!(
            compile(&j, project(), &Limits::default(), path()).await,
            Err(TexError::BadRequest(_))
        ));
        assert!(!folder.join("ran").exists());
        j.program = "lualatex".into();
        assert_eq!(
            compile(&j, project(), &Limits::default(), path()).await,
            Err(TexError::NotFound("lualatex".into()))
        );
    }

    #[test]
    fn headers_and_errors() {
        assert_eq!(
            percent_decode("C%3A%5CTeX%20Live").as_deref(),
            Some("C:\\TeX Live")
        );
        assert_eq!(percent_decode("bad%zz"), None);
        assert_eq!(String::from(TexError::TimedOut), "timed_out");
        assert_eq!(
            String::from(TexError::NotFound("xelatex".into())),
            "not_found: xelatex"
        );
    }

    /// Against a real TeX Live: `LCE_REAL_TEX=1 cargo test real_tex -- --ignored`. Compiles a
    /// document, and checks that \\write18 and reading outside the copy are refused.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn real_tex_live_compiles_and_refuses_escapes() {
        if std::env::var_os("LCE_REAL_TEX").is_none() {
            return;
        }
        let marker = std::env::temp_dir().join("latex-editor-pwned");
        let _ = std::fs::remove_file(&marker);
        let source = format!(
            "\\documentclass{{article}}\n\\begin{{document}}\nHello.\n\\immediate\\write18{{touch {}}}\n\\IfFileExists{{/etc/hostname}}{{\\typeout{{OUTSIDE:READ}}}}{{\\typeout{{OUTSIDE:BLOCKED}}}}\n\\end{{document}}\n",
            marker.display()
        );
        let files = vec![(PathBuf::from("main.tex"), source.into_bytes())];
        for program in ["pdflatex", "latexmk"] {
            let job = Job {
                program: program.into(),
                engine: "pdflatex".into(),
                main: "main.tex".into(),
                tex_dir: None,
            };
            let outcome = compile(&job, files.clone(), &Limits::default(), path())
                .await
                .unwrap();
            assert!(outcome.ok, "{program}: {}", outcome.log);
            assert!(outcome
                .pdf
                .as_deref()
                .is_some_and(|pdf| pdf.starts_with(b"%PDF")));
            assert!(!marker.exists(), "{program}: \\write18 ran");
            assert!(
                outcome.log.contains("runsystem(touch") && outcome.log.contains("disabled"),
                "{program}: {}",
                outcome.log
            );
            assert!(
                outcome.log.contains("OUTSIDE:BLOCKED"),
                "{program}: an absolute path outside the copy was readable"
            );
        }
    }
}
