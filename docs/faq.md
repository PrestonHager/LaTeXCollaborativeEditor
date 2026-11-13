# FAQ

## Do I need an account?

No.
You can write, preview, share, and save to your browser without signing in.
You only sign in to Google if you want to save to Drive.

## Where is my work saved?

If you're the host, in this browser's storage, or in your Google Drive if you connected it.
The autosave pill tells you which.
A project isn't saved until it has a name, so click the title and name it.
See [Saving and storage](saving-and-storage.md).

## Does my document go through a server?

Not ours.
When you share, browsers find each other through public trackers, then send the document straight to each other over WebRTC.
The trackers only see the room id, not your document.
If you save to Drive, your files go to Google, of course.
The preview fonts and styles load from a CDN, but your LaTeX never leaves your browser for the preview.

## Who can see my document?

Anyone with the share link, while a host or guest is in the room.
Treat the link like a key.
To cut everyone off, click **New link** next to Share.

## Why is the preview different from my PDF?

The preview uses LaTeX.js, which turns LaTeX into a web page in your browser.
It's quick, but it isn't a full TeX engine, and not every package works.
See [What's supported](whats-supported.md).

## Can I get a PDF?

Not from the app yet.
Download the project as a `.zip` and build it with your usual LaTeX setup, or upload the zip to another service.

## Can I import my Overleaf project?

Yes.
Download the project from Overleaf as a zip, then use **File > Upload .zip as New Project**.
Check [What's supported](whats-supported.md) for what the preview can show.

## How do I sign out of Google Drive?

Use **File > Disconnect Google Drive**.
It revokes the app's token, and your edits keep saving in this browser.
The sign-in only lasts for the tab anyway, so a new tab starts signed out.
To see who's signed in, open **Settings** or hover the autosave pill.

## What if a file changes in Drive while I'm working on it?

The app won't overwrite it without asking.
Saving pauses for that file, and a dialog asks whether to keep your copy, take the Drive one, or save yours as a copy.
See [When a file changed somewhere else](saving-and-storage.md#when-a-file-changed-somewhere-else).

## Why can't the app see a file I added to the Drive folder?

The app only has permission to see files it made or that you picked.
That keeps it out of the rest of your Drive.
Use **File > Add Files from Drive** and pick the file, so the app can see it.
See [Adding files from Drive](saving-and-storage.md#adding-files-from-drive).

## Can a guest save the project?

No.
The host's browser does all the saving.
Guests can edit, add files, and download a `.zip` of their copy.

## What happens if the host closes the tab?

Guests keep their copy and can keep typing, but nothing gets saved.
If the host just reloads the tab, it rejoins the same room, and edits sync back.
If the host closes the tab and opens a new one, that's a new room, and guests need a new link.

## How do I undo a file delete?

You can't from the app.
Undo only covers typing.
Get the file back from a downloaded zip or your Drive copy (Drive deletes go to the Drive trash).

## Does it work offline?

Partly.
Once the page is loaded, you can keep typing and it saves to your browser.
Collaboration, Drive, and the preview styles need a connection.

## How do I report a bug?

Open an issue on the [repository](https://github.com/PrestonHager/LaTeXCollaborativeEditor/issues).
Say what you did, what you expected, and what happened.
Please leave out your document, room links, and any tokens.
You can also use **Help > Report a Bug**, which fills in your browser and app version.

## How do I report a security problem?

Don't open a public issue for it.
Use **Help > Report a Security Issue**, or GitHub's private [Report a vulnerability](https://github.com/PrestonHager/LaTeXCollaborativeEditor/security/advisories/new) form.
Only the maintainers see it.
The [security policy](https://github.com/PrestonHager/LaTeXCollaborativeEditor/blob/main/SECURITY.md) says what's in scope, what to include, and when you'll hear back.
