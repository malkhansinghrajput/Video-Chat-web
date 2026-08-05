import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { PageLayout } from '@/components/layout/PageLayout';
import { CONFIG } from '@/constants/config';

export function NotFoundPage() {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(CONFIG.REDIRECT_404_DELAY_MS / 1000);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <PageLayout showNav={false} showFooter={false}>
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 'var(--space-6)',
      }}>
        <h1 style={{ fontSize: 'var(--text-display)', marginBottom: 'var(--space-4)', color: 'var(--accent)' }}>404</h1>
        <h2 style={{ marginBottom: 'var(--space-6)' }}>You seem lost. Let's get you back.</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-8)' }}>
          Redirecting to home in {countdown} seconds...
        </p>
        
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button variant="secondary" onClick={() => navigate('/')}>
            Go Home
          </Button>
          <Button variant="primary" onClick={() => navigate('/chat')}>
            Start Chatting
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}
