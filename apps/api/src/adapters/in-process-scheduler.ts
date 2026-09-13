import type { Clock } from "../ports/clock.js";
import type { Logger } from "../ports/logger.js";
import type { Scheduler } from "../ports/scheduler.js";

const MAX_TIMEOUT_MS = 2_147_483_647; // ~24.8 days, the setTimeout ceiling

/** setTimeout-backed scheduler. Jobs are lost on restart — callers re-register them at boot. */
export function createInProcessScheduler(clock: Clock, log: Logger): Scheduler & { size(): number } {
  const timers = new Map<string, NodeJS.Timeout>();

  return {
    schedule(job) {
      const delay = Math.max(0, job.runAt.getTime() - clock.now().getTime());
      if (delay > MAX_TIMEOUT_MS) {
        log.warn("job is beyond the in-process scheduler range; not scheduled", { id: job.id });
        return job.id;
      }
      const timer = setTimeout(() => {
        timers.delete(job.id);
        job.run().catch((err: unknown) => {
          log.error("scheduled job failed", { id: job.id, error: err instanceof Error ? err.message : String(err) });
        });
      }, delay);
      timers.set(job.id, timer);
      return job.id;
    },
    cancel(id) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    },
    size: () => timers.size,
  };
}
