//! Google sign-in through the system browser (issue #177, docs/desktop.md "Google sign-in").
//!
//! Google blocks OAuth inside an app's webview, so this follows RFC 8252 for native apps: a
//! one-shot listener on 127.0.0.1 at a free port, the consent page in the default browser
//! (through the opener plugin), the authorization code exchanged with PKCE (S256), and the
//! refresh token kept in the OS keychain. The page only ever gets short-lived access tokens,
//! through the three commands at the bottom.
//!
//! The client is a Google "Desktop app" OAuth client. Its id and secret come from the
//! environment at build time (`GOOGLE_DESKTOP_CLIENT_ID`, `GOOGLE_DESKTOP_CLIENT_SECRET`), or
//! at run time from the same variables, which win. Google doesn't treat a Desktop client's
//! secret as confidential (it ships in every copy of the app), but it still never goes in the
//! repository. Without a client id, sign-in says it isn't set up.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
/// The web app's scope: only files the app made or the person picked.
const SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
/// The keychain entry: one Google account per app install.
const KEYCHAIN_SERVICE: &str = "io.github.prestonhager.latexcollaborativeeditor.google";
const KEYCHAIN_USER: &str = "drive-refresh-token";
/// How long the browser has to come back with a code.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// The most of a request we read from the browser: a GET with a code and state fits easily.
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

/// What the page gets: an access token and how long it lasts. Never the refresh token.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccessToken {
    pub access_token: String,
    pub expires_in: u64,
}

/// The OAuth client from the environment, if this build has one.
#[derive(Debug, Clone, PartialEq)]
pub struct Client {
    pub id: String,
    pub secret: Option<String>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl Client {
    /// Run-time variables first (handy in development), then the ones baked in at build time.
    pub fn from_env() -> Option<Client> {
        Self::resolve(
            std::env::var("GOOGLE_DESKTOP_CLIENT_ID").ok(),
            std::env::var("GOOGLE_DESKTOP_CLIENT_SECRET").ok(),
            option_env!("GOOGLE_DESKTOP_CLIENT_ID"),
            option_env!("GOOGLE_DESKTOP_CLIENT_SECRET"),
        )
    }

    fn resolve(
        run_id: Option<String>,
        run_secret: Option<String>,
        build_id: Option<&str>,
        build_secret: Option<&str>,
    ) -> Option<Client> {
        if let Some(id) = non_empty(run_id) {
            return Some(Client { id, secret: non_empty(run_secret) });
        }
        let id = non_empty(build_id.map(str::to_string))?;
        Some(Client { id, secret: non_empty(build_secret.map(str::to_string)) })
    }
}

/// Errors the page maps to its own wording (frontend/src/storage/providers/desktopGoogleAuth.ts).
/// Only these short codes and a detail cross IPC, never a token.
#[derive(Debug, PartialEq)]
pub enum AuthError {
    NotConfigured,
    SignedOut,
    Expired,
    Cancelled,
    Denied,
    TimedOut,
    Keychain(String),
    Network(String),
    Google(String),
}

impl From<AuthError> for String {
    fn from(error: AuthError) -> String {
        match error {
            AuthError::NotConfigured => "not_configured".into(),
            AuthError::SignedOut => "signed_out".into(),
            AuthError::Expired => "expired".into(),
            AuthError::Cancelled => "cancelled".into(),
            AuthError::Denied => "denied".into(),
            AuthError::TimedOut => "timed_out".into(),
            AuthError::Keychain(detail) => format!("keychain: {detail}"),
            AuthError::Network(detail) => format!("network: {detail}"),
            AuthError::Google(detail) => format!("google: {detail}"),
        }
    }
}

/// Shared state: the HTTP client, and a way to cancel a sign-in still waiting for the browser.
pub struct GoogleAuth {
    http: reqwest::Client,
    pending: Mutex<Option<oneshot::Sender<()>>>,
}

impl Default for GoogleAuth {
    fn default() -> Self {
        let http = reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .unwrap_or_default();
        GoogleAuth { http, pending: Mutex::new(None) }
    }
}

/// PKCE's verifier and its S256 challenge (RFC 7636), and a state value to match the redirect.
#[derive(Debug)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

fn random_url_safe(bytes: usize) -> Result<String, AuthError> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| AuthError::Google(format!("no randomness: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

impl Pkce {
    pub fn new() -> Result<Pkce, AuthError> {
        // 32 bytes is a 43-character verifier, the shortest RFC 7636 allows, with 256 bits.
        let verifier = random_url_safe(32)?;
        let challenge = challenge_for(&verifier);
        Ok(Pkce { verifier, challenge, state: random_url_safe(16)? })
    }
}

/// The consent page's URL. `login_hint` is the remembered email, so Google skips the chooser.
pub fn auth_url(client: &Client, redirect_uri: &str, pkce: &Pkce, login_hint: Option<&str>) -> String {
    let mut url = tauri::Url::parse(AUTH_URL).expect("AUTH_URL is a valid URL");
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", &client.id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", SCOPE)
            .append_pair("code_challenge", &pkce.challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &pkce.state)
            // A refresh token, and consent every time so Google always sends one.
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
        if let Some(hint) = login_hint.filter(|h| !h.is_empty() && h.len() <= 320) {
            query.append_pair("login_hint", hint);
        }
    }
    url.into()
}

/// What the browser's request to the loopback listener said.
#[derive(Debug, PartialEq)]
pub enum Redirect {
    Code(String),
    Denied,
    /// Not the redirect (a favicon request, or a stale or forged state): answer it and keep waiting.
    Ignore,
}

/// Read the request line (`GET /?code=...&state=... HTTP/1.1`) and check the state.
pub fn parse_redirect(request: &str, state: &str) -> Redirect {
    let Some(target) = request
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("GET "))
        .and_then(|rest| rest.split(' ').next())
    else {
        return Redirect::Ignore;
    };
    let Ok(url) = tauri::Url::parse(&format!("http://127.0.0.1{target}")) else {
        return Redirect::Ignore;
    };
    if url.path() != "/" {
        return Redirect::Ignore;
    }
    let mut code = None;
    let mut error = None;
    let mut got_state = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            "state" => got_state = Some(value.into_owned()),
            _ => {}
        }
    }
    if got_state.as_deref() != Some(state) {
        return Redirect::Ignore;
    }
    match (code, error) {
        (Some(code), None) if !code.is_empty() => Redirect::Code(code),
        (_, Some(_)) => Redirect::Denied,
        _ => Redirect::Ignore,
    }
}

const PAGE_STYLE: &str = "body{font:16px system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222}";

fn page(status: &str, title: &str, text: &str) -> String {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>{title}</title><style>{PAGE_STYLE}</style><h1>{title}</h1><p>{text}</p>"
    );
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

async fn read_request(stream: &mut TcpStream) -> String {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while buf.len() < MAX_REQUEST_BYTES {
        match tokio::time::timeout(Duration::from_secs(5), stream.read(&mut chunk)).await {
            Ok(Ok(0)) | Err(_) | Ok(Err(_)) => break,
            Ok(Ok(n)) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

/// Wait on the listener for the browser's redirect, answering each request with a small page.
pub async fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, AuthError> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| AuthError::Network(e.to_string()))?;
        let request = read_request(&mut stream).await;
        let (reply, result) = match parse_redirect(&request, state) {
            Redirect::Code(code) => (
                page("200 OK", "Signed in", "You can close this tab and go back to the LaTeX Collaborative Editor app."),
                Some(Ok(code)),
            ),
            Redirect::Denied => (
                page("200 OK", "Sign-in canceled", "Google Drive wasn't connected. You can close this tab."),
                Some(Err(AuthError::Denied)),
            ),
            Redirect::Ignore => (page("404 Not Found", "Not found", "Nothing here."), None),
        };
        let _ = stream.write_all(reply.as_bytes()).await;
        let _ = stream.shutdown().await;
        if let Some(result) = result {
            return result;
        }
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

impl GoogleAuth {
    async fn token_request(&self, form: &[(&str, &str)]) -> Result<TokenResponse, AuthError> {
        let res = self
            .http
            .post(TOKEN_URL)
            .form(form)
            .send()
            .await
            .map_err(|e| AuthError::Network(e.without_url().to_string()))?;
        let body: TokenResponse = res.json().await.map_err(|e| AuthError::Network(e.without_url().to_string()))?;
        match body.error.as_deref() {
            // The refresh token was revoked, or expired after six months unused.
            Some("invalid_grant") => Err(AuthError::Expired),
            Some(error) => Err(AuthError::Google(body.error_description.clone().unwrap_or_else(|| error.to_string()))),
            None if body.access_token.is_none() => Err(AuthError::Google("no access token in the answer".into())),
            None => Ok(body),
        }
    }

    /// Cancel a sign-in that's still waiting (a second Connect click starts over).
    fn replace_pending(&self, next: Option<oneshot::Sender<()>>) {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(previous) = pending.take() {
            let _ = previous.send(());
        }
        *pending = next;
    }
}

fn to_access_token(body: TokenResponse) -> AccessToken {
    AccessToken {
        access_token: body.access_token.unwrap_or_default(),
        expires_in: body.expires_in.unwrap_or(3600),
    }
}

/// The keychain calls block (Secret Service talks D-Bus), so they run off the async runtime.
async fn keychain<T: Send + 'static>(
    work: impl FnOnce(&keyring::Entry) -> keyring::Result<T> + Send + 'static,
) -> Result<T, AuthError> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)?;
        work(&entry)
    })
    .await
    .map_err(|e| AuthError::Keychain(e.to_string()))?
    .map_err(|e| match e {
        keyring::Error::NoEntry => AuthError::SignedOut,
        other => AuthError::Keychain(other.to_string()),
    })
}

async fn saved_refresh_token() -> Result<String, AuthError> {
    keychain(|entry| entry.get_password()).await
}

async fn forget_refresh_token() -> Result<(), AuthError> {
    match keychain(|entry| entry.delete_credential()).await {
        Ok(()) | Err(AuthError::SignedOut) => Ok(()),
        Err(other) => Err(other),
    }
}

/// Sign in in the browser. Resolves once the browser comes back, or fails on cancel or timeout.
#[tauri::command]
pub async fn google_sign_in<R: Runtime>(
    app: AppHandle<R>,
    auth: State<'_, GoogleAuth>,
    login_hint: Option<String>,
) -> Result<AccessToken, String> {
    let client = Client::from_env().ok_or(AuthError::NotConfigured)?;
    let pkce = Pkce::new()?;
    // Loopback on IPv4 at any free port: a Desktop client allows http://127.0.0.1:<any port>.
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| AuthError::Network(e.to_string()))?;
    let port = listener.local_addr().map_err(|e| AuthError::Network(e.to_string()))?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let url = auth_url(&client, &redirect_uri, &pkce, login_hint.as_deref());

    let (cancel_tx, cancel_rx) = oneshot::channel();
    auth.replace_pending(Some(cancel_tx));
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AuthError::Network(format!("couldn't open the browser: {e}")))?;

    let code = tokio::select! {
        result = tokio::time::timeout(SIGN_IN_TIMEOUT, wait_for_code(listener, &pkce.state)) => {
            result.map_err(|_| AuthError::TimedOut)??
        }
        _ = cancel_rx => return Err(AuthError::Cancelled.into()),
    };

    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("code_verifier", pkce.verifier.as_str()),
        ("client_id", client.id.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    if let Some(secret) = client.secret.as_deref() {
        form.push(("client_secret", secret));
    }
    let body = auth.token_request(&form).await?;
    if let Some(refresh) = body.refresh_token.clone() {
        keychain(move |entry| entry.set_password(&refresh)).await?;
    }
    Ok(to_access_token(body))
}

/// A fresh access token from the refresh token in the keychain, with no browser.
#[tauri::command]
pub async fn google_access_token(auth: State<'_, GoogleAuth>) -> Result<AccessToken, String> {
    let client = Client::from_env().ok_or(AuthError::NotConfigured)?;
    let refresh = saved_refresh_token().await?;
    let mut form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh.as_str()),
        ("client_id", client.id.as_str()),
    ];
    if let Some(secret) = client.secret.as_deref() {
        form.push(("client_secret", secret));
    }
    match auth.token_request(&form).await {
        Ok(body) => Ok(to_access_token(body)),
        Err(AuthError::Expired) => {
            // A dead refresh token is no use to anyone: forget it, so the app asks to connect.
            let _ = forget_refresh_token().await;
            Err(AuthError::Expired.into())
        }
        Err(other) => Err(other.into()),
    }
}

/// Log out: forget the refresh token, then ask Google to revoke it (best effort).
#[tauri::command]
pub async fn google_sign_out(auth: State<'_, GoogleAuth>) -> Result<(), String> {
    auth.replace_pending(None);
    let refresh = match saved_refresh_token().await {
        Ok(token) => Some(token),
        Err(AuthError::SignedOut) => None,
        Err(other) => return Err(other.into()),
    };
    forget_refresh_token().await?;
    if let Some(token) = refresh {
        let _ = auth
            .http
            .post(REVOKE_URL)
            .form(&[("token", token.as_str())])
            .timeout(Duration::from_secs(5))
            .send()
            .await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_comes_from_run_time_then_build_time() {
        assert_eq!(Client::resolve(None, None, None, None), None);
        assert_eq!(Client::resolve(Some(" ".into()), None, None, None), None);
        assert_eq!(
            Client::resolve(None, None, Some("built.apps.googleusercontent.com"), Some("s")),
            Some(Client { id: "built.apps.googleusercontent.com".into(), secret: Some("s".into()) })
        );
        assert_eq!(
            Client::resolve(Some("run".into()), None, Some("built"), Some("s")),
            Some(Client { id: "run".into(), secret: None })
        );
    }

    #[test]
    fn pkce_matches_rfc_7636() {
        // RFC 7636, appendix B.
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let a = Pkce::new().unwrap();
        let b = Pkce::new().unwrap();
        assert_eq!(a.verifier.len(), 43);
        assert_eq!(a.challenge, challenge_for(&a.verifier));
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.state, b.state);
    }

    #[test]
    fn auth_url_has_pkce_offline_access_and_only_drive_file() {
        let client = Client { id: "id.apps.googleusercontent.com".into(), secret: Some("secret".into()) };
        let pkce = Pkce { verifier: "v".into(), challenge: "c".into(), state: "s".into() };
        let url = tauri::Url::parse(&auth_url(&client, "http://127.0.0.1:4321", &pkce, Some("ada@example.com"))).unwrap();
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(q["client_id"], "id.apps.googleusercontent.com");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:4321");
        assert_eq!(q["scope"], "https://www.googleapis.com/auth/drive.file");
        assert_eq!(q["code_challenge"], "c");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], "s");
        assert_eq!(q["access_type"], "offline");
        assert_eq!(q["login_hint"], "ada@example.com");
        // The secret never goes in the browser.
        assert!(!url.as_str().contains("secret"));
        let no_hint = auth_url(&client, "http://127.0.0.1:1", &pkce, Some(""));
        assert!(!no_hint.contains("login_hint"));
    }

    #[test]
    fn redirect_needs_the_right_state() {
        let ok = "GET /?state=abc&code=4%2F0Ab&scope=x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(parse_redirect(ok, "abc"), Redirect::Code("4/0Ab".into()));
        assert_eq!(parse_redirect(ok, "other"), Redirect::Ignore);
        assert_eq!(parse_redirect("GET /?state=abc&error=access_denied HTTP/1.1\r\n", "abc"), Redirect::Denied);
        assert_eq!(parse_redirect("GET /favicon.ico HTTP/1.1\r\n", "abc"), Redirect::Ignore);
        assert_eq!(parse_redirect("POST /?state=abc&code=x HTTP/1.1\r\n", "abc"), Redirect::Ignore);
        assert_eq!(parse_redirect("GET /?state=abc&code= HTTP/1.1\r\n", "abc"), Redirect::Ignore);
        assert_eq!(parse_redirect("", "abc"), Redirect::Ignore);
    }

    #[tokio::test]
    async fn loopback_answers_and_returns_the_code() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiting = tokio::spawn(async move { wait_for_code(listener, "st").await });
        let send = |path: &'static str| async move {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            stream
                .write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
                .await
                .unwrap();
            let mut reply = String::new();
            stream.read_to_string(&mut reply).await.unwrap();
            reply
        };
        assert!(send("/favicon.ico").await.starts_with("HTTP/1.1 404"));
        assert!(send("/?state=wrong&code=x").await.starts_with("HTTP/1.1 404"));
        let reply = send("/?state=st&code=the-code").await;
        assert!(reply.starts_with("HTTP/1.1 200"));
        assert!(reply.contains("Content-Security-Policy: default-src 'none'"));
        assert_eq!(waiting.await.unwrap(), Ok("the-code".to_string()));
    }

    #[test]
    fn errors_cross_ipc_as_short_codes() {
        assert_eq!(String::from(AuthError::NotConfigured), "not_configured");
        assert_eq!(String::from(AuthError::Expired), "expired");
        assert_eq!(String::from(AuthError::SignedOut), "signed_out");
        assert_eq!(String::from(AuthError::Cancelled), "cancelled");
        assert_eq!(String::from(AuthError::Denied), "denied");
        assert_eq!(String::from(AuthError::TimedOut), "timed_out");
        assert_eq!(String::from(AuthError::Network("x".into())), "network: x");
        assert_eq!(String::from(AuthError::Keychain("x".into())), "keychain: x");
        assert_eq!(String::from(AuthError::Google("x".into())), "google: x");
    }
}
