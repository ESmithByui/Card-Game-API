const path = require("path");

const APP_ROOT = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(APP_ROOT, ".env") });

const fs = require("fs");
const { Pool } = require("pg");

function poolMaxConnections() {
  const raw = process.env.PG_POOL_MAX;
  if (raw === undefined || raw === "") return 10;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/**
 * SSL for `pg`: if PGSSLROOTCERT is set, verify server cert against that CA.
 * Otherwise when SSL is required (PGSSL or sslmode in URL), use TLS without custom CA pinning.
 */
function pgSslOption() {
  const url = process.env.DATABASE_URL || "";
  const requireSsl =
    process.env.PGSSL === "true" ||
    process.env.PGSSL === "1" ||
    /\bsslmode=(require|verify-ca|verify-full)\b/i.test(url);

  const caPath = process.env.PGSSLROOTCERT?.trim();
  if (caPath) {
    const resolved = path.isAbsolute(caPath) ? caPath : path.join(APP_ROOT, caPath);
    const ca = fs.readFileSync(resolved, "utf8");
    return {
      ca,
      rejectUnauthorized: true,
      // TLS chain validates with CA above; hostname may not match numeric pool endpoint.
      checkServerIdentity() {
        return undefined;
      },
    };
  }
  if (requireSsl) {
    return { rejectUnauthorized: false };
  }
  return false;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMaxConnections(),
  ssl: pgSslOption(),
});

module.exports = { pool };
