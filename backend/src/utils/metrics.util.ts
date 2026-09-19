import { performance } from 'perf_hooks';

class MetricsCollector {
  private lastLoopTime: number = performance.now();
  private currentEventLoopLagMs: number = 0;
  private loopIntervalTimer: NodeJS.Timeout | null = null;
  private cpuUsageStart = process.cpuUsage();
  private lastCpuMeasureTime = performance.now();

  constructor() {
    this.startLoopMonitoring();
  }

  private startLoopMonitoring(): void {
    this.loopIntervalTimer = setInterval(() => {
      const now = performance.now();
      const delta = now - this.lastLoopTime;
      // Target interval is 500ms; extra delay is event loop lag
      this.currentEventLoopLagMs = Math.max(0, delta - 500);
      this.lastLoopTime = now;
    }, 500);
    this.loopIntervalTimer.unref();
  }

  public getEventLoopLagMs(): number {
    return Math.round(this.currentEventLoopLagMs * 100) / 100;
  }

  public getCpuUsagePercent(): number {
    const now = performance.now();
    const durationSec = (now - this.lastCpuMeasureTime) / 1000;
    if (durationSec <= 0) return 0;

    const cpu = process.cpuUsage(this.cpuUsageStart);
    this.cpuUsageStart = process.cpuUsage();
    this.lastCpuMeasureTime = now;

    const totalCpuUs = cpu.user + cpu.system;
    const cpuPercent = (totalCpuUs / 1000 / (durationSec * 1000)) * 100;
    return Math.min(100, Math.round(cpuPercent * 100) / 100);
  }

  public getMemoryUsageMb(): { heapUsedMb: number; heapTotalMb: number; rssMb: number } {
    const mem = process.memoryUsage();
    return {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
      rssMb: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
    };
  }
}

export const metricsCollector = new MetricsCollector();
