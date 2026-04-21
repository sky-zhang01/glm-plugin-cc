/**
 * Unit tests for scripts/lib/glm-client.mjs:buildChatRequestBody
 *
 * Why a dedicated test file: this is the entry point where review-call
 * behavior (response_format: json_object) and sampling-parameter
 * forwarding (temperature / top_p / seed / frequency_penalty /
 * presence_penalty) get stamped onto the POST body. These are the
 * surface bugs we already got bitten by — Codex's v0.4.7 repo review
 * flagged that v0.4.6/7 was NOT sending response_format even though
 * the parser assumed JSON, and the v0.4.7 149-run expanded sweep
 * surfaced parse-failures that `response_format` would have
 * reduced.
 *
 * These tests do NOT make any real HTTP calls. buildChatRequestBody
 * is pure — it just shapes a request object.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildChatRequestBody } from "../scripts/lib/glm-client.mjs";

const BASE_CTX = {
  model: "glm-5.1",
  maxTokens: 8000,
  messages: [{ role: "user", content: "test" }],
  thinkingEnabled: true
};

describe("buildChatRequestBody — v0.4.6 baseline shape preserved", () => {
  it("always includes model, max_tokens, messages, stream=false, thinking", () => {
    const body = buildChatRequestBody({}, BASE_CTX);
    assert.equal(body.model, "glm-5.1");
    assert.equal(body.max_tokens, 8000);
    assert.deepEqual(body.messages, [{ role: "user", content: "test" }]);
    assert.equal(body.stream, false);
    assert.deepEqual(body.thinking, { type: "enabled" });
  });

  it("toggles thinking mode based on ctx.thinkingEnabled", () => {
    const on = buildChatRequestBody({}, { ...BASE_CTX, thinkingEnabled: true });
    const off = buildChatRequestBody({}, { ...BASE_CTX, thinkingEnabled: false });
    assert.deepEqual(on.thinking, { type: "enabled" });
    assert.deepEqual(off.thinking, { type: "disabled" });
  });

  it("omits sampling params when caller does not pass them (v0.4.6 default)", () => {
    const body = buildChatRequestBody({}, BASE_CTX);
    assert.equal("temperature" in body, false);
    assert.equal("top_p" in body, false);
    assert.equal("seed" in body, false);
    assert.equal("frequency_penalty" in body, false);
    assert.equal("presence_penalty" in body, false);
  });
});

describe("buildChatRequestBody — response_format JSON mode (v0.4.7)", () => {
  it("sets response_format={type:'json_object'} when expectJson is true", () => {
    const body = buildChatRequestBody({ expectJson: true }, BASE_CTX);
    assert.deepEqual(body.response_format, { type: "json_object" });
  });

  it("does NOT set response_format when expectJson is false (task calls, /glm:task)", () => {
    const body = buildChatRequestBody({ expectJson: false }, BASE_CTX);
    assert.equal("response_format" in body, false);
  });

  it("does NOT set response_format when expectJson is missing", () => {
    const body = buildChatRequestBody({}, BASE_CTX);
    assert.equal("response_format" in body, false);
  });

  it("response_format value has exactly {type:'json_object'} — no json_schema (GLM-5.x doesn't support it)", () => {
    const body = buildChatRequestBody({ expectJson: true }, BASE_CTX);
    // Guard: if someone migrates to json_schema before confirming BigModel
    // support, this test should fail loudly.
    assert.equal(Object.keys(body.response_format).length, 1, "response_format should be {type} only");
    assert.equal(body.response_format.type, "json_object");
  });
});

describe("buildChatRequestBody — sampling parameter forwarding", () => {
  it("forwards valid temperature", () => {
    const body = buildChatRequestBody({ temperature: 0.3 }, BASE_CTX);
    assert.equal(body.temperature, 0.3);
  });

  it("silently drops out-of-range temperature (not in [0, 2])", () => {
    const under = buildChatRequestBody({ temperature: -0.1 }, BASE_CTX);
    const over = buildChatRequestBody({ temperature: 2.5 }, BASE_CTX);
    assert.equal("temperature" in under, false);
    assert.equal("temperature" in over, false);
  });

  it("accepts both topP and top_p keys (camelCase + snake_case)", () => {
    const camel = buildChatRequestBody({ topP: 0.9 }, BASE_CTX);
    const snake = buildChatRequestBody({ top_p: 0.85 }, BASE_CTX);
    assert.equal(camel.top_p, 0.9);
    assert.equal(snake.top_p, 0.85);
  });

  it("forwards integer seed, rejects non-integer", () => {
    const intSeed = buildChatRequestBody({ seed: 42 }, BASE_CTX);
    const floatSeed = buildChatRequestBody({ seed: 3.14 }, BASE_CTX);
    assert.equal(intSeed.seed, 42);
    assert.equal("seed" in floatSeed, false);
  });

  it("forwards frequency_penalty in [-2, 2]", () => {
    const ok = buildChatRequestBody({ frequencyPenalty: -1 }, BASE_CTX);
    const bad = buildChatRequestBody({ frequencyPenalty: 3 }, BASE_CTX);
    assert.equal(ok.frequency_penalty, -1);
    assert.equal("frequency_penalty" in bad, false);
  });

  it("forwards presence_penalty in [-2, 2]", () => {
    const ok = buildChatRequestBody({ presencePenalty: 1.5 }, BASE_CTX);
    const bad = buildChatRequestBody({ presencePenalty: -3 }, BASE_CTX);
    assert.equal(ok.presence_penalty, 1.5);
    assert.equal("presence_penalty" in bad, false);
  });

  it("combines expectJson + sampling params on one review call", () => {
    const body = buildChatRequestBody(
      { expectJson: true, temperature: 0, seed: 1337 },
      BASE_CTX
    );
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.temperature, 0);
    assert.equal(body.seed, 1337);
  });
});
