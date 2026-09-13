import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "../test/fakes.js";
import { createExaSearch } from "./exa-search.js";
import { createSafeBrowsing } from "./safe-browsing.js";
import { createTwilioMediaFetcher } from "./twilio-media.js";
import { createTwilioMessenger } from "./twilio-messenger.js";

type FetchCall = [string, RequestInit];
const asFetch = (fn: (url: string, init: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch;

describe("createTwilioMessenger", () => {
  const opts = { accountSid: "AC123", authToken: "secret", from: "whatsapp:+14155238886" };

  it("posts a WhatsApp message to the Twilio Messages API", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 201 }));
    const messenger = createTwilioMessenger({ ...opts, fetch: asFetch(fetchMock) }, silentLogger);

    await expect(messenger.send({ to: "+60123456789", body: "Hai Mak" })).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("AC123:secret").toString("base64")}`,
    );
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      From: "whatsapp:+14155238886",
      To: "whatsapp:+60123456789",
      Body: "Hai Mak",
    });
  });

  it("returns false on a non-2xx response", async () => {
    const messenger = createTwilioMessenger(
      { ...opts, fetch: asFetch(async () => new Response("bad", { status: 400 })) },
      silentLogger,
    );
    await expect(messenger.send({ to: "+60123456789", body: "x" })).resolves.toBe(false);
  });

  it("returns false when the request throws", async () => {
    const messenger = createTwilioMessenger(
      {
        ...opts,
        fetch: asFetch(async () => {
          throw new Error("offline");
        }),
      },
      silentLogger,
    );
    await expect(messenger.send({ to: "+60123456789", body: "x" })).resolves.toBe(false);
  });
});

describe("createTwilioMediaFetcher", () => {
  it("downloads media with basic auth and returns a data URL", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(Buffer.from("img"), { status: 200, headers: { "content-type": "image/png" } }),
    );
    const fetchMedia = createTwilioMediaFetcher(
      { accountSid: "AC123", authToken: "secret", fetch: asFetch(fetchMock) },
      silentLogger,
    );
    await expect(fetchMedia("https://api.twilio.com/media/ME1")).resolves.toBe(
      `data:image/png;base64,${Buffer.from("img").toString("base64")}`,
    );
    const [, init] = fetchMock.mock.calls[0] as FetchCall;
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it("returns null when the download fails", async () => {
    const fetchMedia = createTwilioMediaFetcher(
      { accountSid: "AC123", authToken: "secret", fetch: asFetch(async () => new Response("", { status: 404 })) },
      silentLogger,
    );
    await expect(fetchMedia("https://api.twilio.com/media/ME1")).resolves.toBeNull();
  });
});

describe("createExaSearch", () => {
  it("sends the query with the API key and maps results", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [
              { title: "Scam alert", url: "https://a.example", text: "t" },
              { title: null, url: "https://b.example" },
            ],
          }),
        ),
    );
    const search = createExaSearch({ apiKey: "exa-key", fetch: asFetch(fetchMock) }, silentLogger);

    await expect(search.search("012-3456789 scam", 2)).resolves.toEqual([
      { title: "Scam alert", url: "https://a.example", text: "t" },
      { title: "https://b.example", url: "https://b.example", text: undefined },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe("https://api.exa.ai/search");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("exa-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ query: "012-3456789 scam", numResults: 2 });
  });

  it("returns [] on failure", async () => {
    const search = createExaSearch(
      { apiKey: "exa-key", fetch: asFetch(async () => new Response("down", { status: 500 })) },
      silentLogger,
    );
    await expect(search.search("q", 2)).resolves.toEqual([]);
  });
});

describe("createSafeBrowsing", () => {
  const withBody = (body: unknown, status = 200) =>
    createSafeBrowsing(
      { apiKey: "gsb", fetch: asFetch(async () => new Response(JSON.stringify(body), { status })) },
      silentLogger,
    );

  it("reports true when Google has a match", async () => {
    await expect(withBody({ matches: [{ threatType: "SOCIAL_ENGINEERING" }] }).isUnsafe("http://bad.example")).resolves.toBe(true);
  });

  it("reports false when there are no matches", async () => {
    await expect(withBody({}).isUnsafe("http://ok.example")).resolves.toBe(false);
  });

  it("reports null when the check fails", async () => {
    await expect(withBody({}, 500).isUnsafe("http://ok.example")).resolves.toBeNull();
  });
});
