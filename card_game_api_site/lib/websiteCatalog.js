const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/api-demo.html", label: "API Demo" },
  { href: "/effects.html", label: "Effects" },
  { href: "/boosts.html", label: "Boosts" },
  { href: "/routes.html", label: "Routes" },
];

function escapeHtml(value) {
  if (value == null) {
    return "";
  }
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderNav(activePath) {
  const links = NAV_ITEMS.map((item) => {
    const active = item.href === activePath ? ' aria-current="page"' : "";
    return `<a href="${item.href}"${active}>${escapeHtml(item.label)}</a>`;
  }).join("\n        ");
  return `<nav class="site-nav">\n        ${links}\n      </nav>`;
}

function pageShell(title, activePath, mainContent) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — Card Game API</title>
    <link rel="stylesheet" href="/css/site.css" />
  </head>
  <body>
    <header class="site-header">
      ${renderNav(activePath)}
    </header>
    <main class="site-main">
      <h1>${escapeHtml(title)}</h1>
      ${mainContent}
    </main>
    <footer class="site-footer">
      <p>Created using AALang and Gab</p>
    </footer>
  </body>
</html>`;
}

function renderCatalogList(rows, nameKey, descKey, emptyMessage) {
  if (!rows.length) {
    return `<p class="hint">${escapeHtml(emptyMessage)}</p>`;
  }
  const items = rows
    .map(
      (row) => `<li class="catalog-item">
          <h2 class="catalog-name">${escapeHtml(row[nameKey])}</h2>
          <p class="catalog-desc">${escapeHtml(row[descKey] || "")}</p>
        </li>`
    )
    .join("\n        ");
  return `<ul class="catalog-list">\n        ${items}\n      </ul>`;
}

async function renderEffectsPage(pool) {
  try {
    const result = await pool.query(
      "SELECT effect_name, effect_desc FROM public.effects ORDER BY effect_name"
    );
    const content = renderCatalogList(
      result.rows,
      "effect_name",
      "effect_desc",
      "No effects found in the database catalog."
    );
    return pageShell("Effects catalog", "/effects.html", content);
  } catch (err) {
    console.error("Effects catalog SSR error:", err.message);
    const content =
      '<p class="error">Could not load effects from the database. Verify DATABASE_URL and connection settings.</p>';
    return pageShell("Effects catalog", "/effects.html", content);
  }
}

async function renderBoostsPage(pool) {
  try {
    const result = await pool.query(
      "SELECT boost_name, boost_desc FROM public.boosts ORDER BY boost_name"
    );
    const content = renderCatalogList(
      result.rows,
      "boost_name",
      "boost_desc",
      "No boosts found in the database catalog."
    );
    return pageShell("Boosts catalog", "/boosts.html", content);
  } catch (err) {
    console.error("Boosts catalog SSR error:", err.message);
    const content =
      '<p class="error">Could not load boosts from the database. Verify DATABASE_URL and connection settings.</p>';
    return pageShell("Boosts catalog", "/boosts.html", content);
  }
}

module.exports = {
  renderEffectsPage,
  renderBoostsPage,
  escapeHtml,
  pageShell,
  renderNav,
};
