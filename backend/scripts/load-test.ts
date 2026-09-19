import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import http from 'http';

interface MetricSample {
  latencyMs: number;
}

interface LoadTestOptions {
  userCount: number;
  serverUrl: string;
  apiUrl: string;
  durationSeconds: number;
}

async function createSession(apiUrl: string, id: number): Promise<{ sessionId: string; token: string }> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      deviceFingerprint: `loadtest_fp_${id}_${Math.random().toString(36).substring(7)}`,
      country: ['US', 'IN', 'ES', 'DE', 'GB'][id % 5],
      language: ['en', 'es', 'hi', 'fr', 'de'][id % 5],
      interests: ['coding', 'music', 'gaming'].slice(0, (id % 3) + 1),
    });

    const url = new URL(`${apiUrl}/session/init`);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.success && json.data) {
            resolve({ sessionId: json.data.sessionId, token: json.data.token });
          } else {
            reject(new Error(`Session init failed: ${body}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function calculatePercentiles(samples: number[]): { p50: number; p95: number; p99: number; min: number; max: number; avg: number } {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)]!;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const avg = Math.round(sorted.reduce((acc, val) => acc + val, 0) / sorted.length);
  return { p50, p95, p99, min, max, avg };
}

async function runScenario(options: LoadTestOptions) {
  console.log(`\n==================================================`);
  console.log(` RUNNING LOAD TEST SCENARIO: ${options.userCount} USERS`);
  console.log(` Server: ${options.serverUrl}`);
  console.log(` Duration: ${options.durationSeconds}s`);
  console.log(`==================================================`);

  const sockets: ClientSocketType[] = [];
  const latencies: number[] = [];
  let successfulMatches = 0;
  let chatMessagesSent = 0;
  let chatMessagesReceived = 0;
  let errorsCount = 0;

  const startTime = Date.now();

  console.log(`Initializing ${options.userCount} sessions via HTTP API...`);
  const sessions: { sessionId: string; token: string }[] = [];

  const BATCH_SIZE = 50;
  for (let i = 0; i < options.userCount; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, options.userCount - i) }, (_, idx) => i + idx);
    const results = await Promise.allSettled(batch.map((id) => createSession(options.apiUrl, id)));
    for (const res of results) {
      if (res.status === 'fulfilled') {
        sessions.push(res.value);
      } else {
        errorsCount++;
      }
    }
  }

  console.log(`Successfully initialized ${sessions.length}/${options.userCount} sessions.`);

  console.log(`Connecting ${sessions.length} Socket.IO clients and joining queue...`);

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]!;
    const socket = ClientSocket(options.serverUrl, {
      auth: { token: session.token },
      transports: ['websocket'],
      reconnection: false,
    });

    sockets.push(socket);

    const connectSendTime = Date.now();

    socket.on('connect', () => {
      // Emit join queue
      const joinTime = Date.now();
      socket.emit('join_queue', {
        country: ['US', 'IN', 'ES', 'DE', 'GB'][i % 5],
        language: ['en', 'es', 'hi', 'fr', 'de'][i % 5],
        interests: ['coding', 'music', 'gaming'],
      });

      socket.once('queue:joined', () => {
        const queueAckTime = Date.now() - joinTime;
        latencies.push(queueAckTime);
      });
    });

    socket.on('match:found', (data: { roomId: string; role: string }) => {
      successfulMatches++;

      // Simulate chat message exchange
      const msgSendTime = Date.now();
      socket.emit('chat:message', {
        roomId: data.roomId,
        content: `Hello from loadtest user ${i}!`,
      });
      chatMessagesSent++;

      // Send next after 1.5s
      setTimeout(() => {
        socket.emit('chat:next');
      }, 1500);
    });

    socket.on('chat:message', () => {
      chatMessagesReceived++;
    });

    socket.on('session:error', () => {
      errorsCount++;
    });

    socket.on('connect_error', () => {
      errorsCount++;
    });
  }

  // Run test for specified duration
  await new Promise((resolve) => setTimeout(resolve, options.durationSeconds * 1000));

  console.log(`Disconnecting all sockets...`);
  for (const socket of sockets) {
    socket.disconnect();
  }

  const durationMs = Date.now() - startTime;
  const stats = calculatePercentiles(latencies);

  console.log(`\nRESULTS FOR ${options.userCount} USERS LOAD TEST:`);
  console.log(`  - Total Duration:       ${Math.round(durationMs / 1000)} s`);
  console.log(`  - Active Connections:   ${sockets.filter((s) => s.connected).length}`);
  console.log(`  - Matches Formed:       ${successfulMatches}`);
  console.log(`  - Chat Messages Sent:   ${chatMessagesSent}`);
  console.log(`  - Chat Messages Recv:   ${chatMessagesReceived}`);
  console.log(`  - Error Count:          ${errorsCount}`);
  console.log(`  - Queue Join Latency:`);
  console.log(`      p50: ${stats.p50} ms | p95: ${stats.p95} ms | p99: ${stats.p99} ms`);
  console.log(`      min: ${stats.min} ms | max: ${stats.max} ms | avg: ${stats.avg} ms`);

  return {
    userCount: options.userCount,
    durationSec: Math.round(durationMs / 1000),
    successfulMatches,
    chatMessagesSent,
    chatMessagesReceived,
    errorsCount,
    latency: stats,
  };
}

async function main() {
  const SERVER_URL = process.env['SERVER_URL'] || 'http://localhost:3001';
  const API_URL    = process.env['API_URL']    || 'http://localhost:3001/api/v1';

  try {
    const userCounts = [100, 500, 1000];
    const results = [];

    for (const count of userCounts) {
      const res = await runScenario({
        userCount: count,
        serverUrl: SERVER_URL,
        apiUrl: API_URL,
        durationSeconds: 10,
      });
      results.push(res);
    }

    console.log(`\n==================================================`);
    console.log(` LOAD TEST SUMMARY TABLE`);
    console.log(`==================================================`);
    console.table(results.map((r) => ({
      Users: r.userCount,
      'Matches Formed': r.successfulMatches,
      'Msgs Sent': r.chatMessagesSent,
      'Errors': r.errorsCount,
      'Queue Latency p50': `${r.latency.p50} ms`,
      'Queue Latency p95': `${r.latency.p95} ms`,
      'Queue Latency p99': `${r.latency.p99} ms`,
    })));

    process.exit(0);
  } catch (err) {
    console.error('Load test failed:', err);
    process.exit(1);
  }
}

main();
