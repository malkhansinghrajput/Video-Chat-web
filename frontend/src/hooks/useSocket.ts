/**
 * useSocket — manages Socket.IO connection lifecycle
 *
 * - Connects when a valid session token is available
 * - Sends heartbeats every 25s
 * - Listens to and dispatches global socket events to Zustand stores
 * - Cleans up on unmount
 *
 * Phase 4F queue state machine:
 *   IDLE → (joinQueue called) → JOINING → (QUEUE_JOINED received) → SEARCHING
 *   SEARCHING → (MATCH_FOUND received) → MATCHED
 *   MATCHED / CONNECTED → (PEER_LEFT/PEER_NEXT received) → IDLE
 *
 *   joinQueue() is a no-op unless phase is IDLE.
 *   Socket reconnect does NOT automatically re-emit join_queue —
 *   the component re-evaluates call status and decides.
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
  /** Clear the current socket error (e.g. after connecting successfully) */
  clearSocketError: () => void;
  /** Emit join_queue to backend — no-op if already joining/searching/matched */
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

// ── Frontend queue phase state machine ──────────────────────────────────────
// Prevents duplicate join_queue emissions regardless of how many times
// React effects fire or socket reconnects occur.
type QueuePhase = 'idle' | 'joining' | 'searching' | 'matched' | 'connected' | 'leaving';

// Error codes that are transient race conditions — suppress persistent banner.
// These resolve themselves and do not require user action.
const SILENT_ERROR_CODES = new Set(['ALREADY_IN_QUEUE', 'SESSION_NOT_AVAILABLE']);
// Timeout for auto-dismissing transient errors that do get shown (ms)
const TRANSIENT_ERROR_DISMISS_MS = 3_000;

export function useSocket(session: SessionInfo | null): UseSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 4F: authoritative queue phase ref — never mutate from outside this file
  const queuePhaseRef = useRef<QueuePhase>('idle');

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
        // Phase 4F: do NOT auto-emit join_queue here.
        // The ChatRoom effect will see isConnected=true and decide based on
        // the current call status. This prevents duplicate joins on reconnect.
      });

      socket.on('disconnect', (reason: unknown) => {
        setIsConnected(false);
        stopHeartbeat();
        // Phase 4F: reset queue phase on disconnect so the next idle→searching
        // transition can proceed after reconnect.
        if (queuePhaseRef.current === 'joining' || queuePhaseRef.current === 'searching') {
          queuePhaseRef.current = 'idle';
        }
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
        // Advance phase: joining → searching
        queuePhaseRef.current = 'searching';
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
        // Advance phase: searching → matched
        queuePhaseRef.current = 'matched';
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
        // Reset phase so next idle→joining transition is allowed
        queuePhaseRef.current = 'idle';
        setPartnerStatus('left');
        setStatus('idle');
      });

      socket.on(SocketEvents.PEER_NEXT, (_data: unknown) => {
        queuePhaseRef.current = 'idle';
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

      // ── Session events ──────────────────────────────────────────────────────
      socket.on(SocketEvents.SESSION_BANNED, (_data: unknown) => {
        setSocketError('Your session has been banned');
        socket.disconnect();
      });

      socket.on(SocketEvents.SESSION_ERROR, (data: unknown) => {
        const payload = data as { code: string; message: string };
        const code = payload?.code ?? '';
        const msg = payload?.message || code || 'Session error occurred';

        // Phase 4F: silently suppress transient race-condition errors.
        // ALREADY_IN_QUEUE means the backend already has us queued — this is
        // not a user-visible problem during normal reconnect/search flow.
        // SESSION_NOT_AVAILABLE resolves when the backend heals stale state.
        if (SILENT_ERROR_CODES.has(code)) {
          // Reset the queue phase so the state machine can recover
          if (queuePhaseRef.current === 'joining') {
            queuePhaseRef.current = 'idle';
          }
          // Auto-dismiss after 3s in case it was already shown
          if (errorDismissTimerRef.current) clearTimeout(errorDismissTimerRef.current);
          errorDismissTimerRef.current = setTimeout(() => {
            setSocketError(null);
            errorDismissTimerRef.current = null;
          }, TRANSIENT_ERROR_DISMISS_MS);
          return; // do NOT show this error to the user
        }

        // Show actionable errors
        setSocketError(`Session error: ${msg}`);

        // Reset joining phase on error so retry is possible
        if (queuePhaseRef.current === 'joining') {
          queuePhaseRef.current = 'idle';
        }
      });

      // ── WebRTC failure ─────────────────────────────────────────────────
      socket.on(SocketEvents.WEBRTC_FAILED, (_data: unknown) => {
        queuePhaseRef.current = 'idle';
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
      if (errorDismissTimerRef.current) clearTimeout(errorDismissTimerRef.current);
      disconnectSocket();
      setIsConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  // ── Action emitters ─────────────────────────────────────────────────────────

  /**
   * Phase 4F: joinQueue with queue phase gate.
   *
   * Emits join_queue ONLY if phase is 'idle'. This prevents:
   * - Duplicate joins on socket reconnect
   * - Duplicate joins from multiple React effect firings
   * - Duplicate joins from React StrictMode double-invoke
   * - Joining while already searching/matched
   */
  const joinQueue = useCallback((opts?: {
    country?: string;
    language?: string;
    interests?: string[];
  }) => {
    const socket = getSocket();
    if (!socket?.connected) return;

    // Gate: only transition from idle
    if (queuePhaseRef.current !== 'idle') {
      return; // Already joining/searching/matched — silently ignore
    }

    queuePhaseRef.current = 'joining';
    socket.emit(SocketEvents.JOIN_QUEUE, opts ?? {});
  }, []);

  const skipPartner = useCallback(() => {
    const socket = getSocket();
    if (!socket?.connected) return;
    // Reset phase — server will re-enqueue us and send QUEUE_JOINED
    queuePhaseRef.current = 'idle';
    socket.emit(SocketEvents.CHAT_NEXT);
    setStatus('searching'); // optimistic UI
    resetCall();
  }, [resetCall, setStatus]);

  const leaveChat = useCallback(() => {
    const socket = getSocket();
    if (!socket?.connected) return;
    queuePhaseRef.current = 'idle';
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

  const clearSocketError = useCallback(() => {
    if (errorDismissTimerRef.current) clearTimeout(errorDismissTimerRef.current);
    setSocketError(null);
  }, []);

  return {
    isConnected,
    isConnecting,
    socketError,
    clearSocketError,
    joinQueue,
    skipPartner,
    leaveChat,
    sendMessage,
    reportPartner,
  };
}
