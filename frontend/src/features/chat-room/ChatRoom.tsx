import { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { IconButton } from '@/components/ui/IconButton';
import { useSession } from '@/hooks/useSession';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useCallStore } from '@/stores/callStore';
import { generateId } from '@/utils/generateId';
import styles from './ChatRoom.module.css';

export function ChatRoom() {
  const navigate = useNavigate();

  // ── Network status ────────────────────────────────────────────────────────
  const isOnline = useNetworkStatus();

  // ── Session ───────────────────────────────────────────────────────────────
  const { session, status: sessionStatus } = useSession();

  // ── Socket ────────────────────────────────────────────────────────────────
  const {
    isConnected,
    isConnecting: socketConnecting,
    socketError,
    clearSocketError,
    joinQueue,
    skipPartner,
    leaveChat,
    sendMessage,
  } = useSocket(session);

  // ── Call store state ──────────────────────────────────────────────────────
  const status = useCallStore((s) => s.status);
  const matchInfo = useCallStore((s) => s.matchInfo);
  const isMicMuted = useCallStore((s) => s.isMicMuted);
  const isCameraOff = useCallStore((s) => s.isCameraOff);
  const isRemoteAudioMuted = useCallStore((s) => s.isRemoteAudioMuted);
  const connectionQuality = useCallStore((s) => s.connectionQuality);
  const rtt = useCallStore((s) => s.rtt);
  const messages = useCallStore((s) => s.messages);
  const isChatOpen = useCallStore((s) => s.isChatOpen);
  const unreadCount = useCallStore((s) => s.unreadCount);
  const isPartnerTyping = useCallStore((s) => s.isPartnerTyping);
  const callStartTime = useCallStore((s) => s.callStartTime);
  const toggleMic = useCallStore((s) => s.toggleMic);
  const toggleCamera = useCallStore((s) => s.toggleCamera);
  const toggleChat = useCallStore((s) => s.toggleChat);
  const toggleRemoteAudio = useCallStore((s) => s.toggleRemoteAudio);
  const addMessage = useCallStore((s) => s.addMessage);
  const markRead = useCallStore((s) => s.markRead);

  // ── WebRTC ────────────────────────────────────────────────────────────────
  const {
    localVideoRef,
    remoteVideoRef,
    localStream,
    remoteStream,
    mediaPermission,
    isConnecting: webrtcConnecting,
    callError,
    requestMedia,
    setMicMuted,
    setCameraOff,
    setRemoteAudioMuted,
  } = useWebRTC(matchInfo);

  // ── Sync mic & camera toggles to actual media tracks ───────────────────────
  useEffect(() => { setMicMuted(isMicMuted); }, [isMicMuted, setMicMuted]);
  useEffect(() => { void setCameraOff(isCameraOff); }, [isCameraOff, setCameraOff]);

  // ── Phase 4F: Sync remote audio mute state to video element ─────────────────
  // Applied on every change to isRemoteAudioMuted AND whenever remoteStream
  // changes (new match → new element mount → re-apply current mute state).
  useEffect(() => {
    setRemoteAudioMuted(isRemoteAudioMuted);
  }, [isRemoteAudioMuted, setRemoteAudioMuted]);

  // ── Phase 4C: Assign remoteStream to <video> element after DOM mount ────────
  // ontrack in useWebRTC can fire before AnimatePresence renders the video
  // element. By reacting to remoteStream state here, we guarantee the
  // assignment happens AFTER React has committed the DOM node to the page.
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      // Phase 4F: re-apply speaker mute state after stream assignment
      remoteVideoRef.current.muted = isRemoteAudioMuted;
    }
  }, [remoteStream, remoteVideoRef, isRemoteAudioMuted]);

  // ── Phase 4F: Local video srcObject re-assignment on element remount ────────
  // The local <video> is conditionally rendered (hidden when camera off).
  // When the DOM node remounts after camera ON, localVideoRef.current changes
  // but the 'localStream' state value hasn't changed — so the useEffect in
  // useWebRTC that assigns srcObject doesn't re-fire. Fix: use a callback ref
  // so assignment runs every time the node mounts (including remounts).
  const localVideoCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    // Assign the ref so useWebRTC can still use it for srcObject updates
    (localVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = node;
    // Immediately assign the stream when the DOM node appears
    if (node && localStream) {
      node.srcObject = localStream;
      node.muted = true;
    }
  }, [localStream, localVideoRef]);

  // ── Auto-join queue once connected (only when online) ─────────────────────
  // Phase 4F: The joinQueue() function in useSocket is now guarded by a
  // queue phase state machine. Calling it when already joining/searching/matched
  // is a no-op. We can safely call it here without additional ref guards.
  useEffect(() => {
    if (isOnline && isConnected && status === 'idle') {
      joinQueue();
    }
  }, [isOnline, isConnected, status, joinQueue]);

  // ── Phase 4B: Clear stale socket errors when status becomes connected ───────
  useEffect(() => {
    if (status === 'connected' && socketError) {
      clearSocketError();
    }
  }, [status, socketError, clearSocketError]);

  // ── Mark messages as read when chat opened ────────────────────────────────
  useEffect(() => {
    if (isChatOpen) markRead();
  }, [isChatOpen, markRead]);

  // ── Touch / Swipe-Up Gesture Handling for Mobile ─────────────────────────
  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartTime = useRef<number>(0);
  const [swipeFeedback, setSwipeFeedback] = useState(false);

  const triggerNextWithFeedback = useCallback(() => {
    if (!isConnected || !isOnline) return;
    setSwipeFeedback(true);
    skipPartner();
    setTimeout(() => {
      setSwipeFeedback(false);
    }, 700);
  }, [isConnected, isOnline, skipPartner]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    // Don't trigger swipe inside chat drawer, buttons, or inputs
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest(`.${styles.chatPanel}`)
    ) {
      return;
    }
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    touchStartTime.current = Date.now();
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null || touchStartX.current === null) return;

    const endY = e.changedTouches[0].clientY;
    const endX = e.changedTouches[0].clientX;
    const deltaY = touchStartY.current - endY; // positive = swipe up
    const deltaX = Math.abs(touchStartX.current - endX);
    const deltaTime = Date.now() - touchStartTime.current;

    touchStartY.current = null;
    touchStartX.current = null;

    // Trigger swipe if user swiped UP by >50px, vertical displacement >horizontal, within 600ms
    if (deltaY > 50 && deltaY > deltaX * 1.1 && deltaTime < 600) {
      triggerNextWithFeedback();
    }
  }, [triggerNextWithFeedback]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSkip = useCallback(() => {
    if (!isOnline) return;
    skipPartner();
  }, [isOnline, skipPartner]);

  // ── Space Key Shortcut to Skip ────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const active = document.activeElement;
        const tag = active?.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (active as HTMLElement)?.isContentEditable) {
          return;
        }
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSkip]);

  // ── Dynamic Local Video Drag Bounds ───────────────────────────────────────
  const [dragBounds, setDragBounds] = useState({ left: -180, right: 10, top: 0, bottom: 350 });

  useEffect(() => {
    const updateBounds = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const maxLeft = Math.min(-50, -(w - 140));
      const maxBottom = Math.min(450, h - 180);
      setDragBounds({ left: maxLeft, right: 10, top: 0, bottom: maxBottom });
    };
    updateBounds();
    window.addEventListener('resize', updateBounds);
    return () => window.removeEventListener('resize', updateBounds);
  }, []);

  // ── Realtime 1-Second Call Timer Tick ────────────────────────────────────
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!callStartTime) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [callStartTime]);

  const callDuration = callStartTime
    ? Math.floor((now - callStartTime) / 1000)
    : 0;

  // ── Quality dot color (memoized — only changes when connectionQuality changes) ─
  const qualityClass = useMemo(() => ({
    excellent: styles.good,
    good: styles.good,
    poor: styles.poor,
    critical: styles.critical,
  }[connectionQuality] ?? styles.good), [connectionQuality]);

  const handleLeave = useCallback(() => {
    leaveChat();
    navigate('/');
  }, [leaveChat, navigate]);

  const handleSendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    sendMessage(text);
    addMessage({
      id: generateId(),
      sender: 'me',
      text: text.trim(),
      timestamp: Date.now(),
    });
  }, [sendMessage, addMessage]);

  // ── Loading / error states ────────────────────────────────────────────────
  const isLoading = sessionStatus === 'loading' || socketConnecting;

  // Phase 4F: never show transient queue errors when actively searching.
  // The socketError from useSocket already filters ALREADY_IN_QUEUE silently,
  // but if any slips through while searching/connected, suppress the banner.
  const isActivelyEngaged = status === 'searching' || status === 'matched' || status === 'connected' || status === 'reconnecting';
  const isTransientError = socketError && (
    socketError.includes('Already in queue') ||
    socketError.includes('Too many queue') ||
    socketError.includes('Session is not available')
  );
  const error = (isActivelyEngaged && isTransientError) ? null : (socketError ?? callError);

  const isSearching = status === 'searching' || (isConnected && status === 'idle');
  const isInCall = status === 'matched' || status === 'connected' || status === 'reconnecting';

  return (
    <div
      className={styles.container}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >

      {/* Network HUD */}
      <motion.div
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        className={styles.networkHud}
      >
        <span className={`${styles.dot} ${isConnected && isOnline ? qualityClass : styles.critical}`} />
        <span>
          {!isOnline
            ? 'Offline'
            : !isConnected
              ? (isLoading ? 'Connecting...' : 'Disconnected')
              : status === 'reconnecting'
                ? 'Reconnecting...'
                : isInCall
                  ? `HD • ${rtt > 0 ? `${rtt}ms` : 'live'}`
                  : isSearching
                    ? 'Searching...'
                    : 'Connected'}
        </span>
      </motion.div>

      {/* Offline Banner */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            key="offline-banner"
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            className={styles.permissionBanner}
            style={{ background: '#dc2626' }}
          >
            <span>📡 Internet connection lost. Reconnecting when online...</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Swipe-Up Hint Pill */}
      <AnimatePresence>
        {isConnected && isOnline && !isChatOpen && (
          <motion.div
            key="swipe-hint"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={styles.swipeHint}
          >
            <motion.span
              animate={{ y: [-3, 3, -3] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              👆
            </motion.span>
            <span>Swipe up or press Space for next</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Swipe Feedback Overlay */}
      <AnimatePresence>
        {swipeFeedback && (
          <motion.div
            key="swipe-feedback"
            initial={{ opacity: 0, y: 40, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -40, scale: 0.9 }}
            transition={{ duration: 0.25 }}
            className={styles.swipeFeedbackOverlay}
          >
            <motion.div
              animate={{ y: [-5, -25] }}
              transition={{ duration: 0.4, repeat: Infinity, repeatType: 'reverse' }}
              style={{ fontSize: '2.4rem' }}
            >
              ⬆️
            </motion.div>
            <span style={{ fontWeight: 600, fontSize: '1.05rem', letterSpacing: '0.5px' }}>
              Skipping to next...
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Camera Permission Denied Banner */}
      <AnimatePresence>
        {mediaPermission === 'denied' && (
          <motion.div
            key="cam-denied"
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            className={styles.permissionBanner}
          >
            <span>📷 Camera/mic blocked</span>
            <button className={styles.retryBtn} onClick={() => { void requestMedia(); }}>
              Allow &amp; Retry
            </button>
          </motion.div>
        )}
        {mediaPermission === 'requesting' && (
          <motion.div
            key="cam-requesting"
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            className={styles.permissionBanner}
            style={{ background: 'rgba(59,130,246,0.85)' }}
          >
            <span>📷 Allow camera &amp; microphone access in your browser...</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Banner — Phase 4F: only actionable errors */}
      <AnimatePresence>
        {error && (
          <motion.div
            key="error"
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            className={styles.errorBanner}
          >
            ⚠️ {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main View Area */}
      <AnimatePresence mode="wait">
        {!isInCall ? (
          /* Searching / Loading overlay */
          <motion.div
            key="search"
            className={styles.searchOverlay}
            exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
            transition={{ duration: 0.4 }}
          >
            <div className={styles.radar}>
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className={styles.ripple}
                  animate={{ scale: [1, 2.5], opacity: [0.8, 0] }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.6, ease: 'easeOut' }}
                />
              ))}
              <div className={styles.avatarPlaceholder}>👤</div>
            </div>

            <motion.h2
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className={styles.searchText}
            >
              {isLoading
                ? 'Initialising session...'
                : sessionStatus === 'rate_limited'
                  ? 'Too many requests — please wait & refresh'
                  : sessionStatus === 'error'
                    ? 'Session error — retrying...'
                    : 'Finding partner...'}
            </motion.h2>
            <p className={styles.waitText}>
              {isConnected ? 'Searching globally • Press Space or Swipe up to skip' : 'Establishing connection...'}
            </p>
          </motion.div>
        ) : (
          /* Active call: remote video */
          <motion.div
            key="call"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={styles.remoteVideo}
          >
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              aria-label="Remote partner video"
              className={styles.remoteVideoEl}
              style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#111' }}
            />
            {webrtcConnecting && (
              <div className={styles.connectingOverlay}>
                <span>Establishing video connection...</span>
              </div>
            )}
            {status === 'reconnecting' && (
              <div className={styles.connectingOverlay} style={{ background: 'rgba(220,38,38,0.7)' }}>
                <span>Reconnecting video stream...</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Local Video Preview
          Phase 4F: keep <video> always mounted (just visually hidden when camera off)
          so localVideoRef always points to a valid DOM node. This prevents the
          srcObject assignment race when camera turns back ON. */}
      <motion.div
        className={styles.localVideo}
        drag
        dragConstraints={dragBounds}
        dragElastic={0.1}
        whileDrag={{ scale: 1.05 }}
      >
        {/* Always keep the video element mounted — hide it when camera is off */}
        <video
          ref={localVideoCallbackRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: 'inherit',
            // Phase 4F: hide (not unmount) when camera is off to keep DOM node alive
            display: isCameraOff || !localStream ? 'none' : 'block',
          }}
        />
        {/* Placeholder shown when camera is off or stream not yet acquired */}
        {(isCameraOff || !localStream) && (
          <div style={{
            width: '100%', height: '100%',
            background: '#222',
            borderRadius: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.8rem',
            color: '#888'
          }}>
            {isCameraOff ? '📷❌' : '👤'}
          </div>
        )}
      </motion.div>

      {/* Call duration */}
      <AnimatePresence>
        {isInCall && callDuration > 0 && (
          <motion.div
            className={styles.callTimer}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {String(Math.floor(callDuration / 60)).padStart(2, '0')}:
            {String(callDuration % 60).padStart(2, '0')}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Controls */}
      <motion.div
        className={styles.controlsWrapper}
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', delay: 0.2 }}
      >
        <IconButton
          icon={isMicMuted ? '🔇' : '🎤'}
          tooltip={isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
          aria-pressed={isMicMuted}
          aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
          onClick={toggleMic}
        />
        <IconButton
          icon={isCameraOff ? '📷' : '🎥'}
          tooltip={isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
          aria-pressed={isCameraOff}
          aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
          onClick={toggleCamera}
        />
        {/* Phase 4F: Remote speaker mute/unmute button
            Controls ONLY local playback — no Socket.IO, no track modification */}
        <IconButton
          icon={isRemoteAudioMuted ? '🔇' : '🔊'}
          tooltip={isRemoteAudioMuted ? 'Unmute remote audio' : 'Mute remote audio'}
          aria-pressed={isRemoteAudioMuted}
          aria-label={isRemoteAudioMuted ? 'Unmute remote audio' : 'Mute remote audio'}
          onClick={toggleRemoteAudio}
        />
        <IconButton
          icon="⏭"
          size="lg"
          variant="filled"
          tooltip="Next (Space or Swipe Up)"
          aria-label="Skip to next partner"
          onClick={handleSkip}
          disabled={!isConnected || !isOnline}
        />
        <IconButton
          icon="💬"
          tooltip="Open Chat"
          aria-label="Open chat panel"
          badge={unreadCount > 0 ? unreadCount : undefined}
          onClick={toggleChat}
        />
        <IconButton
          icon="✖"
          variant="danger"
          tooltip="Leave"
          aria-label="Leave chat"
          onClick={handleLeave}
        />
      </motion.div>

      {/* Chat Panel */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div
            key="chat"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25 }}
            className={styles.chatPanel}
            role="dialog"
            aria-label="Chat panel"
            aria-modal="false"
          >
            <div className={styles.chatHeader}>
              <span>Chat</span>
              <button
                onClick={toggleChat}
                className={styles.chatClose}
                aria-label="Close chat"
              >✕</button>
            </div>
            <div className={styles.chatMessages}>
              {messages.length === 0 && (
                <p className={styles.chatEmpty}>No messages yet. Say hi! 👋</p>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`${styles.chatMsg} ${msg.sender === 'me' ? styles.chatMsgMe : styles.chatMsgPartner}`}
                >
                  {msg.text}
                </div>
              ))}
              {isPartnerTyping && (
                <div className={styles.typingIndicator}>Partner is typing...</div>
              )}
            </div>
            <ChatInput onSend={handleSendMessage} disabled={!isInCall || !isOnline} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Inline chat input ─────────────────────────────────────────────────────────
function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <form
      className={styles.chatInputRow}
      onSubmit={(e) => {
        e.preventDefault();
        const input = (e.currentTarget.elements.namedItem('msg') as HTMLInputElement);
        if (input.value.trim()) {
          onSend(input.value.trim());
          input.value = '';
        }
      }}
    >
      <input
        name="msg"
        className={styles.chatInput}
        placeholder={disabled ? 'Waiting for partner...' : 'Type a message...'}
        aria-label="Type a chat message"
        disabled={disabled}
        maxLength={500}
        autoComplete="off"
      />
      <button type="submit" className={styles.chatSend} disabled={disabled} aria-label="Send message">➤</button>
    </form>
  );
}
