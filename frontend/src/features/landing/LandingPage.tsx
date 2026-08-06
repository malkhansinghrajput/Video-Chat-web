import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { PageLayout } from '@/components/layout/PageLayout';
import { useSession } from '@/hooks/useSession';
import { useAppStore } from '@/stores/appStore';
import { api } from '@/lib/api';
import styles from './LandingPage.module.css';

const FEATURES = [
  {
    icon: '🔒',
    title: 'Completely Anonymous',
    desc: 'No sign-up, no login, no downloads required. Your privacy is our priority.',
  },
  {
    icon: '⚡',
    title: 'Instant Connections',
    desc: 'Swipe and instantly connect with thousands of online users globally.',
  },
  {
    icon: '🌍',
    title: 'Global Community',
    desc: 'Meet interesting people from all over the world in just one click.',
  },
];

/** Animates a number from start → target */
function useAnimatedCount(target: number) {
  const [count, setCount] = useState(Math.max(0, target - 80));
  useEffect(() => {
    if (target <= 0) return;
    let current = Math.max(0, target - 80);
    const step = Math.max(1, Math.ceil((target - current) / 25));
    const timer = setInterval(() => {
      current += step;
      if (current >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(current);
      }
    }, 40);
    return () => clearInterval(timer);
  }, [target]);
  return count;
}

export function LandingPage() {
  const navigate = useNavigate();
  const { status: sessionStatus } = useSession();
  const onlineCountRaw = useAppStore((s) => s.onlineCount);
  const setOnlineCount = useAppStore((s) => s.setOnlineCount);
  const [isStarting, setIsStarting] = useState(false);

  // Fetch real online count from backend analytics endpoint
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await api.getAnalytics();
        if (!cancelled && res.concurrentUsers != null) {
          setOnlineCount(res.concurrentUsers);
        }
      } catch {
        // Backend unreachable in dev — keep at 0
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [setOnlineCount]);

  const displayCount = useAnimatedCount(onlineCountRaw > 0 ? onlineCountRaw : 0);

  const handleStartChat = useCallback(async () => {
    if (isStarting) return;
    setIsStarting(true);
    try {
      navigate('/chat');
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, navigate]);

  const isSessionLoading = sessionStatus === 'loading';

  return (
    <PageLayout>
      <section className={styles.hero}>
        <div className={styles.heroBg} />
        
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={styles.heroContent}
        >
          <h1 className={styles.headline}>Meet Someone New, Instantly.</h1>
          <p className={styles.description}>
            The fastest way to video chat with strangers. Free, anonymous, and mobile-ready.
          </p>
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: 'easeOut' }}
            className={styles.ctaGroup}
          >
            <Button
              id="start-chat-btn"
              size="xl"
              glow
              onClick={handleStartChat}
              disabled={isStarting || isSessionLoading}
              iconRight={<span aria-hidden="true">{isStarting ? '⏳' : '→'}</span>}
            >
              {isSessionLoading ? 'Connecting...' : isStarting ? 'Starting...' : 'Start Video Chat'}
            </Button>
            <p className={styles.heroSubtext}>No sign-up required.</p>
          </motion.div>
        </motion.div>
      </section>

      <section className={styles.stats}>
        <div className={styles.statsInner}>
          <span className={styles.onlineDot} />
          <span className={styles.onlineCount}>
            {displayCount > 0 ? displayCount.toLocaleString() : '—'}
          </span>
          <span>people chatting right now</span>
        </div>
      </section>

      <section className={styles.features}>
        <div className={styles.featuresInner}>
          <h2 className={styles.featuresTitle}>Why VideoChatWeb?</h2>
          <div className={styles.featureGrid}>
            {FEATURES.map((feature, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                whileHover={{ y: -8, scale: 1.02 }}
                className={styles.featureCard}
              >
                <div className={styles.featureIcon}>{feature.icon}</div>
                <h3 className={styles.featureTitle}>{feature.title}</h3>
                <p className={styles.featureDesc}>{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.safety}>
        <div className={styles.safetyInner}>
          <h2 className={styles.safetyTitle}>Keep it clean. Keep it fun.</h2>
          <p className={styles.safetyDesc}>
            We have zero tolerance for inappropriate behavior. Please follow our community guidelines. 
            Violators will be permanently banned. Use the report button if you encounter any issues.
          </p>
        </div>
      </section>
    </PageLayout>
  );
}
