# Status and error messages

This page lists the messages the app shows and what they mean.
If something's wrong and you're not sure where to start, try [Troubleshooting](troubleshooting.md) first.

The app shows messages in a few places:

- The three **status pills** at the top right: connection, compile, and autosave.
- The **notice** text in the header, next to Share. Most notices clear after about 8 seconds. Errors are red.
- The **loading bar** under the header, while something big is happening.
- The **footer**, for preview diagnostics.
- **Confirm and name dialogs**, when the app needs a yes or a name.

![The status pills and notice area](assets/screenshots/status-light.png#only-light)
![The status pills and notice area](assets/screenshots/status-dark.png#only-dark)

## Connection pill

| Text | What it means |
| --- | --- |
| Not shared | You haven't clicked Share and you're not in a room. |
| Shared, waiting for others | You're the host and nobody else has joined yet. |
| Looking for the host | You opened a link and the host hasn't shown up yet. |
| Connected with 2 other people | Peers are connected directly. The number is how many. |
| Connected with 1 other person (relayed) | At least one peer goes through a TURN relay server. |
| Can't reach the host | You're a guest and the host dropped off. The app rejoins and waits. |

More: [P2P connection problems](troubleshooting.md#p2p-connection-problems).

## Compile pill

| Text | What it means |
| --- | --- |
| Idle | Nothing to compile yet. |
| Waiting | You just typed. The preview runs after a short pause. |
| Compiling | The preview is being built. The preview also says "Updating preview...". |
| Compiled | The preview is up to date. Any errors are in the footer. |
| Compile Error | The preview step crashed. The footer has the error. |
| No main file | The project has files, but none is the main file. Click the star on a `.tex` file. |

More: [Preview errors](troubleshooting.md#preview-errors).

## Autosave pill

This pill shows saving for the host, and the host's storage for guests.
Drive messages show here too.

| Text | What it means |
| --- | --- |
| Autosave Off | The page is still loading. |
| Autosave Enabled, Autosave On | Autosave is ready. A project with a name gets saved as you type. |
| Saving pending | You made changes. They save after 4 seconds without typing. |
| Saving | A save is running. |
| Saved to this browser | Saved to browser storage. |
| Saved to Google Drive | Saved to your Drive. |
| Save Error: ... | The save failed after a few retries. The rest of the message says why. |
| Waiting for N file(s) from peers | A guest uploaded files that haven't reached the host yet. They save once they arrive. |
| Saving paused for N file(s) changed in Google Drive | A file changed in storage since the app last saved it. That file waits for your pick in the conflict dialog. Other files keep saving. |
| Saved your copy of path as a new file | You picked **Save mine as a copy** in the conflict dialog. |
| Loaded path from Google Drive | You picked **Take theirs** in the conflict dialog. |
| Opened name | A project finished opening. |
| Saving paused | You turned on Pause Saving. Nothing saves until you resume. |
| Local projects cleared | **Clear Local Projects** finished. |
| No local projects to clear | There was nothing to clear. |
| Saved on host local storage | You're a guest. The host saves to their browser. |
| Saved on host Google Drive | You're a guest. The host saves to their Drive. |

For the conflict messages, see [When a file changed somewhere else](saving-and-storage.md#when-a-file-changed-somewhere-else).

When you're signed in to Drive, hover the pill to see the account, like "Google Drive: you@example.com".

More: [Saving and storage](saving-and-storage.md#autosave-and-save-now).

### Drive messages

| Text | What it means |
| --- | --- |
| Drive: Connecting... | The Google sign-in is open or loading. |
| Drive: Connected | Signed in. Saves go to Drive. |
| Drive: Connected (name the project to save) | Signed in, but the project needs a name before it can save. |
| Drive: Session restored | After a reload, your Drive sign-in was still good. |
| Drive needs you to reconnect; saving locally. Use File > Connect Google Drive. | You were saving to Drive, but this tab has no good sign-in. That happens in a new tab, a restarted browser, or a reload after the sign-in ran out. Saves go to this browser for now. |
| Drive: Saving... / Drive: Saved name | **Save to Google Drive** is running, then done. |
| Drive: Opening picker... | The Drive picker is loading. |
| Drive: Selection canceled | You closed the picker without picking. |
| Drive: Select destination folder... / Drive: Moved to folder | **Move to Drive Folder** is running, then done. |
| Drive: Move canceled | You closed the folder picker. |
| Drive: Save the project to Drive first | **Move to Drive Folder** only works for a project saved in Drive. |
| Drive config missing | This site has no Google client id. Drive can't be used here. |
| Drive: API key missing | This site has no Google API key, so the picker can't open. |
| Drive: Connection failed | The Google sign-in script didn't load or crashed. |
| Drive: Sign-in popup was blocked... | See [Popups blocked](troubleshooting.md#popups-blocked). |
| Drive: Sign-in was canceled. | The popup was closed. |
| Drive: Access was denied... | You didn't allow Drive access. |
| Drive: Authorization failed (...) | Google refused for another reason, given in the brackets. |
| Drive: Session expired. Use File > Connect Google Drive to sign in again. | See [Drive sign-in](troubleshooting.md#drive-sign-in). |
| Drive: Not connected. Use File > Connect Google Drive first. | A Drive action ran without a sign-in. |
| Drive: Could not ... Check your connection and try again. | A network error talking to Drive. |
| Drive: Could not ... The file was not found or this app does not have access to it. | The file was deleted, or it's one the app can't see. |
| Drive: Google Drive is full. Free up space in Drive, or download a .zip so you don't lose work. | Your Drive is out of space. The app doesn't retry this one. |
| Drive: Google is limiting requests, so we could not ... Try again in a minute. | Google is rate limiting. The app already tried a few times. |
| Drive: Permission denied while trying to ... | Google said no, usually a sharing setting or a file the app can't change. |
| Drive: Could not ... (HTTP code) | Another error from Google. |
| Drive: That is not a folder. | You picked a file where a project folder was needed. |
| Drive: path was not found in this project. | A file the app expected is missing from the Drive folder. |

## Notices

These show in the header, next to Share.

| Text | What it means |
| --- | --- |
| Share link copied to clipboard | The room link is ready to paste. |
| Could not copy automatically. Copy the link shown next to Share. | The browser didn't allow clipboard access. The link is still shown. |
| Could not start a share session. Reload the page and try again. | Joining the room failed. |
| Google Drive sign-in expired, so edits are saving in this browser... | Your Drive sign-in ran out mid-session. Nothing is lost. Reconnect from the File menu. This one stays until you reconnect. |
| Disconnected Google Drive. Edits now save in this browser. | **File > Disconnect Google Drive** finished. |
| Google Drive picker is not set up on this site (VITE_GOOGLE_API_KEY is missing). | Drive picking can't work on this copy of the site. |
| Save canceled: the project needs a name first. | You canceled the **Name this project** dialog. |
| Uploaded N file(s) | All uploads worked. |
| name: too big (the limit is 10 MB) | That upload was over 10 MB. |
| name: that name is not allowed | The file name was empty or tried to leave the project. |
| name: use File > Upload .zip as New Project for zips | Zips can't be uploaded into a project. |
| Downloaded name.zip | The project zip was saved. |
| Downloaded, but still waiting on: ... | Some files haven't arrived from a peer, so they're not in the zip. |
| path hasn't arrived from a peer yet. | You tried to download a file you don't have yet. |
| Created name from file.zip | A .zip became a new project. |
| The browser blocked the file picker. Choose Upload .zip again. | The browser didn't count the click on **Choose a .zip** as recent enough to open a file picker. This is rare. The next try opens it without asking again. |
| That .zip has no files in it. / That file is not a .zip archive. / The .zip archive is damaged. | The zip couldn't be read. |
| Zip64 archives are not supported. / ... uses a compression method this app can't read. | The zip uses a format the app can't unpack. Re-zip it with a normal zip tool. |
| name already exists. / name already exists here. | That path is taken. |
| That file name is not allowed. / That name is not allowed. | Empty names and names with `..` aren't allowed. |
| A folder cannot be moved inside itself. | You tried to move a folder into one of its own subfolders. |
| That file no longer exists. | Someone else deleted it first. |
| Deleted name / Renamed name to new / Moved name to folder, with an **Undo** button | A file operation finished. **Undo** reverts it. See [Undoing file operations](editing-and-preview.md#undoing-file-operations). |
| Undid Delete name. / Redid Delete name. | An undo or redo of a file operation finished. |
| path came back as name (restored).ext, since someone made a new name. | Someone made a new file where yours was, so yours came back next to it. This one stays until something replaces it. |
| Kept name because someone else edited it. | Undo or redo would have removed a file a collaborator typed in since, so it stayed. |
| Couldn't undo ...: someone else changed those files since. | A collaborator renamed or deleted those files after you, so there was nothing of yours left to undo. |
| That change is no longer the last one. Use Edit > Undo from the file tree. | You clicked an old notice's **Undo** after another file change or undo. |
| Browser storage is full... | See [Storage full](troubleshooting.md#storage-full). |
| Could not ... in browser storage. Private browsing or site settings may be blocking it. | See [Storage full](troubleshooting.md#storage-full). |
| That local project no longer exists. | It was cleared, maybe from another tab. |
| Could not load Google sign-in. / Could not load the Google Picker. | A script didn't load. Check your connection and blockers. |
| Network request failed. Check your connection and try again. | A request didn't go through. |
| Something went wrong. Check the browser console for details. | An error the app didn't expect. Please report it. |
| You're offline. Settings will load when you're back online. | You opened a part of the app that loads on first use (Settings, the command palette, Export, About and others) while offline. It opens by itself once the connection is back. |
| You're offline. Import .zip will work once you're back online. | That part of the app hasn't downloaded yet. Try again once you're online. |
| Export couldn't load. Check your connection, then reload the page. | That part of the app didn't download, and the site still serves this version, so it's the network. The browser won't retry it until the page reloads. |
| A collaborator is on an older version of the app. Ask them to reload the page to keep editing together. | A peer runs an older build that speaks a different P2P protocol. |

## Update card

This card shows in the bottom corner. It never takes focus from the editor.

| Text | What it means |
| --- | --- |
| A new version of the app is available. | A newer build was deployed since you opened the page. **Reload to update** saves, then reloads. **Later** hides it until the next version. |
| A collaborator is on a newer version of the app. Reload to update so you can keep editing together. | A peer runs a build with a newer P2P protocol. |
| Part of the app couldn't load because a new version is live. Reload to update. | A piece of the old version was removed by the new deploy. It only shows when the site's version.json names a newer build; while offline you get the offline notice instead. |
| Your changes are saved first. | Under each of the above. If you're sharing, it also says guests are disconnected for a moment, or that you'll rejoin the room. |
| Couldn't save: ... Your edits are still in this tab. | The save before the reload failed, so the page didn't reload. **Reload anyway** reloads without it. |

## Loading bar

| Text | When |
| --- | --- |
| Loading the editor... | The page is starting, and its code is still downloading. |
| Opening project... / Opening from Google Drive... | A project is loading. |
| Reading .zip... | A .zip is being unpacked. |

## Footer diagnostics

- **N diagnostic(s). message (file line N)**: the preview found problems. The first one is shown, with its file and line.
- **Not found in the project: ...**: an `\input`, `\includegraphics`, or `\bibliography` names a file that isn't in the project.
- Empty: no problems.

More: [Diagnostics](editing-and-preview.md#diagnostics).

## Confirm and name dialogs

These open in the app, in your theme. The button says what it does, so there's no plain OK.
**Enter** picks the focused button, or submits a name. **Escape**, **Cancel**, or a click outside the box cancels, and focus goes back to where you were.
Buttons for things you can't easily undo are red, and focus starts on **Cancel**, so Enter alone does nothing risky.

| Title | Buttons | From |
| --- | --- | --- |
| Replace the whole project? | Cancel, **Start new project** | **New Project**. Always asks, starts on Cancel so Enter does nothing, and says every file and folder closes and to use **New File** to add one file. Red while a guest is connected, and it says it's for everyone in the room. |
| Open another project? | Cancel, **Choose a project** | **Open Local Project** or **Open from Google Drive**, while a guest is connected. Says it replaces the project for everyone in the room. |
| Upload a .zip as a new project? | Cancel, **Choose a .zip** | **Upload .zip as New Project**, while a guest is connected. |
| Name this project | Cancel, **Save project** | **Save Now** or **Save to Google Drive** on an unnamed project. |
| Rename project | Cancel, **Rename project** | Clicking the title, or **Rename Project**. |
| New file / New folder | Cancel, **Create file** / **Create folder** | The Files panel or File menu. Files without a text extension get `.tex`. |
| Rename *name* | Cancel, **Rename** | The pencil on a file row. Type a path with `/` to move it into a folder. |
| Delete *name*? | Cancel, **Delete file** / **Delete folder** | The trash can on a file row. Collaborators lose it too. |
| Delete all local projects? | Cancel, **Delete N projects** | **Clear Local Projects**. This cannot be undone. |
| Start a new link? | Keep current link, **Start new link** | **New link**. Anyone using the old link is disconnected. |
| Reset keyboard shortcuts? | Cancel, **Reset shortcuts** | **Reset to defaults** in Settings > Keyboard shortcuts. |

The name dialogs select the name without its extension, so you can type over it, and say what's wrong under the box as you type:

| Message | What it means |
| --- | --- |
| Enter a name. | The box is empty. |
| Names can't contain *character*. | File names can't use a backslash, a control character, a vertical bar, or any of `:` `*` `?` `"` `<` `>`. |
| Names can't use ".." to leave the project. | Paths stay inside the project. |
| Keep the path to 512 characters or fewer. | The whole path is too long. |
| *path* already exists. | A file or folder already has that path. New file, New folder and Rename add a **Use** button with the next free name, and Enter fills it in. |
| *path* already exists, so here's *new path* instead. | The suggested name was taken, so the box has the next free one, like `chapter (2).tex`. It goes away when you type. |
| A folder cannot be moved inside itself. | You tried to move a folder into one of its own subfolders. |
| Keep the name to 200 characters or fewer (it has N). | Project names are limited to 200 characters. |
- The browser's own "Leave site?" box shows only when something could be lost: edits not yet in Google Drive, edits made while saving is paused, a failed save, a file waiting on the conflict dialog, files still uploading or arriving, or browser storage too full to keep the project. Edits saved to this browser are written right away when you leave, so they don't ask. See [Saving and storage](saving-and-storage.md#autosave-and-save-now).

## Conflict dialog

The **File changed somewhere else** dialog shows when a file changed in storage since the app last saved it.
It names the file and says saving for it is paused until you pick.
The buttons are **Keep mine**, **Take theirs**, and **Save mine as a copy**.
It has no close button, and **Escape** doesn't close it.

More: [When a file changed somewhere else](saving-and-storage.md#when-a-file-changed-somewhere-else).
