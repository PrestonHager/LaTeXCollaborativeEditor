const WebSocket = require('ws');
const server = new WebSocket.Server({ port: 8787 });
const rooms = new Map();

server.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg?.roomId) return;
    if (!rooms.has(msg.roomId)) rooms.set(msg.roomId, new Set());
    const room = rooms.get(msg.roomId);
    room.add(socket);

    for (const peer of room) {
      if (peer !== socket && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify(msg));
      }
    }
  });

  socket.on('close', () => {
    for (const room of rooms.values()) {
      room.delete(socket);
    }
  });
});

console.log('Signaling server running on ws://localhost:8787');
