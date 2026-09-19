import { QueueService, RoomService, MatchingEngine } from '../src/services/matching.service';
import { SessionService } from '../src/services/session.service';
import { metricsCollector } from '../src/utils/metrics.util';
import { RedisKeys, SocketEvents } from '../src/constants';

describe('Phase 2 High Traffic Optimization & Concurrency Tests', () => {
  // ===========================================================
  // 1. Metrics & Instrumentation
  // ===========================================================

  describe('MetricsCollector', () => {
    it('returns event loop lag in milliseconds', () => {
      const lag = metricsCollector.getEventLoopLagMs();
      expect(typeof lag).toBe('number');
      expect(lag).toBeGreaterThanOrEqual(0);
    });

    it('returns CPU usage percentage within [0, 100]', () => {
      const cpu = metricsCollector.getCpuUsagePercent();
      expect(typeof cpu).toBe('number');
      expect(cpu).toBeGreaterThanOrEqual(0);
      expect(cpu).toBeLessThanOrEqual(100);
    });

    it('returns valid memory usage heap figures in MB', () => {
      const mem = metricsCollector.getMemoryUsageMb();
      expect(mem.heapUsedMb).toBeGreaterThan(0);
      expect(mem.heapTotalMb).toBeGreaterThan(0);
      expect(mem.rssMb).toBeGreaterThan(0);
    });
  });

  // ===========================================================
  // 2. Queue & Matching Engine Atomicity
  // ===========================================================

  describe('Queue & Room Atomic Scripts', () => {
    let queueService: QueueService;
    let roomService: RoomService;
    let matchingEngine: MatchingEngine;

    beforeEach(() => {
      queueService = new QueueService();
      roomService = new RoomService();
      matchingEngine = new MatchingEngine(queueService, roomService);
    });

    it('instantiates QueueService and RoomService correctly', () => {
      expect(queueService).toBeDefined();
      expect(roomService).toBeDefined();
      expect(matchingEngine).toBeDefined();
      expect(matchingEngine.isHealthy).toBe(false);
    });

    it('matchingEngine start and stop toggles healthy state', () => {
      matchingEngine.start();
      expect(matchingEngine.isHealthy).toBe(true);
      matchingEngine.stop();
      expect(matchingEngine.isHealthy).toBe(false);
    });

    it('Redis key naming for distributed session and presence state is consistent', () => {
      const sessId = 'sess_12345';
      const sockId = 'sock_67890';
      const roomId = 'room_abcde';

      expect(RedisKeys.session.data(sessId)).toBe(`session:${sessId}`);
      expect(RedisKeys.session.room(roomId)).toBe(`room:${roomId}`);
      expect(RedisKeys.presence.socket(sockId)).toBe(`presence:${sockId}`);
      expect(RedisKeys.queue.reservation(sessId)).toBe(`match:reservation:${sessId}`);
    });
  });

  // ===========================================================
  // 3. Socket Events & WebRTC Signaling Contracts
  // ===========================================================

  describe('Socket & WebRTC Signaling Contracts', () => {
    it('contains all required WebRTC signaling event names', () => {
      expect(SocketEvents.WEBRTC_OFFER).toBe('webrtc:offer');
      expect(SocketEvents.WEBRTC_ANSWER).toBe('webrtc:answer');
      expect(SocketEvents.WEBRTC_ICE_CANDIDATE).toBe('webrtc:ice_candidate');
      expect(SocketEvents.WEBRTC_RESTART).toBe('webrtc:restart');
    });

    it('contains all required Chat and Queue event names', () => {
      expect(SocketEvents.JOIN_QUEUE).toBe('join_queue');
      expect(SocketEvents.LEAVE_QUEUE).toBe('leave_queue');
      expect(SocketEvents.MATCH_FOUND).toBe('match:found');
      expect(SocketEvents.CHAT_MESSAGE).toBe('chat:message');
      expect(SocketEvents.CHAT_NEXT).toBe('chat:next');
      expect(SocketEvents.CHAT_LEAVE).toBe('chat:leave');
      expect(SocketEvents.PEER_LEFT).toBe('peer:left');
      expect(SocketEvents.PEER_NEXT).toBe('peer:next');
    });
  });

  // ===========================================================
  // 4. Session Service Lifecycle Contracts
  // ===========================================================

  describe('SessionService Contracts', () => {
    let sessionService: SessionService;

    beforeEach(() => {
      sessionService = new SessionService();
    });

    it('generates TURN credentials with username and password', () => {
      const creds = sessionService.getTurnCredentials('test_session');
      expect(creds).toBeDefined();
      expect(creds.urls).toBeDefined();
      expect(creds.username).toBeDefined();
      expect(creds.credential).toBeDefined();
      expect(creds.ttl).toBeGreaterThan(0);
    });
  });
});
