/* Call Store — Call state, media toggles, connection quality, timer */

import { create } from 'zustand';
import type { CallStatus, ConnectionQuality, PartnerStatus } from '@/types/call.types';
import type { Message } from '@/types/chat.types';

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

interface CallState {
  /* Core State */
  status: CallStatus;
  setStatus: (status: CallStatus) => void;

  /* Media State */
  isMicMuted: boolean;
  isCameraOff: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;

  /* Partner State */
  partnerStatus: PartnerStatus;
  setPartnerStatus: (status: PartnerStatus) => void;

  /* Connection Quality */
  connectionQuality: ConnectionQuality;
  rtt: number;
  packetLoss: number;
  updateQuality: (rtt: number, packetLoss: number) => void;

  /* Call Timer */
  callStartTime: number | null;
  startTimer: () => void;
  stopTimer: () => void;

  /* Remote Audio */
  isRemoteAudioMuted: boolean;
  toggleRemoteAudio: () => void;

  /* Chat */
  isChatOpen: boolean;
  messages: Message[];
  unreadCount: number;
  isPartnerTyping: boolean;
  toggleChat: () => void;
  addMessage: (msg: Message) => void;
  markRead: () => void;
  setPartnerTyping: (typing: boolean) => void;
  clearMessages: () => void;

  /* Match Info (from match:found event) */
  matchInfo: MatchInfo | null;
  setMatchInfo: (info: MatchInfo | null) => void;

  /* Full Reset */
  resetCall: () => void;
}

const getQuality = (rtt: number, packetLoss: number): ConnectionQuality => {
  if (rtt < 100 && packetLoss < 1) return 'excellent';
  if (rtt < 300 && packetLoss < 5) return 'good';
  if (rtt < 1000 && packetLoss < 15) return 'poor';
  return 'critical';
};

const MAX_MESSAGES = 200;

export const useCallStore = create<CallState>((set, get) => ({
  status: 'idle',
  setStatus: (status) => set({ status }),

  isMicMuted: false,
  isCameraOff: false,
  toggleMic: () => set((s) => ({ isMicMuted: !s.isMicMuted })),
  toggleCamera: () => set((s) => ({ isCameraOff: !s.isCameraOff })),

  partnerStatus: null,
  setPartnerStatus: (partnerStatus) => set({ partnerStatus }),

  connectionQuality: 'excellent',
  rtt: 0,
  packetLoss: 0,
  updateQuality: (rtt, packetLoss) =>
    set({ rtt, packetLoss, connectionQuality: getQuality(rtt, packetLoss) }),

  callStartTime: null,
  startTimer: () => set({ callStartTime: Date.now() }),
  stopTimer: () => set({ callStartTime: null }),

  // Remote audio mute — controls only local playback of the remote stream.
  // Does NOT send any Socket.IO event, does NOT modify the remote track.
  isRemoteAudioMuted: false,
  toggleRemoteAudio: () => set((s) => ({ isRemoteAudioMuted: !s.isRemoteAudioMuted })),

  isChatOpen: false,
  messages: [],
  unreadCount: 0,
  isPartnerTyping: false,
  toggleChat: () => {
    const wasClosed = !get().isChatOpen;
    set((s) => ({
      isChatOpen: !s.isChatOpen,
      unreadCount: wasClosed ? 0 : s.unreadCount,
    }));
  },
  addMessage: (msg) => {
    const { messages, isChatOpen } = get();
    const updated =
      messages.length >= MAX_MESSAGES
        ? [...messages.slice(1), msg]
        : [...messages, msg];
    set({
      messages: updated,
      unreadCount:
        msg.sender === 'partner' && !isChatOpen
          ? get().unreadCount + 1
          : get().unreadCount,
    });
  },
  markRead: () => set({ unreadCount: 0 }),
  setPartnerTyping: (typing: boolean) => set({ isPartnerTyping: typing }),
  clearMessages: () => set({ messages: [], unreadCount: 0, isPartnerTyping: false }),

  matchInfo: null,
  setMatchInfo: (info) => set({ matchInfo: info }),

  resetCall: () =>
    set({
      status: 'idle',
      isMicMuted: false,
      isCameraOff: false,
      partnerStatus: null,
      connectionQuality: 'excellent',
      rtt: 0,
      packetLoss: 0,
      callStartTime: null,
      // Reset remote audio mute on every new call
      isRemoteAudioMuted: false,
      isChatOpen: false,
      messages: [],
      unreadCount: 0,
      isPartnerTyping: false,
      matchInfo: null,
    }),
}));
