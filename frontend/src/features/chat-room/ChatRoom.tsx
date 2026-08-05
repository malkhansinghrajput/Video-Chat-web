import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { IconButton } from '@/components/ui/IconButton';
import styles from './ChatRoom.module.css';

export function ChatRoom() {
  const navigate = useNavigate();
  const [isSearching, setIsSearching] = useState(true);
  const [searchTime, setSearchTime] = useState(0);

  // Mock search timer for UI demonstration
  useEffect(() => {
    if (!isSearching) return;
    const timer = setInterval(() => setSearchTime((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isSearching]);

  return (
    <div className={styles.container}>
      
      {/* Network HUD */}
      <motion.div 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        className={styles.networkHud}
      >
        <span className={`${styles.dot} ${styles.good}`} />
        <span>HD • 24ms</span>
      </motion.div>

      {/* Main View Area */}
      <AnimatePresence mode="wait">
        {isSearching ? (
          <motion.div 
            key="search"
            className={styles.searchOverlay}
            exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
            transition={{ duration: 0.4 }}
          >
            <div className={styles.radar}>
              {/* Expanding Ripples */}
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className={styles.ripple}
                  animate={{
                    scale: [1, 2.5],
                    opacity: [0.8, 0],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    delay: i * 0.6,
                    ease: "easeOut"
                  }}
                />
              ))}
              <div className={styles.avatarPlaceholder}>👤</div>
            </div>
            
            <motion.h2 
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className={styles.searchText}
            >
              Finding partner...
            </motion.h2>
            <p className={styles.waitText}>Wait time: {searchTime}s</p>
          </motion.div>
        ) : (
          <motion.div 
            key="call"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={styles.remoteVideo}
            style={{ background: '#1a1a1a' }} // Placeholder for remote video
          />
        )}
      </AnimatePresence>

      {/* Local Video Preview */}
      <motion.div 
        className={styles.localVideo}
        style={{ background: '#333' }} // Placeholder for local video
        drag
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={0.1}
      />

      {/* Floating Controls */}
      <motion.div 
        className={styles.controlsWrapper}
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', delay: 0.2 }}
      >
        <IconButton icon="🎤" tooltip="Mute Microphone" />
        <IconButton icon="📷" tooltip="Turn off Camera" />
        <IconButton 
          icon="⏭" 
          variant="filled" 
          tooltip="Skip (Space)" 
          onClick={() => {
            setIsSearching(true);
            setSearchTime(0);
          }}
        />
        <IconButton icon="💬" tooltip="Open Chat" badge={3} />
        <IconButton 
          icon="✖" 
          variant="danger" 
          tooltip="Leave" 
          onClick={() => navigate('/')}
        />
      </motion.div>

    </div>
  );
}
