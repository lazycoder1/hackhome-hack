import type { PovLoopRunner } from "../monitoring/pov-loop-runner.js";
import { isMonitorableStatus } from "../monitoring/pov-loop-runner.js";
import type { PocStore } from "../state/types.js";

/**
 * Local-mode scheduler. Mirrors the Trigger.dev `schedules.task` for `WORKFLOW_MODE=local`:
 * on an interval it lists monitorable POVs and runs the SAME `PovLoopRunner.runTick` the cloud
 * schedule calls. This is what makes the agent feel "always on" without deploying to Trigger.
 */
export type IntervalTickerOptions = {
  store: PocStore;
  runner: PovLoopRunner;
  intervalMs: number;
  onError?: (error: Error, pocId?: string) => void;
  log?: (message: string) => void;
};

export class IntervalTicker {
  private readonly store: PocStore;
  private readonly runner: PovLoopRunner;
  private readonly intervalMs: number;
  private readonly onError: (error: Error, pocId?: string) => void;
  private readonly log: (message: string) => void;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(options: IntervalTickerOptions) {
    this.store = options.store;
    this.runner = options.runner;
    this.intervalMs = options.intervalMs;
    this.onError = options.onError ?? (() => {});
    this.log = options.log ?? (() => {});
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tickAll();
    }, this.intervalMs);
    // Don't keep the process alive solely for the ticker.
    this.timer.unref?.();
    this.log(`POV loop ticker started (every ${Math.round(this.intervalMs / 1000)}s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run one tick across every monitorable POV. Failures are isolated per POV. */
  async tickAll(): Promise<{ ticked: number }> {
    if (this.running) {
      return { ticked: 0 };
    }
    this.running = true;
    try {
      const pocs = await this.store.listPocs({ limit: 200 });
      const active = pocs.filter((poc) => isMonitorableStatus(poc.status));
      for (const poc of active) {
        try {
          await this.runner.runTick(poc.pocId);
        } catch (error) {
          this.onError(error as Error, poc.pocId);
        }
      }
      return { ticked: active.length };
    } catch (error) {
      this.onError(error as Error);
      return { ticked: 0 };
    } finally {
      this.running = false;
    }
  }
}
