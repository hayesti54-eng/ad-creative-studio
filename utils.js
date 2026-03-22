"use strict";

/**
 * utils.js — Ad Creative Studio (Project 001)
 * Project-specific validators and domain logic.
 * Imports shared infrastructure from core.js.
 */

// Re-export everything from core so function files only need to import
// project-specific things from here.
const core = require("./core");
module.exports = { ...core };

// ─── PROJECT-SPECIFIC CONSTANTS ───────────────────────────────────────────────

const VALID_PLATFORMS = ["Meta Feed", "Meta Stories", "Google Search", "Google Display"];
const VALID_GOALS     = ["conversions", "leads", "traffic", "awareness", "app_installs", "video_views"];

// ─── INPUT VALIDATORS (return string[] — used for request body validation) ───

/**
 * Validates the campaign brief sent from the frontend.
 * Returns an array of error strings (empty = valid).
 */
function validateBriefInput(brief) {
  const errs = [];
  if (!brief || typeof brief !== "object") return ["request body must be a JSON object"];
  if (!brief.product || typeof brief.product !== "string" || !brief.product.trim())
    errs.push("product is required");
  if (!brief.description || typeof brief.description !== "string" || brief.description.trim().length < 10)
    errs.push("description must be at least 10 characters");
  if (!brief.audience || typeof brief.audience !== "string" || !brief.audience.trim())
    errs.push("audience is required");
  if (!Array.isArray(brief.platforms) || brief.platforms.length === 0)
    errs.push("at least one platform is required");
  else {
    const invalid = brief.platforms.filter(p => !VALID_PLATFORMS.includes(p));
    if (invalid.length) errs.push(`invalid platforms: ${invalid.join(", ")}`);
  }
  if (brief.goal && !VALID_GOALS.includes(brief.goal))
    errs.push(`goal must be one of: ${VALID_GOALS.join(", ")}`);
  return errs;
}

/**
 * Validates the iteration request body.
 * Returns an array of error strings (empty = valid).
 */
function validateIterationInput(body) {
  const errs = [];
  if (!body || typeof body !== "object") return ["request body must be a JSON object"];
  if (!body.original || typeof body.original !== "object")
    errs.push("original variation object is required");
  if (!body.feedback || typeof body.feedback !== "string" || !body.feedback.trim())
    errs.push("feedback is required");
  return errs;
}

// ─── CLAUDE OUTPUT VALIDATORS (return true | string — used with processClaude) ─

/**
 * Validates the shape of Claude's variations response.
 * Returns true if valid, or an error string describing the first problem found.
 */
function validateVariations(obj) {
  if (!obj || typeof obj !== "object") return "Response is not a JSON object";
  if (!Array.isArray(obj.variations) || obj.variations.length === 0)
    return "variations must be a non-empty array";
  if (typeof obj.brief_analysis !== "string" || !obj.brief_analysis.trim())
    return "brief_analysis must be a non-empty string";
  if (typeof obj.recommended_variation !== "number")
    return "recommended_variation must be a number";

  for (const v of obj.variations) {
    if (v.id == null) return `Variation is missing id field`;
    if (typeof v.angle !== "string" || !v.angle.trim())
      return `Variation ${v.id} is missing angle`;
    if (!v.copy || typeof v.copy !== "object")
      return `Variation ${v.id} is missing copy object`;
    if (!v.scores || typeof v.scores !== "object" || typeof v.scores.overall !== "number")
      return `Variation ${v.id} is missing scores.overall`;
  }

  return true;
}

/**
 * Validates the shape of Claude's iteration response.
 * Returns true if valid, or an error string describing the first problem found.
 */
function validateIteration(obj) {
  if (!obj || typeof obj !== "object") return "Response is not a JSON object";
  if (!obj.iterated_copy || typeof obj.iterated_copy !== "object")
    return "iterated_copy must be an object";
  if (!Array.isArray(obj.changes_made) || obj.changes_made.length === 0)
    return "changes_made must be a non-empty array";
  if (!obj.scores || typeof obj.scores !== "object" || typeof obj.scores.overall !== "number")
    return "scores.overall must be a number";
  return true;
}

// ─── EXTENDED EXPORTS ─────────────────────────────────────────────────────────

Object.assign(module.exports, {
  // Input validators
  validateBriefInput,
  validateIterationInput,

  // Claude output validators
  validateVariations,
  validateIteration,

  // Constants
  VALID_PLATFORMS,
  VALID_GOALS,
});
