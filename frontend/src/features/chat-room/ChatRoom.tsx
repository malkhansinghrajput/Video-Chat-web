import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function ChatRoom() {
  const navigate = useNavigate();

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
      <h1>Chat Room</h1>
      <p>Phase 3 Implementation incoming...</p>
      <Button onClick={() => navigate('/')} variant="outline">Back to Home</Button>
    </div>
  );
}
