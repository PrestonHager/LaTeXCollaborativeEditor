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

## When a window can't share

Sharing and joining need WebRTC, the browser feature that connects people directly.
Some windows don't have it: the Linux desktop app today (its system webview is built without WebRTC), or a browser where a setting or an extension turns it off.

In such a window:

- **Share** doesn't make a room. It shows "This window can't make peer-to-peer connections, so it can't share or join a room." with what to do instead.
- Opening a `?room=` link shows the same message, and the Files panel says so instead of "Waiting for the host".
- The connection badge says **Can't connect in this window**.
- None of the networking code starts, so nothing connects to the trackers.

What to do instead:

- **In a browser,** open the app in a recent version of Chrome, Edge, Firefox or Safari, with WebRTC on.
- **In the desktop app,** click **Open in browser**. For a room link, it opens that room in the web app in your system browser. For Share, it opens the web app, where you can share. Projects in the desktop app don't carry over to the browser, so export the project first. If the browser can't be opened, the link is copied so you can paste it in.

## Joining a room

Open the link in a recent browser.
You join as a guest.

- The Files panel says "Waiting for the host" until you're connected.
- Then you get the whole project: the file tree, the text, and any images.
- Images come from whoever has them, in 64 KB pieces, with a progress bar on the file.
- The project name and the host's storage show up in your header.

## Who's in the room

While you're sharing, avatars next to **Share** show who's in the room: yours first, then everyone else's, each in their own colour.

- Hover an avatar to see the person's name and the file they have open.
- Their cursor shows in the editor as a coloured line with their name on it, and text they select is highlighted in their colour.
- In the Files panel, a dot in their colour marks the file they have open.
- Click someone's avatar to follow them: their file opens and the editor scrolls to their cursor.
- With more than four other people, the rest are in a **+N** chip. Hover it for their names.
- When someone leaves, they disappear right away. If their connection drops instead, they disappear within 30 seconds.

### Your name

The first time you share or join, you get an anonymous animal name, like "Curious Otter".
Click your own avatar to change it.
The name is kept in this browser with your other settings, so you keep it in later rooms. Resetting all settings picks a new animal name.

Everyone gets a colour from a fixed set of eight. It comes from a random id kept with your settings, so you keep your colour when you reload, and everyone in the room sees the same colour for you. If someone who was in the room before you has your colour, you get the next free one instead, so nobody in the room shares a colour until there are more than eight people.

Only your name, colour, which file you have open, and where your cursor is go to the room. Nothing else about you is shared.
People on an older version of the editor still sync with you; they just don't show up in the avatars, and don't see yours.

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
- After that, the document text, file changes, and images go straight between browsers. So do your display name and cursor position (see [Who's in the room](#whos-in-the-room)).
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

When the host picks **New Project**, the dialog says it clears the project for everyone in the room, and its **Start new project** button is red.
Opening or importing another project as the host also swaps it out for every guest.
So while at least one guest is connected, **Open Local Project**, **Open from Google Drive**, and **Upload .zip as New Project** ask first, before any dialog, sign-in, or file picker opens.
Cancel leaves the project as it was.
After **Choose a project** on Open Local Project, its **Upload .zip** button doesn't ask again.
With nobody connected, they open straight away.

## Related topics

- [Getting started](getting-started.md)
- [Projects and files](projects.md#projects-with-collaborators)
- [Saving and storage](saving-and-storage.md)
