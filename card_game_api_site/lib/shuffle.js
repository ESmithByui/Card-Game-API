const crypto = require("crypto");

/**
 * Fisher–Yates shuffle using crypto.randomInt (inclusive range).
 * Returns a new array; does not mutate input.
 * @template T
 * @param {T[]} items
 * @returns {T[]}
 */
function shuffle(items) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { shuffle };
