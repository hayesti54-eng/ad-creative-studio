# Ad Creative Studio — Project 001
## Claude Code Context File

This file tells you everything you need to understand, extend, and debug this project.
Read it fully before touching any code.

---

## What This Project Does

Netlify-hosted SPA that generates ad creative variations using Claude.

1. User fills a campaign brief (product, audience, platforms, tone)
2. `/api/generate-creatives` calls Claude → returns 3 variations with platform copy + 8-dimension scores
3. `/api/generate-image` calls DALL-E 3 → returns optional ad image per variation
4. `/api/iterate-creative` calls Claude → improves a single variation based on feedback
5. Frontend renders cards with tabs per platform, score bars, copy fields, iterate input

---

## File Tree

```
ad-creative-studio/
├── public/
│   └── index.html              ← Full SPA — all HTML, CSS, JS in one file
├── netlify/
│   └── functions/
│       ├── lib/
│       │   ├── core.js         ← SHARED INFRASTRUCTURE — read this first
│       │   └── utils.js        ← Project validators + domain constants
│       ├── generate-creatives.js
│       ├── generate-image.js
│       └── iterate-creative.js
├── netlify.toml
├── package.json
└── CLAUDE.md                   ← You are here
```

---

## The Core Layer — Read This First

**`netlify/functions/lib/core.js`** is the single shared infrastructure file.
Every function imports from it. Never duplicate what's in here.

It provides:
- `ok(data, mode, fn, source)` — standard success envelope
- `fail(statusCode, code, message, retryable, fn, details)` — standard error envelope
- `parseBody(raw)` — safe JSON body parsing
- `processClaude(rawText, validator)` — full AI output pipeline (fence strip → isolate → parse → validate)
- `withTimeout(promise, ms)` — timeout wrapper (default 8000ms, Netlify free = 10s hard limit)
- `requireApiKey(envKey, fn)` — returns null if present, fail() response if missing
- `hasEnv(key)` — boolean check for optional env vars

**`netlify/functions/lib/utils.js`** adds project-specific things on top:
- `validateBriefInput(brief)` — returns `string[]` of errors for request body validation
- `validateIterationInput(body)` — same pattern
- `validateVariations(obj)` — returns `true | string` for Claude output validation
- `validateIteration(obj)` — same pattern
- `VALID_PLATFORMS`, `VALID_GOALS` — enum constants

---

## Every Response Uses This Envelope

```json
{
  "ok": true,
  "data": { ... },
  "error": null,
  "meta": {
    "mode": "live | demo | fallback",
    "function": "generate-creatives",
    "source": "claude-sonnet-4-6",
    "timestamp": "ISO string"
  }
}
```

On failure:
```json
{
  "ok": false,
  "data": null,
  "error": { "code": "CLAUDE_TIMEOUT", "message": "...", "retryable": true },
  "meta": { "mode": "error", ... }
}
```

The frontend reads `env.ok` → `env.data` or `env.error.message`. Never read raw fields.

---

## Adding a New Netlify Function

Copy this pattern exactly:

```js
"use strict";

const { ok, fail, parseBody, processClaude, withTimeout, requireApiKey } = require("./lib/core");
const { validateMyInput, validateMyOutput } = require("./lib/utils");

const FN = "my-function-name"; // matches filename

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return fail(405, "METHOD_NOT_ALLOWED", "POST only", false, FN);
  }

  let body;
  try {
    body = parseBody(event.body);
  } catch {
    return fail(400, "INVALID_BODY", "Request body must be valid JSON", false, FN);
  }

  const errors = validateMyInput(body);
  if (errors.length) return fail(400, "VALIDATION_ERROR", errors.join("; "), false, FN);

  const keyError = requireApiKey("ANTHROPIC_API_KEY", FN);
  if (keyError) return keyError;

  let rawText;
  try {
    rawText = await withTimeout(invokeModel(process.env.ANTHROPIC_API_KEY, body), 8000);
  } catch (err) {
    return fail(err.code === "TIMEOUT" ? 504 : 502,
      err.code === "TIMEOUT" ? "CLAUDE_TIMEOUT" : "CLAUDE_ERROR",
      err.message, true, FN);
  }

  const { data, error: parseError } = processClaude(rawText, validateMyOutput);
  if (parseError) return fail(502, "CLAUDE_OUTPUT_ERROR", "Claude returned malformed output. Please retry.", true, FN);

  return ok(data, "live", FN, "claude-sonnet-4-6");
};
```

---

## Adding a Validator

**For request body validation** (returns `string[]`):
```js
// In utils.js
function validateMyInput(body) {
  const errs = [];
  if (!body || typeof body !== "object") return ["request body must be a JSON object"];
  if (!body.requiredField || typeof body.requiredField !== "string")
    errs.push("requiredField is required");
  return errs;
}
```

**For Claude output validation** (returns `true | string`):
```js
// In utils.js
function validateMyOutput(obj) {
  if (!obj || typeof obj !== "object") return "Response is not a JSON object";
  if (!obj.required_key) return "missing required_key";
  return true; // valid
}
```

---

## Environment Variables

| Variable | Required | Purpose | Get it at |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude generation and iteration | console.anthropic.com |
| `OPENAI_API_KEY` | No | DALL-E 3 image generation | platform.openai.com |

The app runs fully without `OPENAI_API_KEY` — images show a labeled placeholder.
There is no fallback for `ANTHROPIC_API_KEY` in this project — generation requires it.

---

## Local Development

```bash
npm install
netlify dev        # starts local server at http://localhost:8888
```

Create `.env` at project root (already in `.gitignore`):
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

Test endpoints:
```bash
curl -X POST http://localhost:8888/api/generate-creatives \
  -H "Content-Type: application/json" \
  -d '{"product":"Ember Mug","description":"Self-heating coffee mug that keeps drinks at the perfect temperature","audience":"Remote workers 28-45","platforms":["Meta Feed","Google Search"],"goal":"conversions"}'
```

---

## Known Constraints

- **Netlify free tier = 10s hard limit.** `generate-creatives` uses 4000 tokens and can take 8–12s. It will occasionally timeout. The frontend shows a retryable error. This is expected on free tier.
- **DALL-E 3 images timeout on free tier.** DALL-E 3 takes 8–15s. Netlify free = 10s. Images show a placeholder when they timeout. Upgrade to Netlify paid ($19/mo, 26s limit) for reliable images.
- **No retry on Netlify timeout.** Netlify kills the function at 10s — no code runs after that. Retry happens on the frontend.
- **No server-side state.** Each function call is stateless. All state lives in the frontend.

---

## Frontend Architecture

`public/index.html` is a single file containing all HTML, CSS, and JavaScript.

Key JS functions:
- `handleGenerate()` — validates form, locks UI, calls generate-creatives + generate-image in sequence
- `apiFetch(path, payload)` — reads envelope, throws typed errors, used for all API calls
- `UIState.lock/unlock` — duplicate submission guard
- `esc(val)` — HTML escaper, used on ALL Claude-returned strings before innerHTML
- `renderResults(data)` — renders variation cards from validated API response
- `iterateCreative(varId)` — calls iterate-creative for a single card

When editing the frontend, always:
1. Use `esc()` on any string from the API before putting it in `innerHTML`
2. Use `safeNum()` on numeric values from the API (prevents NaN in score bars)
3. Use `apiFetch()` not raw `fetch()` — it handles the envelope

---

## Deployment

1. Push to GitHub
2. Connect repo to Netlify
3. Build command: *(leave blank)*
4. Publish directory: `public`
5. Add env vars in Netlify dashboard
6. Deploy
