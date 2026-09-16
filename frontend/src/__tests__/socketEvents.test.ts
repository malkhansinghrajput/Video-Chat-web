/**
 * Socket Events Contract Tests
 *
 * Verifies that SocketEvents constants match the backend-expected event names.
 * If a backend event string changes, this test will catch the drift.
 *
 * NOTE: These tests do NOT test actual Socket.IO connections.
 * They verify the frontend's event name contract only.
 * Real networking must be tested manually (see webrtc-manual-checklist.md).
 */

import { describe, it, expect } from 'vitest';
import { SocketEvents } from '../lib/socket';

describe('SocketEvents — client-emitted events (Client → Server)', () => {
  it('JOIN_QUEUE maps to "join_queue"', () => {
    expect(SocketEvents.JOIN_QUEUE).toBe('join_queue');
  });

  it('LEAVE_QUEUE maps to "leave_queue"', () => {
    expect(SocketEvents.LEAVE_QUEUE).toBe('leave_queue');
  });

  it('CHAT_MESSAGE maps to "chat:message"', () => {
    expect(SocketEvents.CHAT_MESSAGE).toBe('chat:message');
  });

  it('CHAT_NEXT maps to "chat:next"', () => {
    expect(SocketEvents.CHAT_NEXT).toBe('chat:next');
  });

  it('CHAT_LEAVE maps to "chat:leave"', () => {
    expect(SocketEvents.CHAT_LEAVE).toBe('chat:leave');
  });

  it('WEBRTC_OFFER maps to "webrtc:offer"', () => {
    expect(SocketEvents.WEBRTC_OFFER).toBe('webrtc:offer');
  });

  it('WEBRTC_ANSWER maps to "webrtc:answer"', () => {
    expect(SocketEvents.WEBRTC_ANSWER).toBe('webrtc:answer');
  });

  it('WEBRTC_ICE_CANDIDATE maps to "webrtc:ice_candidate"', () => {
    expect(SocketEvents.WEBRTC_ICE_CANDIDATE).toBe('webrtc:ice_candidate');
  });

  it('REPORT_SUBMIT maps to "report:submit"', () => {
    expect(SocketEvents.REPORT_SUBMIT).toBe('report:submit');
  });

  it('HEARTBEAT maps to "heartbeat"', () => {
    expect(SocketEvents.HEARTBEAT).toBe('heartbeat');
  });
});

describe('SocketEvents — server-emitted events (Server → Client)', () => {
  it('QUEUE_JOINED maps to "queue:joined"', () => {
    expect(SocketEvents.QUEUE_JOINED).toBe('queue:joined');
  });

  it('QUEUE_POSITION maps to "queue:position"', () => {
    expect(SocketEvents.QUEUE_POSITION).toBe('queue:position');
  });

  it('MATCH_FOUND maps to "match:found"', () => {
    expect(SocketEvents.MATCH_FOUND).toBe('match:found');
  });

  it('PEER_LEFT maps to "peer:left"', () => {
    expect(SocketEvents.PEER_LEFT).toBe('peer:left');
  });

  it('PEER_NEXT maps to "peer:next"', () => {
    expect(SocketEvents.PEER_NEXT).toBe('peer:next');
  });

  it('CHAT_MESSAGE_INCOMING maps to "chat:message:incoming"', () => {
    expect(SocketEvents.CHAT_MESSAGE_INCOMING).toBe('chat:message:incoming');
  });

  it('WEBRTC_RESTART maps to "webrtc:restart"', () => {
    expect(SocketEvents.WEBRTC_RESTART).toBe('webrtc:restart');
  });

  it('WEBRTC_FAILED maps to "webrtc:failed"', () => {
    expect(SocketEvents.WEBRTC_FAILED).toBe('webrtc:failed');
  });

  it('SESSION_BANNED maps to "session:banned"', () => {
    expect(SocketEvents.SESSION_BANNED).toBe('session:banned');
  });

  it('SESSION_ERROR maps to "session:error"', () => {
    expect(SocketEvents.SESSION_ERROR).toBe('session:error');
  });

  it('HEARTBEAT_ACK maps to "heartbeat:ack"', () => {
    expect(SocketEvents.HEARTBEAT_ACK).toBe('heartbeat:ack');
  });
});
