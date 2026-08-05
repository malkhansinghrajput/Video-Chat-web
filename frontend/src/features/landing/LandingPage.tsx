import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useAnimation } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { PageLayout } from '@/components/layout/PageLayout';
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

/* Simple rolling number hook */
function useCounter(target: number) {
  const [count, setCount] = useState(target - 100);
  useEffect(() => {
    let current = count;
    const step = Math.ceil((target - current) / 20);
    const timer = setInterval(() => {
      current += step;
      if (current >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(current);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [target]);
  return count;
}

export function LandingPage() {
  const navigate = useNavigate();
  const onlineCount = useCounter(12483);

  const handleStartChat = () => {
    navigate('/chat');
  };

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
            <Button size="xl" glow onClick={handleStartChat} iconRight={<span aria-hidden="true">→</span>}>
              Start Video Chat
            </Button>
            <p className={styles.heroSubtext}>No sign-up required.</p>
          </motion.div>
        </motion.div>
      </section>

      <section className={styles.stats}>
        <div className={styles.statsInner}>
          <span className={styles.onlineDot} />
          <span className={styles.onlineCount}>{onlineCount.toLocaleString()}</span>
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
