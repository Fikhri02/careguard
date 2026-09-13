import type { OutboundMessage } from "@careguard/shared";
import type { Messenger } from "../ports/messenger.js";

/** Records messages instead of sending them. Used by /dev/simulate, the CLI, and tests. */
export class CapturingMessenger implements Messenger {
  readonly sent: OutboundMessage[] = [];

  constructor(private readonly succeed = true) {}

  async send(message: OutboundMessage): Promise<boolean> {
    this.sent.push(message);
    return this.succeed;
  }
}
