const path = require("path");
const express = require("express");
const { pool } = require("./lib/dbPool");
const {
  loadCardsByDeckNames,
  loadDualExplorationItemPiles,
  listDeckNames,
  ValidationError,
} = require("./lib/deckRepository");
const {
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
} = require("./lib/drawEngine");
const { renderEffectsPage, renderBoostsPage } = require("./lib/websiteCatalog");

/** Curated docs for introspection (@see GET /api/routes); keep in sync when adding endpoints. */
const API_ROUTE_MANIFEST = [
  { methods: ["GET"], path: "/api", about: "Service index with this manifest." },
  { methods: ["GET"], path: "/api/routes", about: "JSON list of HTTP routes." },
  { methods: ["GET"], path: "/api/health", about: '{"ok": true} liveness probe.' },
  {
    methods: ["GET"],
    path: "/api/decks/names",
    about: "Postgres catalog: {\"deck_names\": string[]}",
  },
  {
    methods: ["POST"],
    path: "/api/decks/create",
    about:
      '{"deck_names": [], "shuffle_seed"?: }. optional seed embedded in response deck JSON; omit/null → crypto + shuffle_seed:null.',
  },
  {
    methods: ["POST"],
    path: "/api/decks/create-single",
    about: "Alias of /api/decks/create.",
  },
  {
    methods: ["POST"],
    path: "/api/decks/create-dual",
    about:
      '{"deck_names": [], "shuffle_seed"?: }; response includes shuffle_seed (null unless set). piles use RNG from that.',
  },
  {
    methods: ["POST"],
    path: "/api/single/draw",
    about: "One draw; round-trip shuffle_seed on deck decides recycle shuffle (omit or null field → crypto).",
  },
  {
    methods: ["POST"],
    path: "/api/dual/draw/exploration",
    about:
      "Full dual deck JSON + draw_count|count?. shuffle_seed carried on dual object controls recycler RNG.",
  },
  {
    methods: ["POST"],
    path: "/api/dual/draw/item",
    about: "Same as exploration draw for item pile.",
  },
  {
    methods: ["POST"],
    path: "/api/decks/shuffle",
    about:
      '{"draw_pile","discard_pile","current_card","shuffle_seed"?(null|string|number)} — merge piles; RNG from shuffle_seed.',
  },
  {
    methods: ["POST"],
    path: "/api/dual/shuffle/exploration",
    about:
      "Full dual JSON; shuffles exploration_drawpile only (discard untouched). RNG from shuffle_seed.",
  },
  {
    methods: ["POST"],
    path: "/api/dual/shuffle/item",
    about:
      "Shuffles item_drawpile only (item discard untouched). RNG from shuffle_seed.",
  },
  {
    methods: ["POST"],
    path: "/api/single/peek",
    about:
      '{"draw_pile":[...],"peek_count"?: ,"count"?}. top = index 0; optional aliases for depth; default 1.',
  },
  {
    methods: ["POST"],
    path: "/api/dual/peek/exploration",
    about:
      "Full dual state + peek_count only (omit count field). {\"requested\",\"returned\",\"cards\"}; no mutations.",
  },
  { methods: ["POST"], path: "/api/dual/peek/item", about: "Peek item drawpile only." },
  {
    methods: ["POST"],
    path: "/api/single/mill",
    about:
      "Full pile state + optional mill_count (non-negative int). Omit mill_count → move entire draw to discard; mill_count=N → move top N only (truncated). 0 → no-op.",
  },
  {
    methods: ["POST"],
    path: "/api/dual/mill/exploration",
    about:
      "Full dual + optional mill_count (same semantics as single mill). Exploration draw top → exploration discard; currents unchanged.",
  },
  {
    methods: ["POST"],
    path: "/api/dual/mill/item",
    about: "Same as exploration mill for the item track.",
  },
];

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
  if (Object.prototype.hasOwnProperty.call(body, "shuffle_seed")) {
    validateNullableShuffleSeed(body.shuffle_seed, label);
  }
}

/** Single-track peek accepts `draw_pile` only — top of pile is index 0. */
function validatePeekDrawpileOnly(body, label) {
  if (!body || typeof body !== "object") {
    throw new ValidationError(`${label}: expected JSON object.`);
  }
  if (!Array.isArray(body.draw_pile)) {
    throw new ValidationError(`${label}: draw_pile must be an array.`);
  }
  for (const c of body.draw_pile) {
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      throw new ValidationError(`${label}: each draw_pile entry must be a card object.`);
    }
  }
}

function validateCardObjectArray(body, prop, label) {
  for (const c of body[prop]) {
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      throw new ValidationError(`${label}: each ${prop} entry must be a card object.`);
    }
  }
}

/** Body shape matching POST /api/decks/create-dual response. */
function validateDualDeckState(body, label) {
  if (!body || typeof body !== "object") {
    throw new ValidationError(`${label}: expected JSON object.`);
  }
  const piles = [
    "exploration_drawpile",
    "exploration_discardpile",
    "exploration_current_cards",
    "item_drawpile",
    "item_discard_pile",
    "item_current_cards",
  ];
  for (const key of piles) {
    if (!Array.isArray(body[key])) {
      throw new ValidationError(`${label}: ${key} must be an array.`);
    }
  }
  validateCardObjectArray(body, "exploration_drawpile", label);
  validateCardObjectArray(body, "exploration_discardpile", label);
  validateCardObjectArray(body, "exploration_current_cards", label);
  validateCardObjectArray(body, "item_drawpile", label);
  validateCardObjectArray(body, "item_discard_pile", label);
  validateCardObjectArray(body, "item_current_cards", label);
  validateNullableShuffleSeed(body.shuffle_seed, label);
}

const MAX_DUAL_DRAW = 512;
const MAX_PEEK_COUNT = 512;
const MAX_MILL = 8192;

/** null or valid seed value (for round-tripped deck JSON). */
function validateNullableShuffleSeed(s, label) {
  const prefix = `${label}: `;
  if (s === null) {
    return;
  }
  if (typeof s === "number") {
    if (!Number.isFinite(s)) {
      throw new ValidationError(`${prefix}shuffle_seed number must be finite.`);
    }
    return;
  }
  if (typeof s === "string") {
    if (s.trim() === "") {
      throw new ValidationError(`${prefix}shuffle_seed string must be non-empty.`);
    }
    return;
  }
  throw new ValidationError(
    `${prefix}shuffle_seed must be null, a finite number, or a non-empty string.`
  );
}

/** If present on the wire JSON, must be valid (null clears deterministic RNG semantics). */
function validateOptionalShuffleSeedOnWire(body, label) {
  if (!body || typeof body !== "object") {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "shuffle_seed")) {
    validateNullableShuffleSeed(body.shuffle_seed, label);
  }
}

/** Normalizes seeded payload field after validation. */
function parseShuffleSeedForCreate(body, label = "Create") {
  if (!body || typeof body !== "object") {
    return { rngValue: undefined, persisted: null };
  }
  if (!Object.prototype.hasOwnProperty.call(body, "shuffle_seed")) {
    return { rngValue: undefined, persisted: null };
  }
  const s = body.shuffle_seed;
  if (s === null || s === "") {
    return { rngValue: undefined, persisted: null };
  }
  validateNullableShuffleSeed(s, label);
  const persisted = typeof s === "string" ? s.trim() : s;
  return { rngValue: persisted, persisted };
}

/** Dual draw depth: optional draw_count | count — default 1. */
function parseDualDrawCount(body, label) {
  const raw = body?.draw_count ?? body?.count;
  if (raw === undefined || raw === null || raw === "") {
    return 1;
  }
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new ValidationError(
      `${label}: draw_count must be a positive integer (omit for default of 1).`
    );
  }
  if (n > MAX_DUAL_DRAW) {
    throw new ValidationError(`${label}: draw_count cannot exceed ${MAX_DUAL_DRAW}.`);
  }
  return n;
}

/** Peek depth — dual routes: `peek_count` only (avoid clashing with draw's `count` alias). */
function parsePeekCountDual(body, label, defaultCount = 1) {
  const raw = body?.peek_count;
  if (raw === undefined || raw === null || raw === "") {
    return defaultCount;
  }
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new ValidationError(`${label}: peek_count must be a positive integer (default 1).`);
  }
  if (n > MAX_PEEK_COUNT) {
    throw new ValidationError(`${label}: peek_count cannot exceed ${MAX_PEEK_COUNT}.`);
  }
  return n;
}

/** Peek depth: peek_count | count — default 1 (single-/dual-track peek helpers). */
function parsePeekCount(body, label, defaultCount = 1) {
  const raw = body?.peek_count ?? body?.count;
  if (raw === undefined || raw === null || raw === "") {
    return defaultCount;
  }
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new ValidationError(`${label}: peek_count must be a positive integer (default 1).`);
  }
  if (n > MAX_PEEK_COUNT) {
    throw new ValidationError(`${label}: peek_count cannot exceed ${MAX_PEEK_COUNT}.`);
  }
  return n;
}

/**
 * Optional mill depth: omit key → mill entire draw pile (legacy).
 * mill_count 0 → no-op. Otherwise cap at pile size on the engine side.
 */
function parseMillCountIfPresent(body, label) {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(body, "mill_count")) {
    return undefined;
  }
  const raw = body.mill_count;
  if (raw === null || raw === undefined || raw === "") {
    throw new ValidationError(
      `${label}: mill_count is invalid empty; omit mill_count to mill the entire draw pile.`,
    );
  }
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new ValidationError(
      `${label}: mill_count must be a non-negative integer, or omit to mill entire draw.`,
    );
  }
  if (n > MAX_MILL) {
    throw new ValidationError(`${label}: mill_count cannot exceed ${MAX_MILL}.`);
  }
  return n;
}

function dualPilesFromBody(body) {
  const hasSeed = Object.prototype.hasOwnProperty.call(body, "shuffle_seed");
  let seedVal = null;
  if (hasSeed) {
    const s = body.shuffle_seed;
    if (s !== null && s !== undefined) {
      seedVal = typeof s === "string" ? s.trim() : s;
    }
  }
  return {
    exploration_drawpile: body.exploration_drawpile,
    exploration_discardpile: body.exploration_discardpile,
    exploration_current_cards: body.exploration_current_cards,
    item_drawpile: body.item_drawpile,
    item_discard_pile: body.item_discard_pile,
    item_current_cards: body.item_current_cards,
    shuffle_seed: seedVal,
  };
}

function singlePileFromBody(body) {
  const hasSeed = Object.prototype.hasOwnProperty.call(body, "shuffle_seed");
  let seedVal = null;
  if (hasSeed) {
    const s = body.shuffle_seed;
    if (s !== null && s !== undefined) {
      seedVal = typeof s === "string" ? s.trim() : s;
    }
  }
  return {
    draw_pile: body.draw_pile,
    discard_pile: body.discard_pile,
    current_card: body.current_card,
    shuffle_seed: seedVal,
  };
}

function respondSingleDraw(req, res, next) {
  try {
    validatePileState(req.body, "Draw");
    const out = applyDraw(singlePileFromBody(req.body));
    res.json(out);
  } catch (err) {
    next(err);
  }
}

function dualDrawRoute(track) {
  return (req, res, next) => {
    try {
      validateOptionalShuffleSeedOnWire(req.body, `Dual draw (${track})`);
      const piles = dualPilesFromBody(req.body);
      const count = parseDualDrawCount(req.body, "Dual draw");
      validateDualDeckState(piles, "Dual draw");
      const out = applyDualTrackDraw(piles, track, count);
      res.json(out);
    } catch (err) {
      next(err);
    }
  };
}

function dualShuffleRoute(track) {
  return (req, res, next) => {
    try {
      validateOptionalShuffleSeedOnWire(req.body, `Dual shuffle (${track})`);
      const piles = dualPilesFromBody(req.body);
      validateDualDeckState(piles, "Dual shuffle");
      const out = applyDualTrackShuffle(piles, track);
      res.json(out);
    } catch (err) {
      next(err);
    }
  };
}

function dualPeekRoute(track) {
  return (req, res, next) => {
    try {
      validateOptionalShuffleSeedOnWire(req.body, `Dual peek (${track})`);
      const piles = dualPilesFromBody(req.body);
      validateDualDeckState(piles, "Dual peek");
      const n = parsePeekCountDual(req.body, "Dual peek", 1);
      const out = applyDualPeekTop(piles, track, n);
      res.json(out);
    } catch (err) {
      next(err);
    }
  };
}

function dualMillRoute(track) {
  return (req, res, next) => {
    try {
      validateOptionalShuffleSeedOnWire(req.body, `Dual mill (${track})`);
      const piles = dualPilesFromBody(req.body);
      validateDualDeckState(piles, "Dual mill");
      const count = parseMillCountIfPresent(req.body, `Dual mill (${track})`);
      const out = applyDualMill(piles, track, count);
      res.json(out);
    } catch (err) {
      next(err);
    }
  };
}

app.get("/api", (_req, res) => {
  res.json({
    service: "card-game-api-site",
    routes: API_ROUTE_MANIFEST,
    hint: 'GET /api/routes returns {"routes":[...same...]}.',
  });
});

app.get("/api/routes", (_req, res) => {
  res.json({ routes: API_ROUTE_MANIFEST });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/effects.html", async (_req, res, next) => {
  try {
    const html = await renderEffectsPage(pool);
    res.type("html").send(html);
  } catch (err) {
    next(err);
  }
});

app.get("/boosts.html", async (_req, res, next) => {
  try {
    const html = await renderBoostsPage(pool);
    res.type("html").send(html);
  } catch (err) {
    next(err);
  }
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
    const { rngValue, persisted } = parseShuffleSeedForCreate(req.body ?? {}, "Create single deck");
    const draw_pile = await loadCardsByDeckNames(client, names, rngValue);
    res.json({
      draw_pile,
      current_card: null,
      discard_pile: [],
      shuffle_seed: persisted,
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

app.post("/api/decks/create-dual", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const names = req.body?.deck_names ?? req.body?.deckNames;
    if (!names) {
      throw new ValidationError("Provide deck_names as an array of deck name strings.");
    }
    const { rngValue, persisted } = parseShuffleSeedForCreate(req.body ?? {}, "Create dual deck");
    const { exploration_drawpile, item_drawpile } = await loadDualExplorationItemPiles(
      client,
      names,
      rngValue
    );
    res.json({
      exploration_drawpile,
      exploration_discardpile: [],
      exploration_current_cards: [],
      item_drawpile,
      item_discard_pile: [],
      item_current_cards: [],
      shuffle_seed: persisted,
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

/** One card per request; round-trip full single-track pile state. */
app.post("/api/single/draw", respondSingleDraw);

app.post("/api/dual/draw/exploration", dualDrawRoute("exploration"));
app.post("/api/dual/draw/item", dualDrawRoute("item"));

app.post("/api/decks/shuffle", (req, res, next) => {
  try {
    validatePileState(req.body, "Shuffle");
    const out = applySingleDeckShuffle(singlePileFromBody(req.body));
    res.json(out);
  } catch (err) {
    next(err);
  }
});

app.post("/api/dual/shuffle/exploration", dualShuffleRoute("exploration"));
app.post("/api/dual/shuffle/item", dualShuffleRoute("item"));

app.post("/api/single/peek", (req, res, next) => {
  try {
    validatePeekDrawpileOnly(req.body, "Peek");
    const n = parsePeekCount(req.body, "Peek", 1);
    const out = peekTopOfDraw(req.body.draw_pile, n);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

app.post("/api/dual/peek/exploration", dualPeekRoute("exploration"));
app.post("/api/dual/peek/item", dualPeekRoute("item"));

app.post("/api/single/mill", (req, res, next) => {
  try {
    validatePileState(req.body, "Mill");
    const piles = singlePileFromBody(req.body);
    const count = parseMillCountIfPresent(req.body, "Mill");
    const out = applySingleMill(piles, count);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

app.post("/api/dual/mill/exploration", dualMillRoute("exploration"));
app.post("/api/dual/mill/item", dualMillRoute("item"));

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
  if (err instanceof ShuffleConflictError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof TypeError && typeof err.message === "string" && err.message.includes("shuffle_seed")) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`card-game-api-site listening on http://localhost:${PORT}`);
});
