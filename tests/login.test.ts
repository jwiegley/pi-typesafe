import assert from "node:assert/strict";
import { chmodSync, existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { storeApiKey } from "../src/credentials.js";
import { TypeSafeIntegrationError } from "../src/errors.js";
import { ensureApiKey, loginWithPrompt } from "../src/login.js";

let temporary: string;
const savedKey = process.env.TYPESAFE_API_KEY;
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalFetch = globalThis.fetch;
let customResult: string | undefined;
let modelListCalls = 0;
let decisionCalls = 0;
const storedPath = () => join(temporary, "pi-typesafe", "auth.json");
const ctx = (hasUI = true) => ({ hasUI, ui: { custom: async () => customResult, input: async () => { throw new Error("plain input must not be used"); } } }) as unknown as ExtensionCommandContext;

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "pi-typesafe-login-"));
  process.env.PI_CODING_AGENT_DIR = temporary;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/v1/models")) {
      modelListCalls++;
      return Response.json({ models: [{ name: "jev-latest", description: "", release_date: "2026-01-01" }, { name: "jev-preview", description: "", release_date: "2026-01-01" }] });
    }
    if (String(input).includes("openrouter.ai/api/alpha/decisions")) {
      decisionCalls++;
      return Response.json({ model: "typesafe/jev-1.13", answers: { key: { type: "noul", noul: 0.99 } }, usage: { input_tokens: 10, output_tokens: 0 } });
    }
    throw new Error("unexpected request");
  };
});
beforeEach(async () => {
  delete process.env.TYPESAFE_API_KEY;
  modelListCalls = 0;
  decisionCalls = 0;
  customResult = undefined;
  await rm(storedPath(), { force: true });
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = savedKey;
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  await rm(temporary, { recursive: true, force: true });
});

test("loginWithPrompt cancels cleanly, rejects bad keys, and stores a verified key with owner-only permissions", async () => {
  assert.equal(await loginWithPrompt(ctx()), undefined);
  assert.equal(existsSync(storedPath()), false);

  customResult = "nope";
  await assert.rejects(loginWithPrompt(ctx()), (error: unknown) => error instanceof TypeSafeIntegrationError && error.code === "validation" && !error.message.includes("nope"));
  assert.equal(modelListCalls, 0);

  customResult = "ts_live_key_0123456789abcdef";
  const result = await loginWithPrompt(ctx());
  assert.deepEqual(result, { path: storedPath(), models: 2 });
  assert.equal(modelListCalls, 1);
  assert.equal(statSync(storedPath()).mode & 0o777, 0o600);
});

test("loginWithPrompt refuses when the environment key would shadow the store, or without a UI", async () => {
  process.env.TYPESAFE_API_KEY = "env-key-0123456789";
  await assert.rejects(loginWithPrompt(ctx()), (error: unknown) => error instanceof TypeSafeIntegrationError && error.code === "configuration" && /TYPESAFE_API_KEY/.test(error.message));
  delete process.env.TYPESAFE_API_KEY;
  await assert.rejects(loginWithPrompt(ctx(false)), (error: unknown) => error instanceof TypeSafeIntegrationError && /interactive/.test(error.message));
  assert.equal(existsSync(storedPath()), false);
});

test("ensureApiKey reports an existing key without prompting, otherwise logs in", async () => {
  process.env.TYPESAFE_API_KEY = "env-key-0123456789";
  customResult = "must-not-be-used-0123456789";
  assert.deepEqual(await ensureApiKey(ctx()), { source: "environment" });
  assert.equal(existsSync(storedPath()), false);

  delete process.env.TYPESAFE_API_KEY;
  customResult = undefined;
  assert.equal(await ensureApiKey(ctx()), undefined, "cancelled prompt");

  customResult = "ts_live_key_0123456789abcdef";
  const first = await ensureApiKey(ctx());
  assert.deepEqual(first, { source: "stored", login: { path: storedPath(), models: 2 } });
  customResult = "another-key-that-must-not-replace-it";
  assert.deepEqual(await ensureApiKey(ctx()), { source: "stored" }, "second call reuses the stored key");
  assert.equal(modelListCalls, 1);
});

test("another backend keeps its own key: its environment variable wins, otherwise its own login stores it", async () => {
  const savedOpenRouter = process.env.OPENROUTER_API_KEY;
  try {
    delete process.env.OPENROUTER_API_KEY;
    // A stored TypeSafe key does not satisfy OpenRouter: the store is keyed by backend.
    customResult = "ts_live_key_0123456789abcdef";
    assert.deepEqual(await ensureApiKey(ctx()), { source: "stored", login: { path: storedPath(), models: 2 } });

    // OpenRouter's model list is public, so the login proves the key with one request and stores it under its own name.
    customResult = "sk-or-0123456789abcdef";
    const login = await ensureApiKey(ctx(), { backend: "openrouter" });
    assert.equal(login?.source, "stored");
    assert.equal(decisionCalls, 1, "one request proves the key");
    assert.equal(modelListCalls, 1, "no model-list call for a public list");

    process.env.OPENROUTER_API_KEY = "sk-or-0123456789abcdef";
    assert.deepEqual(await ensureApiKey(ctx(), { backend: "openrouter" }), { source: "environment" });
    assert.equal(modelListCalls, 1);
  } finally {
    if (savedOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedOpenRouter;
  }
});

test("ensureApiKey names the caller's login command when the store must not be read", async () => {
  // Every backend has a login store, so the refusal of a store other users can read is the hint ensureApiKey gives.
  storeApiKey("ts_live_key_0123456789abcdef");
  chmodSync(storedPath(), 0o644);
  customResult = "ts_live_key_0123456789abcdef";
  try {
    // The caller's command cannot get past this refusal, so the message puts it after chmod instead of offering it in its place.
    await assert.rejects(ensureApiKey(ctx(), { loginHint: "/warden enable" }), (error: unknown) => error instanceof TypeSafeIntegrationError && error.code === "configuration"
      && /Run chmod 600 on it, then run \/warden enable again\.$/.test(error.message) && !error.message.includes("/typesafe login"));
    assert.equal(modelListCalls, 0, "the refusal is reported instead of prompting for a key");
    // Following the advice works: once the file is owner-only, the same call uses the stored key without prompting.
    chmodSync(storedPath(), 0o600);
    assert.deepEqual(await ensureApiKey(ctx(), { loginHint: "/warden enable" }), { source: "stored" });
    assert.equal(modelListCalls, 0);
  } finally {
    chmodSync(storedPath(), 0o600);
  }
});
