/**
 * useWebRTC — manages the full WebRTC peer connection lifecycle
 *
 * Flow:
 *   Phase 1 (on mount): Request camera + mic permission immediately
 *                        Show local video preview during search
 *   Phase 2 (on match): Create RTCPeerConnection, offer/answer/ICE
 *   Phase 3 (connected): Quality polling, call timer
 */

import { useEffect, useRef, useCallback, useState, type RefObject } from 'react';
import { getSocket, SocketEvents } from '@/lib/socket';
import { api } from '@/lib/api';
import { useCallStore } from '@/stores/callStore';

export interface MatchInfo {
  roomId: string;
  role: 'initiator' | 'responder';
  turnCredentials: {
    urls: string | string[];
    username: string;
    credential: string;
  };
  peerCountry: string;
}

interface OfferPayload   { roomId: string; sdp: RTCSessionDescriptionInit }
interface AnswerPayload  { roomId: string; sdp: RTCSessionDescriptionInit }
interface IcePayload     { roomId: string; candidate: RTCIceCandidateInit }

export type MediaPermission = 'pending' | 'granted' | 'denied' | 'requesting';

// Default STUN & TURN servers for cross-network NAT traversal
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.services.mozilla.com' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelay',
    credential: 'openrelay',
  },
];

export interface UseWebRTCReturn {
  localVideoRef:    RefObject<HTMLVideoElement | null>;
  remoteVideoRef:   RefObject<HTMLVideoElement | null>;
  localStream:      MediaStream | null;
  mediaPermission:  MediaPermission;
  isConnecting:     boolean;
  callError:        string | null;
  /** Re-request camera/mic (e.g. after user denies and fixes browser settings) */
  requestMedia:     () => Promise<void>;
  /** Apply mic mute to local stream track */
  setMicMuted:      (muted: boolean) => void;
  /** Apply camera off to local stream track */
  setCameraOff:     (off: boolean) => void;
}

export function useWebRTC(matchInfo: MatchInfo | null): UseWebRTCReturn {
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef          = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [localStream,     setLocalStream]     = useState<MediaStream | null>(null);
  const [mediaPermission, setMediaPermission] = useState<MediaPermission>('pending');
  const [isConnecting,    setIsConnecting]    = useState(false);
  const [callError,       setCallError]       = useState<string | null>(null);

  const setStatus     = useCallStore((s) => s.setStatus);
  const startTimer    = useCallStore((s) => s.startTimer);
  const stopTimer     = useCallStore((s) => s.stopTimer);
  const updateQuality = useCallStore((s) => s.updateQuality);

  // ── Phase 1: Request media on mount ─────────────────────────────────────────
  const requestMedia = useCallback(async () => {
    setMediaPermission('requesting');
    setCallError(null);

    let stream: MediaStream | null = null;

    // Try video + audio first
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width:  { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  true,
        },
      });
    } catch (videoErr) {
      console.warn('[WebRTC] Video+audio failed, trying audio-only:', videoErr);
      // Fallback: audio only (if camera blocked but mic allowed)
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      } catch (audioErr) {
        console.warn('[WebRTC] Audio-only also failed:', audioErr);
      }
    }

    if (!stream) {
      // Check if it was a real denial vs just no device
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some((d) => d.kind === 'videoinput');
        const hasMic    = devices.some((d) => d.kind === 'audioinput');
        if (!hasCamera && !hasMic) {
          setCallError('No camera or microphone found on this device');
        } else {
          setCallError('Camera/microphone access denied — please allow in browser settings');
        }
      } catch {
        setCallError('Camera/microphone access denied — please allow in browser settings');
      }
      setMediaPermission('denied');
      // Use empty stream so app still works (text chat only)
      stream = new MediaStream();
    } else {
      setMediaPermission('granted');
    }

    localStreamRef.current = stream;
    setLocalStream(stream);

    // Attach to local video element immediately
    if (localVideoRef.current) {
      localVideoRef.current.srcObject  = stream;
      localVideoRef.current.muted      = true; // prevent echo
    }
  }, []);

  // Request media as soon as hook mounts (ChatRoom opens)
  useEffect(() => {
    // Small delay so the UI renders first, then browser shows permission dialog
    const t = setTimeout(() => { requestMedia(); }, 300);
    return () => {
      clearTimeout(t);
      // Stop all tracks on unmount
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep localVideoRef.srcObject in sync when stream changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.muted     = true;
    }
  }, [localStream]);

  // ── Quality polling ──────────────────────────────────────────────────────────
  const qualityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startQualityPolling = useCallback((pc: RTCPeerConnection) => {
    if (qualityTimerRef.current) clearInterval(qualityTimerRef.current);
    qualityTimerRef.current = setInterval(async () => {
      try {
        const stats = await pc.getStats();
        let rtt = 0, loss = 0;
        stats.forEach((report) => {
          if (report.type === 'remote-inbound-rtp') {
            const rtpReport = report as { roundTripTime?: number; fractionLost?: number };
            rtt  = Math.round((rtpReport.roundTripTime ?? 0) * 1000);
            loss = rtpReport.fractionLost ?? 0;
          }
        });
        updateQuality(rtt, loss * 100);
      } catch { /* ignore */ }
    }, 3000);
  }, [updateQuality]);

  const stopQualityPolling = useCallback(() => {
    if (qualityTimerRef.current) {
      clearInterval(qualityTimerRef.current);
      qualityTimerRef.current = null;
    }
  }, []);

  // ── Peer connection cleanup ──────────────────────────────────────────────────
  const closePc = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    stopTimer();
    stopQualityPolling();
  }, [stopTimer, stopQualityPolling]);

  // ── Phase 2: WebRTC peer connection when match found ─────────────────────────
  useEffect(() => {
    if (!matchInfo) return;

    const socket = getSocket();
    if (!socket) return;

    let mounted = true;
    setIsConnecting(true);
    setCallError(null);

    async function setupPeerConnection() {
      try {
        // 1. Get ICE servers from backend
        let iceServers = DEFAULT_ICE_SERVERS;
        try {
          const res = await api.getIceServers();
          if (res.data.iceServers?.length) {
            iceServers = [...res.data.iceServers, ...DEFAULT_ICE_SERVERS];
          }
        } catch {
          console.warn('[WebRTC] Using default STUN/TURN servers');
        }

        if (!mounted) return;

        // 2. Use already-acquired local stream (from Phase 1)
        //    If stream not ready yet, wait briefly then use whatever we have
        let stream = localStreamRef.current;
        if (!stream || stream.getTracks().length === 0) {
          // Re-request if somehow not ready
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStreamRef.current = stream;
            setLocalStream(stream);
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
              localVideoRef.current.muted     = true;
            }
            setMediaPermission('granted');
          } catch {
            stream = new MediaStream(); // empty — signaling still works
          }
        }

        if (!mounted) return;

        // 3. Create peer connection
        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;

        // Add local tracks to peer connection
        stream.getTracks().forEach((track) => pc.addTrack(track, stream!));

        // ICE candidates → relay via backend
        pc.onicecandidate = (e) => {
          if (e.candidate && socket?.connected) {
            socket.emit(SocketEvents.WEBRTC_ICE_CANDIDATE, {
              roomId:    matchInfo!.roomId,
              candidate: e.candidate.toJSON(),
            });
          }
        };

        // Remote track → attach to remote video element
        pc.ontrack = (e) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = e.streams[0];
          }
        };

        // Connection state changes
        pc.onconnectionstatechange = () => {
          if (!mounted) return;
          switch (pc.connectionState) {
            case 'connected':
              setIsConnecting(false);
              setStatus('connected');
              startTimer();
              startQualityPolling(pc);
              break;
            case 'failed':
              setCallError('Connection failed — try skipping to next partner');
              setStatus('idle');
              closePc();
              break;
            case 'disconnected':
              setStatus('idle');
              stopQualityPolling();
              break;
          }
        };

        // ── ICE Candidate Queue for early candidates ──────────────────────────
        const iceCandidateQueue: RTCIceCandidateInit[] = [];

        const processIceQueue = async () => {
          while (iceCandidateQueue.length > 0) {
            const candidate = iceCandidateQueue.shift();
            if (candidate) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (err) {
                console.warn('[WebRTC] Error processing queued ICE candidate:', err);
              }
            }
          }
        };

        // 4. Offer / Answer exchange
        if (matchInfo!.role === 'initiator') {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket!.emit(SocketEvents.WEBRTC_OFFER, {
            roomId: matchInfo!.roomId,
            sdp:    offer,
          });
        }

        // ── Signaling event handlers ──────────────────────────────────────────

        const handleOffer = async (data: unknown) => {
          const payload = data as OfferPayload;
          if (payload.roomId !== matchInfo!.roomId) return;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            await processIceQueue();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket!.emit(SocketEvents.WEBRTC_ANSWER, {
              roomId: matchInfo!.roomId,
              sdp:    answer,
            });
          } catch (err) {
            console.error('[WebRTC] Error handling offer:', err);
          }
        };

        const handleAnswer = async (data: unknown) => {
          const payload = data as AnswerPayload;
          if (payload.roomId !== matchInfo!.roomId) return;
          if (pc.signalingState !== 'have-local-offer') return;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            await processIceQueue();
          } catch (err) {
            console.error('[WebRTC] Error handling answer:', err);
          }
        };

        const handleIce = async (data: unknown) => {
          const payload = data as IcePayload;
          if (payload.roomId !== matchInfo!.roomId) return;
          if (pc.remoteDescription && pc.remoteDescription.type) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch (err) {
              console.warn('[WebRTC] Error adding ICE candidate:', err);
            }
          } else {
            // Remote description not set yet — queue candidate until setRemoteDescription finishes!
            iceCandidateQueue.push(payload.candidate);
          }
        };

        const handlePeerLeft = () => {
          if (!mounted) return;
          closePc();
        };

        socket!.on(SocketEvents.WEBRTC_OFFER,         handleOffer);
        socket!.on(SocketEvents.WEBRTC_ANSWER,        handleAnswer);
        socket!.on(SocketEvents.WEBRTC_ICE_CANDIDATE, handleIce);
        socket!.on(SocketEvents.PEER_LEFT,            handlePeerLeft);
        socket!.on(SocketEvents.PEER_NEXT,            handlePeerLeft);

        return () => {
          socket!.off(SocketEvents.WEBRTC_OFFER,         handleOffer);
          socket!.off(SocketEvents.WEBRTC_ANSWER,        handleAnswer);
          socket!.off(SocketEvents.WEBRTC_ICE_CANDIDATE, handleIce);
          socket!.off(SocketEvents.PEER_LEFT,            handlePeerLeft);
          socket!.off(SocketEvents.PEER_NEXT,            handlePeerLeft);
        };

      } catch (err) {
        if (!mounted) return;
        setCallError(err instanceof Error ? err.message : 'WebRTC setup failed');
        setIsConnecting(false);
      }
    }

    const cleanupPromise = setupPeerConnection();

    return () => {
      mounted = false;
      cleanupPromise.then((cleanup) => cleanup?.());
      closePc();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchInfo?.roomId]);

  // ── Media controls ───────────────────────────────────────────────────────────

  const setMicMuted = useCallback((muted: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  }, []);

  const setCameraOff = useCallback((off: boolean) => {
    localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !off; });
  }, []);

  return {
    localVideoRef,
    remoteVideoRef,
    localStream,
    mediaPermission,
    isConnecting,
    callError,
    requestMedia,
    setMicMuted,
    setCameraOff,
  };
}
