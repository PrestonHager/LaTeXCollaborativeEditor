# How the app fits together

This page is a map of the app.
It shows the main areas of the screen, how you get to each one, and what happens step by step for the common tasks.
If you want the details on any one piece, follow the links.

![The main screen with each area labeled](assets/screenshots/overview-light.png#only-light)
![The main screen with each area labeled](assets/screenshots/overview-dark.png#only-dark)

## UI map

Everything lives on one page.
The header holds the project name, the menus, Share, and the status pills.
Below it are the Files panel, the editor, and the preview.
The footer shows diagnostics.
Dialogs open on top of all of that.

```mermaid
flowchart TB
    subgraph Header
        Title["Project name<br/>(click to rename)"]
        Menus["Menu bar<br/>File / Edit / View / Help"]
        Share["Share and New link"]
        Pills["Status pills<br/>connection / compile / autosave"]
        Notice["Notice text"]
    end
    subgraph Workspace
        Files["Files panel<br/>(file tree)"]
        Editor["Editor<br/>(text files)"]
        Viewer["File viewer<br/>(images, PDFs)"]
        Preview["Preview"]
    end
    Footer["Footer<br/>diagnostics, Privacy, ToS, Repository, version"]

    subgraph Dialogs
        Palette["Command palette"]
        Settings["Settings"]
        Upload["Upload files"]
        Projects["Open a project"]
        DrivePicker["Google Drive picker"]
        Conflict["File changed somewhere else"]
    end

    Menus -- "Help > Command Palette<br/>or Ctrl+P" --> Palette
    Menus -- "Edit > Settings<br/>or Ctrl+," --> Settings
    Menus -- "File > Upload Files" --> Upload
    Files -- "Upload button<br/>or drop files" --> Upload
    Menus -- "File > Open Local Project<br/>or Ctrl+O" --> Projects
    Menus -- "File > Open from Google Drive<br/>or Ctrl+Shift+O" --> DrivePicker
    Files -- "click a text file" --> Editor
    Files -- "click an image or PDF" --> Viewer
    Editor -- "typing (after a short pause)" --> Preview
    Preview -- "errors" --> Footer
    Editor -- "autosave finds a file<br/>changed in storage" --> Conflict
    Menus -- "View > Split / Editor Only / Preview Only" --> Workspace
```

Where to read more about each area:

- Header and menus: [Interface and layout](interface-layout.md).
- Files panel and viewer: [Projects and files](projects.md).
- Editor, preview, and footer: [Editing and preview](editing-and-preview.md).
- Share and the connection pill: [Sharing and collaboration](collaboration.md).
- Autosave pill and Drive: [Saving and storage](saving-and-storage.md).

## User flows

### Starting a new document or project

A new tab gives you a starter project with one `main.tex`.
It isn't saved until it has a name.
New Project is host only, and its confirm warns that it clears the project for everyone in the room.

```mermaid
flowchart TD
    A([Open the app]) --> B{Saved session<br/>in this browser?}
    B -- yes --> C[Pick up the last project]
    B -- no --> D[Starter project<br/>with main.tex]
    C --> E[Edit]
    D --> E
    N([File > New Project<br/>or Ctrl+Shift+N, host only]) --> F{Confirm?<br/>clears it for the room}
    F -- no --> E
    F -- yes --> G[Save what's pending<br/>on the old project]
    G --> D
    E --> H{Project has a name?}
    H -- no --> I[Nothing saved yet.<br/>Click the title or Save Now<br/>to name it]
    I --> J[Type a name]
    J --> K[Autosave writes it<br/>to this browser or Drive]
    H -- yes --> K
```

### Sharing a room and someone joining

The host clicks Share, sends the link, and the guest opens it.
Both browsers find each other through public trackers, then connect directly over WebRTC.

```mermaid
flowchart TD
    A([Host clicks Share]) --> B[App makes a room id<br/>and joins it]
    B --> C[Link with ?room=... is copied<br/>and shown next to Share]
    C --> D[Host sends the link]
    D --> E([Guest opens the link])
    E --> F[Guest joins the same room<br/>through the trackers]
    F --> G{Found a peer?}
    G -- not yet --> H[Badge says Looking for the host.<br/>The app keeps looking]
    H --> G
    G -- yes --> I[Badge says Connected with 1 other person]
    I --> J[Host sends the whole project]
    J --> K[Guest sees the file tree<br/>and asks for images it's missing]
    K --> L[Both edit the same files live]
```

### Connecting Google Drive and saving

Drive only works if the site was set up with Google keys.
Sign-in happens in a popup, so allow popups for the site.

```mermaid
flowchart TD
    A([File > Save to Google Drive]) --> B{Project has a name?}
    B -- no --> C[Prompt for a name]
    C -- canceled --> X([Save canceled])
    C -- named --> D
    B -- yes --> D{Signed in to Drive?}
    D -- yes --> F
    D -- no --> E[Google sign-in popup]
    E -- blocked --> P([Status: Sign-in popup was blocked])
    E -- closed --> Q([Status: Sign-in was canceled])
    E -- signed in --> F[Saves now go to Drive]
    F --> G[Make a project folder in Drive<br/>on the first save]
    G --> H[Write each changed file]
    H --> I([Status: Drive: Saved name])
    I --> J[Autosave keeps writing to Drive]
```

**File > Connect Google Drive** does the same sign-in, then switches autosave over to Drive without saving right away.
**File > Disconnect Google Drive** signs out, revokes the token, and sends saves back to this browser.

If a save finds that a file changed in Drive since the app last saved it, the app doesn't overwrite it.
Saving pauses for that file, and the conflict dialog asks you to pick **Keep mine**, **Take theirs**, or **Save mine as a copy**.
See [When a file changed somewhere else](saving-and-storage.md#when-a-file-changed-somewhere-else).

### Opening a project

You can open a project from this browser, from Drive, or from a `.zip`.

```mermaid
flowchart TD
    A{Where is it?}
    A -- this browser --> B([File > Open Local Project])
    B --> C[Open a project dialog]
    C --> D[Click a project]
    A -- Google Drive --> E([File > Open from Google Drive])
    E --> F[Sign in if needed]
    F --> G[Drive picker:<br/>pick a project folder<br/>or an old .tex file]
    A -- a .zip file --> H([File > Upload .zip as New Project])
    H --> I[Pick the .zip]
    D --> J[Save what's pending<br/>on the current project]
    G --> J
    I --> J
    J --> K[Load the files]
    K --> L([Open the main file])
```

### Uploading an image

```mermaid
flowchart TD
    A{How?}
    A -- button --> B([Upload button in Files<br/>or File > Upload Files])
    B --> C[Pick a folder in Upload into]
    C --> D[Drop files or click to pick]
    A -- drag and drop --> E([Drop files on the Files panel])
    E --> F{Dropped on a folder?}
    F -- yes --> G[Goes into that folder]
    F -- no --> H[Goes into the project root]
    D --> I{Over 10 MB?}
    G --> I
    H --> I
    I -- yes --> J([Refused: too big])
    I -- no --> K[Added to the file tree]
    K --> L[Use it with<br/>\includegraphics in a .tex file]
    L --> M[Preview shows the image]
    K --> N[Peers ask for it<br/>and get it over WebRTC]
```

### Fixing a compile error

```mermaid
flowchart TD
    A([You type]) --> B[Compile pill: Waiting]
    B --> C[Compile pill: Compiling]
    C --> D{LaTeX.js happy?}
    D -- yes --> E([Compile pill: Compiled<br/>preview updates])
    D -- no --> F[Footer shows the count<br/>and the first error<br/>with file and line]
    F --> G[Red mark on that line<br/>if the file is open]
    G --> H{Error in another file?}
    H -- yes --> I[Open that file<br/>from the Files panel]
    H -- no --> J[Fix the line]
    I --> J
    J --> A
    D -- "file not found" --> K[Footer: Not found in the project]
    K --> L[Fix the path or upload the file]
    L --> A
```

## State diagrams

### Autosave on and off

Autosave turns on for the host once browser storage is ready.
It only writes a project that has a name.
A file that changed in storage since the last save is held back until you answer the conflict dialog, while the other files keep saving.
Guests never save, the host does.
**Pause Saving** stops autosave and **Save Now** until you turn it off.
What changed in the meantime saves as soon as you resume.

```mermaid
stateDiagram-v2
    [*] --> Starting
    Starting --> Guest: page has ?room=
    Starting --> Enabled: host, storage ready
    Guest --> [*]
    state Enabled {
        [*] --> Idle
        Idle --> Pending: edit (project has a name)
        Pending --> Saving: 4 seconds without edits,<br/>or Save Now
        Saving --> Saved: write worked
        Saving --> Pending: edits came in during the save
        Saving --> SaveError: failed after retries
        Saving --> Held: a file changed in storage<br/>(only that file)
        Held --> Pending: you picked in the conflict dialog
        Saved --> Pending: edit
        SaveError --> Pending: edit
    }
    Enabled --> Paused: Pause Saving
    Paused --> Enabled: Resume Saving<br/>(saves what changed)
```

The pill text for each state is in [Status and error messages](messages.md#autosave-pill).

### Google Drive connected and expired

The Drive sign-in lives in the tab's `sessionStorage`.
A reload in the same tab keeps it, but a new tab or a restarted browser starts signed out.

```mermaid
stateDiagram-v2
    [*] --> Local
    Local --> Connecting: Connect, Save to, or Open from Drive
    Connecting --> Connected: sign-in worked
    Connecting --> Local: popup blocked, canceled,<br/>or config missing
    Connected --> Refreshing: token near its 1 hour limit
    Refreshing --> Connected: new token, no popup
    Refreshing --> Expired: Google said no
    Expired --> Local: saves fall back to this browser,<br/>notice in the header
    Local --> Connecting: File > Connect Google Drive
    Connected --> Local: File > Disconnect Google Drive<br/>(token revoked)
    Connected --> Local: new tab, or reload after the token ran out<br/>("Drive needs you to reconnect")
```

### Host and guest

```mermaid
stateDiagram-v2
    [*] --> Host: no ?room= in the address
    [*] --> Guest: opened a ?room= link
    state Host {
        [*] --> Solo
        Solo --> Sharing: Share
        Sharing --> Sharing: reload (same room)
        Sharing --> Sharing: New link (new room,<br/>old guests dropped)
    }
    state Guest {
        [*] --> Waiting: "Waiting for the host"
        Waiting --> Synced: host sent the project
        Synced --> HostAway: host left or reloaded
        HostAway --> Synced: host back with the same project<br/>(edits merge both ways)
        HostAway --> Synced: host back with a different project<br/>(guest starts over from it)
    }
```

While the host is away, a guest keeps its copy and can keep typing.
Those edits reach the host when it comes back, as long as the host is still on the same project.

### Peer connection

These are the connection states behind the badge.
The badge says them in plainer words, like "Shared, waiting for others" or "Can't reach the host". See [Connection status](collaboration.md#connection-status).

```mermaid
stateDiagram-v2
    [*] --> NotSharing
    NotSharing: Not sharing
    NotSharing --> Waiting: Share, or open a link
    Waiting: Waiting for peers
    Waiting --> Connected: a peer joined directly
    Waiting --> Relayed: a peer joined through TURN
    Connected --> Relayed: another peer joined through TURN
    Connected --> Reconnecting: last peer left
    Relayed --> Reconnecting: last peer left
    Reconnecting --> Waiting: rejoin (1, 2, 4... up to 20 seconds)
```

Waiting for peers has no timeout, since nobody joining yet is normal.
Relayed means the connection really goes through a TURN server, which the app checks with `getStats()` when a peer joins.
