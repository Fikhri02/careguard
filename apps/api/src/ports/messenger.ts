import type { OutboundMessage } from "@careguard/shared";

export interface Messenger {
  /** Resolves false when the message could not be delivered. Never throws. */
  send(message: OutboundMessage): Promise<boolean>;
}
