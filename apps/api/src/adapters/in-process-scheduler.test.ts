import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixedClock, silentLogger } from "../test/fakes.js";
import { createInProcessScheduler } from "./in-process-scheduler.js";

describe("createInProcessScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a job at its time", async () => {
    const scheduler = createInProcessScheduler(fixedClock("2026-09-13T03:00:00.000Z"), silentLogger);
    const run = vi.fn(async () => {});
    scheduler.schedule({ id: "rem_1", runAt: new Date("2026-09-13T03:10:00.000Z"), run });

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.size()).toBe(0);
  });

  it("cancels a job", async () => {
    const scheduler = createInProcessScheduler(fixedClock("2026-09-13T03:00:00.000Z"), silentLogger);
    const run = vi.fn(async () => {});
    scheduler.schedule({ id: "rem_1", runAt: new Date("2026-09-13T03:01:00.000Z"), run });
    scheduler.cancel("rem_1");

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.size()).toBe(0);
  });

  it("survives a failing job", async () => {
    const scheduler = createInProcessScheduler(fixedClock("2026-09-13T03:00:00.000Z"), silentLogger);
    scheduler.schedule({
      id: "rem_1",
      runAt: new Date("2026-09-13T03:00:01.000Z"),
      run: async () => {
        throw new Error("boom");
      },
    });
    await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
  });
});
