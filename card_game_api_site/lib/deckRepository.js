const { shuffle } = require("./shuffle");

class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string[]} deckNames
 * @returns {Promise<object[]>} card rows as plain objects
 */
async function loadCardsByDeckNames(client, deckNames) {
  if (!Array.isArray(deckNames) || deckNames.length === 0) {
    throw new ValidationError("deckNames must be a non-empty array of strings.");
  }
  for (const n of deckNames) {
    if (typeof n !== "string" || n.trim() === "") {
      throw new ValidationError("Each deck name must be a non-empty string.");
    }
  }

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
      `SELECT c.card_id, c.card_name, c.card_desc, d.deck_name, t.type_name, co.color_name
       FROM public.cards c
       JOIN public.decks d ON c.card_deck = d.deck_id
       JOIN public.types t ON c.card_type = t.type_id
       JOIN public.colors co ON c.card_color = co.color_id
       WHERE d.deck_name = $1
       ORDER BY c.card_id`,
      [name]
    );

    rows.rows.forEach((row) =>
      result.push({
        card_id: row.card_id,
        card_name: row.card_name,
        card_desc: row.card_desc,
        deck_name: row.deck_name,
        type_name: row.type_name,
        color_name: row.color_name,
      })
    );
  }

  if (result.length === 0) {
    throw new ValidationError(
      "No cards found for the given deck names. Your decks may exist but contain no rows in public.cards."
    );
  }

  return shuffle(result);
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
  listDeckNames,
  ValidationError,
};
