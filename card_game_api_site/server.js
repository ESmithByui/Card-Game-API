const path = require("path");
const express = require("express");
const { pool } = require("./lib/dbPool");
const {
  loadCardsByDeckNames,
  loadDualExplorationItemPiles,
  listDeckNames,
  ValidationError,
} = require("./lib/deckRepository");
const { applyDraw, applyReshuffle, DrawConflictError } = require("./lib/drawEngine");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "2mb" }));

/** Simple CORS for non-browser callers; safe default for dev (tighten in production). */
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

function validatePileState(body, label) {
  if (!body || typeof body !== "object") {
    throw new ValidationError(`${label}: expected JSON object.`);
  }
  if (!Array.isArray(body.draw_pile)) {
    throw new ValidationError(`${label}: draw_pile must be an array.`);
  }
  if (!Array.isArray(body.discard_pile)) {
    throw new ValidationError(`${label}: discard_pile must be an array.`);
  }
  if (
    body.current_card !== null &&
    (typeof body.current_card !== "object" || Array.isArray(body.current_card))
  ) {
    throw new ValidationError(`${label}: current_card must be an object or null.`);
  }
  for (const c of body.draw_pile) {
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      throw new ValidationError(`${label}: each draw_pile entry must be a card object.`);
    }
  }
  for (const c of body.discard_pile) {
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      throw new ValidationError(`${label}: each discard_pile entry must be a card object.`);
    }
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/decks/names", async (_req, res, next) => {
  try {
    const names = await listDeckNames(pool);
    res.json({ deck_names: names });
  } catch (err) {
    next(err);
  }
});

async function respondCreateSingleDeck(req, res, next) {
  const client = await pool.connect();
  try {
    const names = req.body?.deck_names ?? req.body?.deckNames;
    if (!names) {
      throw new ValidationError("Provide deck_names as an array of deck name strings.");
    }
    const draw_pile = await loadCardsByDeckNames(client, names);
    res.json({
      draw_pile,
      current_card: null,
      discard_pile: [],
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

/** Same payload as `/api/decks/create`: one shuffled pile + null current + empty discard (legacy alias). */
app.post("/api/decks/create", respondCreateSingleDeck);
app.post("/api/decks/create-single", respondCreateSingleDeck);

/**
 * Exploration vs Item split by DB `types.type_name`. Full card payloads: flavor_text, subtype_name,
 * monster (or null), effects[], boosts[]. Each pile shuffled independently.
 * `*_current_cards` stay arrays so multiple revealed cards fit later without changing the envelope.
 */
app.post("/api/decks/create-dual", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const names = req.body?.deck_names ?? req.body?.deckNames;
    if (!names) {
      throw new ValidationError("Provide deck_names as an array of deck name strings.");
    }
    const { exploration_drawpile, item_drawpile } = await loadDualExplorationItemPiles(
      client,
      names
    );
    res.json({
      exploration_drawpile,
      exploration_discardpile: [],
      exploration_current_cards: [],
      item_drawpile,
      item_discard_pile: [],
      item_current_cards: [],
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

app.post("/api/decks/draw", (req, res, next) => {
  try {
    validatePileState(req.body, "Draw");
    const out = applyDraw(req.body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

app.post("/api/decks/reshuffle", (req, res, next) => {
  try {
    validatePileState(req.body, "Reshuffle");
    const out = applyReshuffle(req.body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ValidationError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof DrawConflictError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`card-game-api-site listening on http://localhost:${PORT}`);
});
