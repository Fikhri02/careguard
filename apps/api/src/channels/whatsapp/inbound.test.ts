import { describe, expect, it, vi } from "vitest";
import { parseTwilioForm, toUserMessage } from "./inbound.js";

describe("parseTwilioForm", () => {
  it("extracts sender, trimmed body, message id and media", () => {
    expect(
      parseTwilioForm({
        From: "whatsapp:+60123456789",
        Body: "  Bil apa ni?  ",
        MessageSid: "SM1",
        NumMedia: "2",
        MediaUrl0: "https://api.twilio.com/media/0",
        MediaContentType0: "image/jpeg",
        MediaUrl1: "https://api.twilio.com/media/1",
        MediaContentType1: "audio/ogg",
      }),
    ).toEqual({
      from: "whatsapp:+60123456789",
      body: "Bil apa ni?",
      messageSid: "SM1",
      media: [
        { url: "https://api.twilio.com/media/0", contentType: "image/jpeg" },
        { url: "https://api.twilio.com/media/1", contentType: "audio/ogg" },
      ],
    });
  });

  it("tolerates missing fields", () => {
    expect(parseTwilioForm({ From: "whatsapp:+60123456789" })).toEqual({
      from: "whatsapp:+60123456789",
      body: "",
      messageSid: null,
      media: [],
    });
  });
});

describe("toUserMessage", () => {
  const inbound = (overrides = {}) => ({ from: "whatsapp:+60123456789", body: "", messageSid: "SM1", media: [], ...overrides });

  it("combines text with downloaded images and skips other media", async () => {
    const fetchMedia = vi.fn(async (url: string) => (url.endsWith("/0") ? "data:image/jpeg;base64,AAAA" : null));
    const message = await toUserMessage(
      inbound({
        body: "Bil apa ni?",
        media: [
          { url: "https://api.twilio.com/media/0", contentType: "image/jpeg" },
          { url: "https://api.twilio.com/media/1", contentType: "audio/ogg" },
        ],
      }),
      fetchMedia,
    );
    expect(message).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Bil apa ni?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      ],
    });
    expect(fetchMedia).toHaveBeenCalledTimes(1);
  });

  it("drops an image that could not be downloaded", async () => {
    const message = await toUserMessage(
      inbound({ body: "Tengok ni", media: [{ url: "https://api.twilio.com/media/0", contentType: "image/png" }] }),
      async () => null,
    );
    expect(message.content).toEqual([{ type: "text", text: "Tengok ni" }]);
  });

  it("marks an empty message", async () => {
    await expect(toUserMessage(inbound(), async () => null)).resolves.toEqual({
      role: "user",
      content: [{ type: "text", text: "(no content)" }],
    });
  });
});
