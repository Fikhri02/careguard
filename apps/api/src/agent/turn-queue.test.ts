import { describe, expect, it } from "vitest";
import { createTurnQueue } from "./turn-queue.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createTurnQueue", () => {
  it("runs tasks for the same key one at a time, in order", async () => {
    const queue = createTurnQueue();
    const log: string[] = [];
    const first = queue.run("eld_1", async () => {
      log.push("1:start");
      await sleep(20);
      log.push("1:end");
      return 1;
    });
    const second = queue.run("eld_1", async () => {
      log.push("2:start");
      return 2;
    });

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(log).toEqual(["1:start", "1:end", "2:start"]);
  });

  it("runs different keys concurrently", async () => {
    const queue = createTurnQueue();
    const log: string[] = [];
    const a = queue.run("eld_a", async () => {
      log.push("a:start");
      await sleep(20);
      log.push("a:end");
    });
    const b = queue.run("eld_b", async () => {
      log.push("b");
    });

    await Promise.all([a, b]);
    expect(log).toEqual(["a:start", "b", "a:end"]);
  });

  it("keeps processing after a task fails", async () => {
    const queue = createTurnQueue();
    await expect(
      queue.run("eld_1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(queue.run("eld_1", async () => "next")).resolves.toBe("next");
  });

  it("idle() waits for in-flight tasks", async () => {
    const queue = createTurnQueue();
    let done = false;
    void queue.run("eld_1", async () => {
      await sleep(20);
      done = true;
    });
    await queue.idle();
    expect(done).toBe(true);
  });
});
