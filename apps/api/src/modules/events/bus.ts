import type { StreamMessage } from "@careguard/shared";
import { EventEmitter } from "node:events";

export interface EventBus {
  publish(message: StreamMessage): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: (message: StreamMessage) => void): () => void;
}

export function createEventBus(): EventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // one listener per open dashboard stream
  return {
    publish: (message) => {
      emitter.emit("message", message);
    },
    subscribe(listener) {
      emitter.on("message", listener);
      return () => emitter.off("message", listener);
    },
  };
}
