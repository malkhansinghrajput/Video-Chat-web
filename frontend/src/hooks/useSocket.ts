/**
 * useSocket — manages Socket.IO connection lifecycle
 *
 * - Connects when a valid session token is available
 * - Sends heartbeats every 25s
 * - Listens to and dispatches global socket events to Zustand stores
 * - Cleans up on unmount
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { connectSocket, disconnectSocket, getSocket, SocketEvents } from '@/lib/socket';
import { useCallStore } from '@/stores/callStore';
import { useAppStore } from '@/stores/appStore';
import type { SessionInfo } from './useSession';
import type { Message } from '@/types/chat.types';

interface MatchFoundPayload {
  roomId: string;
  role: 'initiator' | 'responder';
  turnCredentials: {
    urls: string | string[];
    username: string;
    credential: string;
  };
  peerCountry: string;
}

interface QueuePositionPayload {
  position: number;
  estimatedWaitSeconds: number;
  queueDepth: number;
}

export interface UseSocketReturn {
  isConnected: boolean;
  isConnecting: boolean;
  socketError: string | null;
  /** Emit join_queue to backend */
  joinQueue: (opts?: { country?: string; language?: string; interests?: string[] }) => void;
  /** Emit chat:next (skip current partner) */
  skipPartner: () => void;
  /** Emit chat:leave */
  leaveChat: () => void;
  /** Emit chat:message */
  sendMessage: (text: string) => void;
  /** Emit report:submit */
  reportPartner: (reason: string) => void;
}

const HEARTBEAT_INTERVAL = 25_000;

export function useSocket(session: SessionInfo | null): UseSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setStatus = useCallStore((s) => s.setStatus);
  const setPartnerStatus = useCallStore((s) => s.setPartnerStatus);
  const addMessage = useCallStore((s) => s.addMessage);
  const setPartnerTyping = useCallStore((s) => s.setPartnerTyping);
  const setOnlineCount = useAppStore((s) => s.setOnlineCount);
  const setMatchInfo = useCallStore((s) => s.setMatchInfo);
  const resetCall = useCallStore((s) => s.resetCall);

  // Start heartbeat loop
  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit(SocketEvents.HEARTBEAT);
      }
    }, HEARTBEAT_INTERVAL);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!session?.token) return;

    let mounted = true;
    setIsConnecting(true);
    setSocketError(null);

    connectSocket(session.token).then((socket) => {
      if (!mounted) { socket.disconnect(); return; }

      // ── Core connection events ─────────────────────────────────────────
      socket.on('connect', () => {
        if (!mounted) return;
        setIsConnected(true);
        setIsConnecting(false);
        setSocketError(null);
        startHeartbeat();
      });

      socket.on('disconnect', (reason: unknown) => {
        setIsConnected(false);
        stopHeartbeat();
        if (reason === 'io server disconnect') {
          setSocketError('Server disconnected the session');
        }
      });

      socket.on('connect_error', (err: unknown) => {
        if (!mounted) return;
        setIsConnecting(false);
        const msg = err instanceof Error ? err.message : String(err);
        setSocketError(`Connection failed: ${msg}`);
        setIsConnected(false);
      });

      // ── Heartbeat ──────────────────────────────────────────────────────
      socket.on(SocketEvents.HEARTBEAT_ACK, (_data: unknown) => {
        // Alive
      });

      // ── Queue events ───────────────────────────────────────────────────
      socket.on(SocketEvents.QUEUE_JOINED, (_data: unknown) => {
        setStatus('searching');
      });

      socket.on(SocketEvents.QUEUE_POSITION, (data: unknown) => {
        const payload = data as QueuePositionPayload;
        setOnlineCount(payload.queueDepth ?? 0);
      });

      // ── Match events ───────────────────────────────────────────────────
      socket.on(SocketEvents.MATCH_FOUND, (data: unknown) => {
        if (!mounted) return;
        const payload = data as MatchFoundPayload;
        setMatchInfo({
          roomId: payload.roomId,
          role: payload.role,
          turnCredentials: payload.turnCredentials,
          peerCountry: payload.peerCountry,
        });
        setStatus('matched');
      });

      // ── Peer events ────────────────────────────────────────────────────
      socket.on(SocketEvents.PEER_LEFT, (_data: unknown) => {
        setPartnerStatus('left');
        setStatus('idle');
      });

      socket.on(SocketEvents.PEER_NEXT, (_data: unknown) => {
        setPartnerStatus('left');
        setStatus('idle');
      });

      // ── Chat events ────────────────────────────────────────────────────
      socket.on(SocketEvents.CHAT_MESSAGE_INCOMING, (data: unknown) => {
        const payload = data as { text: string; timestamp: number };
        const msg: Message = {
          id: `p-${Date.now()}`,
          sender: 'partner',
          text: payload.text,
          timestamp: payload.timestamp ?? Date.now(),
        };
        addMessage(msg);
        setPartnerTyping(false);
      });

      // ── Session events ────────────────────────────────────────────────
      socket.on(SocketEvents.SESSION_BANNED, (_data: unknown) => {
        setSocketError('Your session has been banned');
        socket.disconnect();
      });

      socket.on(SocketEvents.SESSION_ERROR, (data: unknown) => {
        const payload = data as { code: string; message: string };
        console.warn('[Socket] Session error:', payload);
      });

      // ── WebRTC failure ─────────────────────────────────────────────────
      socket.on(SocketEvents.WEBRTC_FAILED, (_data: unknown) => {
        setStatus('idle');
        resetCall();
      });

    }).catch((err) => {
      if (!mounted) return;
      setIsConnecting(false);
      setSocketError(err instanceof Error ? err.message : 'Failed to connect');
    });

    return () => {
      mounted = false;
      stopHeartbeat();
      disconnectSocket();
      setIsConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  // ── Action emitters ─────────────────────────────────────────────────────────

  const joinQueue = useCallback((opts?: {
    country?: string;
    language?: string;
    interests?: string[];
  }) => {
    const socket = getSocket();
    if (!socket?.connected) return;
    socket.emit(SocketEvents.JOIN_QUEUE, opts ?? {});
  }, []);

  const skipPartner = useCallback(() => {
    const socket = getSocket();
    if (!socket?.connected) return;
    socket.emit(SocketEvents.CHAT_NEXT);
    setStatus('searching');
    resetCall();
  }, [resetCall, setStatus]);

  const leaveChat = useCallback(() => {
    const socket = getSocket();
    if (!socket?.connected) return;
    socket.emit(SocketEvents.CHAT_LEAVE);
    resetCall();
  }, [resetCall]);

  const sendMessage = useCallback((text: string) => {
    const socket = getSocket();
    if (!socket?.connected || !text.trim()) return;
    socket.emit(SocketEvents.CHAT_MESSAGE, { text: text.trim() });
  }, []);

  const reportPartner = useCallback((reason: string) => {
    const socket = getSocket();
    if (!socket?.connected) return;
    socket.emit(SocketEvents.REPORT_SUBMIT, { reason });
  }, []);

  return {
    isConnected,
    isConnecting,
    socketError,
    joinQueue,
    skipPartner,
    leaveChat,
    sendMessage,
    reportPartner,
  };
}
