/**
 * useWebRTC — manages the full WebRTC peer connection lifecycle
 *
 * Flow:
 *   Phase 1 (on mount): Request camera + mic permission immediately
 *                        Show local video preview during search
 *   Phase 2 (on match): Create RTCPeerConnection, offer/answer/ICE
 *   Phase 3 (connected): Quality polling, call timer
 *
 * Phase 4C fixes:
 *   - remoteStream exposed as React state so ChatRoom can assign it to the
 *     video element AFTER the DOM node mounts (solves blank remote video).
 *   - ICE servers pre-fetched and module-cached on first call so the HTTP
 *     round-trip is not on the critical match→offer path.
 *   - iceCandidatePoolSize: 4 added to RTCPeerConnection config to pre-gather
 *     candidates before setLocalDescription.
 *   - Video constraints simplified (no forced width/height) so mobile cameras
 *     are not confused by a 1280×720 demand they override anyway.
 *   - Outbound encoding params set after connection (maxBitrate for VP8/VP9)
 *     where supported; guarded by setParameters existence check.
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
    /*
     * OpenRelay public TURN server — suitable for development/testing ONLY.
     * For production: replace with a private TURN server (coturn, Twilio, Metered, etc.)
     * for reliability, privacy, and to avoid rate limits on the public relay.
     */
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelay',
    credential: 'openrelay',
  },
];

// ── Phase 4C: Module-level ICE server cache ──────────────────────────────────
// Pre-fetched once when the hook first needs them; avoids an HTTP round-trip
// on the critical match→offer path. TTL is set from the server response.
let cachedIceServers: RTCIceServer[] | null = null;
let iceCacheFetchedAt = 0;
let iceCacheTtlMs = 60_000; // default 60s until server response received

async function getIceServers(): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (cachedIceServers && (now - iceCacheFetchedAt) < iceCacheTtlMs) {
    return cachedIceServers;
  }
  try {
    const res = await api.getIceServers();
    if (res.data.iceServers?.length) {
      cachedIceServers = [...res.data.iceServers, ...DEFAULT_ICE_SERVERS];
      iceCacheTtlMs = (res.data.ttl ?? 60) * 1000;
      iceCacheFetchedAt = now;
      return cachedIceServers;
    }
  } catch {
    console.warn('[WebRTC] ICE server fetch failed, using defaults');
  }
  return DEFAULT_ICE_SERVERS;
}

export interface UseWebRTCReturn {
  localVideoRef:    RefObject<HTMLVideoElement | null>;
  remoteVideoRef:   RefObject<HTMLVideoElement | null>;
  localStream:      MediaStream | null;
  /** Phase 4C: exposed as state so ChatRoom can assign it after DOM mounts */
  remoteStream:     MediaStream | null;
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
  // Phase 4C: track remote stream as state so the mounting useEffect in
  // ChatRoom can react to it and assign it after the <video> element paints.
  const [remoteStream,    setRemoteStream]     = useState<MediaStream | null>(null);
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

    // Phase 4C fix: do NOT force width/height — mobile front cameras reject
    // a 1280×720 constraint and fall back unpredictably. Let the browser/device
    // pick the best supported resolution; only constrain frameRate.
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          frameRate: { ideal: 30, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  true,
        },
      });
    } catch (videoErr) {
      console.warn('[WebRTC] Video+audio failed, trying audio-only:', videoErr);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      } catch (audioErr) {
        console.warn('[WebRTC] Audio-only also failed:', audioErr);
      }
    }

    if (!stream) {
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
      stream = new MediaStream();
    } else {
      setMediaPermission('granted');
    }

    localStreamRef.current = stream;
    setLocalStream(stream);

    if (localVideoRef.current) {
      localVideoRef.current.srcObject  = stream;
      localVideoRef.current.muted      = true;
    }
  }, []);

  // Request media as soon as hook mounts (ChatRoom opens)
  useEffect(() => {
    // Small delay so the UI renders first, then browser shows permission dialog.
    // Also pre-warm the ICE server cache while the user is granting permissions.
    const t = setTimeout(() => {
      void requestMedia();
      void getIceServers(); // pre-fetch in background, result will be cached
    }, 300);
    return () => {
      clearTimeout(t);
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
    setRemoteStream(null);
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
        // 1. Get ICE servers — uses module-level cache (pre-warmed on mount).
        //    No HTTP round-trip on the critical path when cache is warm.
        const iceServers = await getIceServers();

        if (!mounted) return;

        // 2. Use already-acquired local stream (from Phase 1).
        let stream = localStreamRef.current;
        if (!stream || stream.getTracks().length === 0) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'user', frameRate: { ideal: 30, max: 30 } },
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
            localStreamRef.current = stream;
            setLocalStream(stream);
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
              localVideoRef.current.muted     = true;
            }
            setMediaPermission('granted');
          } catch {
            stream = new MediaStream();
          }
        }

        if (!mounted) return;

        // 3. Create peer connection.
        // Phase 4C: iceCandidatePoolSize pre-gathers ICE candidates before
        // setLocalDescription, saving 100–500ms of ICE gathering time.
        const pc = new RTCPeerConnection({
          iceServers,
          iceCandidatePoolSize: 4,
        });
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

        // Phase 4C fix: store remote stream in state so ChatRoom.tsx can
        // assign it to the <video> element in a post-paint useEffect.
        // This resolves the race where ontrack fires before the video
        // element enters the DOM (it's inside AnimatePresence mode="wait").
        pc.ontrack = (e) => {
          const incomingStream = e.streams[0];
          if (incomingStream) {
            setRemoteStream(incomingStream);
            // Also try direct assignment if the ref is already mounted
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = incomingStream;
            }
          }
        };

        let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

        // Connection state changes
        pc.onconnectionstatechange = () => {
          if (!mounted) return;
          switch (pc.connectionState) {
            case 'connected':
              if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
              setIsConnecting(false);
              setStatus('connected');
              startTimer();
              startQualityPolling(pc);
              // Phase 4C: set outbound encoding parameters after connection.
              // maxBitrate hint is advisory — the browser/codec may not honour
              // it exactly, but it prevents the congestion controller from
              // throttling below a useful quality floor. Only applied when
              // setParameters is supported (all modern browsers).
              void applyVideoEncodingParams(pc);
              break;
            case 'failed':
              if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
              setCallError('Connection failed — try skipping to next partner');
              setStatus('idle');
              closePc();
              break;
            case 'disconnected':
              setStatus('reconnecting');
              stopQualityPolling();
              if (reconnectTimeout) clearTimeout(reconnectTimeout);
              reconnectTimeout = setTimeout(() => {
                if (pc.connectionState === 'disconnected') {
                  setCallError('Connection timed out — skipping to next partner');
                  setStatus('idle');
                  closePc();
                }
              }, 5000);
              break;
          }
        };

        // ── ICE Candidate Queue for early candidates ──────────────────────
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

        // ── Signaling event handlers ──────────────────────────────────────

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
            iceCandidateQueue.push(payload.candidate);
          }
        };

        const handleRestart = async (data: unknown) => {
          const payload = data as { roomId: string };
          if (payload.roomId !== matchInfo!.roomId) return;
          if (pcRef.current) {
            try {
              pcRef.current.restartIce();
              const offer = await pcRef.current.createOffer({ iceRestart: true });
              await pcRef.current.setLocalDescription(offer);
              socket!.emit(SocketEvents.WEBRTC_OFFER, {
                roomId: matchInfo!.roomId,
                sdp: offer,
              });
            } catch (err) {
              console.error('[WebRTC] Failed ICE restart:', err);
            }
          }
        };

        const handlePeerLeft = () => {
          if (!mounted) return;
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          closePc();
        };

        socket!.on(SocketEvents.WEBRTC_OFFER,         handleOffer);
        socket!.on(SocketEvents.WEBRTC_ANSWER,        handleAnswer);
        socket!.on(SocketEvents.WEBRTC_ICE_CANDIDATE, handleIce);
        socket!.on(SocketEvents.WEBRTC_RESTART,       handleRestart);
        socket!.on(SocketEvents.PEER_LEFT,            handlePeerLeft);
        socket!.on(SocketEvents.PEER_NEXT,            handlePeerLeft);

        return () => {
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          socket!.off(SocketEvents.WEBRTC_OFFER,         handleOffer);
          socket!.off(SocketEvents.WEBRTC_ANSWER,        handleAnswer);
          socket!.off(SocketEvents.WEBRTC_ICE_CANDIDATE, handleIce);
          socket!.off(SocketEvents.WEBRTC_RESTART,       handleRestart);
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
    remoteStream,
    mediaPermission,
    isConnecting,
    callError,
    requestMedia,
    setMicMuted,
    setCameraOff,
  };
}

// ── Phase 4C: Apply video encoding parameters after connection ───────────────
// Sets a maxBitrate hint on the outbound video sender. This is advisory —
// WebRTC's congestion controller may still throttle below this if network
// conditions require it. We do NOT claim this enforces a minimum bitrate;
// actual throughput must be verified via WebRTC stats (chrome://webrtc-internals).
async function applyVideoEncodingParams(pc: RTCPeerConnection): Promise<void> {
  try {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender || typeof sender.getParameters !== 'function') return;

    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;

    // Set a 2 Mbps max bitrate hint and prevent the browser from scaling
    // down the resolution unnecessarily.
    params.encodings[0] = {
      ...params.encodings[0],
      maxBitrate: 2_000_000,           // 2 Mbps ceiling hint
      scaleResolutionDownBy: 1.0,      // do not downscale from native resolution
    };

    await sender.setParameters(params);
  } catch (err) {
    // setParameters can fail if the codec doesn't support the parameter —
    // this is non-fatal; the call continues with default codec parameters.
    console.warn('[WebRTC] Could not set encoding params:', err);
  }
}
