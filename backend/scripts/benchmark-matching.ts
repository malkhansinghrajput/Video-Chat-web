import { redisQueues, connectRedis, disconnectRedis } from '../src/config/redis';
import { QueueService, RoomService } from '../src/services/matching.service';
import { RedisKeys } from '../src/constants';
import { metricsCollector } from '../src/utils/metrics.util';
import type { QueueEntry } from '../src/types';

const queueService = new QueueService();
const roomService = new RoomService();

const LANGUAGES = ['en', 'es', 'hi', 'fr', 'de'];
const COUNTRIES = ['US', 'IN', 'ES', 'DE', 'GB'];
const ALL_INTERESTS = ['gaming', 'music', 'coding', 'movies', 'sports', 'anime', 'art', 'travel'];

function generateMockEntries(count: number): QueueEntry[] {
  const entries: QueueEntry[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const sessionId = `bench_sess_${i}_${Math.random().toString(36).substring(7)}`;
    const socketId = `bench_sock_${i}_${Math.random().toString(36).substring(7)}`;
    const language = LANGUAGES[i % LANGUAGES.length]!;
    const country = COUNTRIES[i % COUNTRIES.length]!;
    const userInterests = ALL_INTERESTS.slice(i % 3, (i % 3) + 3);

    entries.push({
      sessionId,
      socketId,
      country,
      language,
      interests: userInterests,
      joinedAt: now - Math.floor(Math.random() * 10000), // joined up to 10s ago
      priority: i % 10 === 0 ? 1 : 0,
    });
  }
  return entries;
}

async function fastEnqueueBatch(entries: QueueEntry[]): Promise<void> {
  const pipeline = redisQueues.pipeline();
  for (const entry of entries) {
    const entryKey = RedisKeys.queue.entry(entry.sessionId);
    pipeline.hset(
      entryKey,
      'sessionId', entry.sessionId,
      'socketId', entry.socketId,
      'country', entry.country,
      'language', entry.language,
      'interests', JSON.stringify(entry.interests),
      'joinedAt', String(entry.joinedAt),
      'priority', String(entry.priority)
    );
    pipeline.expire(entryKey, 3600);
    pipeline.zadd(RedisKeys.queue.global(), entry.joinedAt, entry.sessionId);
  }
  await pipeline.exec();
}

async function runBenchmarkForSize(size: number): Promise<{
  size: number;
  enqueueTimeMs: number;
  matchingCycleTimeMs: number;
  matchesCreated: number;
  matchesPerSec: number;
  candidateScanTimeMs: number;
  eventLoopLagMs: number;
  cpuPercent: number;
  heapUsedMb: number;
}> {
  console.log(`\n==================================================`);
  console.log(` BENCHMARKING MATCHING ENGINE WITH ${size.toLocaleString()} QUEUED USERS`);
  console.log(`==================================================`);

  // Clear existing queue test entries
  await redisQueues.del(RedisKeys.queue.global());

  const entries = generateMockEntries(size);

  // Enqueue in pipeline batches of 1000
  const enqueueStart = Date.now();
  const BATCH_SIZE = 1000;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await fastEnqueueBatch(batch);
  }
  const enqueueTimeMs = Date.now() - enqueueStart;

  const initialDepth = await queueService.getQueueDepth();
  console.log(`Queue populated: ${initialDepth} members in ${enqueueTimeMs}ms`);

  // Measure matching cycle execution
  const matchCycleStart = Date.now();

  let matchesCreated = 0;
  let cycles = 0;
  let remainingDepth = initialDepth;

  while (remainingDepth >= 2 && cycles < 100) {
    const depthBefore = remainingDepth;
    const batch = await queueService.getCandidates(500);
    if (batch.length < 2) break;

    const matched = new Set<string>();
    const now = Date.now();

    for (let i = 0; i < batch.length; i++) {
      const a = batch[i]!;
      if (matched.has(a.sessionId)) continue;

      for (let j = i + 1; j < batch.length; j++) {
        const b = batch[j]!;
        if (matched.has(b.sessionId)) continue;

        const minWait = Math.min((now - a.joinedAt) / 1000, (now - b.joinedAt) / 1000);
        const langMatch = a.language === b.language;
        const countryMatch = a.country === b.country;

        if ((langMatch && countryMatch) || minWait >= 15) {
          const ownerToken = `bench_token_${matchesCreated}`;
          const room = await roomService.createMatchedRoom(a, b, ownerToken);

          if (room) {
            matched.add(a.sessionId);
            matched.add(b.sessionId);
            matchesCreated++;
          }
          break;
        }
      }
    }

    cycles++;
    remainingDepth = await queueService.getQueueDepth();
    if (depthBefore === remainingDepth) {
      break;
    }
  }

  const matchingCycleTimeMs = Math.max(1, Date.now() - matchCycleStart);
  const matchesPerSec = Math.round((matchesCreated / (matchingCycleTimeMs / 1000)) * 10) / 10;
  const eventLoopLagMs = metricsCollector.getEventLoopLagMs();
  const cpuPercent = metricsCollector.getCpuUsagePercent();
  const heapUsedMb = metricsCollector.getMemoryUsageMb().heapUsedMb;

  console.log(`Results for ${size} queued users:`);
  console.log(`  - Matches Formed:        ${matchesCreated}`);
  console.log(`  - Matching Cycle Time:   ${matchingCycleTimeMs} ms`);
  console.log(`  - Matches / Second:      ${matchesPerSec}`);
  console.log(`  - Remaining Queue Depth: ${remainingDepth}`);
  console.log(`  - Event Loop Lag:        ${eventLoopLagMs} ms`);
  console.log(`  - CPU Usage:             ${cpuPercent}%`);
  console.log(`  - Heap Memory:           ${heapUsedMb} MB`);

  // Cleanup test queue
  await redisQueues.del(RedisKeys.queue.global());

  return {
    size,
    enqueueTimeMs,
    matchingCycleTimeMs,
    matchesCreated,
    matchesPerSec,
    candidateScanTimeMs: Math.round(matchingCycleTimeMs / Math.max(1, cycles)),
    eventLoopLagMs,
    cpuPercent,
    heapUsedMb,
  };
}

async function main() {
  try {
    await connectRedis();

    const sizes = [100, 500, 1000, 5000, 10000];
    const summaryTable: any[] = [];

    for (const size of sizes) {
      const result = await runBenchmarkForSize(size);
      summaryTable.push({
        'Queued Users': result.size,
        'Cycle Time (ms)': result.matchingCycleTimeMs,
        'Matches Formed': result.matchesCreated,
        'Matches / Sec': result.matchesPerSec,
        'Avg Scan (ms)': result.candidateScanTimeMs,
        'Loop Lag (ms)': result.eventLoopLagMs,
        'CPU %': result.cpuPercent,
        'Heap (MB)': result.heapUsedMb,
      });
    }

    console.log(`\n==================================================`);
    console.log(` MATCHING ENGINE BENCHMARK SUMMARY TABLE`);
    console.log(`==================================================`);
    console.table(summaryTable);

    await disconnectRedis();
    process.exit(0);
  } catch (err) {
    console.error('Benchmark failed:', err);
    process.exit(1);
  }
}

main();
