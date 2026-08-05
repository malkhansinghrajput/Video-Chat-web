import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';

/* Eager load the landing page */
import { LandingPage } from '@/features/landing';

/* Lazy load other routes */
const ChatRoom = lazy(() =>
  import('@/features/chat-room').then((m) => ({ default: m.ChatRoom }))
);
const NotFoundPage = lazy(() =>
  import('@/features/static-pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage }))
);

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={
        <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size="lg" />
        </div>
      }>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/chat" element={<ChatRoom />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
