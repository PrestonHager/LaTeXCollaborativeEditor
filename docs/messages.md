# Status and error messages

This page lists the messages the app shows and what they mean.
If something's wrong and you're not sure where to start, try [Troubleshooting](troubleshooting.md) first.

The app shows messages in a few places:

- The three **status pills** at the top right: connection, compile, and autosave.
- The **notice** text in the header, next to Share. Most notices clear after about 8 seconds. Errors are red.
- The **loading bar** under the header, while something big is happening.
- The **footer**, for preview diagnostics.
- Browser **confirm and prompt** boxes, when the app needs a yes or a name.

![The status pills and notice area](assets/screenshots/status-light.png#only-light)
![The status pills and notice area](assets/screenshots/status-dark.png#only-dark)

## Connection pill

| Text | What it means |
| --- | --- |
| Not sharing | You haven't clicked Share and you're not in a room. |
| Waiting for peers | In the room, nobody else has joined yet. |
| Connected · 2 peers | Peers are connected directly. The number is how many. |
| Relayed · 1 peer | At least one peer goes through a TURN relay server. |
| Reconnecting | Everyone else left. The app rejoins and waits. |

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
| Save Now Disabled | You turned off Save Now. Autosave still runs. |
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
| Save canceled: the project needs a name first. | You canceled the name prompt. |
| Uploaded N file(s) | All uploads worked. |
| name: too big (the limit is 10 MB) | That upload was over 10 MB. |
| name: that name is not allowed | The file name was empty or tried to leave the project. |
| name: use File > Upload .zip as New Project for zips | Zips can't be uploaded into a project. |
| Downloaded name.zip | The project zip was saved. |
| Downloaded, but still waiting on: ... | Some files haven't arrived from a peer, so they're not in the zip. |
| path hasn't arrived from a peer yet. | You tried to download a file you don't have yet. |
| Created name from file.zip | A .zip became a new project. |
| That .zip has no files in it. / That file is not a .zip archive. / The .zip archive is damaged. | The zip couldn't be read. |
| Zip64 archives are not supported. / ... uses a compression method this app can't read. | The zip uses a format the app can't unpack. Re-zip it with a normal zip tool. |
| name already exists. / name already exists here. | That path is taken. |
| That file name is not allowed. / That name is not allowed. | Empty names and names with `..` aren't allowed. |
| A folder cannot be moved inside itself. | You tried to move a folder into one of its own subfolders. |
| That file no longer exists. | Someone else deleted it first. |
| Browser storage is full... | See [Storage full](troubleshooting.md#storage-full). |
| Could not ... in browser storage. Private browsing or site settings may be blocking it. | See [Storage full](troubleshooting.md#storage-full). |
| That local project no longer exists. | It was cleared, maybe from another tab. |
| Could not load Google sign-in. / Could not load the Google Picker. | A script didn't load. Check your connection and blockers. |
| Network request failed. Check your connection and try again. | A request didn't go through. |
| Something went wrong. Check the browser console for details. | An error the app didn't expect. Please report it. |

## Loading bar

| Text | When |
| --- | --- |
| Loading compiler assets... | The page is starting. |
| Opening project... / Opening from Google Drive... | A project is loading. |
| Reading .zip... | A .zip is being unpacked. |

## Footer diagnostics

- **N diagnostic(s). message (file line N)**: the preview found problems. The first one is shown, with its file and line.
- **Not found in the project: ...**: an `\input`, `\includegraphics`, or `\bibliography` names a file that isn't in the project.
- Empty: no problems.

More: [Diagnostics](editing-and-preview.md#diagnostics).

## Confirm and prompt boxes

- **Start a new project? This clears the project for everyone in the room. The current one stays saved where it is.** From **New Project**.
- **Name this project before saving:** From **Save Now** or **Save to Google Drive** on an unnamed project.
- **Rename project:** From clicking the title or **Rename Project**.
- **New file:** and **New folder:** From the Files panel or File menu.
- **Rename or move (use / for folders):** From the pencil on a file row.
- **Delete path? Collaborators lose it too.** From the trash can on a file row.
- **Delete all N project(s) saved in this browser? This cannot be undone.** From **Clear Local Projects**.
- **Start a new link? Anyone using the old link will be disconnected.** From **New link**.
- The browser's own "Leave site?" box shows when you close the tab before the last save finished, or while a file is waiting on the conflict dialog.

## Conflict dialog

The **File changed somewhere else** dialog shows when a file changed in storage since the app last saved it.
It names the file and says saving for it is paused until you pick.
The buttons are **Keep mine**, **Take theirs**, and **Save mine as a copy**.
It has no close button, and **Escape** doesn't close it.

More: [When a file changed somewhere else](saving-and-storage.md#when-a-file-changed-somewhere-else).
