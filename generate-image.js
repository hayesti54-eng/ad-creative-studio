"use strict";

const { ok, fail, parseBody, hasEnv } = require("./lib/core");

const FN = "generate-image";

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return fail(405, "METHOD_NOT_ALLOWED", "POST only", false, FN);
  }

  // ── No OpenAI key — return explicit placeholder, not an error ─────────────
  if (!hasEnv("OPENAI_API_KEY")) {
    return ok(
      {
        url: null,
        placeholder: true,
        reason: "no_key",
        message: "Add OPENAI_API_KEY to Netlify environment variables to enable image generation.",
      },
      "demo", FN, "placeholder"
    );
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    body = parseBody(event.body);
  } catch {
    return fail(400, "INVALID_BODY", "Request body must be valid JSON", false, FN);
  }

  const { imagePrompt, variationId } = body;

  if (!imagePrompt || typeof imagePrompt !== "string" || !imagePrompt.trim()) {
    return fail(400, "VALIDATION_ERROR", "imagePrompt is required", false, FN);
  }

  // ── DALL-E 3 call ─────────────────────────────────────────────────────────
  // DALL-E 3 typically takes 8–15s. Netlify free tier hard limit is 10s.
  // This function will occasionally timeout on free tier — that is expected.
  // The frontend handles null imageUrl gracefully with a labeled placeholder.
  // Upgrade to Netlify paid ($19/mo, 26s limit) for reliable image generation.
  try {
    const OpenAI = require("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const safePrompt = `${imagePrompt.trim()}. Professional advertising photography. Clean, brand-safe, high contrast. No text overlays. No people in distress. Suitable for paid social media advertising.`;

    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: safePrompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      style: "natural",
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) throw new Error("DALL-E returned no image URL");

    console.log(`[${FN}] Image generated for variation ${variationId}`);
    return ok(
      { url: imageUrl, revised_prompt: response.data[0].revised_prompt, variationId },
      "live", FN, "dall-e-3"
    );

  } catch (err) {
    // Image generation is non-fatal — return null so the frontend shows a placeholder
    console.error(`[${FN}] Image generation failed for variation ${variationId}: ${err.message}`);
    return ok(
      {
        url: null,
        placeholder: true,
        reason: "generation_failed",
        message: "Image generation failed — ad copy and scores are fully available.",
      },
      "fallback", FN, "placeholder"
    );
  }
};
