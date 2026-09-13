export interface TurnQueue {
  /** Runs `task` after every earlier task with the same key has settled. */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** Resolves once no task is queued or running. */
  idle(): Promise<void>;
}

export function createTurnQueue(): TurnQueue {
  const tails = new Map<string, Promise<void>>();

  return {
    run(key, task) {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(task);
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
    async idle() {
      while (tails.size > 0) await Promise.all(tails.values());
    },
  };
}
