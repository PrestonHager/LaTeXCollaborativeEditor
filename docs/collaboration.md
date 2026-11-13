# Sharing and collaboration

## Share button

1. Click **Share** in the header.
2. The app builds a link to the **same page** you are on, with a **`room`** query parameter set to the current room id.
3. The link is typically **copied to your clipboard** and also shown next to the button so you can copy it manually if needed.

Send that link to people you want in the session. They should open it in a **modern browser** with WebRTC allowed (same requirements as other real-time web apps).

If you reload the host tab, it rejoins the same room and the link keeps working.
The room is remembered per tab, so closing the tab or opening a new one starts fresh.
To drop everyone on the old link, click **New link** next to Share.

## Connection status

The connection badge in the header shows where the peer session is at, plus how many peers are connected.

- **Not sharing**: you haven't clicked Share and you're not in a room.
- **Waiting for peers**: you're in the room, but nobody else has joined yet.
  This is normal right after sharing.
- **Connected · 2 peers**: you're talking to peers directly.
- **Relayed · 1 peer**: at least one peer is connected through a **TURN** relay server instead of directly.
  It still works, it's just a longer path.
- **Reconnecting**: everyone dropped off, so the app is rejoining the room.

If someone cannot join, check firewalls, VPNs, and whether a **TURN** server is required on restrictive networks (that is configured by whoever deployed the app).

## What is shared vs not shared

- **After you are in a room**, the **document text** and collaboration sync happen **directly between peers** (peer-to-peer), not through a custom “document server” shipped with this project.
- **Joining** a room still uses whatever **rendezvous / bootstrap** endpoints the deployment configured (for example public WebTorrent-style trackers). Those paths carry **session metadata** needed to connect, not the ongoing document payload as a central archive.

In practical terms: treat the collaboration link like a **live session key**. Only share it with people who should edit with you.

## Host responsibilities

The **host** is the tab that started the room (no `room` in the URL before sharing). Guests follow the host’s document title and storage context message. For saving to Drive or local lists, the **host** performs those actions; guests edit the shared buffer.

## What guests can and can't do

Guests can create, rename, move, upload, and delete individual files and folders, like any collaborator.
Those changes show up for everyone in the room.

Guests can't replace the whole project.
**New Project**, **Open Local Project**, **Open from Google Drive**, and **Upload .zip as New Project** are turned off in a guest tab.
If you're a guest and want your own project, open the editor in a new tab without the `room` link.

When the host picks **New Project**, the confirm says it clears the project for everyone in the room.
Opening or importing another project as the host also swaps it out for every guest.

## Related topics

- [Getting started](getting-started.md) — host vs guest  
- [Saving and storage](saving-and-storage.md) — where the file lives for the host  
