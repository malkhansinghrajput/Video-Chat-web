import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { IconButton } from '@/components/ui/IconButton';
import { useSession } from '@/hooks/useSession';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useCallStore } from '@/stores/callStore';
import styles from './ChatRoom.module.css';

export function ChatRoom() {
  const navigate = useNavigate();

  // ── Session ───────────────────────────────────────────────────────────────
  const { session, status: sessionStatus } = useSession();

  // ── Socket ────────────────────────────────────────────────────────────────
  const {
    isConnected,
    isConnecting: socketConnecting,
    socketError,
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
  const addMessage = useCallStore((s) => s.addMessage);
  const markRead = useCallStore((s) => s.markRead);

  // ── WebRTC ────────────────────────────────────────────────────────────────
  const {
    localVideoRef,
    remoteVideoRef,
    localStream,
    mediaPermission,
    isConnecting: webrtcConnecting,
    callError,
    requestMedia,
    setMicMuted,
    setCameraOff,
  } = useWebRTC(matchInfo);

  // ── Sync mic/camera toggles to actual media tracks ───────────────────────
  useEffect(() => { setMicMuted(isMicMuted); }, [isMicMuted, setMicMuted]);
  useEffect(() => { setCameraOff(isCameraOff); }, [isCameraOff, setCameraOff]);

  // ── Auto-join queue once connected ────────────────────────────────────────
  useEffect(() => {
    if (isConnected && status === 'idle') {
      joinQueue();
    }
  }, [isConnected, status, joinQueue]);

  // ── Mark messages as read when chat opened ────────────────────────────────
  useEffect(() => {
    if (isChatOpen) markRead();
  }, [isChatOpen, markRead]);

  // ── Call timer display ────────────────────────────────────────────────────
  const callDuration = callStartTime
    ? Math.floor((Date.now() - callStartTime) / 1000)
    : 0;

  // ── Quality dot color ─────────────────────────────────────────────────────
  const qualityClass = {
    excellent: styles.good,
    good: styles.good,
    poor: styles.poor,
    critical: styles.critical,
  }[connectionQuality] ?? styles.good;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSkip = useCallback(() => {
    skipPartner();
  }, [skipPartner]);

  const handleLeave = useCallback(() => {
    leaveChat();
    navigate('/');
  }, [leaveChat, navigate]);

  const handleSendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    sendMessage(text);
    addMessage({
      id: `me-${Date.now()}`,
      sender: 'me',
      text: text.trim(),
      timestamp: Date.now(),
    });
  }, [sendMessage, addMessage]);

  // ── Loading / error states ────────────────────────────────────────────────
  const isLoading = sessionStatus === 'loading' || socketConnecting;
  const error = socketError ?? callError;

  const isSearching = status === 'searching' || (isConnected && status === 'idle');
  const isInCall = status === 'matched' || status === 'connected';

  return (
    <div className={styles.container}>

      {/* Network HUD */}
      <motion.div
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        className={styles.networkHud}
      >
        <span className={`${styles.dot} ${isConnected ? qualityClass : styles.critical}`} />
        <span>
          {!isConnected
            ? (isLoading ? 'Connecting...' : 'Disconnected')
            : isInCall
              ? `HD • ${rtt > 0 ? `${rtt}ms` : 'live'}`
              : isSearching
                ? 'Searching...'
                : 'Connected'}
        </span>
      </motion.div>

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

      {/* Error Banner */}
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
              {isConnected ? 'Searching globally' : 'Establishing connection...'}
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
              className={styles.remoteVideoEl}
              style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#111' }}
            />
            {webrtcConnecting && (
              <div className={styles.connectingOverlay}>
                <span>Establishing video connection...</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Local Video Preview */}
      <motion.div
        className={styles.localVideo}
        drag
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={0.1}
      >
        {localStream ? (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: '#333',
            borderRadius: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '2rem',
          }}>
            📷
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
          onClick={toggleMic}
        />
        <IconButton
          icon={isCameraOff ? '🚫' : '📷'}
          tooltip={isCameraOff ? 'Turn on Camera' : 'Turn off Camera'}
          onClick={toggleCamera}
        />
        <IconButton
          icon="⏭"
          variant="filled"
          tooltip="Skip (Space)"
          onClick={handleSkip}
          disabled={!isConnected}
        />
        <IconButton
          icon="💬"
          tooltip="Open Chat"
          badge={unreadCount > 0 ? unreadCount : undefined}
          onClick={toggleChat}
        />
        <IconButton
          icon="✖"
          variant="danger"
          tooltip="Leave"
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
          >
            <div className={styles.chatHeader}>
              <span>Chat</span>
              <button onClick={toggleChat} className={styles.chatClose}>✕</button>
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
            <ChatInput onSend={handleSendMessage} disabled={!isInCall} />
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
        disabled={disabled}
        maxLength={500}
        autoComplete="off"
      />
      <button type="submit" className={styles.chatSend} disabled={disabled}>➤</button>
    </form>
  );
}
