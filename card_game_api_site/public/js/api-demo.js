(function () {
  const isHttpPage =
    window.location.protocol === "http:" || window.location.protocol === "https:";
  const base = isHttpPage ? "" : null;

  /** @type {object | null} */
  let singlePileState = null;

  /** @type {object | null} */
  let dualPileState = null;

  /** @type {string[]} */
  let deckNames = [];

  const POST_EXAMPLES = {
    "demo-create-single": {
      path: "/api/decks/create",
      body: { deck_names: ["Forest"], shuffle_seed: null },
    },
    "demo-create-dual": {
      path: "/api/decks/create-dual",
      body: { deck_names: ["Forest", "Items"] },
    },
    "demo-single-draw": {
      path: "/api/single/draw",
      body: {
        draw_pile: [{ card_name: "Example Card" }],
        discard_pile: [],
        current_card: null,
        shuffle_seed: null,
      },
      note: "Send your full pile object from create — fields above are abbreviated.",
    },
    "demo-single-shuffle": {
      path: "/api/decks/shuffle",
      body: {
        draw_pile: [],
        discard_pile: [{ card_name: "Example Card" }],
        current_card: { card_name: "Held Card" },
        shuffle_seed: null,
      },
      note: "Round-trip the entire single pile JSON from the previous step.",
    },
    "demo-single-peek": {
      path: "/api/single/peek",
      body: { draw_pile: [{ card_name: "Top card" }], peek_count: 1 },
    },
    "demo-single-mill": {
      path: "/api/single/mill",
      body: {
        draw_pile: [{ card_name: "Top card" }],
        discard_pile: [],
        current_card: null,
        mill_count: 1,
      },
    },
    "demo-dual-draw-exploration": {
      path: "/api/dual/draw/exploration",
      body: { draw_count: 1, shuffle_seed: null },
      note: "Merge full dual pile state from create-dual; draw_count is optional.",
    },
    "demo-dual-draw-item": {
      path: "/api/dual/draw/item",
      body: { draw_count: 1 },
      note: "Merge full dual pile state from create-dual.",
    },
    "demo-dual-shuffle-exploration": {
      path: "/api/dual/shuffle/exploration",
      body: { shuffle_seed: null },
      note: "Send the complete dual pile object from create-dual.",
    },
    "demo-dual-shuffle-item": {
      path: "/api/dual/shuffle/item",
      body: { shuffle_seed: null },
      note: "Send the complete dual pile object from create-dual.",
    },
    "demo-dual-peek-exploration": {
      path: "/api/dual/peek/exploration",
      body: { peek_count: 1 },
      note: "Send full dual JSON; peek_count defaults to 1.",
    },
    "demo-dual-peek-item": {
      path: "/api/dual/peek/item",
      body: { peek_count: 1 },
      note: "Send full dual JSON.",
    },
    "demo-dual-mill-exploration": {
      path: "/api/dual/mill/exploration",
      body: { mill_count: 1 },
      note: "Send full dual JSON; omit mill_count to mill entire draw pile.",
    },
    "demo-dual-mill-item": {
      path: "/api/dual/mill/item",
      body: { mill_count: 1 },
      note: "Send full dual JSON.",
    },
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showProtocolBanner() {
    const main = document.querySelector(".site-main");
    if (!main || isHttpPage) return;
    const banner = document.createElement("div");
    banner.className = "demo-banner error-banner";
    banner.innerHTML =
      "<strong>API demos require the Node server.</strong> Open " +
      "<code>http://localhost:3000/api-demo.html</code> after running " +
      "<code>npm start</code> in <code>card_game_api_site</code>. " +
      "Opening this file directly cannot reach <code>/api/*</code>.";
    main.insertBefore(banner, main.firstElementChild?.nextElementSibling || null);
  }

  function initPostExamples() {
    for (const [sectionId, spec] of Object.entries(POST_EXAMPLES)) {
      const section = document.getElementById(sectionId);
      if (!section || section.querySelector(".request-example-wrap")) continue;
      const wrap = document.createElement("div");
      wrap.className = "request-example-wrap";
      const note = spec.note
        ? '<p class="hint">' + escapeHtml(spec.note) + "</p>"
        : "";
      wrap.innerHTML =
        '<p class="request-example-label">Example POST body</p>' +
        '<pre class="request-example">' +
        escapeHtml(JSON.stringify(spec.body, null, 2)) +
        "</pre>" +
        note;
      const controls = section.querySelector(".demo-controls");
      if (controls) {
        section.insertBefore(wrap, controls);
      } else {
        section.appendChild(wrap);
      }
    }
  }

  function initCollapsibleResults() {
    document.querySelectorAll('pre.response-block[id^="out-"]').forEach((pre) => {
      if (pre.closest(".demo-result")) return;
      const details = document.createElement("details");
      details.className = "demo-result";
      details.dataset.outId = pre.id;
      const summary = document.createElement("summary");
      summary.className = "demo-result-summary";
      summary.textContent = "Response — click to expand";
      pre.classList.add("has-content");
      if (pre.textContent.trim() === "(response here)") {
        pre.textContent = "";
        pre.classList.remove("has-content");
      }
      pre.parentNode.insertBefore(details, pre);
      details.appendChild(summary);
      details.appendChild(pre);
    });
  }

  function getResultDetails(outId) {
    const pre = document.getElementById(outId);
    return pre?.closest(".demo-result") || null;
  }

  function getOrCreateRequestPanel(outId) {
    const responseDetails = getResultDetails(outId);
    if (!responseDetails) return null;
    const reqId = "req-" + outId;
    let reqDetails = document.getElementById(reqId);
    if (!reqDetails) {
      reqDetails = document.createElement("details");
      reqDetails.id = reqId;
      reqDetails.className = "demo-result demo-request";
      const summary = document.createElement("summary");
      summary.textContent = "Request sent — click to expand";
      const pre = document.createElement("pre");
      pre.className = "response-block has-content";
      reqDetails.appendChild(summary);
      reqDetails.appendChild(pre);
      responseDetails.parentNode.insertBefore(reqDetails, responseDetails);
    }
    return reqDetails;
  }

  function showRequest(outId, method, path, body) {
    const panel = getOrCreateRequestPanel(outId);
    if (!panel) return;
    const pre = panel.querySelector("pre");
    if (!pre) return;
    pre.textContent =
      method + " " + path + "\nContent-Type: application/json\n\n" + JSON.stringify(body, null, 2);
    panel.open = true;
  }

  function summarizeResponse(data) {
    if (data == null) return "empty response";
    if (typeof data !== "object") return String(data).slice(0, 60);
    if (Array.isArray(data.deck_names)) {
      return data.deck_names.length + " deck name(s)";
    }
    if (Array.isArray(data.draw_pile)) {
      return "draw_pile: " + data.draw_pile.length + " cards";
    }
    if (data.exploration_drawpile) {
      return "dual pile created";
    }
    if (data.ok === true) return "ok: true";
    if (data.routes) return data.routes.length + " routes";
    if (data.cards) return data.returned + " card(s) peeked";
    return "JSON response";
  }

  function showResponse(outId, data, isError) {
    const el = document.getElementById(outId);
    if (!el) return;
    el.classList.toggle("error-text", !!isError);
    el.classList.add("has-content");
    el.textContent =
      isError && typeof data === "string"
        ? data
        : typeof data === "string"
          ? data
          : JSON.stringify(data, null, 2);
    const details = getResultDetails(outId);
    if (details) {
      const summary = details.querySelector("summary");
      if (summary) {
        summary.textContent = isError
          ? "Response — error (click to expand)"
          : "Response — " + summarizeResponse(data) + " (click to collapse)";
      }
      details.open = true;
    }
  }

  async function api(path, options = {}) {
    if (base === null) {
      throw new Error(
        "Not running on the API server. Use http://localhost:3000/api-demo.html after npm start."
      );
    }
    const method = (options.method || "GET").toUpperCase();
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(base + path, { ...options, method, headers });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg =
        typeof data === "object" && data && data.error ? data.error : text || res.statusText;
      throw new Error(res.status + " " + msg);
    }
    return data;
  }

  async function runDemo(outId, fn, meta = {}) {
    const btn = meta.button;
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalLabel = btn.dataset.originalLabel || btn.textContent;
      btn.textContent = "Loading…";
    }
    try {
      const data = await fn();
      if (meta.method && meta.path && "requestBody" in meta) {
        showRequest(outId, meta.method, meta.path, meta.requestBody);
      }
      showResponse(outId, data, false);
      updateStatePanels();
      return data;
    } catch (err) {
      showResponse(outId, String(err.message), true);
      throw err;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalLabel || btn.textContent;
      }
    }
  }

  function setDeckStatus(message, ok) {
    const el = document.getElementById("deckNamesStatus");
    if (!el) return;
    el.textContent = message;
    el.className = "deck-status " + (ok ? "ok" : "err");
  }

  function updateStatePanels() {
    const singleEl = document.getElementById("singleStatePreview");
    const dualEl = document.getElementById("dualStatePreview");
    if (singleEl) {
      singleEl.textContent = singlePileState
        ? JSON.stringify(singlePileState, null, 2)
        : "(no single pile — create one first)";
    }
    if (dualEl) {
      dualEl.textContent = dualPileState
        ? JSON.stringify(dualPileState, null, 2)
        : "(no dual pile — create one first)";
    }
  }

  function getSelectedDeckNames(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(
      (cb) => cb.value
    );
  }

  function renderDeckCheckboxes(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (deckNames.length === 0) {
      container.innerHTML =
        '<p class="hint">No decks loaded yet — use <strong>Fetch deck names</strong> in the section above.</p>';
      return;
    }
    container.innerHTML = deckNames
      .map(
        (name) =>
          "<label><input type=\"checkbox\" value=\"" +
          escapeHtml(name) +
          '" /> ' +
          escapeHtml(name) +
          "</label>"
      )
      .join("");
  }

  function parseOptionalShuffleSeed(inputId) {
    const raw = document.getElementById(inputId)?.value?.trim();
    if (raw === "" || raw === undefined) return undefined;
    if (raw.toLowerCase() === "null") return null;
    const num = Number(raw);
    if (Number.isFinite(num)) return num;
    return raw;
  }

  function buildCreateBody(deckContainerId, seedInputId) {
    const names = getSelectedDeckNames(deckContainerId);
    if (names.length === 0) {
      throw new Error("Select at least one deck name (fetch names first).");
    }
    const body = { deck_names: names };
    const seed = parseOptionalShuffleSeed(seedInputId);
    if (seed !== undefined) {
      body.shuffle_seed = seed;
    }
    return body;
  }

  function parsePositiveInt(inputId, label, max) {
    const raw = document.getElementById(inputId)?.value?.trim();
    if (raw === "" || raw === undefined) return undefined;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
      throw new Error(label + " must be a positive integer.");
    }
    if (max != null && n > max) {
      throw new Error(label + " cannot exceed " + max + ".");
    }
    return n;
  }

  function parseNonNegativeInt(inputId, label, max) {
    const raw = document.getElementById(inputId)?.value?.trim();
    if (raw === "" || raw === undefined) return undefined;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error(label + " must be a non-negative integer.");
    }
    if (max != null && n > max) {
      throw new Error(label + " cannot exceed " + max + ".");
    }
    return n;
  }

  function requireSinglePile() {
    if (!singlePileState) {
      throw new Error("Create a single pile first.");
    }
    return singlePileState;
  }

  function requireDualPile() {
    if (!dualPileState) {
      throw new Error("Create a dual pile first.");
    }
    return dualPileState;
  }

  function mergeOptionalCount(body, countInputId, countKey, aliasKey) {
    const n = parsePositiveInt(countInputId, countKey, 512);
    if (n !== undefined) {
      body[countKey] = n;
      if (aliasKey) body[aliasKey] = n;
    }
  }

  async function loadDeckNames(options = {}) {
    const btn = options.button;
    setDeckStatus("Loading deck names…", true);
    try {
      const data = await api("/api/decks/names");
      const raw = data && data.deck_names;
      deckNames = Array.isArray(raw)
        ? raw.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
        : [];
      renderDeckCheckboxes("singleDeckPick");
      renderDeckCheckboxes("dualDeckPick");
      if (deckNames.length === 0) {
        setDeckStatus("Connected, but the catalog returned no deck names.", false);
      } else {
        setDeckStatus(
          "Loaded " + deckNames.length + " deck name(s). Select decks in the create sections below.",
          true
        );
      }
      showResponse("out-deck-names", data, false);
      return data;
    } catch (err) {
      setDeckStatus(String(err.message), false);
      showResponse("out-deck-names", String(err.message), true);
      throw err;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalLabel || "Fetch deck names";
      }
    }
  }

  function wireDemos() {
    const btnDeckNames = document.getElementById("btn-deck-names");
    btnDeckNames.addEventListener("click", () => {
      btnDeckNames.disabled = true;
      btnDeckNames.dataset.originalLabel = btnDeckNames.dataset.originalLabel || btnDeckNames.textContent;
      btnDeckNames.textContent = "Loading…";
      loadDeckNames({ button: btnDeckNames }).catch(() => {});
    });

    document.getElementById("btn-api").addEventListener("click", (e) =>
      runDemo("out-api", () => api("/api"), { button: e.currentTarget })
    );
    document.getElementById("btn-routes").addEventListener("click", (e) =>
      runDemo("out-routes", () => api("/api/routes"), { button: e.currentTarget })
    );
    document.getElementById("btn-health").addEventListener("click", (e) =>
      runDemo("out-health", () => api("/api/health"), { button: e.currentTarget })
    );

    document.getElementById("btn-create-single").addEventListener("click", (e) =>
      runDemo(
        "out-create-single",
        async () => {
          const body = buildCreateBody("singleDeckPick", "singleShuffleSeed");
          singlePileState = await api("/api/decks/create", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return singlePileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/decks/create",
          get requestBody() {
            return buildCreateBody("singleDeckPick", "singleShuffleSeed");
          },
        }
      )
    );

    document.getElementById("btn-create-dual").addEventListener("click", (e) =>
      runDemo(
        "out-create-dual",
        async () => {
          const body = buildCreateBody("dualDeckPick", "dualShuffleSeed");
          dualPileState = await api("/api/decks/create-dual", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return dualPileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/decks/create-dual",
          get requestBody() {
            return buildCreateBody("dualDeckPick", "dualShuffleSeed");
          },
        }
      )
    );

    document.getElementById("btn-single-draw").addEventListener("click", (e) =>
      runDemo(
        "out-single-draw",
        async () => {
          const body = requireSinglePile();
          singlePileState = await api("/api/single/draw", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return singlePileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/single/draw",
          get requestBody() {
            return requireSinglePile();
          },
        }
      )
    );

    document.getElementById("btn-single-shuffle").addEventListener("click", (e) =>
      runDemo(
        "out-single-shuffle",
        async () => {
          const body = requireSinglePile();
          singlePileState = await api("/api/decks/shuffle", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return singlePileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/decks/shuffle",
          get requestBody() {
            return requireSinglePile();
          },
        }
      )
    );

    document.getElementById("btn-single-peek").addEventListener("click", (e) =>
      runDemo(
        "out-single-peek",
        async () => {
          const pile = requireSinglePile();
          const body = { draw_pile: pile.draw_pile };
          mergeOptionalCount(body, "singlePeekCount", "peek_count", "count");
          return api("/api/single/peek", { method: "POST", body: JSON.stringify(body) });
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/single/peek",
          get requestBody() {
            const pile = requireSinglePile();
            const body = { draw_pile: pile.draw_pile };
            mergeOptionalCount(body, "singlePeekCount", "peek_count", "count");
            return body;
          },
        }
      )
    );

    document.getElementById("btn-single-mill").addEventListener("click", (e) =>
      runDemo(
        "out-single-mill",
        async () => {
          const body = { ...requireSinglePile() };
          const n = parseNonNegativeInt("singleMillCount", "mill_count", 8192);
          if (n !== undefined) body.mill_count = n;
          singlePileState = await api("/api/single/mill", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return singlePileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/single/mill",
          get requestBody() {
            const body = { ...requireSinglePile() };
            const n = parseNonNegativeInt("singleMillCount", "mill_count", 8192);
            if (n !== undefined) body.mill_count = n;
            return body;
          },
        }
      )
    );

    document.getElementById("btn-dual-draw-exploration").addEventListener("click", (e) =>
      runDemo(
        "out-dual-draw-exploration",
        async () => {
          const body = { ...requireDualPile() };
          mergeOptionalCount(body, "dualDrawExplorationCount", "draw_count", "count");
          dualPileState = await api("/api/dual/draw/exploration", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return dualPileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/dual/draw/exploration",
          get requestBody() {
            const body = { ...requireDualPile() };
            mergeOptionalCount(body, "dualDrawExplorationCount", "draw_count", "count");
            return body;
          },
        }
      )
    );

    document.getElementById("btn-dual-draw-item").addEventListener("click", (e) =>
      runDemo(
        "out-dual-draw-item",
        async () => {
          const body = { ...requireDualPile() };
          mergeOptionalCount(body, "dualDrawItemCount", "draw_count", "count");
          dualPileState = await api("/api/dual/draw/item", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return dualPileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/dual/draw/item",
          get requestBody() {
            const body = { ...requireDualPile() };
            mergeOptionalCount(body, "dualDrawItemCount", "draw_count", "count");
            return body;
          },
        }
      )
    );

    document.getElementById("btn-dual-shuffle-exploration").addEventListener("click", (e) =>
      runDemo(
        "out-dual-shuffle-exploration",
        async () => {
          const body = requireDualPile();
          dualPileState = await api("/api/dual/shuffle/exploration", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return dualPileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/dual/shuffle/exploration",
          get requestBody() {
            return requireDualPile();
          },
        }
      )
    );

    document.getElementById("btn-dual-shuffle-item").addEventListener("click", (e) =>
      runDemo(
        "out-dual-shuffle-item",
        async () => {
          const body = requireDualPile();
          dualPileState = await api("/api/dual/shuffle/item", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return dualPileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/dual/shuffle/item",
          get requestBody() {
            return requireDualPile();
          },
        }
      )
    );

    document.getElementById("btn-dual-peek-exploration").addEventListener("click", (e) =>
      runDemo(
        "out-dual-peek-exploration",
        async () => {
          const body = { ...requireDualPile() };
          const n = parsePositiveInt("dualPeekExplorationCount", "peek_count", 512);
          if (n !== undefined) body.peek_count = n;
          return api("/api/dual/peek/exploration", {
            method: "POST",
            body: JSON.stringify(body),
          });
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/dual/peek/exploration",
          get requestBody() {
            const body = { ...requireDualPile() };
            const n = parsePositiveInt("dualPeekExplorationCount", "peek_count", 512);
            if (n !== undefined) body.peek_count = n;
            return body;
          },
        }
      )
    );

    document.getElementById("btn-dual-peek-item").addEventListener("click", (e) =>
      runDemo(
        "out-dual-peek-item",
        async () => {
          const body = { ...requireDualPile() };
          const n = parsePositiveInt("dualPeekItemCount", "peek_count", 512);
          if (n !== undefined) body.peek_count = n;
          return api("/api/dual/peek/item", {
            method: "POST",
            body: JSON.stringify(body),
          });
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/dual/peek/item",
          get requestBody() {
            const body = { ...requireDualPile() };
            const n = parsePositiveInt("dualPeekItemCount", "peek_count", 512);
            if (n !== undefined) body.peek_count = n;
            return body;
          },
        }
      )
    );

    document.getElementById("btn-dual-mill-exploration").addEventListener("click", (e) =>
      runDemo(
        "out-dual-mill-exploration",
        async () => {
          const body = { ...requireDualPile() };
          const n = parseNonNegativeInt("dualMillExplorationCount", "mill_count", 8192);
          if (n !== undefined) body.mill_count = n;
          dualPileState = await api("/api/dual/mill/exploration", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return dualPileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/dual/mill/exploration",
          get requestBody() {
            const body = { ...requireDualPile() };
            const n = parseNonNegativeInt("dualMillExplorationCount", "mill_count", 8192);
            if (n !== undefined) body.mill_count = n;
            return body;
          },
        }
      )
    );

    document.getElementById("btn-dual-mill-item").addEventListener("click", (e) =>
      runDemo(
        "out-dual-mill-item",
        async () => {
          const body = { ...requireDualPile() };
          const n = parseNonNegativeInt("dualMillItemCount", "mill_count", 8192);
          if (n !== undefined) body.mill_count = n;
          dualPileState = await api("/api/dual/mill/item", {
            method: "POST",
            body: JSON.stringify(body),
          });
          return dualPileState;
        },
        {
          button: e.currentTarget,
          method: "POST",
          path: "/api/dual/mill/item",
          get requestBody() {
            const body = { ...requireDualPile() };
            const n = parseNonNegativeInt("dualMillItemCount", "mill_count", 8192);
            if (n !== undefined) body.mill_count = n;
            return body;
          },
        }
      )
    );
  }

  showProtocolBanner();
  initPostExamples();
  initCollapsibleResults();
  wireDemos();
  updateStatePanels();

  if (isHttpPage) {
    loadDeckNames().catch(() => {});
  } else {
    setDeckStatus("Start the server and reload this page over http://localhost:3000", false);
  }
})();
