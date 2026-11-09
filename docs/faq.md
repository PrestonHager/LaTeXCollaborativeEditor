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

## Why can't the app see a file I added to the Drive folder?

The app only has permission to see files it made or that you picked.
That keeps it out of the rest of your Drive.
Upload the file from the editor instead.

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
