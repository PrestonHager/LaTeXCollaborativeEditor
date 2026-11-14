# Troubleshooting

This page covers the problems people hit most.
Each section says what you'll see, why it happens, and what to try.
For the meaning of a single status message, see [Status and error messages](messages.md).

If none of this helps, open an issue on the [repository](https://github.com/PrestonHager/LaTeXCollaborativeEditor/issues).
Please don't paste your document, room link, or any tokens into it.
If it looks like a security problem, don't post it publicly. Use **Help > Report a Security Issue** or the [private vulnerability form](https://github.com/PrestonHager/LaTeXCollaborativeEditor/security/advisories/new) instead.

## P2P connection problems

What you see: the connection badge stays on **Looking for the host** or **Can't reach the host**, or a guest's Files panel keeps saying "Waiting for the host".

How it works: browsers find each other through public trackers, then connect directly over WebRTC.
There's no server of ours in between, so both browsers have to be able to reach each other.

Things to try:

- Make sure the host tab is still open. Guests can only sync while a host or another guest is in the room.
- Make sure everyone has the same link, with the same `?room=` value. If the host clicked **New link**, the old link stops working.
- Wait a bit. On **Reconnecting**, the app rejoins on its own after 1 second, then 2, 4, and so on, up to every 20 seconds.
- Reload the guest tab. The host can reload too, it rejoins the same room.
- Turn off a VPN, or try another network. Some company, school, and hotel networks block WebRTC.
- Check that an ad or tracker blocker isn't blocking the tracker sites (`tracker.openwebtorrent.com` and similar).
- Use an up-to-date browser. Very old browsers and some privacy modes turn WebRTC off. When WebRTC is off, Share and room links say "This window can't make peer-to-peer connections" (see [When a window can't share](collaboration.md#when-a-window-cant-share)).
- If two people are on very strict networks, they may need a TURN server. That's set up by whoever runs the site, not in the app.

**Relayed** means you're connected, just through a TURN server instead of directly.
That's fine, it's only a longer path.

If a guest's image stays on "Getting this file from a peer", the peer that has it may have left.
The app asks again a few times, then gives up until someone with the file joins.

## Drive sign-in

What you see: a status like **Drive: Connection failed**, **Drive: Sign-in was canceled**, **Drive: Access was denied**, **Drive: Session expired**, or **Drive needs you to reconnect; saving locally**.

Things to try:

- **Drive config missing** or **Drive: API key missing** means this copy of the site wasn't set up with Google keys. You can't fix that from the app. Use local storage, or ask whoever runs the site.
- **Sign-in was canceled** means the popup was closed before you finished. Try again and pick your account.
- **Access was denied** means you said no to Drive access. Try again and allow it, or the app can't save there.
- **Connection failed** usually means the Google sign-in script couldn't load. Check your connection and any script blockers.
- **Session expired** means your Google sign-in ran out. Sign-ins last about an hour. The app tries to renew quietly, and if that fails, it saves to this browser so nothing is lost. Use **File > Connect Google Drive** to switch back.
- **Drive needs you to reconnect; saving locally** shows when you open the app in a new tab or a restarted browser. The sign-in is kept per tab in `sessionStorage`, so only a reload of the same tab stays signed in. Use **File > Connect Google Drive**.
- To sign out on purpose, use **File > Disconnect Google Drive**. It revokes the token, and edits keep saving in this browser.

If a Drive save fails:

- **Google Drive is full** means your Drive is out of space. The app stops retrying. Free up space in Drive, or download a `.zip` so you don't lose work.
- **Google is limiting requests** means Google wants the app to slow down. The app retries a few times, then the next autosave tries again. Wait a minute.
- **Permission denied** usually means the file's sharing settings don't let you change it.

The app only asks for the `drive.file` permission.
That means it can see files it made and files you pick, but nothing else in your Drive.
If you add a file to a project folder from Drive itself, the app won't see it.
Use **File > Add Files from Drive** and pick it, or upload it from the editor instead.
See [Adding files from Drive](saving-and-storage.md#adding-files-from-drive).

## Popups blocked

What you see: **Drive: Sign-in popup was blocked. Allow popups for this site and try again.**

Google sign-in opens in a popup, and browsers block popups that don't come straight from a click.

Things to try:

- Look for the blocked-popup icon in the address bar, and allow popups for this site.
- Then click the menu item again, like **File > Connect Google Drive**.
- After a reload with an expired sign-in, the app won't open the popup by itself, since the browser would block it. Use the File menu.

## Storage full

What you see: **Browser storage is full. Download a .zip copy, then delete old local projects.**
Or a message that starts with **Could not** and ends with **in browser storage. Private browsing or site settings may be blocking it.**

Local projects live in your browser's storage for this site, and browsers limit how much a site can keep.

Things to try:

1. Download a copy first with **File > Download Project .zip**, so you don't lose work.
2. Clear old projects with **File > Clear Local Projects** (or the button in Settings). This deletes every project saved in this browser, so make sure you have copies of the ones you want.
3. Or save to Google Drive instead, with **File > Save to Google Drive**.

Private browsing windows often have very little storage, or none.
Some browsers also clear site storage after a while, so don't use browser storage as your only copy.

## A file changed somewhere else

What you see: a dialog titled **File changed somewhere else**, and the autosave pill says **Saving paused for N file(s) changed in ...**.

A file changed in storage since the app last saved it, maybe in the Drive web UI, on another device, or in another tab.
The app won't overwrite it without asking.
Pick **Keep mine**, **Take theirs**, or **Save mine as a copy**.
Only that file waits, the rest keep saving.
See [When a file changed somewhere else](saving-and-storage.md#when-a-file-changed-somewhere-else).

## Preview errors

What you see: the compile pill says **Compile Error**, the footer shows something like "1 diagnostic(s). ... (main.tex line 12)", or the footer says **Not found in the project: ...**.

The preview uses LaTeX.js, which handles a lot of LaTeX but not all of it.
See [What's supported](whats-supported.md) for the details.

Things to try:

- Read the footer. It names the file and line of the first error. If that file is open, its line has a red mark too.
- If the error is in another file, open that file from the Files panel.
- If the footer says **Not found in the project**, check the path in `\input`, `\includegraphics`, or `\bibliography`. Paths are relative to the project root, and folders use `/`.
- If an image file is there but the preview shows a note instead, it might be a PDF or EPS. The preview can't show those yet. Use PNG, JPG, or SVG.
- If a package isn't supported, try the preview without it, or wrap package-specific code so it only runs in real LaTeX.
- If the compile pill says **No main file**, click the star next to the `.tex` file that has `\documentclass`.
- Use **View > Compile Now** (**Ctrl+Enter**) to force a fresh preview.

The preview pulls its fonts and styles from a CDN (`cdn.jsdelivr.net`).
If that's blocked, the preview may look unstyled.

## Other things

- **The share link didn't copy.** The notice says "Could not copy automatically." Copy the link shown next to **Share** by hand. Clipboard access needs HTTPS and a focused page.
- **Something went wrong. Check the browser console for details.** An error the app didn't expect. Open your browser's developer tools to see more, and please report it.
- **The page warns me when I close it.** Something could still be lost: edits that haven't reached Google Drive, saving is paused, the last save failed, a file is waiting on the conflict dialog, files are still uploading or arriving, or browser storage is full. Wait for the autosave pill to say Saved, resume saving, or answer the dialog.
- **"A new version of the app is available" keeps showing.** It shows once per new version. Click **Reload to update**. If it says "Couldn't save", fix the save first (see the autosave pill), or use **Reload anyway** if you're sure. A part of the page that fails to load after a deploy shows the same card, and reloading fixes it.
