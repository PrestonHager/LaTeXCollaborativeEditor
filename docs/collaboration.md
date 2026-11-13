# Sharing and collaboration

You can edit a project with other people at the same time.
Their browsers connect straight to yours over WebRTC.

![The Share button and the link it makes](assets/screenshots/share-light.png#only-light)
![The Share button and the link it makes](assets/screenshots/share-dark.png#only-dark)

## Share button

1. Click **Share** in the header.
2. The app makes a room and builds a link to this page with `?room=...` on the end.
3. It copies the link to your clipboard and shows it next to the button. The notice says "Share link copied to clipboard".
4. Send the link to the people you want to work with.

If the copy fails, the notice says "Could not copy automatically."
Copy the link shown next to Share by hand.

The **Copy share link** command in the command palette does the same thing as the button.

Some things to know:

- Clicking Share again keeps the same room and link.
- If you reload the host tab, it rejoins the same room, so the link keeps working.
- The room is remembered per tab. Closing the tab, or opening the app in a new one, starts fresh.
- To drop everyone on the old link, click **New link** next to Share. The app asks first, then makes a new room and copies the new link.

## Joining a room

Open the link in a recent browser.
You join as a guest.

- The Files panel says "Waiting for the host" until you're connected.
- Then you get the whole project: the file tree, the text, and any images.
- Images come from whoever has them, in 64 KB pieces, with a progress bar on the file.
- The project name and the host's storage show up in your header.

## Connection status

The connection badge in the header says who you're editing with.

| Text | What it means |
| --- | --- |
| Not shared | You haven't clicked Share and you're not in a room. |
| Shared, waiting for others | You're the host and nobody else has joined yet. This is normal right after sharing. |
| Looking for the host | You opened a link and the host hasn't shown up yet. |
| Connected with 2 other people | You're talking to peers directly. |
| Connected with 1 other person (relayed) | At least one peer goes through a TURN relay server instead of directly. It still works, it's just a longer path. |
| Can't reach the host | You're a guest, the host dropped off, and the app is rejoining the room. It retries after 1 second, then 2, 4, and so on, up to every 20 seconds. A notice with help links shows up too. |

If someone can't join, see [P2P connection problems](troubleshooting.md#p2p-connection-problems).

## What's shared and what isn't

- Browsers find each other through public trackers (WebTorrent trackers by default). The trackers see the room id, but not your document.
- After that, the document text, file changes, and images go straight between browsers.
- There's no server of ours in the middle, and nothing is stored anywhere but the browsers in the room and wherever the host saves.

Treat the link like a key.
Only share it with people who should edit with you.

## Host and guests

The host is the tab that started the room, the one without `?room=` in the address.

- The host saves the project. Guests don't save, but their edits and uploads get saved by the host.
- The host can open, start, and save projects, and connect or disconnect Drive. Those are grayed out for guests.
- Guests can edit, add, rename, move, delete, and upload files, and download a `.zip`.
- If the host switches to another project, guests switch with it.
- If the host leaves, guests keep their copy and can keep typing. Their edits reach the host when it comes back to the same project.

For a diagram of these states, see [How the app fits together](how-it-fits.md#host-and-guest).

## What guests can and can't do

Guests can create, rename, move, upload, and delete individual files and folders, like any collaborator.
Those changes show up for everyone in the room.

Guests can't replace the whole project.
**New Project**, **Open Local Project**, **Open from Google Drive**, and **Upload .zip as New Project** are turned off in a guest tab.
So are the Drive commands, **Save Now**, **Rename Project**, **Clear Local Projects**, and **Pause Saving**, since they touch the host's storage.
Their shortcuts do nothing in a guest tab either.
If you're a guest and want your own project, open the editor in a new tab without the `room` link.

When the host picks **New Project**, the confirm says it clears the project for everyone in the room.
Opening or importing another project as the host also swaps it out for every guest.
So while at least one guest is connected, **Open Local Project**, **Open from Google Drive**, and **Upload .zip as New Project** ask first, before any dialog, sign-in, or file picker opens.
Cancel leaves the project as it was.
With nobody connected, they open straight away.

## Related topics

- [Getting started](getting-started.md)
- [Projects and files](projects.md#projects-with-collaborators)
- [Saving and storage](saving-and-storage.md)
