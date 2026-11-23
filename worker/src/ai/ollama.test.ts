import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OllamaClient } from "./ollama";
import { writeTitles } from "./titles";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const input = {
  planId: "pro" as const,
  transcript: "did you ever subscribe to something or no",
  streamTitle: "GTA 6 day 3",
  channelLogin: "ohnepixel",
  reasons: ["question-reply"],
};

describe("Ollama clip copy", () => {
  it("uses validated JSON from the model for every platform", async () => {
    const { fetch } = mockFetch((url, init) => {
      if (url.endsWith("/api/tags")) return json({ models: [] });
      const body = JSON.parse(String(init?.body)) as { format: string; model: string };
      assert.equal(body.format, "json");
      assert.equal(body.model, "llama3.2:3b");
      return json({
        message: {
          content: JSON.stringify({
            hook: "chat answered instantly",
            title: "ohnePixel asks chat one question and it explodes",
            description: "ohnePixel asked: did you ever subscribe to something? Chat had answers.",
            hashtags: ["#GTA6", "ohnepixel", "Twitch Clips"],
          }),
        },
      });
    });
    const client = new OllamaClient({
      baseUrl: "http://ollama:11434",
      model: "llama3.2:3b",
      fetchImpl: fetch,
    });
    const packs = await writeTitles({ ...input, language: "en" }, client);
    assert.equal(packs.length, 4);
    assert.equal(packs[0]?.source, "llm");
    assert.equal(packs[0]?.hookText, "CHAT ANSWERED INSTANTLY");
    assert.ok(packs[0]?.hashtags.includes("GTA6"));
    assert.ok(packs[0]?.hashtags.includes("TwitchClips"));
  });

  it("retries once on invalid JSON, then falls back to templates", async () => {
    let chats = 0;
    const { fetch } = mockFetch((url) => {
      if (url.endsWith("/api/tags")) return json({ models: [] });
      chats += 1;
      return json({ message: { content: "sure! here is a title: GTA" } });
    });
    const client = new OllamaClient({
      baseUrl: "http://ollama:11434",
      model: "m",
      retries: 1,
      fetchImpl: fetch,
    });
    const packs = await writeTitles({ ...input, language: "sv" }, client);
    assert.equal(chats, 2);
    assert.equal(packs[0]?.source, "template");
    assert.equal(packs[0]?.title, "CHATTEN SVARADE");
  });

  it("falls back immediately when Ollama is unreachable", async () => {
    const { fetch, calls } = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = new OllamaClient({
      baseUrl: "http://ollama:11434",
      model: "m",
      fetchImpl: fetch,
    });
    const packs = await writeTitles(input, client);
    assert.equal(packs[0]?.source, "template");
    assert.equal(calls.length, 1, "only the availability probe");
  });

  it("keeps the plan gate: Starter never calls the model", async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const client = new OllamaClient({
      baseUrl: "http://ollama:11434",
      model: "m",
      fetchImpl: fetch,
    });
    const packs = await writeTitles({ ...input, planId: "starter" }, client);
    assert.equal(packs[0]?.source, "template");
    assert.equal(calls.length, 0);
  });
});
