const crypto = require("crypto");

/**
 * Stable string hash to 32-bit unsigned (deterministic shuffle seed derivation).
 */
function stringToSeedUint32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Normalize request seed → 32-bit state for Mulberry32.
 * @param {string | number} seed
 */
function coerceMulberrySeed(seed) {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) {
      throw new TypeError("shuffle_seed number must be finite.");
    }
    if (Object.is(seed, -0)) {
      return stringToSeedUint32("-0");
    }
    if (seed === Math.trunc(seed)) {
      return seed >>> 0;
    }
    return stringToSeedUint32(String(seed));
  }
  if (typeof seed === "string" && seed.length > 0) {
    return stringToSeedUint32(seed);
  }
  throw new TypeError("shuffle_seed must be a finite number or non-empty string.");
}

/**
 * Seeded RNG (Mulberry32) — next unsigned int in [0, 2^32).
 */
function mulberry32Uint32(normalizedSeed) {
  let a = normalizedSeed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * Fisher–Yates shuffle (crypto RNG by default).
 * Optional `shuffleSeed`: deterministic order for same inputs + seed (replayable games / tests).
 *
 * @template T
 * @param {T[]} items
 * @param {string | number} [shuffleSeed]
 * @returns {T[]}
 */
function shuffle(items, shuffleSeed) {
  const a = items.slice();
  if (
    shuffleSeed === undefined ||
    shuffleSeed === null ||
    (typeof shuffleSeed === "string" && shuffleSeed.trim() === "")
  ) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  try {
    const normalized = coerceMulberrySeed(shuffleSeed);
    const next = mulberry32Uint32(normalized);
    for (let i = a.length - 1; i > 0; i--) {
      const j = next() % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  } catch (e) {
    throw new TypeError(e.message || String(e));
  }
}

module.exports = { shuffle };
