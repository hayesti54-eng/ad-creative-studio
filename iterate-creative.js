"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { ok, fail, parseBody, processClaude, withTimeout, requireApiKey } = require("./lib/core");
const { validateIterationInput, validateIteration } = require("./lib/utils");

const FN = "iterate-creative";

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return fail(405, "METHOD_NOT_ALLOWED", "POST only", false, FN);
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    body = parseBody(event.body);
  } catch {
    return fail(400, "INVALID_BODY", "Request body must be valid JSON", false, FN);
  }

  // ── Validate inputs ───────────────────────────────────────────────────────
  const errors = validateIterationInput(body);
  if (errors.length) {
    return fail(400, "VALIDATION_ERROR", errors.join("; "), false, FN);
  }

  // ── Require API key ───────────────────────────────────────────────────────
  const keyError = requireApiKey("ANTHROPIC_API_KEY", FN);
  if (keyError) return keyError;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const { original, feedback, platform } = body;
  console.log(`[${FN}] Iteration start — angle:${original.angle} feedback length:${feedback.length}`);

  // ── Call Claude with 8s timeout ───────────────────────────────────────────
  let rawText;
  try {
    rawText = await withTimeout(invokeModel(apiKey, original, feedback, platform), 8000);
  } catch (err) {
    const isTimeout = err.code === "TIMEOUT";
    console.error(`[${FN}] Claude ${isTimeout ? "timed out" : "failed"}: ${err.message}`);
    return fail(
      isTimeout ? 504 : 502,
      isTimeout ? "CLAUDE_TIMEOUT" : "CLAUDE_ERROR",
      isTimeout
        ? "Iteration timed out. Please retry."
        : `Claude API error: ${err.message}`,
      true, FN
    );
  }

  // ── Extract and validate via processClaude ────────────────────────────────
  const { data: result, error: parseError } = processClaude(rawText, validateIteration);
  if (parseError) {
    console.error(`[${FN}] Claude output failed validation: ${parseError}`);
    return fail(502, "CLAUDE_OUTPUT_ERROR",
      "Claude returned malformed output. Please retry.",
      true, FN, { detail: parseError });
  }

  console.log(`[${FN}] Iteration complete — score:${result.scores.overall} improvement:${result.improvement_vs_original}`);
  return ok(result, "live", FN, "claude-sonnet-4-6");
};

// ─── MODEL INVOCATION ─────────────────────────────────────────────────────────
async function invokeModel(apiKey, original, feedback, platform) {
  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are a performance marketing creative director who iterates on ad creatives.
Your ENTIRE response must be ONLY the raw JSON object below. No text before it. No text after it. No markdown. Just the JSON.
Character limits: Meta headlines ≤40 chars, Google headlines ≤30 chars, descriptions ≤90 chars.
All score fields are integers 0–100. policy_risk is INVERTED (100 = zero risk).`;

  const userPrompt = `Iterate on this ad creative based on the feedback.

ORIGINAL CREATIVE:
Angle: ${original.angle}
Rationale: ${original.angle_rationale || "N/A"}
Current score: ${original.scores?.overall ?? "N/A"}/100
Current copy: ${JSON.stringify(original.copy || {}, null, 2)}

FEEDBACK: ${feedback}
PRIMARY PLATFORM: ${platform || "Meta Feed"}

Apply the feedback. Preserve what worked. Return EXACTLY this JSON:
{
  "iterated_copy": {
    "meta_feed": { "primary_text": "...", "headline": "...", "description": "...", "cta": "..." },
    "meta_stories": { "primary_text": "...", "headline": "...", "cta": "..." },
    "google_search": { "headline_1": "...", "headline_2": "...", "headline_3": "...", "description_1": "...", "description_2": "..." },
    "google_display": { "headline": "...", "long_headline": "...", "description": "..." }
  },
  "changes_made": ["change 1", "change 2", "change 3"],
  "rationale": "Two sentences explaining the strategic reasoning behind the changes",
  "scores": {
    "overall": 0, "hook_strength": 0, "emotional_resonance": 0, "clarity": 0,
    "cta_effectiveness": 0, "audience_fit": 0, "platform_optimization": 0,
    "policy_risk": 0, "brand_consistency": 0
  },
  "improvement_vs_original": "higher",
  "improvement_rationale": "One sentence"
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content[0]?.text ?? "";
}
