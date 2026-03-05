/**
 * @ferry/core — shared data transformation primitives
 *
 * This package contains the schemas, validators, transforms, and utilities
 * shared between the Chrome extension, cloud platform, and monitoring tools.
 */

const { safeClone, DEFAULT_LIMITS } = require("./safe-clone");
const { normalizeItem } = require("./normalize");
const { parseGa4Hit } = require("./parse-ga4-hit");

module.exports = {
  safeClone,
  DEFAULT_LIMITS,
  normalizeItem,
  parseGa4Hit
};
