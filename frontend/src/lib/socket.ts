/**
 * Socket.IO client singleton
 * Uses the bundled ESM build served from backend's client-dist
 * (proxied via Vite: /socket.io/socket.io.esm.min.js)
 */

import type { Socket } from './socket.io.esm.min';

// We import the ESM bundle which exports `io` as default
// The bundled file is served by the backend at /socket.io/socket.io.esm.min.js
// In dev we proxy it via vite

// Dynamic import so the module is only loaded when socket is actually needed
let _io: ((uri: string, opts?: Record<string, unknown>) => Socket) | null = null;

async function getIo() {
  if (!_io) {
    const mod = await import('./socket.io.esm.min.js');
    // ESM bundle exports `io` as a named export AND as default
    _io = (mod.io ?? mod.default) as unknown as typeof _io;
  }
  return _io!;
}

// ── Singleton socket instance ─────────────────────────────────────────────────

let _socket: Socket | null = null;

export function getSocket(): Socket | null {
  return _socket;
}

/**
 * Connect to the backend Socket.IO server with the given session token.
 * If already connected, returns the existing socket.
 */
export async function connectSocket(token: string): Promise<Socket> {
  if (_socket?.connected) return _socket;

  // Disconnect stale socket
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }

  const io = await getIo();

  // In dev: Vite proxy routes '/' to backend:3001
  // In prod: same-origin
  const url = import.meta.env.VITE_BACKEND_URL ?? window.location.origin;

  _socket = io(url, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    timeout: 10_000,
    withCredentials: true,
    // path default: /socket.io
  });

  return _socket;
}

/**
 * Disconnect and clean up the socket.
 */
export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

// ── Typed event emitters (mirrors backend SocketEvents) ──────────────────────

export const SocketEvents = {
  // Client → Server
  JOIN_QUEUE:           'join_queue',
  LEAVE_QUEUE:          'leave_queue',
  CHAT_MESSAGE:         'chat:message',
  CHAT_NEXT:            'chat:next',
  CHAT_LEAVE:           'chat:leave',
  WEBRTC_OFFER:         'webrtc:offer',
  WEBRTC_ANSWER:        'webrtc:answer',
  WEBRTC_ICE_CANDIDATE: 'webrtc:ice_candidate',
  REPORT_SUBMIT:        'report:submit',
  HEARTBEAT:            'heartbeat',

  // Server → Client
  QUEUE_JOINED:         'queue:joined',
  QUEUE_POSITION:       'queue:position',
  MATCH_FOUND:          'match:found',
  PEER_JOINED:          'peer:joined',
  PEER_LEFT:            'peer:left',
  PEER_NEXT:            'peer:next',
  CHAT_MESSAGE_INCOMING:'chat:message:incoming',
  WEBRTC_RESTART:       'webrtc:restart',
  WEBRTC_FAILED:        'webrtc:failed',
  SESSION_BANNED:       'session:banned',
  SESSION_ERROR:        'session:error',
  HEARTBEAT_ACK:        'heartbeat:ack',
} as const;

export type SocketEvent = typeof SocketEvents[keyof typeof SocketEvents];
