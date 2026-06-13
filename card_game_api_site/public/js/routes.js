(function () {
  const base = "";

  async function fetchRoutes() {
    const res = await fetch(base + "/api/routes", {
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text || res.statusText);
    }
    if (!res.ok) {
      throw new Error(data.error || text || res.statusText);
    }
    return data;
  }

  function renderRoutesTable(routes) {
    const wrap = document.getElementById("routesTableWrap");
    if (!Array.isArray(routes) || routes.length === 0) {
      wrap.innerHTML = '<p class="hint">No routes returned.</p>';
      return;
    }
    const rows = routes
      .map((r) => {
        const methods = (r.methods || []).join(", ");
        const cls = (r.methods || []).includes("GET") ? "method-get" : "method-post";
        return (
          "<tr>" +
          '<td><span class="method ' +
          cls +
          '">' +
          methods +
          "</span></td>" +
          "<td><code>" +
          r.path +
          "</code></td>" +
          "<td>" +
          (r.about || "") +
          "</td></tr>"
        );
      })
      .join("");
    wrap.innerHTML =
      '<table class="routes"><thead><tr><th>Method</th><th>Path</th><th>About</th></tr></thead><tbody>' +
      rows +
      "</tbody></table>";
  }

  async function loadRoutes() {
    const wrap = document.getElementById("routesTableWrap");
    wrap.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const data = await fetchRoutes();
      renderRoutesTable(data.routes);
    } catch (err) {
      wrap.innerHTML =
        '<p class="error">Failed to load routes: ' + String(err.message) + "</p>";
    }
  }

  document.getElementById("refreshRoutes").addEventListener("click", loadRoutes);
  loadRoutes();
})();
