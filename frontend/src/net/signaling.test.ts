import { SignalingClient } from './signaling';

class MockSocket {
  static OPEN = 1;
  readyState = MockSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(message: string) {
    this.sent.push(message);
  }
}

describe('SignalingClient', () => {
  it('sends messages when websocket is open', () => {
    const OriginalWebSocket = globalThis.WebSocket;
    const socket = new MockSocket('ws://localhost');
    class WebSocketCtor {
      static OPEN = 1;
      constructor() {
        return socket as unknown as WebSocket;
      }
    }
    globalThis.WebSocket = WebSocketCtor as unknown as typeof WebSocket;
    const onMessage = vi.fn();
    const signaling = new SignalingClient('ws://localhost', onMessage);

    signaling.connect();
    signaling.send({ type: 'join', roomId: 'room-a' });

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'join', roomId: 'room-a' });
    globalThis.WebSocket = OriginalWebSocket;
  });

  it('parses incoming messages and forwards them', () => {
    const OriginalWebSocket = globalThis.WebSocket;
    const socket = new MockSocket('ws://localhost');
    class WebSocketCtor {
      static OPEN = 1;
      constructor() {
        return socket as unknown as WebSocket;
      }
    }
    globalThis.WebSocket = WebSocketCtor as unknown as typeof WebSocket;
    const onMessage = vi.fn();
    const signaling = new SignalingClient('ws://localhost', onMessage);

    signaling.connect();
    socket.onmessage?.({ data: JSON.stringify({ type: 'join', roomId: 'abc' }) });

    expect(onMessage).toHaveBeenCalledWith({ type: 'join', roomId: 'abc' });
    globalThis.WebSocket = OriginalWebSocket;
  });
});
