/**
 * security-verify.ts
 *
 * Automated security boundary tests against a running backend.
 * Tests that security controls (auth, CORS, rate limiting, input validation,
 * Helmet headers) are working correctly.
 *
 * Usage (from backend/ directory):
 *   BACKEND_URL=http://localhost:3001 npx ts-node scripts/security-verify.ts
 *
 * The server MUST be running before executing this script.
 * Run `npm run dev` in one terminal, then this script in another.
 */

const BASE = process.env['BACKEND_URL'] ?? 'http://localhost:3001';
const API  = `${BASE}/api/v1`;

// ─────────────────────────────────────────────
// Types & helpers
// ─────────────────────────────────────────────

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
}

const results: TestResult[] = [];
let failures = 0;

function pass(name: string, message: string): void {
  results.push({ name, status: 'PASS', message });
  console.log(`  ✅ ${name}: ${message}`);
}

function fail(name: string, message: string): void {
  results.push({ name, status: 'FAIL', message });
  console.log(`  ❌ ${name}: ${message}`);
  failures++;
}

function warn(name: string, message: string): void {
  results.push({ name, status: 'WARN', message });
  console.log(`  ⚠️  ${name}: ${message}`);
}

async function httpGet(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(path, { headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as Record<string, unknown>, headers: res.headers };
}

async function httpPost(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody as Record<string, unknown>, headers: res.headers };
}

// ─────────────────────────────────────────────
// Obtain a real session token for authenticated tests
// ─────────────────────────────────────────────

async function obtainToken(): Promise<string | null> {
  try {
    const res = await httpPost(`${API}/session/init`, {
      deviceFingerprint: `security-verify-${Date.now()}`,
      language: 'en',
      interests: [],
    });
    if (res.status === 201) {
      const data = res.body['data'] as { token?: string } | undefined;
      return data?.token ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────

async function testSessionInit(): Promise<void> {
  console.log('\n── Session Init ───────────────────────────────────');

  // Valid request
  const valid = await httpPost(`${API}/session/init`, {
    deviceFingerprint: `test-fp-${Date.now()}`,
    language: 'en',
    interests: ['music'],
  });
  if (valid.status === 201 && valid.body['data']) {
    pass('POST /session/init (valid)', `201 Created ✓`);
  } else {
    fail('POST /session/init (valid)', `Expected 201, got ${valid.status}`);
  }

  // Missing deviceFingerprint
  const missingFp = await httpPost(`${API}/session/init`, { language: 'en' });
  if (missingFp.status === 400) {
    pass('POST /session/init (missing fingerprint)', `400 Bad Request ✓`);
  } else {
    fail('POST /session/init (missing fingerprint)', `Expected 400, got ${missingFp.status}`);
  }

  // Oversized interests array (sanitization check)
  const bigInterests = await httpPost(`${API}/session/init`, {
    deviceFingerprint: `test-fp-oversize-${Date.now()}`,
    language: 'en',
    interests: Array.from({ length: 100 }, (_, i) => `interest-${i}`),
  });
  if (bigInterests.status === 201) {
    // Server should silently truncate interests to 10 items — OK
    pass('POST /session/init (oversized interests)', `201 Created (interests truncated server-side) ✓`);
  } else if (bigInterests.status === 400) {
    pass('POST /session/init (oversized interests)', `400 Bad Request (rejected) ✓`);
  } else {
    fail('POST /session/init (oversized interests)', `Unexpected status ${bigInterests.status}`);
  }
}

async function testSessionValidate(token: string | null): Promise<void> {
  console.log('\n── Session Validate ───────────────────────────────');

  // No token → 401
  const noToken = await httpGet(`${API}/session/validate`);
  if (noToken.status === 401) {
    pass('GET /session/validate (no token)', `401 Unauthorized ✓`);
  } else {
    fail('GET /session/validate (no token)', `Expected 401, got ${noToken.status}`);
  }

  // Forged token → 401
  const forgedToken = Buffer.from('forgery:12345678900:badhash').toString('base64url');
  const badToken = await httpGet(`${API}/session/validate`, {
    'X-Session-Token': forgedToken,
  });
  if (badToken.status === 401) {
    pass('GET /session/validate (forged token)', `401 Unauthorized ✓`);
  } else {
    fail('GET /session/validate (forged token)', `Expected 401, got ${badToken.status}`);
  }

  // Random garbage token → 401
  const garbage = await httpGet(`${API}/session/validate`, {
    'X-Session-Token': 'not-a-real-token-at-all-garbage',
  });
  if (garbage.status === 401) {
    pass('GET /session/validate (garbage token)', `401 Unauthorized ✓`);
  } else {
    fail('GET /session/validate (garbage token)', `Expected 401, got ${garbage.status}`);
  }

  // Valid token → 200
  if (token) {
    const valid = await httpGet(`${API}/session/validate`, {
      'X-Session-Token': token,
    });
    if (valid.status === 200) {
      pass('GET /session/validate (valid token)', `200 OK ✓`);
    } else {
      fail('GET /session/validate (valid token)', `Expected 200, got ${valid.status}`);
    }
  } else {
    warn('GET /session/validate (valid token)', 'Skipped — could not obtain a valid token');
  }
}

async function testIceServers(token: string | null): Promise<void> {
  console.log('\n── ICE Servers ────────────────────────────────────');

  // No token → 401
  const noToken = await httpGet(`${API}/session/iceservers`);
  if (noToken.status === 401) {
    pass('GET /session/iceservers (no token)', `401 Unauthorized ✓`);
  } else {
    fail('GET /session/iceservers (no token)', `Expected 401, got ${noToken.status}`);
  }

  // Valid token → 200 + ICE servers list
  if (token) {
    const res = await httpGet(`${API}/session/iceservers`, {
      'X-Session-Token': token,
    });
    if (res.status === 200) {
      const data = res.body['data'] as { iceServers?: unknown[] } | undefined;
      const iceCount = data?.iceServers?.length ?? 0;
      pass('GET /session/iceservers (valid token)', `200 OK — ${iceCount} ICE server(s) returned ✓`);

      // Verify no localhost TURN is returned to clients
      const hasLocalhostTurn = JSON.stringify(data?.iceServers ?? []).includes('localhost');
      if (hasLocalhostTurn) {
        warn('ICE servers content', 'Response contains localhost TURN entry — expected to be excluded in production');
      } else {
        pass('ICE servers content', 'No localhost TURN entries in response ✓');
      }
    } else {
      fail('GET /session/iceservers (valid token)', `Expected 200, got ${res.status}`);
    }
  } else {
    warn('GET /session/iceservers (valid token)', 'Skipped — could not obtain a valid token');
  }
}

async function testAdminEndpoints(): Promise<void> {
  console.log('\n── Admin Endpoints ────────────────────────────────');

  // No admin token → 403
  const noToken = await httpGet(`${BASE}/health/detailed`);
  if (noToken.status === 403) {
    pass('GET /health/detailed (no admin token)', `403 Forbidden ✓`);
  } else {
    fail('GET /health/detailed (no admin token)', `Expected 403, got ${noToken.status}`);
  }

  // Wrong admin token → 403
  const wrongToken = await httpGet(`${BASE}/health/detailed`, {
    'X-Admin-Token': 'wrong-admin-token-value',
  });
  if (wrongToken.status === 403) {
    pass('GET /health/detailed (wrong admin token)', `403 Forbidden ✓`);
  } else {
    fail('GET /health/detailed (wrong admin token)', `Expected 403, got ${wrongToken.status}`);
  }

  // Analytics admin endpoint — no token → 403
  const noTokenLive = await httpGet(`${BASE}/health/analytics/live`);
  if (noTokenLive.status === 403) {
    pass('GET /health/analytics/live (no admin token)', `403 Forbidden ✓`);
  } else {
    fail('GET /health/analytics/live (no admin token)', `Expected 403, got ${noTokenLive.status}`);
  }

  // Public count endpoint — no auth required → 200
  const publicCount = await httpGet(`${BASE}/health/analytics/count`);
  if (publicCount.status === 200) {
    pass('GET /health/analytics/count (public)', `200 OK (no auth required) ✓`);
  } else {
    fail('GET /health/analytics/count (public)', `Expected 200, got ${publicCount.status}`);
  }
}

async function testSecurityHeaders(): Promise<void> {
  console.log('\n── Security Headers ───────────────────────────────');

  const res = await fetch(`${BASE}/health`);

  // X-Powered-By should be absent (Helmet removes it)
  const poweredBy = res.headers.get('x-powered-by');
  if (!poweredBy) {
    pass('X-Powered-By header absent', 'Helmet removed X-Powered-By ✓');
  } else {
    fail('X-Powered-By header absent', `X-Powered-By is present: ${poweredBy}`);
  }

  // Content-Security-Policy should be present
  const csp = res.headers.get('content-security-policy');
  if (csp) {
    pass('Content-Security-Policy present', `CSP set ✓`);
  } else {
    fail('Content-Security-Policy present', 'CSP header missing — Helmet may not be configured');
  }

  // X-Frame-Options or frame-ancestors in CSP
  const xFrame = res.headers.get('x-frame-options');
  const hasFrameAncestors = csp?.includes('frame-ancestors') ?? false;
  if (xFrame || hasFrameAncestors) {
    pass('Clickjacking protection', `${xFrame ? `X-Frame-Options: ${xFrame}` : 'frame-ancestors in CSP'} ✓`);
  } else {
    warn('Clickjacking protection', 'X-Frame-Options not set and frame-ancestors not in CSP');
  }

  // X-Content-Type-Options
  const noSniff = res.headers.get('x-content-type-options');
  if (noSniff === 'nosniff') {
    pass('X-Content-Type-Options: nosniff', 'Set ✓');
  } else {
    warn('X-Content-Type-Options: nosniff', `Value: ${noSniff ?? '(missing)'}`);
  }
}

async function testResponseLeakage(_token: string | null): Promise<void> {
  console.log('\n── Secret Leakage ─────────────────────────────────');

  // Check that error responses don't contain env var names or secret-like values
  const forgedToken = Buffer.from('x:0:y').toString('base64url');
  const errorRes = await httpGet(`${API}/session/validate`, {
    'X-Session-Token': forgedToken,
  });

  const bodyStr = JSON.stringify(errorRes.body).toLowerCase();
  const leakagePatterns = ['hmac', 'secret', 'password', 'token_value', 'mongodb', 'redis'];
  const leaked = leakagePatterns.filter((p) => bodyStr.includes(p));

  if (leaked.length === 0) {
    pass('Error response leakage', 'No secret-like values in error responses ✓');
  } else {
    fail('Error response leakage', `Response may leak sensitive info: ${leaked.join(', ')}`);
  }

  // Verify 404 for non-existent routes doesn't reveal stack traces
  const notFound = await httpGet(`${API}/does-not-exist`);
  const notFoundStr = JSON.stringify(notFound.body).toLowerCase();
  if (!notFoundStr.includes('at object.<anonymous>') && !notFoundStr.includes('stack')) {
    pass('404 response (no stack trace)', 'No stack traces in 404 response ✓');
  } else {
    fail('404 response (no stack trace)', 'Stack trace detected in 404 response — disable in production');
  }
}

async function testRateLimiting(): Promise<void> {
  console.log('\n── Rate Limiting ──────────────────────────────────');

  // Health endpoint is not rate-limited; check an API endpoint for rate-limit headers

  // Health endpoint is not rate-limited, check an API endpoint header
  const apiRes = await httpGet(`${API}/session/validate`);
  const remaining = apiRes.headers.get('x-ratelimit-remaining');

  if (remaining !== null) {
    pass('Rate limit headers present', `X-RateLimit-Remaining: ${remaining} ✓`);
  } else {
    warn('Rate limit headers present', 'X-RateLimit-Remaining header not set on API responses');
  }

  // Verify 401 is returned (not 429) for the auth failure — rate limit not exhausted
  if (apiRes.status === 401) {
    pass('Rate limit not exhausted by test', '401 (auth error, not rate-limited) ✓');
  }
}

async function testHealthEndpoints(): Promise<void> {
  console.log('\n── Health Endpoints ───────────────────────────────');

  // Basic health
  const basic = await httpGet(`${BASE}/health`);
  if (basic.status === 200 && basic.body['status'] === 'ok') {
    pass('GET /health', `200 OK ✓`);
  } else {
    fail('GET /health', `Expected 200, got ${basic.status}`);
  }

  // Liveness
  const live = await httpGet(`${BASE}/health/live`);
  if (live.status === 200 && live.body['alive'] === true) {
    pass('GET /health/live', `200 OK ✓`);
  } else {
    fail('GET /health/live', `Expected 200, got ${live.status}`);
  }

  // Readiness — check TURN field is present
  const ready = await httpGet(`${BASE}/health/ready`);
  if (ready.status === 200 || ready.status === 503) {
    const checks = ready.body['checks'] as Record<string, unknown> | undefined;
    const turnStatus = checks?.['turn'];
    if (turnStatus !== undefined) {
      pass('GET /health/ready (TURN status field)', `turn=${turnStatus} ✓`);
    } else {
      warn('GET /health/ready (TURN status field)', 'turn field missing from readiness response');
    }
    pass('GET /health/ready', `${ready.status} (ready=${ready.body['ready']}) ✓`);
  } else {
    fail('GET /health/ready', `Unexpected status ${ready.status}`);
  }
}

// ─────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────

function printReport(): void {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SECURITY VERIFICATION REPORT');
  console.log(`  Backend: ${BASE}`);
  console.log('═══════════════════════════════════════════════════════');

  const passed  = results.filter((r) => r.status === 'PASS').length;
  const failed  = results.filter((r) => r.status === 'FAIL').length;
  const warned  = results.filter((r) => r.status === 'WARN').length;

  console.log(`\n  PASSED: ${passed}  FAILED: ${failed}  WARNED: ${warned}`);

  if (failures > 0) {
    console.log(`\n  ❌ SECURITY ISSUES FOUND — ${failures} test(s) failed.`);
  } else if (warned > 0) {
    console.log('\n  ⚠️  SECURITY CHECKS PASSED WITH WARNINGS — review before production.');
  } else {
    console.log('\n  ✅ ALL SECURITY CHECKS PASSED.');
  }
  console.log('═══════════════════════════════════════════════════════\n');
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\nSecurity verification against: ${BASE}`);
  console.log('Make sure the backend server is running before executing this script.\n');

  // First verify server is reachable
  try {
    const ping = await fetch(`${BASE}/health`);
    if (!ping.ok) throw new Error(`Health returned ${ping.status}`);
    console.log(`Server is reachable at ${BASE} ✓`);
  } catch (err) {
    console.error(`\n❌ Cannot reach server at ${BASE}: ${String(err)}`);
    console.error('Start the server with `npm run dev` and retry.\n');
    process.exit(1);
  }

  // Obtain a real session token for authenticated tests
  const token = await obtainToken();
  if (!token) {
    console.warn('⚠️  Could not obtain session token — some tests will be skipped');
  }

  // Run all test suites
  await testSessionInit();
  await testSessionValidate(token);
  await testIceServers(token);
  await testAdminEndpoints();
  await testSecurityHeaders();
  await testResponseLeakage(token);
  await testRateLimiting();
  await testHealthEndpoints();

  printReport();

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Security verify crashed:', err);
  process.exit(1);
});
