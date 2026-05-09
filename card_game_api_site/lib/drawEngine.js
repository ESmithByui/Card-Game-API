const { shuffle } = require("./shuffle");

class DrawConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "DrawConflictError";
    this.status = 409;
  }
}

/**
 * Stateless draw: recycles discard into draw when draw is empty, then draws one card.
 * @param {{ draw_pile: object[], current_card: object | null, discard_pile: object[] }} state
 */
function applyDraw(state) {
  let draw = Array.isArray(state.draw_pile) ? state.draw_pile.slice() : [];
  let discard = Array.isArray(state.discard_pile) ? state.discard_pile.slice() : [];
  let current = state.current_card === undefined ? null : state.current_card;

  if (draw.length === 0) {
    if (current !== null) discard.push(current);
    current = null;
    if (discard.length === 0) {
      throw new DrawConflictError(
        "Cannot draw: draw pile is empty and there are no cards in discard to recycle."
      );
    }
    draw = shuffle(discard);
    discard = [];
  }

  if (current !== null) discard.push(current);

  const [top, ...rest] = draw;
  return {
    draw_pile: rest,
    current_card: top,
    discard_pile: discard,
  };
}

/**
 * Merge draw + discard, shuffle; current_card unchanged.
 */
function applyReshuffle(state) {
  const draw = Array.isArray(state.draw_pile) ? state.draw_pile.slice() : [];
  const discard = Array.isArray(state.discard_pile) ? state.discard_pile.slice() : [];
  const merged = shuffle([...draw, ...discard]);
  return {
    draw_pile: merged,
    current_card: state.current_card === undefined ? null : state.current_card,
    discard_pile: [],
  };
}

module.exports = { applyDraw, applyReshuffle, DrawConflictError };
