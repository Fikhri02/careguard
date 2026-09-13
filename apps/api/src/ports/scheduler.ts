export interface ScheduledJob {
  id: string;
  runAt: Date;
  run(): Promise<void>;
}

export interface Scheduler {
  /** Returns the job id used by the backing scheduler. */
  schedule(job: ScheduledJob): string;
  cancel(id: string): void;
}
