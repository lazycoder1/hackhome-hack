import { schedules, task } from "@trigger.dev/sdk";
import { createAgentSystem } from "../src/app/create-agent-system.js";
import { isMonitorableStatus } from "../src/monitoring/pov-loop-runner.js";

/**
 * Cloud half of the always-on loop. The schedule fires on a cron, lists every monitorable POV,
 * and fans out one `pov-monitoring-tick` per POV so a slow telemetry/LLM call on one evaluation
 * can't stall the rest. Each tick runs the same `PovLoopRunner.runTick` the local IntervalTicker
 * calls — one code path, two schedulers.
 *
 * Override the cadence with the `POV_MONITORING_CRON` env var (UTC cron). Default: every 6 hours.
 */
export const povMonitoringTickTask = task({
  id: "pov-monitoring-tick",
  run: async (payload: { pocId: string }) => {
    const system = createAgentSystem({ approvalMode: "trigger" });
    return system.povLoopRunner.runTick(payload.pocId);
  },
});

export const povMonitoringScheduleTask = schedules.task({
  id: "pov-monitoring-schedule",
  cron: process.env.POV_MONITORING_CRON ?? "0 */6 * * *",
  run: async () => {
    const system = createAgentSystem({ approvalMode: "trigger" });
    const pocs = await system.store.listPocs({ limit: 200 });
    const active = pocs.filter((poc) => isMonitorableStatus(poc.status));

    for (const poc of active) {
      await povMonitoringTickTask.trigger({ pocId: poc.pocId });
    }

    return { activePovs: active.length, triggered: active.map((poc) => poc.pocId) };
  },
});
