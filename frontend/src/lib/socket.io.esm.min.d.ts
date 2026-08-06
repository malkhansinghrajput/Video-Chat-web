// Type declarations for bundled socket.io ESM client (v4.x)
// Matches the socket.io-client API surface used in this project

export type SocketId = string;

export interface SocketOptions {
  auth?: Record<string, unknown> | ((cb: (data: Record<string, unknown>) => void) => void);
  transports?: string[];
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  timeout?: number;
  autoConnect?: boolean;
  withCredentials?: boolean;
  path?: string;
  forceNew?: boolean;
}

export type EventsMap = Record<string, unknown[]>;

export interface Socket {
  id: SocketId;
  connected: boolean;
  disconnected: boolean;
  auth: Record<string, unknown>;

  connect(): this;
  disconnect(): this;
  close(): this;

  emit(event: string, ...args: unknown[]): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  off(event?: string, listener?: (...args: unknown[]) => void): this;

  removeAllListeners(event?: string): this;
}

export interface ManagerOptions extends SocketOptions {
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  timeout?: number;
  autoConnect?: boolean;
}

declare function io(uri: string, opts?: SocketOptions): Socket;
declare function io(opts?: SocketOptions): Socket;

export { io };
export default io;
