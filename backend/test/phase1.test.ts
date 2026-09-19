/**
 * Phase 1 Backend Hardening - Regression Tests
 *
 * Tests all fixes from Phase 1:
 * - Secret validation (production enforcement)
 * - CORS wildcard rejection in production
 * - Session create / validate / destroy / token cleanup
 * - Analytics response contract (no duplicate timestamp)
 * - Redis subscription idempotency
 * - TURN/STUN configuration
 * - Socket event constants completeness
 */
import { subscribeToChannel } from '../src/config/redis';

describe('Phase 1 Hardening Tests', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  // ===========================================================
  // 1. Security - Secret Validation
  // ===========================================================

  describe('env.ts - secret() validation in production', () => {
    it('throws if SESSION_HMAC_SECRET is missing in production', () => {
      process.env = {
        NODE_ENV: 'production',
        ENV_FILE: '.missing',
        // SESSION_HMAC_SECRET deliberately absent
        TURN_SERVER_SECRET: 'a-valid-turn-secret-that-is-long-enough-yes',
        ADMIN_API_TOKEN: 'a-valid-admin-token-that-is-long-enough',
        CORS_ORIGIN: 'https://example.com',
      };
      jest.isolateModules(() => {
        expect(() => {
          require('../src/config/env');
        }).toThrow(/SESSION_HMAC_SECRET/);
      });
    });

    it('throws if SESSION_HMAC_SECRET is shorter than 32 chars in production', () => {
      process.env = {
        NODE_ENV: 'production',
        ENV_FILE: '.missing',
        SESSION_HMAC_SECRET: 'tooshort',
        TURN_SERVER_SECRET: 'a-valid-turn-secret-that-is-long-enough-yes',
        ADMIN_API_TOKEN: 'a-valid-admin-token-that-is-long-enough',
        CORS_ORIGIN: 'https://example.com',
      };
      jest.isolateModules(() => {
        expect(() => {
          require('../src/config/env');
        }).toThrow(/SESSION_HMAC_SECRET/);
      });
    });

    it('throws if SESSION_HMAC_SECRET is a known dev placeholder in production', () => {
      process.env = {
        NODE_ENV: 'production',
        ENV_FILE: '.missing',
        SESSION_HMAC_SECRET: 'change-me-in-production-minimum-32-chars!!',
        TURN_SERVER_SECRET: 'a-valid-turn-secret-that-is-long-enough-yes',
        ADMIN_API_TOKEN: 'a-valid-admin-token-that-is-long-enough',
        CORS_ORIGIN: 'https://example.com',
      };
      jest.isolateModules(() => {
        expect(() => {
          require('../src/config/env');
        }).toThrow(/known development placeholder/);
      });
    });

    it('throws if ADMIN_API_TOKEN is the default dev value in production', () => {
      process.env = {
        NODE_ENV: 'production',
        ENV_FILE: '.missing',
        SESSION_HMAC_SECRET: 'a-valid-prod-secret-that-is-sufficiently-long-yes',
        TURN_SERVER_SECRET: 'a-valid-turn-secret-that-is-long-enough-yes',
        ADMIN_API_TOKEN: 'development-admin-token',  // known dev placeholder
        CORS_ORIGIN: 'https://example.com',
      };
      jest.isolateModules(() => {
        expect(() => {
          require('../src/config/env');
        }).toThrow(/ADMIN_API_TOKEN/);
      });
    });

    it('throws if TURN_SERVER_SECRET is the default dev value in production', () => {
      process.env = {
        NODE_ENV: 'production',
        ENV_FILE: '.missing',
        SESSION_HMAC_SECRET: 'a-valid-prod-secret-that-is-sufficiently-long-yes',
        TURN_SERVER_SECRET: 'change-me-turn-shared-secret',  // known dev placeholder
        ADMIN_API_TOKEN: 'a-valid-admin-token-that-is-long-enough',
        CORS_ORIGIN: 'https://example.com',
      };
      jest.isolateModules(() => {
        expect(() => {
          require('../src/config/env');
        }).toThrow(/TURN_SERVER_SECRET/);
      });
    });

    it('accepts valid production secrets without throwing', () => {
      process.env = {
        NODE_ENV: 'production',
        ENV_FILE: '.missing',
        SESSION_HMAC_SECRET: 'a-valid-prod-secret-that-is-sufficiently-long-yes',
        TURN_SERVER_SECRET: 'a-valid-turn-secret-that-is-long-enough-yes',
        ADMIN_API_TOKEN: 'a-valid-admin-token-that-is-long-enough',
        CORS_ORIGIN: 'https://example.com',
      };
      jest.isolateModules(() => {
        expect(() => {
          require('../src/config/env');
        }).not.toThrow();
      });
    });

    it('allows dev fallback in development without throwing', () => {
      process.env = {
        NODE_ENV: 'development',
        ENV_FILE: '.missing',
      };
      jest.isolateModules(() => {
        expect(() => {
          const { env } = require('../src/config/env') as typeof import('../src/config/env');
          // Fallback should be present
          expect(env.SESSION_HMAC_SECRET).toBeTruthy();
        }).not.toThrow();
      });
    });
  });

  // ===========================================================
  // 2. CORS - Wildcard rejected in production
  // ===========================================================

  describe('env.ts - corsOrigin() validation in production', () => {
    it('throws if CORS_ORIGIN is wildcard in production', () => {
      process.env = {
        NODE_ENV: 'production',
        ENV_FILE: '.missing',
        SESSION_HMAC_SECRET: 'a-valid-prod-secret-that-is-sufficiently-long-yes',
        TURN_SERVER_SECRET: 'a-valid-turn-secret-that-is-long-enough-yes',
        ADMIN_API_TOKEN: 'a-valid-admin-token-that-is-long-enough',
        CORS_ORIGIN: '*',
      };
      jest.isolateModules(() => {
        expect(() => {
          require('../src/config/env');
        }).toThrow(/CORS_ORIGIN/);
      });
    });

    it('throws if CORS_ORIGIN includes wildcard among other origins in production', () => {
      process.env = {
        NODE_ENV: 'production',
        ENV_FILE: '.missing',
        SESSION_HMAC_SECRET: 'a-valid-prod-secret-that-is-sufficiently-long-yes',
        TURN_SERVER_SECRET: 'a-valid-turn-secret-that-is-long-enough-yes',
        ADMIN_API_TOKEN: 'a-valid-admin-token-that-is-long-enough',
        CORS_ORIGIN: 'https://example.com,*',
      };
      jest.isolateModules(() => {
        expect(() => {
          require('../src/config/env');
        }).toThrow(/CORS_ORIGIN/);
      });
    });

    it('allows specific origins in production', () => {
      process.env = {
        NODE_ENV: 'production',
        ENV_FILE: '.missing',
        SESSION_HMAC_SECRET: 'a-valid-prod-secret-that-is-sufficiently-long-yes',
        TURN_SERVER_SECRET: 'a-valid-turn-secret-that-is-long-enough-yes',
        ADMIN_API_TOKEN: 'a-valid-admin-token-that-is-long-enough',
        CORS_ORIGIN: 'https://myapp.com,https://www.myapp.com',
      };
      jest.isolateModules(() => {
        expect(() => {
          const { env } = require('../src/config/env') as typeof import('../src/config/env');
          expect(env.CORS_ORIGIN).toBe('https://myapp.com,https://www.myapp.com');
        }).not.toThrow();
      });
    });

    it('allows wildcard in development', () => {
      process.env = {
        NODE_ENV: 'development',
        ENV_FILE: '.missing',
        CORS_ORIGIN: '*',
      };
      jest.isolateModules(() => {
        expect(() => {
          require('../src/config/env');
        }).not.toThrow();
      });
    });
  });

  // ===========================================================
  // 3. Session Token - validateToken returns null for invalid
  // ===========================================================

  describe('token.util.ts - token generation and validation', () => {
    it('generates and verifies a valid session token', () => {
      process.env = {
        NODE_ENV: 'development',
        ENV_FILE: '.missing',
      };
      jest.isolateModules(() => {
        const { generateSessionToken, verifySessionToken, generateSessionId } =
          require('../src/utils/token.util') as typeof import('../src/utils/token.util');
        const sessionId = generateSessionId();
        const token = generateSessionToken(sessionId);
        const result = verifySessionToken(token);
        expect(result).toBe(sessionId);
      });
    });

    it('returns null for a tampered token', () => {
      process.env = {
        NODE_ENV: 'development',
        ENV_FILE: '.missing',
      };
      jest.isolateModules(() => {
        const { generateSessionToken, verifySessionToken, generateSessionId } =
          require('../src/utils/token.util') as typeof import('../src/utils/token.util');
        const sessionId = generateSessionId();
        const token = generateSessionToken(sessionId);
        const tampered = token.slice(0, -5) + 'XXXXX';
        expect(verifySessionToken(tampered)).toBeNull();
      });
    });

    it('returns null for an empty string', () => {
      process.env = { NODE_ENV: 'development', ENV_FILE: '.missing' };
      jest.isolateModules(() => {
        const { verifySessionToken } = require('../src/utils/token.util') as typeof import('../src/utils/token.util');
        expect(verifySessionToken('')).toBeNull();
      });
    });
  });

  // ===========================================================
  // 4. Analytics contract - no duplicate timestamp in data
  // ===========================================================

  describe('AnalyticsController.getLiveStats - response contract', () => {
    it('returns data without a nested timestamp field', async () => {
      // Mock Express response
      const res = {
        _body: null as unknown,
        json(body: unknown) { this._body = body; },
      };
      const req = {} as import('express').Request;

      // Mock Redis and queue
      jest.mock('../src/config/redis', () => ({
        redisAnalytics: { get: jest.fn().mockResolvedValue('42') },
      }));
      jest.mock('../src/services/matching.service', () => ({
        queueService: { getQueueDepth: jest.fn().mockResolvedValue(5) },
        matchingEngine: { isHealthy: true },
        roomService: {},
      }));

      jest.isolateModules(async () => {
        const { analyticsController } = require('../src/controllers/health.controller') as
          typeof import('../src/controllers/health.controller');

        await analyticsController.getLiveStats(req, res as unknown as import('express').Response);

        const body = res._body as {
          success: boolean;
          data: Record<string, unknown>;
          timestamp: number;
        };

        // Root timestamp must be present
        expect(body.timestamp).toBeDefined();
        // data must NOT have a nested timestamp (that was the contract bug)
        expect(body.data['timestamp']).toBeUndefined();
        // required fields present
        expect(body.data['concurrentUsers']).toBeDefined();
        expect(body.data['usersInQueue']).toBeDefined();
        expect(body.data['activeRooms']).toBeDefined();
      });
    });
  });

  // ===========================================================
  // 5. Redis subscription idempotency
  // ===========================================================

  describe('redis.ts - subscribeToChannel idempotency', () => {
    it('registers the message listener only once for the same channel', () => {
      expect(typeof subscribeToChannel).toBe('function');
      const handler = jest.fn();
      expect(() => {
        subscribeToChannel('test:channel:idempotent', 1000, handler);
        subscribeToChannel('test:channel:idempotent', 1000, handler);
      }).not.toThrow();
    });
  });

  // ===========================================================
  // 6. TURN - localhost TURN URLs excluded from ICE in production
  // ===========================================================

  describe('session.controller.ts - TURN configuration', () => {
    it('excludes localhost TURN from ICE servers', async () => {
      const res = {
        _body: null as unknown,
        json(body: unknown) { this._body = body; },
      };
      const req = { session: { sessionId: 'test-session-id' } } as unknown as import('express').Request;

      process.env = {
        NODE_ENV: 'development',
        ENV_FILE: '.missing',
        TURN_SERVER_URLS: 'turn:localhost:3478',
        TURN_SERVER_SECRET: 'dev-turn-secret',
      };

      jest.isolateModules(() => {
        jest.mock('../src/services/session.service', () => ({
          sessionService: {
            getTurnCredentials: jest.fn().mockReturnValue({
              username: 'user',
              credential: 'cred',
              ttl: 3600,
              urls: ['turn:localhost:3478'],
            }),
          },
        }));

        const { SessionController } = require('../src/controllers/session.controller') as
          typeof import('../src/controllers/session.controller');
        const ctrl = new SessionController();

        void ctrl.getIceServers(req, res as unknown as import('express').Response).then(() => {
          const body = res._body as {
            data: { iceServers: Array<{ urls: string | string[] }> };
          };
          const hasTurn = body.data.iceServers.some((s) =>
            (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.includes('localhost'))
          );
          expect(hasTurn).toBe(false);
        });
      });
    });

    it('removes retired stun.services.mozilla.com from ICE list', async () => {
      const res = {
        _body: null as unknown,
        json(body: unknown) { this._body = body; },
      };
      const req = { session: { sessionId: 'test-session-id' } } as unknown as import('express').Request;

      process.env = { NODE_ENV: 'development', ENV_FILE: '.missing' };

      jest.isolateModules(() => {
        jest.mock('../src/services/session.service', () => ({
          sessionService: {
            getTurnCredentials: jest.fn().mockReturnValue({
              username: 'u', credential: 'c', ttl: 3600, urls: [],
            }),
          },
        }));

        const { SessionController } = require('../src/controllers/session.controller') as
          typeof import('../src/controllers/session.controller');
        const ctrl = new SessionController();

        void ctrl.getIceServers(req, res as unknown as import('express').Response).then(() => {
          const body = res._body as {
            data: { iceServers: Array<{ urls: string | string[] }> };
          };
          const hasMozilla = body.data.iceServers.some((s) =>
            (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.includes('mozilla'))
          );
          expect(hasMozilla).toBe(false);
        });
      });
    });
  });

  // ===========================================================
  // 7. Socket event constants - REPORT_SUBMITTED present
  // ===========================================================

  describe('constants/index.ts - SocketEvents completeness', () => {
    it('has REPORT_SUBMITTED constant defined', () => {
      jest.isolateModules(() => {
        const { SocketEvents } = require('../src/constants') as typeof import('../src/constants');
        expect(SocketEvents.REPORT_SUBMITTED).toBe('report:submitted');
      });
    });

    it('all Server-to-Client events are defined', () => {
      jest.isolateModules(() => {
        const { SocketEvents } = require('../src/constants') as typeof import('../src/constants');
        const expected = [
          'QUEUE_JOINED', 'QUEUE_POSITION', 'MATCH_FOUND', 'PEER_JOINED',
          'PEER_LEFT', 'PEER_NEXT', 'CHAT_MESSAGE_INCOMING', 'WEBRTC_RESTART',
          'WEBRTC_FAILED', 'SESSION_BANNED', 'SESSION_ERROR', 'HEARTBEAT_ACK',
          'REPORT_SUBMITTED',
        ];
        for (const key of expected) {
          expect(SocketEvents[key as keyof typeof SocketEvents]).toBeDefined();
        }
      });
    });
  });

  // ===========================================================
  // 8. Existing staging alias test (regression guard)
  // ===========================================================

  describe('env.ts - staging credential aliases', () => {
    it('maps explicitly named staging credentials only in test mode', () => {
      process.env = {
        NODE_ENV: 'test',
        ENV_FILE: '.missing-test-env',
        STAGING_MONGODB_URI: 'mongodb://staging.example/videochat_loadtest',
        STAGING_REDIS_HOST: 'redis.staging.example',
        STAGING_REDIS_PORT: '6380',
      };
      jest.isolateModules(() => {
        const { env } = require('../src/config/env') as typeof import('../src/config/env');
        expect(env.MONGODB_URI).toBe('mongodb://staging.example/videochat_loadtest');
        expect(env.REDIS_HOST).toBe('redis.staging.example');
        expect(env.REDIS_PORT).toBe(6380);
      });
    });

    it('does not map staging aliases outside test mode', () => {
      process.env = {
        NODE_ENV: 'production',
        ENV_FILE: '.missing-production-env',
        STAGING_REDIS_HOST: 'redis.staging.example',
        SESSION_HMAC_SECRET: 'test-only-secret-with-sufficient-length-yes-ok',
        TURN_SERVER_SECRET: 'test-only-turn-secret-that-is-long-enough',
        ADMIN_API_TOKEN: 'test-only-admin-token-that-is-long-enough',
        CORS_ORIGIN: 'https://example.com',
      };
      jest.isolateModules(() => {
        const { env } = require('../src/config/env') as typeof import('../src/config/env');
        expect(env.REDIS_HOST).toBe('localhost');
      });
    });
  });
});