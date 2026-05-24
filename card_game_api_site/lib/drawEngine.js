const { shuffle } = require("./shuffle");

class DrawConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "DrawConflictError";
    this.status = 409;
  }
}

class ShuffleConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ShuffleConflictError";
    this.status = 409;
  }
}

/** `undefined` → crypto shuffle; otherwise Mulberry32 path in lib/shuffle.js */
function recycleShuffleArg(state) {
  const s = state.shuffle_seed;
  if (s === undefined || s === null || s === "") {
    return undefined;
  }
  return s;
}

/** Always include in JSON: `null` means “use crypto for shuffles”. */
function shuffleSeedForJson(state) {
  const s = state.shuffle_seed;
  if (s === undefined || s === null || s === "") {
    return null;
  }
  return s;
}

/**
 * @param {string | number | undefined} shuffleSeed Optional; passed to `./shuffle`.
 */
function recycleDiscardIntoDrawIfDrawEmpty(draw, discard, shuffleSeed) {
  const d = Array.isArray(draw) ? draw.slice() : [];
  const disc = Array.isArray(discard) ? discard.slice() : [];
  if (d.length > 0) {
    return { draw: d, discard: disc };
  }
  if (disc.length === 0) {
    throw new DrawConflictError(
      "Cannot draw: draw pile is empty and there are no cards in discard to recycle."
    );
  }
  return { draw: shuffle(disc, shuffleSeed), discard: [] };
}

/**
 * Merge draw then discard into one pile, shuffle, clear discard (current / in-play cards unchanged).
 *
 * @param {object[]} draw
 * @param {object[]} discard
 * @param {string | number | undefined} shuffleSeed Optional.
 * @returns {{ draw_pile: object[], discard_pile: object[] }}
 */
function mergeDrawAndDiscardShuffle(draw, discard, shuffleSeed) {
  const d = Array.isArray(draw) ? draw.slice() : [];
  const disc = Array.isArray(discard) ? discard.slice() : [];
  if (d.length === 0 && disc.length === 0) {
    throw new ShuffleConflictError(
      "Cannot shuffle: draw pile is empty and there are no cards in discard to recycle."
    );
  }
  return {
    draw_pile: shuffle([...d, ...disc], shuffleSeed),
    discard_pile: [],
  };
}

/**
 * Stateless draw: recycles discard into draw when draw is empty, then draws one card.
 * Deterministic recycle uses `state.shuffle_seed` when set (from deck creation); otherwise crypto.
 * @param {{ draw_pile: object[], current_card: object | null, discard_pile: object[], shuffle_seed?: unknown }} state
 */
function applyDraw(state) {
  const eff = recycleShuffleArg(state);
  let draw = Array.isArray(state.draw_pile) ? state.draw_pile.slice() : [];
  let discard = Array.isArray(state.discard_pile) ? state.discard_pile.slice() : [];
  let current = state.current_card === undefined ? null : state.current_card;

  if (draw.length === 0) {
    if (current !== null) discard.push(current);
    current = null;
    const recycled = recycleDiscardIntoDrawIfDrawEmpty(draw, discard, eff);
    draw = recycled.draw;
    discard = recycled.discard;
  }

  if (current !== null) discard.push(current);

  const [top, ...rest] = draw;
  return {
    draw_pile: rest,
    current_card: top,
    discard_pile: discard,
    shuffle_seed: shuffleSeedForJson(state),
  };
}

/** Top of draw pile = index 0 (same convention as draw). */
function peekTopOfDraw(drawPile, requested) {
  const draw = Array.isArray(drawPile) ? drawPile.slice() : [];
  const returned = Math.min(requested, draw.length);
  return {
    requested,
    returned,
    cards: draw.slice(0, returned),
  };
}

/**
 * Move cards from the top of the draw pile onto discard (after existing discard). current_card untouched.
 * @param {number|undefined} explicitCount If undefined, move the entire draw pile (legacy). If 0, no-op.
 */
function applySingleMill(state, explicitCount) {
  const draw = Array.isArray(state.draw_pile) ? state.draw_pile.slice() : [];
  const discard = Array.isArray(state.discard_pile) ? state.discard_pile.slice() : [];
  const take =
    explicitCount === undefined
      ? draw.length
      : Math.min(Math.max(0, explicitCount), draw.length);
  const milled = draw.slice(0, take);
  const rest = draw.slice(take);
  return {
    draw_pile: rest,
    discard_pile: [...discard, ...milled],
    current_card: state.current_card === undefined ? null : state.current_card,
    shuffle_seed: shuffleSeedForJson(state),
  };
}

/** @param {"exploration" | "item"} track */
function applyDualMill(state, track, explicitCount) {
  if (track !== "exploration" && track !== "item") {
    throw new Error(`Invalid track: ${track}`);
  }

  const drawKey = track === "exploration" ? "exploration_drawpile" : "item_drawpile";
  const discardKey =
    track === "exploration" ? "exploration_discardpile" : "item_discard_pile";

  const draw = Array.isArray(state[drawKey]) ? state[drawKey].slice() : [];
  const discard = Array.isArray(state[discardKey]) ? state[discardKey].slice() : [];
  const take =
    explicitCount === undefined
      ? draw.length
      : Math.min(Math.max(0, explicitCount), draw.length);
  const milled = draw.slice(0, take);
  const rest = draw.slice(take);

  return {
    ...state,
    [drawKey]: rest,
    [discardKey]: [...discard, ...milled],
  };
}

/**
 * Single-track: merge draw + discard, shuffle; current_card unchanged.
 * @param {{ draw_pile: object[], current_card: object | null, discard_pile: object[], shuffle_seed?: unknown }} state
 */
function applySingleDeckShuffle(state) {
  const eff = recycleShuffleArg(state);
  const { draw_pile, discard_pile } = mergeDrawAndDiscardShuffle(
    state.draw_pile,
    state.discard_pile,
    eff
  );
  return {
    draw_pile,
    current_card: state.current_card === undefined ? null : state.current_card,
    discard_pile,
    shuffle_seed: shuffleSeedForJson(state),
  };
}

/**
 * Dual-track: shuffle only that track’s draw pile. Discard unchanged here; discard is merged
 * back into draw (shuffled) only when drawing with an empty draw pile — see `applyDualTrackDraw`.
 * `exploration_current_cards` / `item_current_cards` unchanged.
 * @param {object} state full dual payload from create-dual
 * @param {"exploration" | "item"} track
 */
function applyDualTrackShuffle(state, track) {
  if (track !== "exploration" && track !== "item") {
    throw new Error(`Invalid track: ${track}`);
  }

  const drawKey = track === "exploration" ? "exploration_drawpile" : "item_drawpile";
  const discardKey =
    track === "exploration" ? "exploration_discardpile" : "item_discard_pile";

  const eff = recycleShuffleArg(state);
  const draw = Array.isArray(state[drawKey]) ? state[drawKey].slice() : [];
  const discard = Array.isArray(state[discardKey]) ? state[discardKey].slice() : [];

  return {
    ...state,
    [drawKey]: shuffle(draw, eff),
    [discardKey]: discard,
  };
}

/**
 * Dual-track draw: moves existing `*_current_cards` onto that track's discard (order preserved),
 * then draws count cards from draw pile (each step recycles discard→draw shuffled when draw empty).
 * New cards become `*_current_cards` with first-drawn first — draw order preserved.
 *
 * @param {object} state full dual payload
 * @param {"exploration" | "item"} track
 * @param {number} drawCount integer >= 1
 */
function applyDualTrackDraw(state, track, drawCount) {
  if (track !== "exploration" && track !== "item") {
    throw new Error(`Invalid track: ${track}`);
  }

  const drawKey = track === "exploration" ? "exploration_drawpile" : "item_drawpile";
  const discardKey =
    track === "exploration" ? "exploration_discardpile" : "item_discard_pile";
  const currentKey =
    track === "exploration" ? "exploration_current_cards" : "item_current_cards";

  const eff = recycleShuffleArg(state);
  let draw = Array.isArray(state[drawKey]) ? state[drawKey].slice() : [];
  let discard = Array.isArray(state[discardKey]) ? state[discardKey].slice() : [];
  const olds = Array.isArray(state[currentKey]) ? state[currentKey].slice() : [];

  discard.push(...olds);

  const drawn = [];
  for (let i = 0; i < drawCount; i++) {
    const ensured = recycleDiscardIntoDrawIfDrawEmpty(draw, discard, eff);
    draw = ensured.draw;
    discard = ensured.discard;
    const [top, ...rest] = draw;
    drawn.push(top);
    draw = rest;
  }

  return {
    ...state,
    [drawKey]: draw,
    [discardKey]: discard,
    [currentKey]: drawn,
  };
}

/** @param {"exploration" | "item"} track */
function applyDualPeekTop(state, track, requested) {
  if (track !== "exploration" && track !== "item") {
    throw new Error(`Invalid track: ${track}`);
  }
  const drawKey = track === "exploration" ? "exploration_drawpile" : "item_drawpile";
  return peekTopOfDraw(state[drawKey], requested);
}

module.exports = {
  applyDraw,
  applySingleDeckShuffle,
  applyDualTrackShuffle,
  applyDualTrackDraw,
  peekTopOfDraw,
  applyDualPeekTop,
  applySingleMill,
  applyDualMill,
  DrawConflictError,
  ShuffleConflictError,
};
