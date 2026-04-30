# Sharing and collaboration

## Share button

1. Click **Share** in the header.
2. The app builds a link to the **same page** you are on, with a **`room`** query parameter set to the current room id.
3. The link is typically **copied to your clipboard** and also shown next to the button so you can copy it manually if needed.

Send that link to people you want in the session. They should open it in a **modern browser** with WebRTC allowed (same requirements as other real-time web apps).

## Connection status

The **Connection** pill in the header reflects whether the peer session is up, connecting, or disconnected. If someone cannot join, check firewalls, VPNs, and whether a **TURN** server is required on restrictive networks (that is configured by whoever deployed the app).

## What is shared vs not shared

- **After you are in a room**, the **document text** and collaboration sync happen **directly between peers** (peer-to-peer), not through a custom “document server” shipped with this project.
- **Joining** a room still uses whatever **rendezvous / bootstrap** endpoints the deployment configured (for example public WebTorrent-style trackers). Those paths carry **session metadata** needed to connect, not the ongoing document payload as a central archive.

In practical terms: treat the collaboration link like a **live session key**. Only share it with people who should edit with you.

## Host responsibilities

The **host** is the tab that started the room (no `room` in the URL before sharing). Guests follow the host’s document title and storage context message. For saving to Drive or local lists, the **host** performs those actions; guests edit the shared buffer.

## Related topics

- [Getting started](getting-started.md) — host vs guest  
- [Saving and storage](saving-and-storage.md) — where the file lives for the host  
