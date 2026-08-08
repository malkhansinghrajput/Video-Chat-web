describe('test environment isolation', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
  });

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
      SESSION_HMAC_SECRET: 'test-only-secret-with-sufficient-length',
      TURN_SERVER_SECRET: 'test-only-turn-secret',
      ADMIN_API_TOKEN: 'test-only-admin-token',
    };
    jest.isolateModules(() => {
      const { env } = require('../src/config/env') as typeof import('../src/config/env');
      expect(env.REDIS_HOST).toBe('localhost');
    });
  });
});
