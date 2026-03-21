"use strict";

/**
 * core.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared reliability infrastructure for every project in this portfolio.
 * Drop this file into netlify/functions/lib/core.js.
 *
 * Every project's function files import shared infrastructure from here.
 * Every project's utils.js adds domain-specific validators and fallbacks
 * on top of this layer.
 *
 * What lives here:
 *   1. Standard response envelope  (ok / fail)
 *   2. Body parsing
 *   3. Claude JSON extraction pipeline  (extractJSON + processClaude)
 *   4. Timeout wrapper
 *   5. API key helpers  (requireApiKey / hasEnv)
 *
 * What does NOT live here:
 *   - Project-specific validators
 *   - Project-specific fallback generators
 *   - Business logic of any kind
 */

// ─────────────────────────────────────────────────────────────────────────────
// CORS — included on every response so browsers can read error bodies
// ─────────────────────────────────────────────────────────────────────────────
const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. RESPONSE ENVELOPE
//
// Every Netlify function must return one of these two shapes.
// Frontend always reads result.ok → result.data or result.error.
//
// ok:   { ok: true,  data: {...}, error: null,  meta: { mode, function, source, timestamp } }
// fail: { ok: false, data: null,  error: {...}, meta: { mode: "error", function, source, timestamp } }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {*}      data    — payload for the frontend (result.data)
 * @param {string} mode    — "live" | "demo" | "fallback"
 * @param {string} fn      — function name e.g. "simulate-auction"
 * @param {string} source  — optional data source label e.g. "claude-sonnet-4-6" | "deterministic"
 */
function ok(data, mode, fn, source = "") {
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok: true,
      data,
      error: null,
      meta: {
        mode,
        function: fn,
        source,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

/**
 * @param {number}  statusCode
 * @param {string}  code       — machine-readable e.g. "VALIDATION_ERROR", "CLAUDE_TIMEOUT"
 * @param {string}  message    — human-readable, shown directly in the UI
 * @param {boolean} retryable  — whether the frontend should show a Retry button
 * @param {string}  fn         — function name for log correlation
 * @param {object}  details    — optional structured debug context (never shown to end users)
 */
function fail(statusCode, code, message, retryable, fn, details = null) {
  return {
    statusCode,
    headers: CORS,
    body: JSON.stringify({
      ok: false,
      data: null,
      error: { code, message, retryable, details },
      meta: {
        mode: "error",
        function: fn,
        source: "",
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. BODY PARSING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a raw Netlify event body string into a JS object.
 * Throws with a clear message if the body is empty or invalid JSON.
 */
function parseBody(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Empty or missing request body");
  }
  return JSON.parse(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. CLAUDE JSON EXTRACTION PIPELINE
//
// Claude's response text may arrive as any of:
//   • plain JSON object
//   • markdown-fenced ```json ... ```
//   • JSON preceded or followed by prose
//   • truncated / incomplete JSON
//
// extractJSON handles the first three.
// processClaude bundles extraction + shape validation into one step.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts a JSON object from Claude's raw response text.
 * Strips markdown fences, isolates the outermost {…} block, then parses.
 * Throws SyntaxError if no valid JSON object can be extracted.
 *
 * @param  {string} text — raw Claude response
 * @returns {object}     — parsed JSON object
 */
function extractJSON(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new TypeError("extractJSON: input must be a non-empty string");
  }

  // Strip leading/trailing markdown fences (all variants)
  let s = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/```\s*$/im, "")
    .trim();

  // Isolate outermost JSON object
  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }

  return JSON.parse(s); // throws SyntaxError if malformed
}

/**
 * Full Claude output processing pipeline.
 * Extracts JSON and runs it through a shape validator in one step.
 *
 * Validator contract:
 *   - Receives the parsed object
 *   - Returns true  if the shape is valid
 *   - Returns string (error description) if invalid
 *
 * Returns { data } on success or { error } on any failure.
 * Never throws — errors are contained and returned as { error }.
 *
 * @param  {string}   rawText   — Claude's raw response text
 * @param  {function} validator — (parsedObj) => true | "error description"
 * @returns {{ data?: object, error?: string }}
 */
function processClaude(rawText, validator) {
  if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
    return { error: "Claude returned an empty response" };
  }

  let parsed;
  try {
    parsed = extractJSON(rawText);
  } catch (e) {
    return { error: `JSON extraction failed: ${e.message}` };
  }

  if (typeof validator === "function") {
    const result = validator(parsed);
    if (result !== true) {
      const msg = typeof result === "string" ? result : "Schema validation failed";
      return { error: msg };
    }
  }

  return { data: parsed };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. TIMEOUT WRAPPER
//
// Netlify free tier: 10s hard function kill.
// Default budget: 8000ms (leaves 2s for response serialisation and overhead).
// Netlify paid tier ($19/mo): 26s limit — pass ms = 24000 if needed.
//
// Rejects with err.code = "TIMEOUT" so callers can distinguish it from
// other Anthropic/network errors and respond with the correct status code.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Promise} promise
 * @param {number}  ms      — timeout in milliseconds (default 8000)
 */
function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        const e = new Error(
          `Request timed out after ${ms}ms. ` +
          `Netlify free tier has a 10s limit — retry or upgrade to Netlify paid for a 26s limit.`
        );
        e.code = "TIMEOUT";
        reject(e);
      }, ms)
    ),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. API KEY HELPERS
//
// requireApiKey — for functions that hard-fail without the key
//                 (e.g. generate-creatives: no key = no creatives)
//
// hasEnv        — for functions that fall back gracefully without the key
//                 (e.g. simulate-auction: no key = deterministic fallback mode)
// ─────────────────────────────────────────────────────────────────────────────

const ENV_MESSAGES = {
  ANTHROPIC_API_KEY:
    "ANTHROPIC_API_KEY is not configured. " +
    "Add it in Netlify → Site Configuration → Environment Variables. " +
    "Get your key at console.anthropic.com.",
  OPENAI_API_KEY:
    "OPENAI_API_KEY is not configured. " +
    "Add it in Netlify → Site Configuration → Environment Variables. " +
    "Get your key at platform.openai.com.",
  META_ACCESS_TOKEN:
    "META_ACCESS_TOKEN is not configured. " +
    "The app will use demo competitor data. " +
    "To get live data: developers.facebook.com → Graph API Explorer → generate token with ads_read permission.",
};

/**
 * Checks that an env var is present.
 * Returns null if the key exists (caller should continue normally).
 * Returns a fail() response if the key is missing (caller should return it immediately).
 *
 * Use for env vars that are hard requirements:
 *   const keyError = requireApiKey("ANTHROPIC_API_KEY", FN);
 *   if (keyError) return keyError;
 */
function requireApiKey(envKey, fn) {
  if (process.env[envKey]) return null;
  const message = ENV_MESSAGES[envKey] || `${envKey} is not configured.`;
  return fail(503, "MISSING_ENV_VAR", message, false, fn);
}

/**
 * Returns true if an env var is present, false otherwise.
 * Use for optional env vars where the function degrades gracefully:
 *   if (!hasEnv("ANTHROPIC_API_KEY")) { return fallback; }
 */
function hasEnv(key) {
  return Boolean(process.env[key]);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Envelope
  ok,
  fail,
  CORS,

  // Body
  parseBody,

  // Claude pipeline
  extractJSON,
  processClaude,

  // Timeout
  withTimeout,

  // Env
  requireApiKey,
  hasEnv,
  ENV_MESSAGES,
};
