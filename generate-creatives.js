"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { ok, fail, parseBody, processClaude, withTimeout, requireApiKey } = require("./lib/core");
const { validateBriefInput, validateVariations } = require("./lib/utils");

const FN = "generate-creatives";

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return fail(405, "METHOD_NOT_ALLOWED", "POST only", false, FN);
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let brief;
  try {
    brief = parseBody(event.body);
  } catch {
    return fail(400, "INVALID_BODY", "Request body must be valid JSON", false, FN);
  }

  // ── Validate inputs ───────────────────────────────────────────────────────
  const errors = validateBriefInput(brief);
  if (errors.length) {
    return fail(400, "VALIDATION_ERROR", errors.join("; "), false, FN);
  }

  // ── Require API key ───────────────────────────────────────────────────────
  const keyError = requireApiKey("ANTHROPIC_API_KEY", FN);
  if (keyError) return keyError;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const { product, platforms } = brief;
  console.log(`[${FN}] Brief received — product:${product} platforms:${platforms.join(",")}`);

  // ── Call Claude with 8s timeout ───────────────────────────────────────────
  let rawText;
  try {
    rawText = await withTimeout(invokeModel(apiKey, brief), 8000);
  } catch (err) {
    const isTimeout = err.code === "TIMEOUT";
    console.error(`[${FN}] Claude ${isTimeout ? "timed out" : "failed"}: ${err.message}`);
    return fail(
      isTimeout ? 504 : 502,
      isTimeout ? "CLAUDE_TIMEOUT" : "CLAUDE_ERROR",
      isTimeout
        ? "Creative generation timed out. Netlify free tier has a 10s limit. Try reducing your brief or upgrading to Netlify paid tier."
        : `Claude API error: ${err.message}`,
      true, FN
    );
  }

  // ── Extract and validate via processClaude ────────────────────────────────
  const { data: result, error: parseError } = processClaude(rawText, validateVariations);
  if (parseError) {
    console.error(`[${FN}] Claude output failed validation: ${parseError}. Raw length: ${rawText?.length}`);
    return fail(502, "CLAUDE_OUTPUT_ERROR",
      "Claude returned malformed output. Please retry — this is usually transient.",
      true, FN, { detail: parseError });
  }

  console.log(`[${FN}] Success — ${result.variations.length} variations, recommended: ${result.recommended_variation}`);
  return ok(result, "live", FN, "claude-sonnet-4-6");
};

// ─── MODEL INVOCATION ─────────────────────────────────────────────────────────
async function invokeModel(apiKey, brief) {
  const client = new Anthropic({ apiKey });
  const { product, description, audience, platforms, goal, tone, brandVoice, budget } = brief;

  const systemPrompt = `You are a world-class performance marketing creative director with 15+ years running paid media for DTC brands, SaaS companies, and agencies.

Your ENTIRE response must be ONLY the raw JSON object specified below. No text before it. No text after it. No markdown fences. No explanation. Just the JSON.

Character limits you MUST enforce exactly:
- Meta Feed: primary_text ≤125 chars, headline ≤40 chars, description ≤30 chars
- Meta Stories: primary_text ≤90 chars, headline ≤40 chars
- Google Search: each headline ≤30 chars, each description ≤90 chars
- Google Display: headline ≤30 chars, long_headline ≤90 chars, description ≤90 chars

All score fields are integers 0–100. policy_risk is INVERTED (100 = zero policy risk, 0 = likely disapproval).`;

  const userPrompt = `Generate 3 distinct ad creative variations for this campaign.

PRODUCT: ${product}
DESCRIPTION: ${description}
AUDIENCE: ${audience}
GOAL: ${goal || "conversions"}
TONE: ${tone || "urgent and direct"}
BRAND VOICE: ${brandVoice || "None specified"}
BUDGET: ${budget || "Not specified"}
PLATFORMS: ${platforms.join(", ")}

Rules:
- Each variation must use a different angle (pain-point, aspiration, social proof, curiosity, urgency, before-after, fear-of-missing-out)
- Include copy ONLY for the platforms listed above — omit all other platform keys
- All character limits above are hard limits — do not exceed them
- All score fields must be present as integers

Return EXACTLY this JSON:
{
  "variations": [
    {
      "id": 1,
      "angle": "angle name",
      "angle_rationale": "one sentence on why this angle fits this audience",
      "copy": {
        "meta_feed": { "primary_text": "...", "headline": "...", "description": "...", "cta": "Shop Now" },
        "meta_stories": { "primary_text": "...", "headline": "...", "cta": "Shop Now" },
        "google_search": { "headline_1": "...", "headline_2": "...", "headline_3": "...", "description_1": "...", "description_2": "..." },
        "google_display": { "headline": "...", "long_headline": "...", "description": "..." }
      },
      "image_prompt": "Detailed photorealistic DALL-E 3 prompt for an ad visual — no text in image",
      "scores": {
        "overall": 0, "hook_strength": 0, "emotional_resonance": 0, "clarity": 0,
        "cta_effectiveness": 0, "audience_fit": 0, "platform_optimization": 0,
        "policy_risk": 0, "brand_consistency": 0
      },
      "score_notes": "Two sentences: top strength and main weakness",
      "predicted_ctr_tier": "low"
    },
    {
      "id": 2,
      "angle": "angle name",
      "angle_rationale": "one sentence on why this angle fits this audience",
      "copy": {
        "meta_feed": { "primary_text": "...", "headline": "...", "description": "...", "cta": "Shop Now" },
        "meta_stories": { "primary_text": "...", "headline": "...", "cta": "Shop Now" },
        "google_search": { "headline_1": "...", "headline_2": "...", "headline_3": "...", "description_1": "...", "description_2": "..." },
        "google_display": { "headline": "...", "long_headline": "...", "description": "..." }
      },
      "image_prompt": "Detailed photorealistic DALL-E 3 prompt for an ad visual — no text in image",
      "scores": { "overall": 0, "hook_strength": 0, "emotional_resonance": 0, "clarity": 0, "cta_effectiveness": 0, "audience_fit": 0, "platform_optimization": 0, "policy_risk": 0, "brand_consistency": 0 },
      "score_notes": "Two sentences: top strength and main weakness",
      "predicted_ctr_tier": "medium"
    },
    {
      "id": 3,
      "angle": "angle name",
      "angle_rationale": "one sentence on why this angle fits this audience",
      "copy": {
        "meta_feed": { "primary_text": "...", "headline": "...", "description": "...", "cta": "Shop Now" },
        "meta_stories": { "primary_text": "...", "headline": "...", "cta": "Shop Now" },
        "google_search": { "headline_1": "...", "headline_2": "...", "headline_3": "...", "description_1": "...", "description_2": "..." },
        "google_display": { "headline": "...", "long_headline": "...", "description": "..." }
      },
      "image_prompt": "Detailed photorealistic DALL-E 3 prompt for an ad visual — no text in image",
      "scores": { "overall": 0, "hook_strength": 0, "emotional_resonance": 0, "clarity": 0, "cta_effectiveness": 0, "audience_fit": 0, "platform_optimization": 0, "policy_risk": 0, "brand_consistency": 0 },
      "score_notes": "Two sentences: top strength and main weakness",
      "predicted_ctr_tier": "high"
    }
  ],
  "brief_analysis": "Two sentences on the key insight driving all three variations",
  "recommended_variation": 1
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content[0]?.text ?? "";
}
