import { describe, it, expect, beforeEach } from 'vitest';
import { useCallStore } from '../stores/callStore';

describe('callStore', () => {
  beforeEach(() => {
    useCallStore.getState().resetCall();
  });

  it('should initialize with default state', () => {
    const state = useCallStore.getState();
    expect(state.status).toBe('idle');
    expect(state.isMicMuted).toBe(false);
    expect(state.isCameraOff).toBe(false);
    expect(state.messages).toEqual([]);
    expect(state.matchInfo).toBeNull();
  });

  it('should toggle mic and camera states', () => {
    const store = useCallStore.getState();
    store.toggleMic();
    expect(useCallStore.getState().isMicMuted).toBe(true);

    store.toggleCamera();
    expect(useCallStore.getState().isCameraOff).toBe(true);

    store.toggleMic();
    expect(useCallStore.getState().isMicMuted).toBe(false);
  });

  it('should handle messages and unread counts', () => {
    const store = useCallStore.getState();
    
    // Add partner message when chat is closed
    store.addMessage({
      id: '1',
      sender: 'partner',
      text: 'Hello!',
      timestamp: Date.now(),
    });

    expect(useCallStore.getState().messages.length).toBe(1);
    expect(useCallStore.getState().unreadCount).toBe(1);

    // Open chat should reset unread count when markRead is called or chat toggled
    store.markRead();
    expect(useCallStore.getState().unreadCount).toBe(0);
  });

  it('should reset state completely on resetCall', () => {
    const store = useCallStore.getState();
    store.setStatus('connected');
    store.toggleMic();
    store.startTimer();

    store.resetCall();

    const resetState = useCallStore.getState();
    expect(resetState.status).toBe('idle');
    expect(resetState.isMicMuted).toBe(false);
    expect(resetState.callStartTime).toBeNull();
  });

  // ── Phase 4F: Remote audio mute tests ─────────────────────────────────────

  it('isRemoteAudioMuted initializes to false', () => {
    const state = useCallStore.getState();
    expect(state.isRemoteAudioMuted).toBe(false);
  });

  it('toggleRemoteAudio toggles isRemoteAudioMuted', () => {
    const store = useCallStore.getState();

    store.toggleRemoteAudio();
    expect(useCallStore.getState().isRemoteAudioMuted).toBe(true);

    store.toggleRemoteAudio();
    expect(useCallStore.getState().isRemoteAudioMuted).toBe(false);
  });

  it('resetCall resets isRemoteAudioMuted to false', () => {
    const store = useCallStore.getState();
    store.toggleRemoteAudio(); // mute remote
    expect(useCallStore.getState().isRemoteAudioMuted).toBe(true);

    store.resetCall();
    expect(useCallStore.getState().isRemoteAudioMuted).toBe(false);
  });

  it('remote audio and mic are independent toggles', () => {
    const store = useCallStore.getState();

    // Mute remote audio
    store.toggleRemoteAudio();
    expect(useCallStore.getState().isRemoteAudioMuted).toBe(true);
    expect(useCallStore.getState().isMicMuted).toBe(false); // unaffected

    // Mute mic
    store.toggleMic();
    expect(useCallStore.getState().isMicMuted).toBe(true);
    expect(useCallStore.getState().isRemoteAudioMuted).toBe(true); // still muted

    // Unmute remote audio
    store.toggleRemoteAudio();
    expect(useCallStore.getState().isRemoteAudioMuted).toBe(false);
    expect(useCallStore.getState().isMicMuted).toBe(true); // still muted
  });

  it('remote audio and camera are independent toggles', () => {
    const store = useCallStore.getState();

    store.toggleRemoteAudio();
    store.toggleCamera();

    expect(useCallStore.getState().isRemoteAudioMuted).toBe(true);
    expect(useCallStore.getState().isCameraOff).toBe(true);

    // Unmute only remote audio
    store.toggleRemoteAudio();
    expect(useCallStore.getState().isRemoteAudioMuted).toBe(false);
    expect(useCallStore.getState().isCameraOff).toBe(true); // unchanged
  });
});
