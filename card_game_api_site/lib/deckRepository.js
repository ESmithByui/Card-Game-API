const { shuffle } = require("./shuffle");

class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
  }
}

function validateDeckNamesInput(deckNames) {
  if (!Array.isArray(deckNames) || deckNames.length === 0) {
    throw new ValidationError("deck_names must be a non-empty array of strings.");
  }
  for (const n of deckNames) {
    if (typeof n !== "string" || n.trim() === "") {
      throw new ValidationError("Each deck name must be a non-empty string.");
    }
  }
}

/** Single-deck pile: full catalog fields minus monster/effects/boosts (no DB round-trips for those). */
function mapSingleDeckCardRow(row) {
  const card = {
    card_id: row.card_id,
    card_name: row.card_name,
    deck_name: row.deck_name,
    type_name: row.type_name,
    subtype_name: row.subtype_name,
    color_name: row.color_name,
  };
  if (row.card_desc != null && row.card_desc !== "") {
    card.card_desc = row.card_desc;
  }
  if (row.flavor_text != null && row.flavor_text !== "") {
    card.flavor_text = row.flavor_text;
  }
  return card;
}

function buildRichDualCard(row, monsterMap, effectsMap, boostsMap) {
  const id = row.card_id;

  const card = {
    card_id: row.card_id,
    card_name: row.card_name,
    deck_name: row.deck_name,
    type_name: row.type_name,
    subtype_name: row.subtype_name,
    color_name: row.color_name,
  };

  if (row.card_desc != null && row.card_desc !== "") {
    card.card_desc = row.card_desc;
  }
  if (row.flavor_text != null && row.flavor_text !== "") {
    card.flavor_text = row.flavor_text;
  }

  const rawMonster = monsterMap.get(id);
  if (rawMonster) {
    const monster = {};
    if (rawMonster.hp != null) monster.hp = rawMonster.hp;
    if (rawMonster.attack != null) monster.attack = rawMonster.attack;
    if (rawMonster.defense != null) monster.defense = rawMonster.defense;
    if (Object.keys(monster).length) {
      card.monster = monster;
    }
  }

  const fx = effectsMap.get(id);
  if (fx && fx.length) {
    card.effects = fx.map((entry) => {
      const effect = {
        effect_name: entry.effect_name,
        trigger: entry.trigger_name,
        effect_order: entry.effect_order,
      };
      if (entry.amount != null) effect.amount = entry.amount;
      if (entry.duration != null) effect.duration = entry.duration;
      return effect;
    });
  }

  const bs = boostsMap.get(id);
  if (bs && bs.length) {
    card.boosts = bs.map((entry) => {
      const boost = { boost_name: entry.boost_name };
      if (entry.amount != null) boost.amount = entry.amount;
      return boost;
    });
  }

  return card;
}

/**
 * Full payloads for dual-deck flows: subtype, optional flavor/card_desc, optional monster/effects/boosts.
 * Omits absent sections (no empty arrays; no monster key when none). Effects/boosts expose names only — no FK ids.
 * Per-card clones for each row in decks (same card_id may repeat). PoolClient queries run sequentially.
 * @param {import('pg').PoolClient} client
 * @param {string[]} deckNames
 * @returns {Promise<object[]>}
 */
async function fetchOrderedRichCardsByDeckNames(client, deckNames) {
  validateDeckNamesInput(deckNames);

  const bases = [];
  for (const name of deckNames) {
    const deckCheck = await client.query(
      "SELECT deck_id FROM public.decks WHERE deck_name = $1",
      [name]
    );
    if (deckCheck.rows.length === 0) {
      throw new ValidationError(`Unknown deck name: "${name}".`);
    }

    const rows = await client.query(
      `SELECT c.card_id, c.card_name, c.card_desc, c.flavor_text,
              d.deck_name, t.type_name, st.subtype_name, co.color_name
       FROM public.cards c
       JOIN public.decks d ON c.card_deck = d.deck_id
       JOIN public.types t ON c.card_type = t.type_id
       JOIN public.subtypes st ON c.card_subtype = st.subtype_id
       JOIN public.colors co ON c.card_color = co.color_id
       WHERE d.deck_name = $1
       ORDER BY c.card_id`,
      [name]
    );

    rows.rows.forEach((row) => bases.push(row));
  }

  if (bases.length === 0) {
    throw new ValidationError(
      "No cards found for the given deck names. Your decks may exist but contain no rows in public.cards."
    );
  }

  const uniqueIds = [...new Set(bases.map((r) => r.card_id))];

  // Same PoolClient cannot run overlapping queries — serialize (see pg deprecation warning).
  const monstersR = await client.query(
    `SELECT card_id, hp, attack, defense
     FROM public.monsters
     WHERE card_id = ANY($1::int[])`,
    [uniqueIds]
  );
  const effectsR = await client.query(
    `SELECT ce.card_id, ce.effect_order, ce.amount, ce.duration,
            e.effect_name, tr.trigger_name
     FROM public.card_effects ce
     JOIN public.effects e ON ce.effect_id = e.effect_id
     JOIN public.triggers tr ON ce.trigger_id = tr.trigger_id
     WHERE ce.card_id = ANY($1::int[])
     ORDER BY ce.card_id, ce.effect_order, ce.card_effect_id`,
    [uniqueIds]
  );
  const boostsR = await client.query(
    `SELECT cb.card_id, b.boost_name, cb.amount
     FROM public.card_boosts cb
     JOIN public.boosts b ON cb.boost_id = b.boost_id
     WHERE cb.card_id = ANY($1::int[])
     ORDER BY cb.card_id, cb.card_boost_id`,
    [uniqueIds]
  );

  const monsterMap = new Map();
  monstersR.rows.forEach((r) =>
    monsterMap.set(r.card_id, { hp: r.hp, attack: r.attack, defense: r.defense })
  );

  const effectsMap = new Map();
  effectsR.rows.forEach((r) => {
    const arr = effectsMap.get(r.card_id);
    const entry = {
      effect_name: r.effect_name,
      trigger_name: r.trigger_name,
      effect_order: r.effect_order,
      amount: r.amount,
      duration: r.duration,
    };
    if (arr) arr.push(entry);
    else effectsMap.set(r.card_id, [entry]);
  });

  const boostsMap = new Map();
  boostsR.rows.forEach((r) => {
    const arr = boostsMap.get(r.card_id);
    const entry = {
      boost_name: r.boost_name,
      amount: r.amount,
    };
    if (arr) arr.push(entry);
    else boostsMap.set(r.card_id, [entry]);
  });

  return bases.map((row) =>
    buildRichDualCard(row, monsterMap, effectsMap, boostsMap)
  );
}

/**
 * Concatenates cards from decks in request order (per-deck ORDER BY card_id). No shuffle.
 * @param {import('pg').PoolClient} client
 * @param {string[]} deckNames
 * @returns {Promise<object[]>} card rows as plain objects
 */
async function fetchOrderedCardsByDeckNames(client, deckNames) {
  validateDeckNamesInput(deckNames);

  const result = [];
  for (const name of deckNames) {
    const deckCheck = await client.query(
      "SELECT deck_id FROM public.decks WHERE deck_name = $1",
      [name]
    );
    if (deckCheck.rows.length === 0) {
      throw new ValidationError(`Unknown deck name: "${name}".`);
    }

    const rows = await client.query(
      `SELECT c.card_id, c.card_name, c.card_desc, c.flavor_text,
              d.deck_name, t.type_name, st.subtype_name, co.color_name
       FROM public.cards c
       JOIN public.decks d ON c.card_deck = d.deck_id
       JOIN public.types t ON c.card_type = t.type_id
       JOIN public.subtypes st ON c.card_subtype = st.subtype_id
       JOIN public.colors co ON c.card_color = co.color_id
       WHERE d.deck_name = $1
       ORDER BY c.card_id`,
      [name]
    );

    rows.rows.forEach((row) => result.push(mapSingleDeckCardRow(row)));
  }

  if (result.length === 0) {
    throw new ValidationError(
      "No cards found for the given deck names. Your decks may exist but contain no rows in public.cards."
    );
  }

  return result;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string[]} deckNames
 * @param {string | number} [shuffleSeed] optional deterministic shuffle (see lib/shuffle.js)
 * @returns {Promise<object[]>} card rows as plain objects
 */
async function loadCardsByDeckNames(client, deckNames, shuffleSeed) {
  const ordered = await fetchOrderedCardsByDeckNames(client, deckNames);
  return shuffle(ordered, shuffleSeed);
}

/**
 * Same deck name input as loadCardsByDeckNames, but splits exploration vs item piles by types.type_name.
 * Each pile is shuffled independently. Throws if any card is not Exploration or Item.
 *
 * @param {import('pg').PoolClient} client
 * @param {string[]} deckNames
 * @param {string | number} [shuffleSeed] optional deterministic shuffle (see lib/shuffle.js)
 * @returns {Promise<{ exploration_drawpile: object[], item_drawpile: object[] }>}
 */
async function loadDualExplorationItemPiles(client, deckNames, shuffleSeed) {
  const ordered = await fetchOrderedRichCardsByDeckNames(client, deckNames);
  const exploration = [];
  const items = [];
  for (const card of ordered) {
    if (card.type_name === "Exploration") exploration.push(card);
    else if (card.type_name === "Item") items.push(card);
    else {
      throw new ValidationError(
        `Dual deck loading: card "${card.card_name}" has type "${card.type_name}"; only Exploration and Item cards are split into piles.`
      );
    }
  }
  return {
    exploration_drawpile: shuffle(exploration, shuffleSeed),
    item_drawpile: shuffle(items, shuffleSeed),
  };
}

/**
 * @param {import('pg').PoolClient | import('pg').Pool} poolOrClient
 */
async function listDeckNames(poolOrClient) {
  const r = await poolOrClient.query(
    "SELECT deck_name FROM public.decks ORDER BY deck_name ASC"
  );
  return r.rows.map((row) => row.deck_name);
}

module.exports = {
  loadCardsByDeckNames,
  loadDualExplorationItemPiles,
  listDeckNames,
  ValidationError,
};
