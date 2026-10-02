"use strict";
(() => {
  const MAX_DIGITS = 50, CARD_H = 220, GAP = 12, MIN_COL = 168, ROW = CARD_H + GAP;
  const $ = (s) => document.querySelector(s);

  /* ---------- BigInt ids: parsing + randomness ---------- */
  const Ids = {
    parse(raw) {
      let s = String(raw ?? "").trim().replace(/^profilith\s*/i, "").replace(/\s+/g, "");
      if (!s) return { error: "Enter a profile number." };
      if (s[0] === "-") return { error: "Profile numbers start at 1." };
      if (!/^\d+$/.test(s)) return { error: "Use whole digits only, like 777777777." };
      s = s.replace(/^0+/, "");
      if (!s) return { error: "Profile numbers start at 1." };
      if (s.length > MAX_DIGITS) return { error: "That number is too long (max " + MAX_DIGITS + " digits)." };
      return { id: BigInt(s) };
    },
    random() {
      const w = new Uint32Array(3);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(w);
      else w.forEach((_, i) => { w[i] = Math.random() * 4294967296; });
      return (((BigInt(w[0]) << 64n) | (BigInt(w[1]) << 32n) | BigInt(w[2])) % (10n ** 24n)) + 1n;
    }
  };

  /* ---------- Seeded PRNG (sfc32) derived from a BigInt ---------- */
  const Rng = {
    create(id) {
      let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = 1, x = id, i = 0;
      do {
        const w = Number(x & 0xffffffffn);
        a = Math.imul(a ^ w, 0x85ebca6b) ^ (b >>> 13);
        b = Math.imul(b + w + i, 0xc2b2ae35) ^ ((c << 7) | (c >>> 25));
        c = (Math.imul(c ^ a, 0x27d4eb2f) + d) | 0;
        d = (d + 0x9e3779b9 + w) | 0;
        x >>= 32n; i++;
      } while (x > 0n);
      const next = () => {
        const t = (((a + b) | 0) + d) | 0;
        d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
        c = (((c << 21) | (c >>> 11)) + t) | 0;
        return (t >>> 0) / 4294967296;
      };
      for (let k = 0; k < 16; k++) next();
      return { next, int: (n) => Math.floor(next() * n), range: (lo, hi) => lo + next() * (hi - lo), pick: (arr) => arr[Math.floor(next() * arr.length)] };
    }
  };

  /* ---------- Profile engine: the single source of identity ---------- */
  const GLYPHS = "ABCDEFGHJKLMNPRSTVWXYZ";
  const FRAMES = [["Circle", "50%"], ["Soft square", "28%"], ["Tile", "14%"]];
  const PATTERNS = ["None", "Lines", "Dots", "Grid"];
  const FONTS = [["Sans", "system-ui,sans-serif", 700], ["Serif", "Georgia,serif", 600], ["Mono", "ui-monospace,Menlo,monospace", 700]];
  const HUE_BANDS = [[345, 375], [255, 295], [208, 232]];
  const hsl = (h, s, l) => "hsl(" + Math.round(((h % 360) + 360) % 360) + "," + Math.round(s) + "%," + Math.round(l) + "%)";

  /* Layers run in order on one RNG stream; append new layers to extend without changing old output. */
  const LAYERS = [
    (r) => ({
      initials: GLYPHS[r.int(GLYPHS.length)] + GLYPHS[r.int(GLYPHS.length)],
      font: r.int(FONTS.length), frame: r.int(FRAMES.length), gradAngle: r.int(360),
      pattern: { type: r.int(PATTERNS.length), gap: 6 + r.int(6), angle: r.pick([0, 45, 90, 135]) }
    }),
    (r) => {
      const band = r.pick(HUE_BANDS), hue = Math.round(r.range(band[0], band[1])) % 360, s = r.range(35, 65);
      return { palette: { hue, bg1: hsl(hue, s, r.range(16, 28)), bg2: hsl(hue + r.pick([-40, 30, 60, 150]), s, r.range(30, 46)), accent: hsl(hue, s + 12, 60) } };
    },
    (r) => ({ shapes: Array.from({ length: 3 + r.int(3) }, () => ({ t: r.int(4), x: 10 + r.int(80), y: 10 + r.int(80), s: 14 + r.int(30), rot: r.int(180), o: +r.range(.15, .55).toFixed(2), c: r.int(3) })) })
  ];

  function generateProfile(id) {
    const r = Rng.create(id), profile = { id, label: "Profilith " + id.toString() };
    for (const layer of LAYERS) Object.assign(profile, layer(r));
    return profile;
  }

  /* ---------- Avatar renderer (SVG string; only numbers and fixed constants) ---------- */
  let svgSeq = 0;
  function shapeSVG(s, fills) {
    const f = fills[s.c], h = s.s / 2, base = ' fill="' + f + '" opacity="' + s.o + '"', tr = ' transform="rotate(' + s.rot + " " + s.x + " " + s.y + ')"';
    if (s.t === 0) return '<circle cx="' + s.x + '" cy="' + s.y + '" r="' + h + '"' + base + "/>";
    if (s.t === 1) return '<rect x="' + (s.x - h) + '" y="' + (s.y - h) + '" width="' + s.s + '" height="' + s.s + '"' + base + tr + "/>";
    if (s.t === 2) return '<polygon points="' + s.x + "," + (s.y - h) + " " + (s.x + h) + "," + (s.y + h) + " " + (s.x - h) + "," + (s.y + h) + '"' + base + tr + "/>";
    return '<circle cx="' + s.x + '" cy="' + s.y + '" r="' + h + '" fill="none" stroke="' + f + '" stroke-width="3" opacity="' + (s.o + .2) + '"/>';
  }
  function avatarSVG(p) {
    const n = svgSeq++, g = "g" + n, pt = "p" + n, q = p.palette, pat = p.pattern, f = FONTS[p.font];
    const line = '<path d="M0 0V' + pat.gap + '" stroke="#fff" stroke-opacity=".16" stroke-width="1.2"/>';
    const patDef = [ "", line, '<circle cx="1.5" cy="1.5" r="1.1" fill="#fff" fill-opacity=".2"/>', line + '<path d="M0 0H' + pat.gap + '" stroke="#fff" stroke-opacity=".12"/>' ][pat.type];
    return '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><defs><linearGradient id="' + g + '" gradientTransform="rotate(' + p.gradAngle + ' .5 .5)"><stop offset="0" stop-color="' + q.bg1 + '"/><stop offset="1" stop-color="' + q.bg2 + '"/></linearGradient>' +
      (patDef ? '<pattern id="' + pt + '" width="' + pat.gap + '" height="' + pat.gap + '" patternUnits="userSpaceOnUse" patternTransform="rotate(' + pat.angle + ')">' + patDef + "</pattern>" : "") +
      '</defs><rect width="100" height="100" fill="url(#' + g + ')"/>' + p.shapes.map((s) => shapeSVG(s, [q.accent, "#fff", q.bg2])).join("") +
      (patDef ? '<rect width="100" height="100" fill="url(#' + pt + ')"/>' : "") +
      '<text x="50" y="50" dy=".35em" text-anchor="middle" fill="#fff" fill-opacity=".94" font-family="' + f[1] + '" font-weight="' + f[2] + '" font-size="34" letter-spacing="1">' + p.initials + "</text></svg>";
  }

  /* ---------- URL routing ---------- */
  const urlFor = (id) => {
    const u = new URL(location.href);
    u.search = ""; u.hash = "";
    if (id != null) u.searchParams.set("profile", id.toString());
    return u.href;
  };
  function readUrl() {
    const v = new URLSearchParams(location.search).get("profile");
    if (v === null) return { id: null };
    const r = /^\d+$/.test(v) ? Ids.parse(v) : { error: "That link's profile number isn't valid." };
    if (r.error) history.replaceState({}, "", urlFor(null));
    return r;
  }

  /* ---------- Persistence (only the top-visible id, per session) ---------- */
  const Store = {
    save(id) { try { sessionStorage.setItem("profilith.top", id.toString()); } catch (e) { /* storage unavailable */ } },
    load() { try { const r = Ids.parse(sessionStorage.getItem("profilith.top")); return r.id || null; } catch (e) { return null; } }
  };

  /* ---------- Feed: bounded DOM window over an unbounded id sequence ---------- */
  const Feed = (() => {
    const el = $("#feed");
    let rows = [], cols = 1, queued = false;
    const measureCols = () => Math.max(1, Math.min(8, Math.floor((el.clientWidth + GAP) / (MIN_COL + GAP))));
    const cardHTML = (p) => '<button type="button" class="card" data-id="' + p.id + '" style="--a:' + p.palette.accent + '" aria-label="Open ' + p.label + '"><span class="av" style="border-radius:' + FRAMES[p.frame][1] + '">' + avatarSVG(p) + '</span><span class="tag">Profilith</span><span class="num">' + p.id + "</span></button>";
    function makeRow(first, count) {
      const node = document.createElement("div");
      let html = "";
      node.className = "row";
      for (let k = 0; k < count; k++) html += cardHTML(generateProfile(first + BigInt(k)));
      node.innerHTML = html;
      return { node, first, count };
    }
    function appendRow() {
      const last = rows[rows.length - 1], row = makeRow(last.first + BigInt(last.count), cols);
      el.appendChild(row.node); rows.push(row);
    }
    function prependRow() {
      const top = rows[0].first, start = top > BigInt(cols) ? top - BigInt(cols) : 1n, row = makeRow(start, Number(top - start));
      el.insertBefore(row.node, rows[0].node); rows.unshift(row);
      window.scrollTo(0, window.scrollY + ROW);
    }
    function update() {
      const vh = window.innerHeight, buf = vh * 1.5, rect = () => el.getBoundingClientRect();
      let guard = 80;
      while (guard-- > 0 && rect().bottom < vh + buf) appendRow();
      while (guard-- > 0 && rows[0].first > 1n && rect().top > -buf) prependRow();
      while (guard-- > 0 && rows.length > 2 && rect().top + ROW < -buf * 2) {
        rows.shift().node.remove();
        window.scrollTo(0, window.scrollY - ROW);
      }
      while (guard-- > 0 && rows.length > 2 && rect().bottom - ROW > vh + buf * 2) rows.pop().node.remove();
    }
    function reset(startId) {
      el.textContent = "";
      cols = measureCols();
      el.style.setProperty("--cols", cols);
      const row = makeRow(startId, cols);
      el.appendChild(row.node); rows = [row];
      window.scrollTo(0, 0);
      update();
    }
    function topId() {
      const row = rows.find((r) => r.node.getBoundingClientRect().bottom > 0) || rows[0];
      return row.first;
    }
    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (measureCols() !== cols) reset(topId()); else update();
      });
    }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    return { reset, topId, el };
  })();

  /* ---------- Toast + sharing ---------- */
  const toastEl = $("#toast"), dlg = $("#viewer");
  let toastTimer = 0;
  function toast(text) {
    (dlg.open ? dlg : document.body).appendChild(toastEl);
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const area = document.createElement("textarea");
      let ok = false;
      area.value = text; area.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(area); area.select();
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      area.remove();
      return ok;
    }
  }
  async function shareProfile(id) {
    const url = urlFor(id);
    if (navigator.share) {
      try { await navigator.share({ title: "Profilith " + id, url }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    toast((await copyText(url)) ? "Link copied" : "Copy this link: " + url);
  }

  /* ---------- Viewer ---------- */
  const Viewer = (() => {
    let current = null, pushed = false;
    function render(id) {
      const p = generateProfile(id), av = $("#vAvatar");
      current = id;
      av.innerHTML = avatarSVG(p);
      av.style.borderRadius = FRAMES[p.frame][1];
      dlg.style.setProperty("--a", p.palette.accent);
      $("#vTitle").textContent = p.label;
      $("#vTraits").innerHTML = "<dt>Frame</dt><dd>" + FRAMES[p.frame][0] + "</dd><dt>Pattern</dt><dd>" + PATTERNS[p.pattern.type] + "</dd><dt>Typeface</dt><dd>" + FONTS[p.font][0] + "</dd><dt>Accent hue</dt><dd>" + p.palette.hue + "°</dd>";
      $("#vPrev").disabled = id <= 1n;
    }
    function open(id, mode) {
      const wasOpen = dlg.open;
      if (!wasOpen) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
      render(id);
      if (mode === "none") { pushed = true; return; }
      if (mode === "push" && !wasOpen) { history.pushState({ open: true }, "", urlFor(id)); pushed = true; }
      else history.replaceState({ open: true }, "", urlFor(id));
      if (!wasOpen) $("#vNext").focus();
    }
    function hide() { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
    function close() {
      if (!dlg.open) return;
      hide();
      if (pushed) { pushed = false; history.back(); } else history.replaceState({}, "", urlFor(null));
    }
    const step = (delta) => { if (current !== null && current + delta >= 1n) open(current + delta, "replace"); };
    $("#vClose").addEventListener("click", close);
    $("#vNext").addEventListener("click", () => step(1n));
    $("#vPrev").addEventListener("click", () => step(-1n));
    $("#vShare").addEventListener("click", () => shareProfile(current));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") step(1n); else if (e.key === "ArrowLeft") step(-1n);
    });
    window.addEventListener("popstate", () => {
      const r = readUrl();
      if (r.id) open(r.id, "none");
      else if (dlg.open) { pushed = false; hide(); }
    });
    return { open };
  })();

  /* ---------- Search, random, feed clicks ---------- */
  const msg = $("#msg"), input = $("#q");
  const goTo = (id) => { msg.textContent = ""; Feed.reset(id); Viewer.open(id, "push"); };
  $("#search").addEventListener("submit", (e) => {
    e.preventDefault();
    const r = Ids.parse(input.value);
    if (r.error) { msg.textContent = r.error; input.focus(); return; }
    input.value = ""; input.blur(); goTo(r.id);
  });
  $("#random").addEventListener("click", () => goTo(Ids.random()));
  Feed.el.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) Viewer.open(BigInt(card.dataset.id), "push");
  });

  /* ---------- Boot ---------- */
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const initial = readUrl();
  if (initial.error) msg.textContent = initial.error;
  Feed.reset(initial.id || Store.load() || 1n);
  if (initial.id) Viewer.open(initial.id, "replace");
  const persist = () => Store.save(Feed.topId());
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") persist(); });
})();
