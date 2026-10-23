/* Math Lab — app logic. All math goes through MathEngine (engine.js):
   a hand-written tokenizer + Pratt parser. No eval(), no new Function(). */
(function () {
"use strict";
const M = window.MathEngine;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = M.fmt;
const APK_URL = "https://github.com/jaineil32624/CALCULATOR/releases/latest/download/MathLab.apk";
const REL_URL = "https://github.com/jaineil32624/CALCULATOR/releases/latest";
const COLORS = ["#4f8ef7", "#3ecf8e", "#f59e0b", "#a78bfa", "#ef4444", "#22c3c3"];

/* =========================================================
   1. Persistent state (localStorage, always wrapped)
========================================================= */
const KEY = "mathlab.v1";
const DEFAULTS = {
  theme: "dark", sound: false, haptic: true, deg: false, memory: 0,
  calcHist: [], recent: [], tabInputs: {}, lastTab: {}, mod: "calc",
  graph: { fns: [{ e: "sin(x)", on: true }, { e: "x^2/4 - 1", on: true }, { e: "", on: true }], view: { cx: 0, cy: 0, s: 60 }, a: 1, keypts: true },
  unit: { cat: "Length", from: "m", to: "ft" }, onboarded: false,
};
let ST;
try { ST = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (_) { ST = Object.assign({}, DEFAULTS); }
ST.graph = Object.assign({}, DEFAULTS.graph, ST.graph || {});
if (!Array.isArray(ST.graph.fns) || !ST.graph.fns.length) ST.graph.fns = DEFAULTS.graph.fns.map((f) => ({ ...f }));
let saveT = 0;
function persist() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch (_) {} }, 120); }

/* =========================================================
   2. Feedback: toast, sound, haptics, ripple
========================================================= */
let toastT = 0;
function toast(msg, icon = "check") {
  const t = $("toast"); t.querySelector("span").textContent = msg; t.querySelector("i").className = "ti ti-" + icon;
  t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1900);
}
let actx = null;
function blip(kind = "key") {
  if (ST.haptic && navigator.vibrate) { try { navigator.vibrate(kind === "eq" ? 14 : kind === "err" ? [10, 40, 10] : 7); } catch (_) {} }
  if (!ST.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    const f = { key: 660, op: 520, fn: 780, eq: 880, err: 180, clr: 330, ui: 600 }[kind] || 600;
    o.type = kind === "err" ? "square" : "sine"; o.frequency.setValueAtTime(f, t);
    if (kind === "eq") o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.08);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === "err" ? 0.05 : 0.09, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "eq" ? 0.16 : 0.07));
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.2);
  } catch (_) {}
}
function ripple(el, ev) {
  const r = el.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement("span");
  s.className = "ripple"; s.style.width = s.style.height = d + "px";
  const x = ev && ev.clientX ? ev.clientX - r.left : r.width / 2, y = ev && ev.clientY ? ev.clientY - r.top : r.height / 2;
  s.style.left = x - d / 2 + "px"; s.style.top = y - d / 2 + "px"; el.appendChild(s); setTimeout(() => s.remove(), 460);
}
async function copyText(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(`${label}: ${text.length > 40 ? text.slice(0, 40) + "…" : text}`); }
  catch (_) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(`${label}: ${text}`); } catch (e) { toast("Couldn't copy", "alert-triangle"); }
    ta.remove();
  }
  blip("ui");
}

/* =========================================================
   3. Helpers for inputs / results
========================================================= */
function num(id, opts = {}) { // read an input as a math expression (so "pi/2", "3/4", "2^10" all work)
  const el = $(id); if (!el) return NaN; const raw = el.value.trim();
  if (raw === "") { if (opts.optional) return null; el.classList.add("bad"); throw new Error(`${opts.name || "A field"} is empty`); }
  try { const v = M.evaluate(raw, { deg: false }); if (typeof v !== "number" || Number.isNaN(v)) throw new Error("not a number"); el.classList.remove("bad"); return v; }
  catch (e) { el.classList.add("bad"); throw new Error(`${opts.name || "Value"}: ${e.message}`); }
}
function setResult(id, text, cls = "success") {
  const el = $(id); if (!el) return; el.textContent = text; el.className = "result-box " + cls + " pop";
  if (cls !== "error") { const b = document.createElement("button"); b.className = "btn btn-sm copy-mini"; b.innerHTML = '<i class="ti ti-copy"></i>'; b.title = "Copy result"; b.onclick = () => copyText(text); el.appendChild(b); }
  setTimeout(() => el.classList.remove("pop"), 320);
  blip(cls === "error" ? "err" : "eq");
}
function showErr(id, msg) { setResult(id, "Error: " + msg, "error"); }
function showSteps(id, steps, numbered = true) { const el = $(id); if (el) el.innerHTML = steps.map((s, i) => `<div class="step"><span class="step-n">${numbered ? i + 1 : "→"}</span><span>${s}</span></div>`).join(""); }
function toggleEl(id) { const el = $(id); if (!el) return; el.classList.toggle("show"); const b = $(id + "-btn"); if (b) b.textContent = el.classList.contains("show") ? "Hide steps ▴" : "Show steps ▾"; }
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function cleanFx(s) { return String(s).trim().replace(/^(y|f\s*\(\s*x\s*\))\s*=\s*/i, ""); }
function snapInputs() { const o = {}; $("content-area").querySelectorAll("input[id],select[id]").forEach((el) => { if (!el.dataset.nosave) o[el.id] = el.value; }); return o; }
function applyInputs(o) {
  if (!o) return; const area = $("content-area");
  Object.keys(o).forEach((k) => { const el = area.querySelector("#" + CSS.escape(k)); if (el && el.tagName === "SELECT") { el.value = o[k]; el.dispatchEvent(new Event("change")); } });
  Object.keys(o).forEach((k) => { const el = area.querySelector("#" + CSS.escape(k)); if (el && el.tagName === "INPUT") el.value = o[k]; });
}

/* =========================================================
   4. Recent activity (sidebar) — serializable, click to re-run
========================================================= */
function addRecent(tag, tagCls, label, tab, extra) {
  const inputs = extra || snapInputs();
  ST.recent = ST.recent.filter((r) => !(r.label === label && r.tab === tab));
  ST.recent.unshift({ tag, tagCls, label, tab, inputs });
  if (ST.recent.length > 12) ST.recent.length = 12;
  persist(); renderRecent();
}
function renderRecent() {
  const el = $("history-list");
  el.innerHTML = ST.recent.length ? ST.recent.map((h, i) => `<div class="history-item" data-i="${i}" title="${esc(h.label)}"><span class="hist-tag ${esc(h.tagCls)}">${esc(h.tag)}</span>${esc(h.label)}</div>`).join("") : '<div class="history-empty">Your calculations show up here</div>';
}
$("history-list").addEventListener("click", (e) => {
  const it = e.target.closest(".history-item"); if (!it) return; const h = ST.recent[+it.dataset.i]; if (!h) return;
  openTab(h.tab, { inputs: h.inputs, run: true });
});
$("recent-clear").addEventListener("click", () => { ST.recent = []; persist(); renderRecent(); toast("Recent cleared", "trash"); });

/* =========================================================
   5. Modules / tabs registry
========================================================= */
const MODS = {
  calc: [{ id: "calc-sci", label: "Scientific" }, { id: "calc-const", label: "Constants" }],
  graph: [{ id: "graph-plot", label: "y = f(x)" }],
  calc2: [{ id: "calc2-deriv", label: "Derivative" }, { id: "calc2-integ", label: "Integral" }, { id: "calc2-limit", label: "Limit" }],
  alg: [{ id: "alg-linear", label: "Linear" }, { id: "alg-system", label: "System" }, { id: "alg-quad", label: "Quadratic" }, { id: "alg-poly", label: "Polynomial" }],
  geo: [{ id: "geo-2d", label: "2D shapes" }, { id: "geo-3d", label: "3D shapes" }],
  conv: [{ id: "conv-unit", label: "Units" }, { id: "conv-base", label: "Number bases" }],
};
const MOD_NAMES = { calc: "Calculator", graph: "Graph", calc2: "Calculus", alg: "Algebra", geo: "Geometry", conv: "Convert" };
const TAB_KW = { "calc-sci": "scientific calculator keypad memory history", "calc-const": "constants pi physics", "graph-plot": "graph plot function grapher trace zoom", "calc2-deriv": "derivative differentiate tangent slope", "calc2-integ": "integral area integrate", "calc2-limit": "limit approach infinity", "alg-linear": "linear equation solve", "alg-system": "system equations cramer matrix 3x3", "alg-quad": "quadratic roots parabola", "alg-poly": "polynomial expand simplify roots", "geo-2d": "area perimeter circle triangle", "geo-3d": "volume surface sphere cube", "conv-unit": "unit converter length mass temperature", "conv-base": "number base binary hex octal decimal bits" };
const TAB_ICON = { "calc-sci": "calculator", "calc-const": "atom", "graph-plot": "chart-dots", "calc2-deriv": "math-function", "calc2-integ": "math-integral-x", "calc2-limit": "arrows-join", "alg-linear": "variable", "alg-system": "table", "alg-quad": "chart-line", "alg-poly": "sum", "geo-2d": "circle-square", "geo-3d": "cube", "conv-unit": "ruler-measure", "conv-base": "binary" };
const modOf = (tab) => Object.keys(MODS).find((m) => MODS[m].some((t) => t.id === tab));
let currentModule = "calc", currentTab = "", cleanupTab = null;
const TABS = {}; // id -> {html, init, run}

function switchModule(mod, opts = {}) {
  if (!MODS[mod]) return;
  currentModule = mod; ST.mod = mod; persist();
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.mod === mod));
  $("tab-bar").innerHTML = MODS[mod].map((t) => `<button class="tab" role="tab" id="tab-${t.id}" data-tab="${t.id}">${t.label}</button>`).join("");
  const want = opts.tab || ST.lastTab[mod] || MODS[mod][0].id;
  switchTab(MODS[mod].some((t) => t.id === want) ? want : MODS[mod][0].id, opts);
}
function switchTab(id, opts = {}) {
  if (cleanupTab) { try { cleanupTab(); } catch (_) {} cleanupTab = null; }
  currentTab = id; ST.lastTab[currentModule] = id; persist();
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === id));
  const area = $("content-area"); const T = TABS[id];
  area.className = "content fade-in" + (T.flush ? " flush" : ""); area.scrollTop = 0;
  area.innerHTML = T.html();
  applyInputs(opts.inputs || ST.tabInputs[id]);
  cleanupTab = T.init ? T.init(opts) || null : null;
  if (opts.run && T.run) T.run();
  setTimeout(() => area.classList.remove("fade-in"), 260);
}
function openTab(tab, opts = {}) { const m = modOf(tab); if (m) switchModule(m, Object.assign({ tab }, opts)); }
document.querySelectorAll(".nav-item").forEach((n) => n.addEventListener("click", () => { blip("ui"); switchModule(n.dataset.mod); }));
$("tab-bar").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) { blip("ui"); switchTab(t.dataset.tab); } });
// remember what people typed in each tab (saved progress)
let inpT = 0;
$("content-area").addEventListener("input", (e) => {
  if (!e.target.matches("input[id],select[id]") || e.target.dataset.nosave) return;
  e.target.classList.remove("bad");
  clearTimeout(inpT); inpT = setTimeout(() => { ST.tabInputs[currentTab] = snapInputs(); persist(); }, 250);
});
$("content-area").addEventListener("change", (e) => { if (e.target.matches("select[id]") && !e.target.dataset.nosave) { ST.tabInputs[currentTab] = snapInputs(); persist(); } });
// Enter in any field runs the tab's main action
$("content-area").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input") && !e.target.closest(".no-enter") && TABS[currentTab].run && currentTab !== "calc-sci") { e.preventDefault(); TABS[currentTab].run(); }
});

/* =========================================================
   6. Mini plot helper (used by calculus / quadratic tabs)
========================================================= */
function robustRange(vals) {
  const v = vals.filter((y) => isFinite(y)).sort((a, b) => a - b); if (!v.length) return [-1, 1];
  let lo = v[Math.floor(v.length * 0.03)], hi = v[Math.ceil(v.length * 0.97) - 1];
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.12; return [lo - pad, hi + pad];
}
function miniPlot(canvas, cfg) {
  if (!canvas) return; canvas.style.display = "block";
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 400, H = canvas.clientHeight || 180;
  canvas.width = W * dpr; canvas.height = H * dpr; const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { xmin, xmax } = cfg, n = 400, xs = [], all = [];
  for (let i = 0; i <= n; i++) xs.push(xmin + (i * (xmax - xmin)) / n);
  const series = cfg.fns.map((s) => { const ys = xs.map((x) => s.f(x)); if (!s.noRange) all.push(...ys); return ys; });
  (cfg.points || []).forEach((p) => all.push(p.y));
  let [ymin, ymax] = cfg.yr || robustRange(all);
  if (cfg.includeZero) { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); }
  const X = (x) => ((x - xmin) / (xmax - xmin)) * W, Y = (y) => H - ((y - ymin) / (ymax - ymin)) * H;
  ctx.clearRect(0, 0, W, H);
  // grid
  const step = niceStep((xmax - xmin) / 8), ystep = niceStep((ymax - ymin) / 5);
  ctx.strokeStyle = cssVar("--grid"); ctx.lineWidth = 1; ctx.beginPath();
  for (let x = Math.ceil(xmin / step) * step; x <= xmax; x += step) { ctx.moveTo(X(x), 0); ctx.lineTo(X(x), H); }
  for (let y = Math.ceil(ymin / ystep) * ystep; y <= ymax; y += ystep) { ctx.moveTo(0, Y(y)); ctx.lineTo(W, Y(y)); }
  ctx.stroke();
  ctx.strokeStyle = cssVar("--axis"); ctx.beginPath();
  if (xmin <= 0 && xmax >= 0) { ctx.moveTo(X(0), 0); ctx.lineTo(X(0), H); }
  if (ymin <= 0 && ymax >= 0) { ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); }
  ctx.stroke();
  ctx.fillStyle = cssVar("--text3"); ctx.font = "10px ui-monospace,monospace";
  ctx.fillText(fmtNum(+xmin.toPrecision(3)), 4, H - 4); const xr = fmtNum(+xmax.toPrecision(3)); ctx.fillText(xr, W - ctx.measureText(xr).width - 4, H - 4);
  ctx.fillText(fmtNum(+ymax.toPrecision(3)), 4, 11);
  // shaded area
  if (cfg.shade) {
    const { f, a, b, color } = cfg.shade; ctx.fillStyle = color; ctx.beginPath();
    const lo = Math.max(Math.min(a, b), xmin), hi = Math.min(Math.max(a, b), xmax); const y0 = Y(Math.min(Math.max(0, ymin), ymax));
    ctx.moveTo(X(lo), y0); for (let i = 0; i <= 200; i++) { const x = lo + ((hi - lo) * i) / 200, y = f(x); ctx.lineTo(X(x), isFinite(y) ? Math.max(-5, Math.min(H + 5, Y(y))) : y0); }
    ctx.lineTo(X(hi), y0); ctx.closePath(); ctx.fill();
  }
  cfg.fns.forEach((s, k) => {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []); ctx.beginPath(); let pen = false, prev = null;
    series[k].forEach((y, i) => {
      if (!isFinite(y)) { pen = false; prev = null; return; }
      const py = Math.max(-H, Math.min(2 * H, Y(y)));
      if (pen && prev !== null && Math.abs(py - prev) > H * 1.2) pen = false;
      if (!pen) { ctx.moveTo(X(xs[i]), py); pen = true; } else ctx.lineTo(X(xs[i]), py); prev = py;
    });
    ctx.stroke(); ctx.setLineDash([]);
  });
  (cfg.points || []).forEach((p) => { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 4.5, 0, Math.PI * 2); ctx.fill(); if (p.label) { ctx.fillStyle = cssVar("--text2"); ctx.fillText(p.label, X(p.x) + 7, Y(p.y) - 7); } });
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }

/* =========================================================
   7. Scientific calculator
========================================================= */
let sciJust = false, sciLast = null, sciFrac = false, histNav = -1, second = false;
const KEYS = [
  [{ l: "MC", a: "mc", c: "key-mem", t: "Memory clear" }, { l: "MR", a: "mr", c: "key-mem", t: "Memory recall" }, { l: "M+", a: "m+", c: "key-mem", t: "Add result to memory" }, { l: "M−", a: "m-", c: "key-mem", t: "Subtract result from memory" }, { l: "MS", a: "ms", c: "key-mem", t: "Store result in memory" }],
  [{ l: "2nd", a: "2nd", c: "key-fn key-2nd", t: "Inverse / second functions" }, { l: "sin", i: "sin(", c: "key-fn", s: { l: "sin⁻¹", i: "asin(" } }, { l: "cos", i: "cos(", c: "key-fn", s: { l: "cos⁻¹", i: "acos(" } }, { l: "tan", i: "tan(", c: "key-fn", s: { l: "tan⁻¹", i: "atan(" } }, { l: "π", i: "π", c: "key-fn", s: { l: "τ", i: "τ" } }],
  [{ l: "x²", i: "^2", c: "key-fn", s: { l: "x³", i: "^3" } }, { l: "ln", i: "ln(", c: "key-fn", s: { l: "eˣ", i: "e^(" } }, { l: "log", i: "log(", c: "key-fn", s: { l: "10ˣ", i: "10^(" } }, { l: "√", i: "sqrt(", c: "key-fn", s: { l: "∛", i: "cbrt(" } }, { l: "e", i: "e", c: "key-fn", s: { l: "φ", i: "φ" } }],
  [{ l: "xʸ", i: "^", c: "key-op", s: { l: "mod", i: " mod " } }, { l: "(", i: "(", c: "key-op" }, { l: ")", i: ")", c: "key-op" }, { l: "n!", i: "!", c: "key-fn", s: { l: "nCr", i: "nCr(" } }, { l: "÷", i: "/", c: "key-op" }],
  [{ l: "7", i: "7" }, { l: "8", i: "8" }, { l: "9", i: "9" }, { l: "C", a: "clear", c: "key-clr", t: "Clear (Esc)" }, { l: "×", i: "*", c: "key-op" }],
  [{ l: "4", i: "4" }, { l: "5", i: "5" }, { l: "6", i: "6" }, { l: "⌫", a: "back", c: "key-clr", t: "Backspace" }, { l: "−", i: "-", c: "key-op" }],
  [{ l: "1", i: "1" }, { l: "2", i: "2" }, { l: "3", i: "3" }, { l: "Ans", i: "ans", c: "key-fn", t: "Last answer" }, { l: "+", i: "+", c: "key-op" }],
  [{ l: "±", a: "neg", c: "key-op", t: "Negate" }, { l: "0", i: "0" }, { l: ".", i: "." }, { l: "%", i: "%", c: "key-op", s: { l: ",", i: "," } }, { l: "=", a: "eq", c: "key-eq", t: "Evaluate (Enter)" }],
];
TABS["calc-sci"] = {
  html: () => `<div class="sci-wrap"><div>
<div class="panel-title"><i class="ti ti-calculator" aria-hidden="true"></i>Scientific calculator<span class="sub">Type freely — <kbd>Enter</kbd> = , <kbd>Esc</kbd> clear, <kbd>↑</kbd> history</span></div>
<div class="calc-display" id="calc-display">
  <div class="calc-top"><button class="pill ${ST.deg ? "on" : ""}" id="deg-pill" title="Degrees / radians (Alt+R)">${ST.deg ? "DEG" : "RAD"}</button><span class="pill mem" id="mem-pill" style="display:none"></span><span class="spacer"></span>
  <button class="btn btn-sm" id="graph-it" style="display:none" title="Plot this in the grapher"><i class="ti ti-chart-dots"></i>Graph it</button>
  <button class="btn btn-sm" id="frac-btn" title="Toggle fraction / decimal">a/b</button><button class="btn btn-sm" id="copy-res" title="Copy result (Alt+C)"><i class="ti ti-copy"></i>Copy</button></div>
  <input id="sci-input" class="calc-expr-in no-enter" data-nosave="1" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" aria-label="Expression" placeholder="e.g. sin(pi/2)*3^2 + 5!"/>
  <div class="calc-result-row"><div class="calc-result" id="sci-res" aria-live="polite">0</div></div>
</div>
<div class="keypad" id="keypad">${KEYS.flat().map((k, i) => `<button class="key ${k.c || ""}" data-k="${i}" ${k.t ? `title="${k.t}"` : ""}>${k.l}</button>`).join("")}</div>
<div class="hint">Functions: sin cos tan sec csc cot asin acos atan sinh cosh tanh sqrt cbrt abs ln log(x[,base]) exp floor ceil round gamma nCr nPr gcd lcm min max mod · constants π e φ τ · implicit multiplication <code>2π</code>, <code>3(4+1)</code></div>
</div>
<div class="hist-panel"><div class="card"><div class="card-title"><i class="ti ti-history"></i>History<span class="r"><button class="btn btn-sm" id="hist-clear" title="Clear history"><i class="ti ti-trash"></i></button></span></div><div class="hist-list" id="hist-list"></div></div></div>
</div>`,
  init: (opts) => {
    const inp = $("sci-input");
    const flatKeys = KEYS.flat();
    $("keypad").addEventListener("click", (e) => { const b = e.target.closest(".key"); if (!b) return; ripple(b, e); pressKey(flatKeys[+b.dataset.k]); });
    inp.addEventListener("input", () => { sciJust = false; histNav = -1; preview(); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); evalSci(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); clearSci(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (!ST.calcHist.length) return; e.preventDefault();
        histNav = Math.max(-1, Math.min(ST.calcHist.length - 1, histNav + (e.key === "ArrowUp" ? 1 : -1)));
        inp.value = histNav < 0 ? "" : ST.calcHist[histNav].e; preview();
      } else if (sciJust && e.key.length === 1 && /[+\-*/^%!×÷]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); inp.value = "ans"; sciJust = false; insert(e.key);
      } else if (sciJust && e.key.length === 1 && !e.ctrlKey && !e.metaKey) { inp.value = ""; sciJust = false; }
    });
    $("deg-pill").addEventListener("click", toggleDeg);
    $("copy-res").addEventListener("click", copyResult);
    $("frac-btn").addEventListener("click", () => { sciFrac = !sciFrac; showSciResult(); blip("ui"); });
    $("graph-it").addEventListener("click", () => graphExpr(inp.value));
    $("hist-clear").addEventListener("click", () => { ST.calcHist = []; persist(); renderCalcHist(); toast("History cleared", "trash"); });
    $("hist-list").addEventListener("click", (e) => {
      const row = e.target.closest(".hist-row"); if (!row) return; const h = ST.calcHist[+row.dataset.i];
      if (e.target.closest(".hr")) { insert(h.r.replace(/[∞]/g, "inf")); toast("Inserted " + h.r, "corner-down-left"); }
      else { inp.value = h.e; sciJust = false; preview(); inp.focus(); }
    });
    renderCalcHist(); updateMem();
    if (opts.expr) { inp.value = opts.expr; evalSci(); } else if (sciLast !== null) { showSciResult(); }
    if (matchMedia("(pointer:fine)").matches) inp.focus();
  },
  run: () => evalSci(),
};
function insert(text) {
  const inp = $("sci-input"); if (!inp) return;
  if (sciJust) { inp.value = /^[+\-*/^%!]|^ mod $/.test(text) ? "ans" : ""; sciJust = false; }
  const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
  const pos = s + text.length; inp.setSelectionRange(pos, pos);
  if (matchMedia("(pointer:fine)").matches) inp.focus();
  preview();
}
function backspace() {
  const inp = $("sci-input"); if (sciJust) { clearSci(); return; }
  let s = inp.selectionStart ?? inp.value.length; const e = inp.selectionEnd ?? s;
  if (s !== e) { inp.value = inp.value.slice(0, s) + inp.value.slice(e); inp.setSelectionRange(s, s); preview(); return; }
  const before = inp.value.slice(0, s); const m = /(asin|acos|atan|sinh|cosh|tanh|sin|cos|tan|sqrt|cbrt|log|ln|abs|exp|nCr|ans| mod )\(?$/.exec(before);
  const cut = m ? m[0].length : 1; inp.value = before.slice(0, -cut) + inp.value.slice(s); s = Math.max(0, s - cut); inp.setSelectionRange(s, s); preview();
}
function clearSci() { const inp = $("sci-input"); if (!inp) return; if (!inp.value) sciLast = null; inp.value = ""; sciJust = false; const r = $("sci-res"); r.className = "calc-result"; r.textContent = sciLast === null ? "0" : r.textContent; if (sciLast === null) r.textContent = "0"; $("graph-it").style.display = "none"; blip("clr"); }
function pressKey(k) {
  if (k.a) {
    blip(k.a === "eq" ? "eq" : k.a === "clear" || k.a === "back" ? "clr" : "fn");
    switch (k.a) {
      case "eq": return evalSci(true);
      case "clear": return clearSci();
      case "back": return backspace();
      case "2nd": second = !second; return renderKeys();
      case "neg": { const inp = $("sci-input"); let v = sciJust ? "ans" : inp.value.trim(); sciJust = false; const m = /^-\((.*)\)$/.exec(v); inp.value = m ? m[1] : v ? `-(${v})` : "-"; preview(); return; }
      case "mc": ST.memory = 0; break;
      case "mr": insert(fmtNum(ST.memory)); break;
      case "ms": case "m+": case "m-": {
        const v = currentValue(); if (v === null) { toast("Nothing to store yet", "info-circle"); return; }
        ST.memory = k.a === "ms" ? v : k.a === "m+" ? ST.memory + v : ST.memory - v; toast(`Memory = ${fmtNum(ST.memory)}`, "device-floppy"); break;
      }
    }
    persist(); updateMem(); return;
  }
  const key = second && k.s ? k.s : k;
  blip(k.c && k.c.includes("op") ? "op" : k.c && k.c.includes("fn") ? "fn" : "key");
  insert(key.i);
  if (second && k.s) { second = false; renderKeys(); }
}
function renderKeys() {
  const flat = KEYS.flat();
  document.querySelectorAll("#keypad .key").forEach((b) => { const k = flat[+b.dataset.k]; if (k.a === "2nd") b.classList.toggle("on", second); else if (k.s) b.textContent = second ? k.s.l : k.l; });
}
function currentValue() {
  const inp = $("sci-input"); if (inp && inp.value.trim() && !sciJust) { try { const v = M.evaluate(inp.value, envCalc()); if (isFinite(v)) return v; } catch (_) {} }
  return sciLast;
}
function updateMem() { const p = $("mem-pill"); if (!p) return; p.style.display = ST.memory ? "" : "none"; p.textContent = "M " + fmtNum(ST.memory); }
function envCalc() { return { deg: ST.deg, ans: sciLast || 0 }; }
function preview() {
  const inp = $("sci-input"), r = $("sci-res"); if (!inp || !r) return; const v = inp.value.trim();
  let hasX = false;
  try { hasX = v && M.hasVar(M.parse(v), "x"); } catch (_) {}
  $("graph-it").style.display = hasX ? "" : "none";
  if (!v) { r.className = "calc-result"; r.textContent = sciLast === null ? "0" : r.textContent; return; }
  try { const val = M.evaluate(v, envCalc()); r.className = "calc-result preview"; r.textContent = "= " + fmtNum(val); }
  catch (_) { r.className = "calc-result preview"; r.textContent = hasX ? "f(x) — tap Graph it" : ""; }
}
function showSciResult() {
  const r = $("sci-res"); if (!r || sciLast === null) return;
  const fr = sciFrac ? M.toFraction(sciLast) : null;
  r.className = "calc-result"; r.textContent = fr || fmtNum(sciLast);
}
function evalSci(fromKey) {
  const inp = $("sci-input"), r = $("sci-res"); let expr = inp.value.trim();
  if (!expr) { if (sciLast === null) r.textContent = "0"; return; }
  try {
    const ast = M.parse(expr);
    if (M.hasVar(ast, "x")) { graphExpr(expr); return; }
    const v = M.evaluate(ast, envCalc());
    if (typeof v !== "number" || Number.isNaN(v)) throw new Error("Result is undefined (NaN)");
    sciLast = v; sciJust = true; histNav = -1;
    showSciResult();
    inp.value = expr; inp.setSelectionRange(expr.length, expr.length);
    const d = $("calc-display"); d.classList.remove("flash"); void d.offsetWidth; d.classList.add("flash");
    const res = fmtNum(v);
    if (!ST.calcHist.length || ST.calcHist[0].e !== expr || ST.calcHist[0].r !== res) { ST.calcHist.unshift({ e: expr, r: res, deg: ST.deg }); if (ST.calcHist.length > 100) ST.calcHist.length = 100; }
    persist(); renderCalcHist();
    addRecent("calc", "tag-calc", `${expr.slice(0, 22)} = ${res}`, "calc-sci", { "sci-input": expr });
    if (!fromKey) blip("eq");
  } catch (e) {
    r.className = "calc-result error"; r.textContent = "Error: " + e.message; blip("err");
  }
}
function renderCalcHist() {
  const el = $("hist-list"); if (!el) return;
  el.innerHTML = ST.calcHist.length ? ST.calcHist.map((h, i) => `<div class="hist-row" data-i="${i}" title="Click to reuse the expression · click the answer to insert it"><div class="he">${esc(h.e)} =${h.deg ? " <span class='badge badge-info'>DEG</span>" : ""}</div><div class="hr">${esc(h.r)}</div></div>`).join("") : '<div class="hist-empty"><i class="ti ti-history" style="font-size:22px;display:block;margin-bottom:6px"></i>Results you calculate are saved here.<br>Click one to reuse it.</div>';
}
function toggleDeg() { ST.deg = !ST.deg; persist(); const p = $("deg-pill"); if (p) { p.textContent = ST.deg ? "DEG" : "RAD"; p.classList.toggle("on", ST.deg); preview(); } toast(ST.deg ? "Degrees mode" : "Radians mode", "angle"); }
function copyResult() {
  const r = $("sci-res"); let t = sciLast !== null ? (sciFrac && M.toFraction(sciLast)) || fmtNum(sciLast) : r ? r.textContent.replace(/^= /, "") : "";
  if (r && r.classList.contains("preview")) t = r.textContent.replace(/^= /, "");
  if (t) copyText(t);
}
function graphExpr(expr) {
  const f = cleanFx(expr); const fns = ST.graph.fns;
  if (!fns.some((x) => x.e === f)) { const empty = fns.findIndex((x) => !x.e.trim()); if (empty >= 0) fns[empty] = { e: f, on: true }; else if (fns.length < 6) fns.push({ e: f, on: true }); else fns[fns.length - 1] = { e: f, on: true }; }
  persist(); openTab("graph-plot"); toast("Plotted y = " + f, "chart-dots");
}

/* ---------- constants ---------- */
const CONSTS = [
  { name: "π (pi)", val: Math.PI, sym: "π" }, { name: "e (Euler's number)", val: Math.E, sym: "e" }, { name: "φ (golden ratio)", val: (1 + Math.sqrt(5)) / 2, sym: "φ" },
  { name: "τ (tau = 2π)", val: 2 * Math.PI, sym: "τ" }, { name: "√2", val: Math.SQRT2, sym: "√2" }, { name: "ln(2)", val: Math.LN2, sym: "ln2" },
  { name: "log₁₀(e)", val: Math.LOG10E, sym: "log₁₀e" }, { name: "γ (Euler–Mascheroni)", val: 0.5772156649015329, sym: "γ" },
  { name: "Speed of light (c)", val: 299792458, unit: "m/s", sym: "c" }, { name: "Standard gravity (g)", val: 9.80665, unit: "m/s²", sym: "g" },
  { name: "Gravitational constant (G)", val: 6.6743e-11, unit: "N·m²/kg²", sym: "G" }, { name: "Planck constant (h)", val: 6.62607015e-34, unit: "J·s", sym: "h" },
  { name: "Avogadro (Nₐ)", val: 6.02214076e23, unit: "1/mol", sym: "Nₐ" }, { name: "Boltzmann (k)", val: 1.380649e-23, unit: "J/K", sym: "k" },
  { name: "Elementary charge (e⁻)", val: 1.602176634e-19, unit: "C", sym: "qₑ" }, { name: "Electron mass (mₑ)", val: 9.1093837015e-31, unit: "kg", sym: "mₑ" },
  { name: "Gas constant (R)", val: 8.314462618, unit: "J/(mol·K)", sym: "R" }, { name: "Earth radius (mean)", val: 6371000, unit: "m", sym: "R⊕" },
];
TABS["calc-const"] = {
  html: () => `<div class="panel-title"><i class="ti ti-atom" aria-hidden="true"></i>Mathematical & physical constants<span class="sub">Click to copy · <i class="ti ti-corner-down-left"></i> sends it to the calculator</span></div>
<input id="const-q" data-nosave="1" placeholder="Filter constants…" style="margin-bottom:10px;max-width:360px"/>
<div id="const-list">${CONSTS.map((c, i) => `<div class="card const-card" data-i="${i}" data-n="${esc(c.name.toLowerCase())}"><div><div style="font-weight:500;font-size:13px">${c.name}</div><div class="cs">${c.unit ? c.unit : "dimensionless"}</div></div><div style="display:flex;align-items:center;gap:8px"><div class="cv">${fmtConst(c.val)}</div><button class="btn btn-sm send" title="Use in calculator"><i class="ti ti-corner-down-left"></i></button></div></div>`).join("")}</div>`,
  init: () => {
    $("const-list").addEventListener("click", (e) => {
      const card = e.target.closest(".const-card"); if (!card) return; const c = CONSTS[+card.dataset.i]; const v = String(c.val).replace("e+", "e");
      if (e.target.closest(".send")) { openTab("calc-sci"); setTimeout(() => insert(["π", "e", "φ", "τ"].includes(c.sym) ? c.sym : v), 0); }
      else copyText(v, c.sym);
    });
    $("const-q").addEventListener("input", (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll(".const-card").forEach((c) => (c.style.display = c.dataset.n.includes(q) ? "" : "none")); });
  },
};
function fmtConst(v) { return Math.abs(v) >= 1e6 || Math.abs(v) < 1e-3 ? v.toExponential(6).replace("e", " × 10^").replace("+", "") : v.toPrecision(10); }

/* =========================================================
   8. Grapher — y = f(x) with pan / zoom / pinch / trace
========================================================= */
TABS["graph-plot"] = {
  flush: true,
  html: () => `<div class="gr">
<div class="gr-side"><div class="scroll">
  <div class="card-title"><i class="ti ti-math-function"></i>Functions<span class="r"><button class="btn btn-sm" id="fn-add"><i class="ti ti-plus"></i>Add</button></span></div>
  <div id="fn-list"></div>
  <div id="a-wrap" style="display:none;margin:4px 0 10px"><label>Parameter <b class="mono">a</b> = <span id="a-val" class="mono"></span> <button class="btn btn-sm" id="a-play" style="margin-left:6px" title="Animate a"><i class="ti ti-player-play"></i></button></label><input type="range" id="a-range" data-nosave="1" min="-5" max="5" step="0.05" style="padding:0"></div>
  <div class="chips" style="margin:6px 0 12px">${["sin(x)", "x^3 - 3x", "1/x", "e^(-x^2)", "abs(x) - 2", "tan(x)", "sqrt(4 - x^2)", "a*sin(x)"].map((c) => `<span class="chip" data-fx="${c}">${c}</span>`).join("")}</div>
  <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="kp-toggle" data-nosave="1" style="width:auto"> Show roots, extrema & intersections</label>
  <div class="pts-list" id="pts-list" style="margin-top:6px"></div>
  <div class="hint">Drag to pan · scroll / pinch to zoom · hover or use <kbd>←</kbd><kbd>→</kbd> to trace, <kbd>↑</kbd><kbd>↓</kbd> to switch curve · <kbd>+</kbd>/<kbd>−</kbd> zoom · <kbd>0</kbd> reset</div>
</div></div>
<div class="gr-stage" id="gr-stage"><canvas id="gr-canvas" tabindex="0" aria-label="Graph of the functions. Use arrow keys to trace."></canvas>
  <div class="gr-ctrl"><button class="icon-btn" id="gz-in" title="Zoom in (+)"><i class="ti ti-zoom-in"></i></button><button class="icon-btn" id="gz-out" title="Zoom out (−)"><i class="ti ti-zoom-out"></i></button><button class="icon-btn" id="gz-home" title="Reset view (0)"><i class="ti ti-focus-centered"></i></button><button class="icon-btn" id="g-png" title="Save as PNG"><i class="ti ti-photo-down"></i></button></div>
  <div class="gr-tip" id="gr-tip"></div><div class="gr-info" id="gr-info"></div>
</div></div>`,
  init: () => initGrapher(),
};
function initGrapher() {
  const G = ST.graph, cv = $("gr-canvas"), stage = $("gr-stage"), ctx = cv.getContext("2d"), tip = $("gr-tip");
  let W = 0, H = 0, dpr = 1, compiled = [], trace = null, raf = 0, keyPts = [], animT = 0;
  const v = G.view;
  function compileAll() {
    compiled = G.fns.map((fn, i) => {
      const src = cleanFx(fn.e); if (!src) return null;
      try { const ast = M.parse(src); return { f: M.makeFn(ast, { vars: { a: G.a } }), ast, i, color: COLORS[i % COLORS.length], usesA: usesSym(ast, "a") }; }
      catch (e) { return { err: e.message, i }; }
    });
    const anyA = compiled.some((c) => c && c.usesA); $("a-wrap").style.display = anyA ? "" : "none";
    if (anyA) { $("a-range").value = G.a; $("a-val").textContent = (+G.a).toFixed(2); }
  }
  function usesSym(ast, n) { if (ast.type === "sym") return ast.name === n; if (ast.type === "num") return false; if (ast.type === "neg") return usesSym(ast.a, n); if (ast.type === "bin") return usesSym(ast.a, n) || usesSym(ast.b, n); return ast.args.some((x) => usesSym(x, n)); }
  function renderFnList() {
    $("fn-list").innerHTML = G.fns.map((fn, i) => `<div class="fn-row" data-i="${i}"><span class="fn-dot ${fn.on ? "" : "off"}" style="background:${COLORS[i % COLORS.length]}" title="Show / hide"></span><span class="lbl">y${sub(i + 1)}=</span><input class="fn-in no-enter" data-nosave="1" value="${esc(fn.e)}" placeholder="f(x)" spellcheck="false" autocomplete="off" autocapitalize="off"><button class="icon-btn fn-del" title="Remove"><i class="ti ti-x"></i></button></div>`).join("");
    markErrors(); $("fn-add").disabled = G.fns.length >= 6;
  }
  function markErrors() { document.querySelectorAll(".fn-row").forEach((r) => { const c = compiled[+r.dataset.i]; const inp = r.querySelector("input"); inp.classList.toggle("bad", !!(c && c.err)); inp.title = c && c.err ? c.err : ""; }); }
  const sub = (n) => String(n).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[d]);
  const toPx = (x, y) => [W / 2 + (x - v.cx) * v.s, H / 2 - (y - v.cy) * v.s];
  const fromPx = (px, py) => [v.cx + (px - W / 2) / v.s, v.cy - (py - H / 2) / v.s];
  function resize() { const r = stage.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); draw(); }
  function req() { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
  function draw() {
    if (!W || !H || !cv.isConnected) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = cssVar("--bg"); ctx.fillRect(0, 0, W, H);
    const [x0, y1] = fromPx(0, 0), [x1, y0] = fromPx(W, H);
    const step = niceStep(90 / v.s), minor = step / 5;
    ctx.lineWidth = 1;
    ctx.strokeStyle = cssVar("--grid"); ctx.globalAlpha = 0.45; ctx.beginPath();
    if (minor * v.s > 7) {
      for (let x = Math.ceil(x0 / minor) * minor; x <= x1; x += minor) { const p = Math.round(toPx(x, 0)[0]) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
      for (let y = Math.ceil(y0 / minor) * minor; y <= y1; y += minor) { const p = Math.round(toPx(0, y)[1]) + 0.5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
    }
    ctx.stroke(); ctx.globalAlpha = 1; ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const p = Math.round(toPx(x, 0)[0]) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const p = Math.round(toPx(0, y)[1]) + 0.5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
    ctx.stroke();
    // axes
    const [ox, oy] = toPx(0, 0); ctx.strokeStyle = cssVar("--axis"); ctx.lineWidth = 1.5; ctx.beginPath();
    if (ox >= 0 && ox <= W) { ctx.moveTo(ox, 0); ctx.lineTo(ox, H); } if (oy >= 0 && oy <= H) { ctx.moveTo(0, oy); ctx.lineTo(W, oy); } ctx.stroke();
    // labels
    ctx.fillStyle = cssVar("--text3"); ctx.font = "11px ui-monospace,SFMono-Regular,Menlo,monospace";
    const lx = Math.min(Math.max(oy + 14, 14), H - 6), ly = Math.min(Math.max(ox + 5, 5), W - 40);
    const lab = (n) => fmtNum(+n.toPrecision(10));
    ctx.textAlign = "center";
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { if (Math.abs(x) < step / 2) continue; ctx.fillText(lab(x), toPx(x, 0)[0], lx); }
    ctx.textAlign = "left";
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { if (Math.abs(y) < step / 2) continue; ctx.fillText(lab(y), ly, toPx(0, y)[1] + 4); }
    // curves
    compiled.forEach((c, i) => {
      if (!c || c.err || !G.fns[i].on) return;
      ctx.strokeStyle = c.color; ctx.lineWidth = trace && trace.k === i ? 3 : 2.2; ctx.lineJoin = "round"; ctx.beginPath();
      let pen = false, prev = null;
      for (let px = -1; px <= W + 1; px += 0.75) {
        const x = v.cx + (px - W / 2) / v.s, y = c.f(x);
        if (!isFinite(y)) { pen = false; prev = null; continue; }
        const py = H / 2 - (y - v.cy) * v.s; const cl = Math.max(-1e4, Math.min(1e4, py));
        if (pen && prev !== null && Math.abs(cl - prev) > H && (py < 0 || py > H || prev < 0 || prev > H)) { // asymptote jump
          const ym = c.f(x - 0.375 / v.s); const pm = H / 2 - (ym - v.cy) * v.s;
          if (!isFinite(ym) || Math.abs(pm - prev) > H / 2) pen = false;
        }
        if (!pen) { ctx.moveTo(px, cl); pen = true; } else ctx.lineTo(px, cl); prev = cl;
      }
      ctx.stroke();
    });
    // key points
    if (G.keypts) keyPts.forEach((p) => { const [px, py] = toPx(p.x, p.y); if (px < -5 || px > W + 5 || py < -5 || py > H + 5) return; ctx.fillStyle = cssVar("--bg"); ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill(); ctx.stroke(); });
    // trace
    if (trace) {
      const c = compiled[trace.k];
      if (c && !c.err && G.fns[trace.k].on) {
        const y = c.f(trace.x); const [px, py] = toPx(trace.x, y);
        ctx.strokeStyle = c.color; ctx.globalAlpha = 0.35; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        if (isFinite(y)) {
          ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(px, py, 5.5, 0, 7); ctx.fill(); ctx.strokeStyle = cssVar("--bg"); ctx.lineWidth = 2; ctx.stroke();
          const slope = (c.f(trace.x + 1e-5) - c.f(trace.x - 1e-5)) / 2e-5;
          tip.innerHTML = `<b style="color:${c.color}">y${sub(trace.k + 1)}</b> x = ${esc(fmtNum(+trace.x.toPrecision(8)))}<br>y = ${esc(fmtNum(+y.toPrecision(8)))}<br><span style="color:var(--text3)">slope ${esc(isFinite(slope) ? fmtNum(+slope.toPrecision(5)) : "—")}</span>`;
          tip.style.display = "block"; const tw = tip.offsetWidth, th = tip.offsetHeight;
          tip.style.left = Math.min(W - tw - 6, Math.max(6, px + 12)) + "px"; tip.style.top = Math.min(H - th - 6, Math.max(6, py - th - 12)) + "px";
        } else tip.style.display = "none";
      } else tip.style.display = "none";
    } else tip.style.display = "none";
    $("gr-info").textContent = `x ∈ [${lab(+x0.toPrecision(3))}, ${lab(+x1.toPrecision(3))}]  scale ${lab(+(1 / v.s * 100).toPrecision(3))}/100px`;
  }
  function findKeyPoints() {
    if (!$("pts-list")) return;
    keyPts = []; if (!G.keypts) { $("pts-list").innerHTML = ""; return; }
    const [x0] = fromPx(0, 0), [x1] = fromPx(W, 0), n = 600, dx = (x1 - x0) / n;
    const bisect = (g, a, b) => { let fa = g(a); for (let i = 0; i < 60; i++) { const m = (a + b) / 2, fm = g(m); if (fa * fm <= 0) b = m; else { a = m; fa = fm; } } return (a + b) / 2; };
    const live = compiled.filter((c, i) => c && !c.err && G.fns[i].on);
    live.forEach((c) => {
      const f = c.f, y0 = f(0); if (isFinite(y0) && x0 < 0 && x1 > 0) keyPts.push({ x: 0, y: y0, kind: "y-int", color: c.color, k: c.i });
      const d = (x) => (f(x + 1e-6) - f(x - 1e-6)) / 2e-6;
      for (let j = 0; j < n; j++) {
        const a = x0 + j * dx, b = a + dx, fa = f(a), fb = f(b);
        if (isFinite(fa) && isFinite(fb)) {
          if (fa === 0) keyPts.push({ x: a, y: 0, kind: "root", color: c.color, k: c.i });
          else if (fa * fb < 0) { let r = bisect(f, a, b); if (Math.abs(r) < Math.abs(dx) * 1e-6) r = 0; if (Math.abs(f(r)) < 1e-6 * Math.max(1, Math.abs(fa) + Math.abs(fb))) keyPts.push({ x: r, y: 0, kind: "root", color: c.color, k: c.i }); }
          const da = d(a), db = d(b);
          if (isFinite(da) && isFinite(db) && da * db < 0) { let r = bisect(d, a, b); if (Math.abs(r) < Math.abs(dx) * 1e-6) r = 0; const yr = f(r); if (isFinite(yr) && Math.abs(d(r)) < 1e-3 * (1 + Math.abs(da) + Math.abs(db))) keyPts.push({ x: r, y: yr, kind: da > 0 ? "max" : "min", color: c.color, k: c.i }); }
        }
      }
    });
    for (let p = 0; p < live.length; p++) for (let q = p + 1; q < live.length; q++) {
      const g = (x) => live[p].f(x) - live[q].f(x);
      for (let j = 0; j < n; j++) { const a = x0 + j * dx, b = a + dx, ga = g(a), gb = g(b); if (isFinite(ga) && isFinite(gb) && ga * gb < 0) { const r = bisect(g, a, b); if (Math.abs(g(r)) < 1e-6 * (1 + Math.abs(ga) + Math.abs(gb))) keyPts.push({ x: r, y: live[p].f(r), kind: `y${sub(live[p].i + 1)}∩y${sub(live[q].i + 1)}`, color: cssVar("--text"), k: live[p].i }); } }
    }
    keyPts = keyPts.slice(0, 40);
    $("pts-list").innerHTML = keyPts.length ? keyPts.slice(0, 24).map((p, i) => `<div data-i="${i}"><span style="color:${p.color}">●</span> ${esc(p.kind)} (${esc(fmtNum(+p.x.toPrecision(6)))}, ${esc(fmtNum(+p.y.toPrecision(6)))})</div>`).join("") : '<span style="color:var(--text3)">None in view</span>';
  }
  let kpT = 0; const kpLater = () => { clearTimeout(kpT); kpT = setTimeout(() => { findKeyPoints(); req(); }, 140); };
  const saveView = () => { persist(); kpLater(); };
  function zoomAt(f, px, py) { const [x, y] = fromPx(px, py); v.s = Math.max(0.5, Math.min(1e6, v.s * f)); v.cx = x - (px - W / 2) / v.s; v.cy = y + (py - H / 2) / v.s; req(); saveView(); }
  function setTraceFromPx(px, py) {
    const x = fromPx(px, py)[0]; let best = null, bd = Infinity;
    compiled.forEach((c, i) => { if (!c || c.err || !G.fns[i].on) return; const y = c.f(x); if (!isFinite(y)) return; const d = Math.abs(toPx(x, y)[1] - py); if (d < bd) { bd = d; best = i; } });
    trace = best === null ? null : { x, k: best }; req();
  }
  // pointer interaction: drag to pan, pinch to zoom, hover to trace
  const ptrs = new Map(); let drag = null, pinch = null, moved = false;
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); moved = false;
    if (ptrs.size === 1) drag = { x: e.offsetX, y: e.offsetY, cx: v.cx, cy: v.cy };
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: v.s }; drag = null; } });
  cv.addEventListener("pointermove", (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; zoomAt((pinch.s * d) / pinch.d / v.s, mx, my); return; }
    if (drag) { const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) { moved = true; cv.classList.add("dragging"); } v.cx = drag.cx - dx / v.s; v.cy = drag.cy + dy / v.s; if (e.pointerType !== "mouse") setTraceFromPx(e.offsetX, e.offsetY); else trace = null; req(); return; }
    if (e.pointerType === "mouse") setTraceFromPx(e.offsetX, e.offsetY);
  });
  const end = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) { if (drag && !moved) setTraceFromPx(e.offsetX, e.offsetY); drag = null; cv.classList.remove("dragging"); saveView(); } };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !drag) { trace = null; req(); } });
  cv.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.offsetX, e.offsetY); }, { passive: false });
  cv.addEventListener("dblclick", (e) => zoomAt(2, e.offsetX, e.offsetY));
  cv.addEventListener("keydown", (e) => {
    const live = compiled.map((c, i) => (c && !c.err && G.fns[i].on ? i : -1)).filter((i) => i >= 0); if (!live.length) return;
    if (!trace) trace = { x: v.cx, k: live[0] };
    const stepX = niceStep(90 / v.s) / 10;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); trace.x = Math.round((trace.x + (e.key === "ArrowRight" ? stepX : -stepX)) / stepX) * stepX; const px = toPx(trace.x, 0)[0]; if (px < 30 || px > W - 30) v.cx += (e.key === "ArrowRight" ? 1 : -1) * W / 3 / v.s; req(); blip("key"); }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const j = live.indexOf(trace.k); trace.k = live[(j + (e.key === "ArrowUp" ? 1 : live.length - 1)) % live.length]; req(); blip("key"); }
  });
  $("gz-in").onclick = () => { zoomAt(1.5, W / 2, H / 2); blip("ui"); };
  $("gz-out").onclick = () => { zoomAt(1 / 1.5, W / 2, H / 2); blip("ui"); };
  $("gz-home").onclick = () => { v.cx = 0; v.cy = 0; v.s = Math.max(20, Math.min(W, H) / 12); req(); saveView(); blip("ui"); };
  $("g-png").onclick = () => { cv.toBlob((b) => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "mathlab-graph.png"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast("Graph saved as PNG", "photo-down"); }); };
  $("fn-list").addEventListener("input", (e) => { const row = e.target.closest(".fn-row"); if (!row) return; G.fns[+row.dataset.i].e = e.target.value; compileAll(); markErrors(); req(); kpLater(); persist(); });
  $("fn-list").addEventListener("keydown", (e) => { if (e.key === "Enter") { const r = e.target.closest(".fn-row"); const nx = r && r.nextElementSibling; if (nx) nx.querySelector("input").focus(); else if (G.fns.length < 6) { $("fn-add").click(); } } });
  $("fn-list").addEventListener("click", (e) => {
    const row = e.target.closest(".fn-row"); if (!row) return; const i = +row.dataset.i;
    if (e.target.closest(".fn-dot")) { G.fns[i].on = !G.fns[i].on; blip("ui"); }
    else if (e.target.closest(".fn-del")) { G.fns.splice(i, 1); if (!G.fns.length) G.fns.push({ e: "", on: true }); trace = null; blip("clr"); }
    else return;
    compileAll(); renderFnList(); req(); kpLater(); persist();
  });
  $("fn-add").onclick = () => { if (G.fns.length >= 6) return; G.fns.push({ e: "", on: true }); compileAll(); renderFnList(); persist(); const ins = document.querySelectorAll(".fn-in"); ins[ins.length - 1].focus(); };
  document.querySelector(".gr-side .chips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return; const fx = c.dataset.fx;
    const empty = G.fns.findIndex((f) => !f.e.trim()); if (empty >= 0) G.fns[empty] = { e: fx, on: true }; else if (G.fns.length < 6) G.fns.push({ e: fx, on: true }); else G.fns[5] = { e: fx, on: true };
    compileAll(); renderFnList(); req(); kpLater(); persist(); blip("ui");
  });
  $("kp-toggle").checked = !!G.keypts;
  $("kp-toggle").onchange = (e) => { G.keypts = e.target.checked; persist(); findKeyPoints(); req(); };
  $("pts-list").addEventListener("click", (e) => { const d = e.target.closest("[data-i]"); if (!d) return; const p = keyPts[+d.dataset.i]; trace = { x: p.x, k: p.k }; v.cx = p.x; v.cy = p.y; req(); saveView(); });
  $("a-range").oninput = (e) => { G.a = +e.target.value; $("a-val").textContent = G.a.toFixed(2); compileAll(); req(); kpLater(); persist(); };
  $("a-play").onclick = () => {
    if (animT) { cancelAnimationFrame(animT); animT = 0; $("a-play").innerHTML = '<i class="ti ti-player-play"></i>'; return; }
    $("a-play").innerHTML = '<i class="ti ti-player-pause"></i>'; const t0 = performance.now(), a0 = Math.asin(Math.max(-1, Math.min(1, G.a / 5)));
    const tick = (t) => { G.a = +(5 * Math.sin(a0 + (t - t0) / 900)).toFixed(2); $("a-range").value = G.a; $("a-val").textContent = G.a.toFixed(2); compileAll(); draw(); animT = requestAnimationFrame(tick); };
    animT = requestAnimationFrame(tick);
  };
  compileAll(); renderFnList();
  const ro = new ResizeObserver(() => { resize(); kpLater(); }); ro.observe(stage);
  const onTheme = () => req(); document.addEventListener("themechange", onTheme);
  GRAPH_API = { zoom: (f) => zoomAt(f, W / 2, H / 2), home: () => $("gz-home").click() };
  return () => { ro.disconnect(); clearTimeout(kpT); cancelAnimationFrame(raf); if (animT) cancelAnimationFrame(animT); document.removeEventListener("themechange", onTheme); GRAPH_API = null; persist(); };
}
let GRAPH_API = null;

/* =========================================================
   9. Calculus
========================================================= */
const exampleChips = (target, list) => `<div class="chips" style="margin-top:2px">${list.map((x) => `<span class="chip" data-target="${target}" data-v="${esc(x)}">${esc(x)}</span>`).join("")}</div>`;
$("content-area").addEventListener("click", (e) => {
  const c = e.target.closest(".chip[data-target]"); if (!c) return; const el = $(c.dataset.target); if (!el) return;
  el.value = c.dataset.v; el.dispatchEvent(new Event("input", { bubbles: true })); blip("ui"); if (TABS[currentTab].run) TABS[currentTab].run();
});
TABS["calc2-deriv"] = {
  html: () => `<div class="panel-title"><i class="ti ti-math-function" aria-hidden="true"></i>Symbolic derivative</div>
<div class="card"><div class="card-title">Enter function f(x)</div>
<div class="row"><div class="inp-group"><label>f(x) =</label><input id="d-fx" placeholder="e.g. x^3 + 2*x^2 - 5*x + 1" spellcheck="false" autocomplete="off"/></div></div>
${exampleChips("d-fx", ["x^3 + 2x^2 - 5x + 1", "sin(x)^2", "x*e^x", "ln(x)/x", "sqrt(1 + x^2)", "tan(3x)", "x^x"])}
<div class="row" style="margin-top:10px"><div class="inp-group"><label>Order</label><select id="d-ord"><option value="1">f′(x) — first</option><option value="2">f″(x) — second</option><option value="3">f‴(x) — third</option></select></div>
<div class="inp-group"><label>Evaluate at x = (optional)</label><input id="d-pt" placeholder="e.g. 2 or pi/4"/></div>
<div style="align-self:flex-end;display:flex;gap:6px"><button class="btn btn-primary" id="d-go"><i class="ti ti-arrow-right" aria-hidden="true"></i>Differentiate</button><button class="btn" id="d-graph" title="Plot f and f′ in the grapher"><i class="ti ti-chart-dots"></i></button></div></div>
</div>
<div class="card"><div class="card-title">Result</div>
<div class="result-box" id="d-result" style="min-height:36px">—</div>
<button class="toggle-steps" id="d-steps-btn" style="display:none">Show steps ▾</button>
<div class="steps-box" id="d-steps"></div>
<canvas class="graph-canvas" id="d-graph-c" style="margin-top:12px;display:none"></canvas></div>`,
  init: () => { $("d-go").onclick = calcDeriv; $("d-steps-btn").onclick = () => toggleEl("d-steps"); $("d-graph").onclick = () => { const fx = cleanFx($("d-fx").value); if (!fx) return; try { const d = M.derivative(fx); graphPair(fx, d.str); } catch (e) { showErr("d-result", e.message); } }; },
  run: () => calcDeriv(),
};
function graphPair(a, b) { const G = ST.graph; G.fns = [{ e: a, on: true }, { e: b, on: true }]; persist(); openTab("graph-plot"); }
function calcDeriv() {
  const fx = cleanFx($("d-fx").value), ord = +$("d-ord").value; if (!fx) { showErr("d-result", "Enter f(x)"); return; }
  try {
    const ast = M.parse(fx); const f = M.makeFn(ast);
    const steps = [`Parse: f(x) = ${esc(M.toStr(ast))}`]; let out, dstr = null, df = null;
    try {
      const d = M.derivative(ast, ord); dstr = d.str; df = M.makeFn(d.ast);
      d.rules.forEach((r) => steps.push(`Apply ${esc(r)}`));
      d.chain.forEach((s, i) => steps.push(`${["f′", "f″", "f‴"][i]}(x) = ${esc(s)} <span style="color:var(--text3)">(simplified)</span>`));
      out = `${["f′", "f″", "f‴"][ord - 1]}(x) = ${dstr}`;
    } catch (e) {
      steps.push(`Symbolic rules don't cover this (${esc(e.message)}) — using numerical differentiation`);
      df = ord === 1 ? (x) => (f(x + 1e-5) - f(x - 1e-5)) / 2e-5 : ord === 2 ? (x) => (f(x + 1e-4) - 2 * f(x) + f(x - 1e-4)) / 1e-8 : (x) => (f(x + 2e-3) - 2 * f(x + 1e-3) + 2 * f(x - 1e-3) - f(x - 2e-3)) / (2e-9);
      out = "(computed numerically — see evaluation below)";
    }
    let pt = null; const pts = [];
    const raw = $("d-pt").value.trim();
    if (raw !== "") {
      pt = num("d-pt", { name: "x" }); const nv = df(pt), fv = f(pt);
      out += `\n\n${["f′", "f″", "f‴"][ord - 1]}(${raw}) = ${fmtNum(nv)}`;
      if (ord === 1 && isFinite(fv) && isFinite(nv)) { out += `\nTangent line: y = ${fmtNum(nv)}(x − ${fmtNum(pt)}) + ${fmtNum(fv)}`; pts.push({ x: pt, y: fv, color: COLORS[2], label: `(${fmtNum(+pt.toPrecision(4))}, ${fmtNum(+fv.toPrecision(4))})` }); }
      steps.push(`Evaluate at x = ${esc(raw)}: ${fmtNum(nv)}`);
    }
    setResult("d-result", out); showSteps("d-steps", steps); $("d-steps-btn").style.display = "block";
    const c = pt === null ? 0 : pt; const fns = [{ f, color: COLORS[0] }, { f: df, color: COLORS[1], dash: [6, 4], noRange: true }];
    if (pt !== null && ord === 1) { const m = df(pt), y0 = f(pt); if (isFinite(m) && isFinite(y0)) fns.push({ f: (x) => y0 + m * (x - pt), color: COLORS[2], width: 1.3, noRange: true }); }
    miniPlot($("d-graph-c"), { xmin: c - 5, xmax: c + 5, fns, points: pts });
    addRecent("∂", "tag-calc2", `d/dx [${fx.slice(0, 18)}]`, "calc2-deriv");
  } catch (e) { showErr("d-result", e.message); }
}
TABS["calc2-integ"] = {
  html: () => `<div class="panel-title"><i class="ti ti-math-integral-x" aria-hidden="true"></i>Definite integral (numeric)</div>
<div class="card"><div class="card-title">∫ₐᵇ f(x) dx</div>
<div class="row"><div class="inp-group"><label>f(x) =</label><input id="i-fx" placeholder="e.g. x^2 + sin(x)" spellcheck="false" autocomplete="off"/></div></div>
${exampleChips("i-fx", ["x^2 + sin(x)", "e^(-x^2)", "1/x", "sqrt(1 - x^2)", "x*cos(x)"])}
<div class="row" style="margin-top:10px"><div class="inp-group"><label>a (lower)</label><input id="i-a" value="0"/></div>
<div class="inp-group"><label>b (upper)</label><input id="i-b" value="1"/></div>
<div style="align-self:flex-end"><button class="btn btn-primary" id="i-go"><i class="ti ti-arrow-right" aria-hidden="true"></i>Integrate</button></div></div>
<div class="hint">Bounds accept expressions like <code>pi</code>, <code>2pi/3</code> or <code>e^2</code>.</div>
</div>
<div class="card"><div class="card-title">Result</div>
<div class="result-box" id="i-result">—</div>
<div class="steps-box show" id="i-steps" style="margin-top:8px"></div>
<canvas class="graph-canvas" id="i-graph" style="margin-top:12px;display:none"></canvas></div>`,
  init: () => { $("i-go").onclick = calcInteg; },
  run: () => calcInteg(),
};
function calcInteg() {
  const fx = cleanFx($("i-fx").value); if (!fx) { showErr("i-result", "Enter f(x)"); return; }
  try {
    const a = num("i-a", { name: "a" }), b = num("i-b", { name: "b" }); const f = M.makeFn(fx);
    if (!isFinite(a) || !isFinite(b)) throw new Error("Bounds must be finite");
    const ad = M.adaptive(f, a, b, 1e-11), simp = M.simpson(f, a, b, 10000);
    if (!isFinite(ad) && !isFinite(simp)) throw new Error("The integral diverges or f(x) is undefined on [a, b]");
    let bad = 0; for (let i = 0; i <= 200; i++) if (!isFinite(f(a + ((b - a) * i) / 200))) bad++;
    const result = isFinite(ad) ? ad : simp, agree = Math.abs(ad - simp) <= 1e-6 * Math.max(1, Math.abs(ad));
    const fr = M.toFraction(+result.toPrecision(12), 1000);
    setResult("i-result", `∫[${fmtNum(a)}, ${fmtNum(b)}] (${fx}) dx ≈ ${fmtNum(result)}${fr ? `  (≈ ${fr})` : ""}`, bad ? "error" : "success");
    let abs = 0; const h = (b - a) / 2000; for (let i = 0; i < 2000; i++) abs += Math.abs(f(a + (i + 0.5) * h)) * Math.abs(h);
    const steps = [`Method: adaptive Simpson's rule (tolerance 10⁻¹¹), cross-checked with composite Simpson n = 10,000`, `Interval: [${fmtNum(a)}, ${fmtNum(b)}], width ${fmtNum(b - a)}`, `Adaptive ≈ ${fmtNum(ad)} · Composite ≈ ${fmtNum(simp)} ${agree ? "✓ agree" : "⚠ differ — f may be singular"}`, `Average value of f on [a, b] ≈ ${fmtNum(result / (b - a || 1))}`, `Total (unsigned) area ∫|f| ≈ ${fmtNum(abs)}`];
    if (bad) steps.push(`⚠ f(x) is undefined at ${bad} sample point(s) — result may be unreliable`);
    showSteps("i-steps", steps, false);
    const pad = Math.abs(b - a) * 0.25 || 1;
    miniPlot($("i-graph"), { xmin: Math.min(a, b) - pad, xmax: Math.max(a, b) + pad, fns: [{ f, color: COLORS[0] }], shade: { f, a, b, color: "rgba(62,207,142,.25)" }, includeZero: true });
    addRecent("∫", "tag-calc2", `∫(${fx.slice(0, 12)}) [${fmtNum(a)},${fmtNum(b)}]`, "calc2-integ");
  } catch (e) { showErr("i-result", e.message); }
}
TABS["calc2-limit"] = {
  html: () => `<div class="panel-title"><i class="ti ti-arrows-join" aria-hidden="true"></i>Limit evaluator</div>
<div class="card"><div class="card-title">lim x→c f(x)</div>
<div class="row"><div class="inp-group"><label>f(x) =</label><input id="l-fx" placeholder="e.g. (x^2-1)/(x-1)" spellcheck="false" autocomplete="off"/></div></div>
${exampleChips("l-fx", ["(x^2-1)/(x-1)", "sin(x)/x", "(1+1/x)^x", "1/x", "abs(x)/x", "(e^x-1)/x"])}
<div class="row" style="margin-top:10px"><div class="inp-group"><label>c (approach — try inf)</label><input id="l-c" placeholder="e.g. 1, pi, inf" value="0"/></div>
<div class="inp-group"><label>Direction</label><select id="l-dir"><option value="both">Both sides</option><option value="left">Left (−)</option><option value="right">Right (+)</option></select></div>
<div style="align-self:flex-end"><button class="btn btn-primary" id="l-go">Evaluate</button></div></div>
</div>
<div class="card"><div class="card-title">Result</div>
<div class="result-box" id="l-result">—</div>
<div class="steps-box show" id="l-steps" style="margin-top:8px"></div></div>`,
  init: () => { $("l-go").onclick = calcLimit; },
  run: () => calcLimit(),
};
function calcLimit() {
  const fx = cleanFx($("l-fx").value), dir = $("l-dir").value; if (!fx) { showErr("l-result", "Enter f(x)"); return; }
  try {
    const f = M.makeFn(fx); const craw = $("l-c").value.trim() || "0";
    const c = M.evaluate(craw.replace(/^\+/, ""), {}); if (Number.isNaN(c)) throw new Error("Enter an approach value");
    const settle = (seq) => { // pick the value the sequence converges to
      const fin = seq.filter((p) => isFinite(p.y)); if (!fin.length) { const last = seq[seq.length - 1].y; return Number.isNaN(last) ? NaN : last; }
      const tail = fin.slice(-3).map((p) => p.y); const last = tail[tail.length - 1];
      if (seq.slice(-3).every((p) => Math.abs(p.y) > 1e8) && seq.slice(-3).every((p) => Math.sign(p.y) === Math.sign(last))) return last > 0 ? Infinity : -Infinity;
      const spread = Math.max(...tail) - Math.min(...tail); if (spread > 1e-3 * Math.max(1, Math.abs(last))) return NaN;
      const r = Math.round(last); if (Math.abs(last - r) < 1e-6) return r; return +last.toPrecision(9);
    };
    let L, rows = [], resultStr, ok = true, note = "";
    if (!isFinite(c)) {
      const s = c > 0 ? 1 : -1; const seq = [1, 2, 3, 4, 5, 6, 7].map((k) => ({ x: s * Math.pow(10, k), y: f(s * Math.pow(10, k)) }));
      rows = seq; L = settle(seq);
    } else {
      const hs = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7];
      const left = hs.map((h) => ({ x: c - h, y: f(c - h) })), right = hs.map((h) => ({ x: c + h, y: f(c + h) }));
      const Ll = settle(left), Lr = settle(right), direct = f(c);
      rows = dir === "left" ? left : dir === "right" ? right : left.slice(-4).concat(right.slice(-4));
      if (dir === "left") L = Ll; else if (dir === "right") L = Lr;
      else if (Object.is(Ll, Lr) || Math.abs(Ll - Lr) <= 1e-6 * Math.max(1, Math.abs(Ll))) L = Ll;
      else { ok = false; note = `L⁻ ≈ ${fmtNum(Ll)}, L⁺ ≈ ${fmtNum(Lr)}`; }
      if (isFinite(direct)) note = (note ? note + " · " : "") + `Direct substitution: f(${fmtNum(c)}) = ${fmtNum(direct)}`; else note = (note ? note + " · " : "") + "Direct substitution undefined (hole / singularity)";
    }
    if (ok && Number.isNaN(L)) { ok = false; note = "The values oscillate or don't settle"; }
    resultStr = ok ? fmtNum(L) : "does not exist";
    const fr = ok && isFinite(L) ? M.toFraction(L, 1000) : null;
    setResult("l-result", `lim x→${craw}${dir === "left" ? "⁻" : dir === "right" ? "⁺" : ""} (${fx}) = ${resultStr}${fr ? `  (= ${fr})` : ""}${!ok ? "\n" + note.split(" · ")[0] : ""}`, ok ? "success" : "error");
    $("l-steps").innerHTML = (note ? `<div class="step"><span class="step-n">→</span>${esc(note)}</div>` : "") +
      `<div class="step"><span class="step-n">→</span>Numerical approach:</div><table class="unit-table" style="margin-top:4px"><tbody>${rows.map((r) => `<tr><td class="mono">x = ${esc(fmtNum(+r.x.toPrecision(10)))}</td><td>${esc(fmtNum(r.y))}</td></tr>`).join("")}</tbody></table>`;
    addRecent("lim", "tag-calc2", `lim→${craw}(${fx.slice(0, 12)})`, "calc2-limit");
  } catch (e) { showErr("l-result", e.message); }
}

/* =========================================================
   10. Algebra
========================================================= */
TABS["alg-linear"] = {
  html: () => `<div class="panel-title"><i class="ti ti-variable" aria-hidden="true"></i>Linear equation solver</div>
<div class="card"><div class="card-title">ax + b = c</div>
<div class="row">
<div class="inp-group"><label>a</label><input id="lin-a" value="2"/></div>
<div class="inp-group"><label>b</label><input id="lin-b" value="3"/></div>
<div class="inp-group"><label>c</label><input id="lin-c" value="7"/></div>
<div style="align-self:flex-end"><button class="btn btn-primary" id="lin-go">Solve</button></div></div>
<div class="hint">Fractions and expressions work too: <code>3/4</code>, <code>sqrt(2)</code>.</div>
</div>
<div class="card"><div class="result-box" id="lin-result">—</div>
<button class="toggle-steps" id="lin-steps-btn" style="display:none">Show steps ▾</button>
<div class="steps-box" id="lin-steps"></div></div>`,
  init: () => { $("lin-go").onclick = solveLinear; $("lin-steps-btn").onclick = () => toggleEl("lin-steps"); },
  run: () => solveLinear(),
};
const sgn = (v) => (v < 0 ? `− ${fmtNum(-v)}` : `+ ${fmtNum(v)}`);
function solveLinear() {
  try {
    const a = num("lin-a", { name: "a" }), b = num("lin-b", { name: "b" }), c = num("lin-c", { name: "c" });
    const btn = $("lin-steps-btn");
    if (a === 0) { if (b === c) setResult("lin-result", "Infinite solutions (identity)", ""); else setResult("lin-result", "No solution (contradiction)", "error"); $("lin-steps").innerHTML = ""; btn.style.display = "none"; return; }
    const x = (c - b) / a, fr = M.toFraction(x);
    setResult("lin-result", `x = ${fmtNum(x)}${fr ? `  (= ${fr})` : ""}`);
    showSteps("lin-steps", [`Start: ${fmtNum(a)}x ${sgn(b)} = ${fmtNum(c)}`, `Subtract ${fmtNum(b)} from both sides: ${fmtNum(a)}x = ${fmtNum(c - b)}`, `Divide by ${fmtNum(a)}: x = ${fmtNum(x)}`, `Check: ${fmtNum(a)}·(${fmtNum(x)}) ${sgn(b)} = ${fmtNum(a * x + b)} ✓`]); btn.style.display = "block";
    addRecent("ax", "tag-alg", `${fmtNum(a)}x${sgn(b).replace(/ /g, "")}=${fmtNum(c)} → x=${fmtNum(x)}`, "alg-linear");
  } catch (e) { showErr("lin-result", e.message); }
}
TABS["alg-system"] = {
  html: () => {
    const cell = (id, v) => `<div><label>${id.replace(/^s-/, "").replace(/(\d)/, (d) => "₀₁₂₃"[d])}</label><input id="${id}" value="${v}"/></div>`;
    return `<div class="panel-title"><i class="ti ti-table" aria-hidden="true"></i>System of linear equations</div>
<div class="card"><div class="card-title">Size<span class="r"><select id="s-n" style="width:auto;padding:3px 8px"><option value="2">2 × 2</option><option value="3">3 × 3</option></select></span></div>
<div id="s-grid2"><div class="muted" style="margin-bottom:6px">a₁x + b₁y = c₁ &nbsp;|&nbsp; a₂x + b₂y = c₂</div>
<div class="grid3" style="margin-bottom:8px">${cell("s-a1", 2)}${cell("s-b1", 3)}${cell("s-c1", 12)}${cell("s-a2", 1)}${cell("s-b2", -1)}${cell("s-c2", 1)}</div></div>
<div id="s-grid3" style="display:none"><div class="muted" style="margin-bottom:6px">aᵢx + bᵢy + cᵢz = dᵢ</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px">${[[1, 1, 1, 6], [2, -1, 3, 9], [1, 2, -1, 2]].map((r, i) => ["a", "b", "c", "d"].map((L, j) => `<div><label>${L}${"₁₂₃"[i]}</label><input id="t-${L}${i + 1}" value="${r[j]}"/></div>`).join("")).join("")}</div></div>
<button class="btn btn-primary" id="s-go">Solve</button>
</div>
<div class="card"><div class="result-box" id="sys-result">—</div>
<div class="steps-box show" id="sys-steps" style="margin-top:8px"></div></div>`;
  },
  init: () => { $("s-go").onclick = solveSystem; const sw = () => { const n = $("s-n").value; $("s-grid2").style.display = n === "2" ? "" : "none"; $("s-grid3").style.display = n === "3" ? "" : "none"; }; $("s-n").onchange = sw; sw(); },
  run: () => solveSystem(),
};
function solveSystem() {
  try {
    const el = "sys-result";
    if ($("s-n").value === "3") {
      const A = [1, 2, 3].map((i) => ["a", "b", "c", "d"].map((L) => num(`t-${L}${i}`, { name: L + i })));
      const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det3(A.map((r) => r.slice(0, 3)));
      if (Math.abs(D) < 1e-12) { setResult(el, "No unique solution (det = 0)", "error"); showSteps("sys-steps", ["Determinant = 0 → the planes are parallel, coincident, or meet in a line"], false); return; }
      const col = (k) => det3(A.map((r) => r.slice(0, 3).map((v, j) => (j === k ? r[3] : v))));
      const [Dx, Dy, Dz] = [0, 1, 2].map(col), [x, y, z] = [Dx / D, Dy / D, Dz / D];
      setResult(el, `x = ${fmtNum(x)},  y = ${fmtNum(y)},  z = ${fmtNum(z)}`);
      showSteps("sys-steps", [`Cramer's rule: D = ${fmtNum(D)}`, `Dx = ${fmtNum(Dx)} → x = Dx/D = ${fmtNum(x)}`, `Dy = ${fmtNum(Dy)} → y = ${fmtNum(y)}`, `Dz = ${fmtNum(Dz)} → z = ${fmtNum(z)}`]);
      addRecent("sys", "tag-alg", `3×3: x=${fmtNum(x)}, y=${fmtNum(y)}, z=${fmtNum(z)}`, "alg-system");
      return;
    }
    const g = (id) => num(id, { name: id.slice(2) });
    const a1 = g("s-a1"), b1 = g("s-b1"), c1 = g("s-c1"), a2 = g("s-a2"), b2 = g("s-b2"), c2 = g("s-c2");
    const D = a1 * b2 - a2 * b1;
    if (D === 0) { setResult(el, "No unique solution (det = 0)", "error"); showSteps("sys-steps", ["Determinant = 0 → parallel or coincident lines"], false); return; }
    const x = (c1 * b2 - c2 * b1) / D, y = (a1 * c2 - a2 * c1) / D;
    setResult(el, `x = ${fmtNum(x)},  y = ${fmtNum(y)}`);
    showSteps("sys-steps", [`Cramer's rule: D = a₁b₂ − a₂b₁ = ${fmtNum(D)}`, `Dx = ${fmtNum(c1 * b2 - c2 * b1)} → x = ${fmtNum(x)}`, `Dy = ${fmtNum(a1 * c2 - a2 * c1)} → y = ${fmtNum(y)}`]);
    addRecent("sys", "tag-alg", `x=${fmtNum(x)}, y=${fmtNum(y)}`, "alg-system");
  } catch (e) { showErr("sys-result", e.message); }
}
TABS["alg-quad"] = {
  html: () => `<div class="panel-title"><i class="ti ti-chart-line" aria-hidden="true"></i>Quadratic equation solver</div>
<div class="card"><div class="card-title">ax² + bx + c = 0</div>
<div class="row">
<div class="inp-group"><label>a</label><input id="q-a" value="1"/></div>
<div class="inp-group"><label>b</label><input id="q-b" value="-5"/></div>
<div class="inp-group"><label>c</label><input id="q-c" value="6"/></div>
<div style="align-self:flex-end;display:flex;gap:6px"><button class="btn btn-primary" id="q-go">Solve</button><button class="btn" id="q-graph" title="Open in grapher"><i class="ti ti-chart-dots"></i></button></div></div>
</div>
<div class="card" id="q-res-card">
<div class="result-box" id="q-result">—</div>
<div id="q-disc" style="margin-top:8px;font-size:12px"></div>
<canvas class="graph-canvas" id="q-graph-c" style="margin-top:12px;display:none"></canvas>
</div>`,
  init: () => { $("q-go").onclick = solveQuad; $("q-graph").onclick = () => { try { const a = num("q-a"), b = num("q-b"), c = num("q-c"); graphExpr(`${fmtNum(a)}x^2 + ${fmtNum(b)}x + ${fmtNum(c)}`.replace(/\+ -/g, "- ")); } catch (e) { showErr("q-result", e.message); } }; },
  run: () => solveQuad(),
};
function solveQuad() {
  try {
    const a = num("q-a", { name: "a" }), b = num("q-b", { name: "b" }), c = num("q-c", { name: "c" });
    if (a === 0) throw new Error("a must not be 0 (that's a linear equation)");
    const D = b * b - 4 * a * c, disc = $("q-disc"); let roots, out;
    const vx = -b / (2 * a), vy = a * vx * vx + b * vx + c;
    if (D > 0) {
      const sq = Math.sqrt(D), x1 = (-b + sq) / (2 * a), x2 = (-b - sq) / (2 * a); roots = [x1, x2].sort((p, q) => p - q);
      out = `x₁ = ${fmtNum(roots[0])},  x₂ = ${fmtNum(roots[1])}\nFactored: ${fmtNum(a) === "1" ? "" : fmtNum(a)}(x ${sgn(-roots[0])})(x ${sgn(-roots[1])})`;
      disc.innerHTML = `<span class="disc-pos">Δ = ${esc(fmtNum(D))} &gt; 0 — two distinct real roots</span>`;
    } else if (D === 0) {
      roots = [vx]; out = `x = ${fmtNum(vx)} (double root)\nFactored: ${fmtNum(a) === "1" ? "" : fmtNum(a)}(x ${sgn(-vx)})²`;
      disc.innerHTML = `<span class="disc-zer">Δ = 0 — one repeated real root</span>`;
    } else {
      const re = vx, im = Math.sqrt(-D) / (2 * Math.abs(a)); roots = [];
      out = `x = ${fmtNum(re)} ± ${fmtNum(im)}i`;
      disc.innerHTML = `<span class="disc-neg">Δ = ${esc(fmtNum(D))} &lt; 0 — two complex conjugate roots</span>`;
    }
    out += `\nVertex: (${fmtNum(vx)}, ${fmtNum(vy)}) · axis x = ${fmtNum(vx)} · opens ${a > 0 ? "up" : "down"}`;
    setResult("q-result", out, roots.length ? "success" : "");
    const span = Math.max(3, roots.length === 2 ? Math.abs(roots[1] - roots[0]) * 0.9 : 3);
    const f = (x) => a * x * x + b * x + c;
    miniPlot($("q-graph-c"), { xmin: vx - span, xmax: vx + span, fns: [{ f, color: COLORS[0] }], points: roots.map((r) => ({ x: r, y: 0, color: COLORS[1] })).concat([{ x: vx, y: vy, color: COLORS[2], label: "vertex" }]), includeZero: true });
    addRecent("x²", "tag-alg", `${fmtNum(a)}x²${sgn(b).replace(/ /g, "")}x${sgn(c).replace(/ /g, "")}`, "alg-quad");
  } catch (e) { showErr("q-result", e.message); }
}
TABS["alg-poly"] = {
  html: () => `<div class="panel-title"><i class="ti ti-sum" aria-hidden="true"></i>Polynomial toolkit</div>
<div class="card"><div class="card-title">Enter a polynomial in x</div>
<div class="row"><div class="inp-group"><label>p(x) =</label><input id="poly-in" placeholder="e.g. 3*x^2 + 2*x - x^2 + 4*x - 7" spellcheck="false" autocomplete="off"/></div>
<div style="align-self:flex-end"><button class="btn btn-primary" id="poly-go">Simplify</button></div></div>
${exampleChips("poly-in", ["3x^2 + 2x - x^2 + 4x - 7", "(x+1)^3", "(x-1)(x-2)(x-3)", "x^4 - 1", "(2x - 3)^2 - 4"])}
<div class="row" style="margin-top:10px"><div class="inp-group" style="max-width:220px"><label>Evaluate p at x = (optional)</label><input id="poly-x" placeholder="e.g. 2"/></div></div>
</div>
<div class="card"><div class="card-title">Result</div>
<div class="result-box" id="poly-result">—</div>
<div class="steps-box show" id="poly-steps" style="margin-top:8px"></div></div>`,
  init: () => { $("poly-go").onclick = simplifyPoly; },
  run: () => simplifyPoly(),
};
function simplifyPoly() {
  const p = cleanFx($("poly-in").value); if (!p) { showErr("poly-result", "Enter polynomial"); return; }
  try {
    const co = M.toPoly(M.parse(p)), deg = co.length - 1, s = M.polyStr(co);
    let out = `p(x) = ${s}\nDegree ${deg}  ·  p′(x) = ${M.polyStr(M.polyDeriv(co))}`;
    const xr = $("poly-x").value.trim(); if (xr) { const x = num("poly-x", { name: "x" }); out += `\np(${xr}) = ${fmtNum(M.polyEval(co, x))}`; }
    const steps = [];
    for (let k = deg; k >= 0; k--) if (co[k]) steps.push(`x^${k} coefficient: ${fmtNum(co[k])}`);
    if (deg >= 1 && deg <= 12) {
      const rs = M.polyRoots(co); const real = rs.filter((r) => r.im === 0).map((r) => fmtNum(+r.re.toPrecision(10)));
      const cpx = rs.filter((r) => r.im > 0).map((r) => `${fmtNum(+r.re.toPrecision(8))} ± ${fmtNum(+r.im.toPrecision(8))}i`);
      out += `\nRoots: ${[...real, ...cpx].join(",  ") || "—"}`;
      steps.push(`Roots found numerically (Durand–Kerner): ${rs.length} root${rs.length === 1 ? "" : "s"} counting multiplicity`);
    }
    setResult("poly-result", out);
    showSteps("poly-steps", steps, false);
    addRecent("p(x)", "tag-alg", "Simplify: " + p.slice(0, 18), "alg-poly");
  } catch (e) { showErr("poly-result", e.message); }
}

/* =========================================================
   11. Geometry (live results + diagram)
========================================================= */
const geo2dInputs = {
  Circle: ["r|Radius"], Triangle: ["a|Side a", "b|Side b", "c|Side c"], Rectangle: ["w|Width", "h|Height"], Square: ["s|Side"],
  Parallelogram: ["b|Base", "s|Side", "h|Height"], Trapezoid: ["a|Base a (bottom)", "b|Base b (top)", "h|Height"], "Regular polygon": ["n|Number of sides", "s|Side"], "Regular hexagon": ["s|Side"], Ellipse: ["a|Semi-major (a)", "b|Semi-minor (b)"],
};
const geo3dInputs = {
  Sphere: ["r|Radius"], Hemisphere: ["r|Radius"], Cylinder: ["r|Radius", "h|Height"], Cone: ["r|Radius", "h|Height"], Cube: ["s|Side"],
  "Rectangular prism": ["l|Length", "w|Width", "h|Height"], "Triangular prism": ["b|Base", "ht|Base height", "l|Length"], "Square pyramid": ["b|Base side", "h|Height"], Torus: ["R|Major radius (R)", "r|Minor radius (r)"],
};
function geoTab(dim) {
  const shapes = Object.keys(dim === 2 ? geo2dInputs : geo3dInputs), p = dim === 2 ? "g2" : "g3";
  return {
    html: () => `<div class="panel-title"><i class="ti ti-${dim === 2 ? "circle-square" : "cube"}" aria-hidden="true"></i>${dim}D geometry<span class="sub">Results update as you type</span></div>
<div class="card"><div class="card-title">Shape</div>
<select id="${p}-shape">${shapes.map((s) => `<option>${s}</option>`).join("")}</select>
<div id="${p}-inputs" style="margin-top:10px"></div>
<button class="btn btn-primary" style="margin-top:8px" id="${p}-go">Calculate</button>
</div>
<div class="card"><div class="result-box" id="${p}-result">—</div>${dim === 2 ? '<canvas class="graph-canvas" id="g2-canvas" style="margin-top:12px;height:170px"></canvas>' : ""}</div>`,
    init: () => {
      const render = () => { const shape = $(`${p}-shape`).value; const fields = (dim === 2 ? geo2dInputs : geo3dInputs)[shape] || [];
        $(`${p}-inputs`).innerHTML = `<div class="grid2">${fields.map((f) => { const [id, label] = f.split("|"); return `<div><label>${label}</label><input id="${p}-${id}" value="${id === "n" ? 5 : id === "R" ? 8 : id === "a" && shape === "Triangle" ? 3 : id === "b" && shape === "Triangle" ? 4 : 5}"/></div>`; }).join("")}</div>`; };
      $(`${p}-shape`).addEventListener("change", () => { render(); calc(true); });
      $(`${p}-go`).onclick = () => calc(false);
      $(`${p}-inputs`).addEventListener("input", () => calc(true));
      render(); setTimeout(() => calc(true), 0);
    },
    run: () => calc(false),
  };
  function calc(live) { (dim === 2 ? calcGeo2d : calcGeo3d)(live); }
}
TABS["geo-2d"] = geoTab(2); TABS["geo-3d"] = geoTab(3);
function geoVal(p, id) { const v = num(`${p}-${id}`, { name: id }); if (!(v > 0)) { $(`${p}-${id}`).classList.add("bad"); throw new Error("Dimensions must be positive"); } return v; }
function calcGeo2d(live) {
  const shape = $("g2-shape").value, g = (id) => geoVal("g2", id), PI = Math.PI; let area, perim, extra = "", draw = null;
  try {
    if (shape === "Circle") { const r = g("r"); area = PI * r * r; perim = 2 * PI * r; extra = `Diameter = ${fmtNum(2 * r)}`; draw = { t: "circle", r }; }
    else if (shape === "Triangle") {
      const a = g("a"), b = g("b"), c = g("c"); if (a + b <= c || a + c <= b || b + c <= a) throw new Error("Those sides can't form a triangle (triangle inequality)");
      const s = (a + b + c) / 2; area = Math.sqrt(s * (s - a) * (s - b) * (s - c)); perim = a + b + c;
      const A = Math.acos((b * b + c * c - a * a) / (2 * b * c)) * 180 / PI, B = Math.acos((a * a + c * c - b * b) / (2 * a * c)) * 180 / PI, C = 180 - A - B;
      const kind = [A, B, C].some((x) => Math.abs(x - 90) < 1e-9) ? "right" : [A, B, C].some((x) => x > 90) ? "obtuse" : "acute";
      extra = `Semi-perimeter s = ${fmtNum(s)}\nAngles: A = ${fmtNum(+A.toFixed(4))}°, B = ${fmtNum(+B.toFixed(4))}°, C = ${fmtNum(+C.toFixed(4))}° (${kind}${a === b && b === c ? ", equilateral" : a === b || b === c || a === c ? ", isosceles" : ""})`; draw = { t: "tri", a, b, c };
    }
    else if (shape === "Rectangle") { const w = g("w"), h = g("h"); area = w * h; perim = 2 * (w + h); extra = `Diagonal = ${fmtNum(Math.hypot(w, h))}`; draw = { t: "rect", w, h }; }
    else if (shape === "Square") { const s = g("s"); area = s * s; perim = 4 * s; extra = `Diagonal = ${fmtNum(s * Math.SQRT2)}`; draw = { t: "rect", w: s, h: s }; }
    else if (shape === "Parallelogram") { const b = g("b"), s = g("s"), h = g("h"); if (h > s) throw new Error("Height can't exceed the slanted side"); area = b * h; perim = 2 * (b + s); draw = { t: "para", b, s, h }; }
    else if (shape === "Trapezoid") { const a = g("a"), b = g("b"), h = g("h"); area = ((a + b) * h) / 2; const leg = Math.hypot((a - b) / 2, h); perim = a + b + 2 * leg; extra = `(perimeter assumes an isosceles trapezoid, legs = ${fmtNum(leg)})`; draw = { t: "trap", a, b, h }; }
    else if (shape === "Regular polygon" || shape === "Regular hexagon") {
      const n = shape === "Regular hexagon" ? 6 : Math.round(g("n")), s = g("s"); if (n < 3 || n > 1000) throw new Error("Sides must be between 3 and 1000");
      area = (n * s * s) / (4 * Math.tan(PI / n)); perim = n * s; extra = `Apothem = ${fmtNum(s / (2 * Math.tan(PI / n)))} · Circumradius = ${fmtNum(s / (2 * Math.sin(PI / n)))}\nInterior angle = ${fmtNum(+((n - 2) * 180 / n).toFixed(6))}°`; draw = { t: "poly", n };
    }
    else if (shape === "Ellipse") { const a = g("a"), b = g("b"); area = PI * a * b; const hh = ((a - b) / (a + b)) ** 2; perim = PI * (a + b) * (1 + (3 * hh) / (10 + Math.sqrt(4 - 3 * hh))); extra = `Perimeter by Ramanujan's approximation · eccentricity = ${fmtNum(Math.sqrt(1 - Math.min(a, b) ** 2 / Math.max(a, b) ** 2))}`; draw = { t: "ell", a, b }; }
    setResult("g2-result", `Area = ${fmtNum(area)}\nPerimeter = ${fmtNum(perim)}${extra ? "\n" + extra : ""}`);
    drawShape(draw);
    if (!live) addRecent("2D", "tag-geo", `${shape}: A=${fmtNum(+area.toPrecision(6))}`, "geo-2d");
  } catch (e) { if (live) { const el = $("g2-result"); el.textContent = "Error: " + e.message; el.className = "result-box error"; } else showErr("g2-result", e.message); }
}
function drawShape(d) {
  const cv = $("g2-canvas"); if (!cv || !d) return; const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const acc = cssVar("--accent"); ctx.strokeStyle = acc; ctx.fillStyle = acc + "22"; ctx.lineWidth = 2; ctx.font = "11px ui-monospace,monospace";
  const cx = W / 2, cy = H / 2, box = Math.min(W, H) * 0.8; let pts = null;
  const fit = (w, h) => box / Math.max(w, h * (W > H ? 1 : 1));
  if (d.t === "circle") { ctx.beginPath(); ctx.arc(cx, cy, box / 2, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + box / 2, cy); ctx.stroke(); ctx.fillStyle = cssVar("--text2"); ctx.fillText("r", cx + box / 4, cy - 5); return; }
  if (d.t === "ell") { const k = Math.min((W * 0.8) / (2 * d.a), box / (2 * d.b)); ctx.beginPath(); ctx.ellipse(cx, cy, d.a * k, d.b * k, 0, 0, 7); ctx.fill(); ctx.stroke(); return; }
  if (d.t === "rect") { const k = Math.min((W * 0.8) / d.w, box / d.h); pts = [[-d.w / 2, -d.h / 2], [d.w / 2, -d.h / 2], [d.w / 2, d.h / 2], [-d.w / 2, d.h / 2]].map(([x, y]) => [cx + x * k, cy + y * k]); }
  if (d.t === "para") { const off = Math.sqrt(d.s * d.s - d.h * d.h); const tw = d.b + off; const k = Math.min((W * 0.8) / tw, box / d.h); pts = [[0, 0], [d.b, 0], [d.b + off, -d.h], [off, -d.h]].map(([x, y]) => [cx + (x - tw / 2) * k, cy + (y + d.h / 2) * k]); }
  if (d.t === "trap") { const tw = Math.max(d.a, d.b); const k = Math.min((W * 0.8) / tw, box / d.h); pts = [[-d.a / 2, 0], [d.a / 2, 0], [d.b / 2, -d.h], [-d.b / 2, -d.h]].map(([x, y]) => [cx + x * k, cy + (y + d.h / 2) * k]); }
  if (d.t === "tri") { const { a, b, c } = d; const Ax = 0, Bx = c, Cx = (b * b + c * c - a * a) / (2 * c), Cy = -Math.sqrt(Math.max(0, b * b - Cx * Cx)); const minx = Math.min(0, Cx), maxx = Math.max(c, Cx), hgt = -Cy; const k = Math.min((W * 0.8) / (maxx - minx), box / hgt); pts = [[Ax, 0], [Bx, 0], [Cx, Cy]].map(([x, y]) => [cx + (x - (minx + maxx) / 2) * k, cy + (y + hgt / 2) * k]); }
  if (d.t === "poly") { const n = Math.min(d.n, 200); pts = Array.from({ length: n }, (_, i) => [cx + (box / 2) * Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / n), cy + (box / 2) * Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / n)]); }
  if (pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = acc; pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }); }
  void fit;
}
function calcGeo3d(live) {
  const shape = $("g3-shape").value, g = (id) => geoVal("g3", id), PI = Math.PI; let vol, sa, extra = "";
  try {
    if (shape === "Sphere") { const r = g("r"); vol = (4 / 3) * PI * r ** 3; sa = 4 * PI * r ** 2; }
    else if (shape === "Hemisphere") { const r = g("r"); vol = (2 / 3) * PI * r ** 3; sa = 3 * PI * r ** 2; extra = "Surface includes the flat base"; }
    else if (shape === "Cylinder") { const r = g("r"), h = g("h"); vol = PI * r ** 2 * h; sa = 2 * PI * r * (r + h); extra = `Lateral area = ${fmtNum(2 * PI * r * h)}`; }
    else if (shape === "Cone") { const r = g("r"), h = g("h"); const sl = Math.sqrt(r ** 2 + h ** 2); vol = (PI * r ** 2 * h) / 3; sa = PI * r * (r + sl); extra = `Slant height = ${fmtNum(sl)}`; }
    else if (shape === "Cube") { const s = g("s"); vol = s ** 3; sa = 6 * s ** 2; extra = `Space diagonal = ${fmtNum(s * Math.sqrt(3))}`; }
    else if (shape === "Rectangular prism") { const l = g("l"), w = g("w"), h = g("h"); vol = l * w * h; sa = 2 * (l * w + l * h + w * h); extra = `Space diagonal = ${fmtNum(Math.sqrt(l * l + w * w + h * h))}`; }
    else if (shape === "Triangular prism") { const b = g("b"), ht = g("ht"), l = g("l"); vol = 0.5 * b * ht * l; sa = b * ht + l * (b + 2 * Math.sqrt((b / 2) ** 2 + ht ** 2)); extra = "(isosceles triangular cross-section)"; }
    else if (shape === "Square pyramid") { const b = g("b"), h = g("h"); const sl = Math.sqrt(h * h + (b / 2) ** 2); vol = (b * b * h) / 3; sa = b * b + 2 * b * sl; extra = `Slant height = ${fmtNum(sl)}`; }
    else if (shape === "Torus") { const R = g("R"), r = g("r"); if (r > R) throw new Error("Minor radius should be ≤ major radius"); vol = 2 * PI * PI * R * r * r; sa = 4 * PI * PI * R * r; }
    setResult("g3-result", `Volume = ${fmtNum(vol)}\nSurface area = ${fmtNum(sa)}${extra ? "\n" + extra : ""}`);
    if (!live) addRecent("3D", "tag-geo", `${shape}: V=${fmtNum(+vol.toPrecision(6))}`, "geo-3d");
  } catch (e) { if (live) { const el = $("g3-result"); el.textContent = "Error: " + e.message; el.className = "result-box error"; } else showErr("g3-result", e.message); }
}

/* =========================================================
   12. Converters — units & number bases
========================================================= */
const UNITS = {
  Length: { m: ["Meter", 1], km: ["Kilometer", 1000], cm: ["Centimeter", 0.01], mm: ["Millimeter", 0.001], µm: ["Micrometer", 1e-6], nm: ["Nanometer", 1e-9], mi: ["Mile", 1609.344], yd: ["Yard", 0.9144], ft: ["Foot", 0.3048], in: ["Inch", 0.0254], nmi: ["Nautical mile", 1852], au: ["Astronomical unit", 149597870700], ly: ["Light-year", 9.4607304725808e15] },
  Mass: { kg: ["Kilogram", 1], g: ["Gram", 0.001], mg: ["Milligram", 1e-6], t: ["Metric ton", 1000], lb: ["Pound", 0.45359237], oz: ["Ounce", 0.028349523125], st: ["Stone", 6.35029318], ct: ["Carat", 0.0002] },
  Temperature: { C: ["Celsius", null], F: ["Fahrenheit", null], K: ["Kelvin", null], R: ["Rankine", null] },
  Area: { "m²": ["Square meter", 1], "km²": ["Square kilometer", 1e6], "cm²": ["Square centimeter", 1e-4], ha: ["Hectare", 1e4], ac: ["Acre", 4046.8564224], "ft²": ["Square foot", 0.09290304], "in²": ["Square inch", 0.00064516], "mi²": ["Square mile", 2589988.110336] },
  Volume: { L: ["Liter", 1], mL: ["Milliliter", 0.001], "m³": ["Cubic meter", 1000], gal: ["US gallon", 3.785411784], qt: ["US quart", 0.946352946], pt: ["US pint", 0.473176473], cup: ["US cup", 0.2365882365], floz: ["US fluid ounce", 0.0295735295625], tbsp: ["Tablespoon", 0.01478676478125], tsp: ["Teaspoon", 0.00492892159375], "ft³": ["Cubic foot", 28.316846592] },
  Speed: { "m/s": ["Meter / second", 1], "km/h": ["Kilometer / hour", 1 / 3.6], mph: ["Mile / hour", 0.44704], kn: ["Knot", 0.514444444], "ft/s": ["Foot / second", 0.3048], c: ["Speed of light", 299792458] },
  Time: { s: ["Second", 1], ms: ["Millisecond", 0.001], min: ["Minute", 60], h: ["Hour", 3600], d: ["Day", 86400], wk: ["Week", 604800], yr: ["Year (365.25 d)", 31557600] },
  Data: { B: ["Byte", 1], bit: ["Bit", 0.125], KB: ["Kilobyte (1000)", 1e3], MB: ["Megabyte", 1e6], GB: ["Gigabyte", 1e9], TB: ["Terabyte", 1e12], KiB: ["Kibibyte (1024)", 1024], MiB: ["Mebibyte", 1048576], GiB: ["Gibibyte", 1073741824] },
  Energy: { J: ["Joule", 1], kJ: ["Kilojoule", 1000], cal: ["Calorie", 4.184], kcal: ["Kilocalorie", 4184], Wh: ["Watt-hour", 3600], kWh: ["Kilowatt-hour", 3.6e6], eV: ["Electronvolt", 1.602176634e-19], BTU: ["BTU", 1055.05585262] },
  Pressure: { Pa: ["Pascal", 1], kPa: ["Kilopascal", 1000], bar: ["Bar", 1e5], atm: ["Atmosphere", 101325], psi: ["PSI", 6894.757293168], mmHg: ["mmHg (torr)", 133.322387415] },
  Angle: { deg: ["Degree", Math.PI / 180], rad: ["Radian", 1], grad: ["Gradian", Math.PI / 200], turn: ["Turn", 2 * Math.PI], arcmin: ["Arcminute", Math.PI / 10800], arcsec: ["Arcsecond", Math.PI / 648000] },
};
const toK = { C: (v) => v + 273.15, F: (v) => ((v - 32) * 5) / 9 + 273.15, K: (v) => v, R: (v) => (v * 5) / 9 };
const fromK = { C: (k) => k - 273.15, F: (k) => ((k - 273.15) * 9) / 5 + 32, K: (k) => k, R: (k) => (k * 9) / 5 };
function convert(cat, v, from, to) { if (cat === "Temperature") return fromK[to](toK[from](v)); return (v * UNITS[cat][from][1]) / UNITS[cat][to][1]; }
TABS["conv-unit"] = {
  html: () => `<div class="panel-title"><i class="ti ti-ruler-measure" aria-hidden="true"></i>Unit converter</div>
<div class="card"><div class="card-title">Category</div>
<div class="chips" id="u-cats">${Object.keys(UNITS).map((c) => `<span class="chip" data-c="${c}" style="font-family:inherit">${c}</span>`).join("")}</div>
<div class="sep"></div>
<div class="conv-row"><div><label>From</label><input id="u-val" data-nosave="1" value="1" inputmode="decimal"/><select id="u-from" data-nosave="1" style="margin-top:6px"></select></div>
<button class="btn" id="u-swap" title="Swap units" style="margin-bottom:2px"><i class="ti ti-arrows-exchange"></i></button>
<div><label>To</label><div class="result-box" id="u-out" style="min-height:34px;padding:6px 10px;font-size:15px">—</div><select id="u-to" data-nosave="1" style="margin-top:6px"></select></div></div>
</div>
<div class="card"><div class="card-title">All <span id="u-catname"></span> units<span class="r muted">click to copy</span></div><table class="unit-table" id="u-table"></table></div>`,
  init: () => {
    const U = ST.unit; if (!UNITS[U.cat]) U.cat = "Length";
    const fill = () => {
      const units = UNITS[U.cat], opts = Object.keys(units).map((k) => `<option value="${esc(k)}">${esc(units[k][0])} (${esc(k)})</option>`).join("");
      $("u-from").innerHTML = opts; $("u-to").innerHTML = opts; if (!units[U.from]) U.from = Object.keys(units)[0]; if (!units[U.to]) U.to = Object.keys(units)[1];
      $("u-from").value = U.from; $("u-to").value = U.to; $("u-catname").textContent = U.cat.toLowerCase();
      document.querySelectorAll("#u-cats .chip").forEach((c) => { const on = c.dataset.c === U.cat; c.style.color = on ? "var(--accent)" : ""; c.style.borderColor = on ? "var(--accent)" : ""; c.style.background = on ? "var(--accent-dim)" : ""; });
      update();
    };
    const update = () => {
      let v; try { v = M.evaluate($("u-val").value || "0", {}); $("u-val").classList.remove("bad"); } catch (e) { $("u-val").classList.add("bad"); $("u-out").textContent = "—"; return; }
      const r = convert(U.cat, v, U.from, U.to); $("u-out").textContent = `${fmtNum(+r.toPrecision(10))} ${U.to}`;
      const units = UNITS[U.cat];
      $("u-table").innerHTML = Object.keys(units).map((k) => `<tr data-v="${esc(fmtNum(+convert(U.cat, v, U.from, k).toPrecision(10)))}"><td>${esc(units[k][0])} <span class="muted">${esc(k)}</span></td><td>${esc(fmtNum(+convert(U.cat, v, U.from, k).toPrecision(10)))}</td></tr>`).join("");
      persist();
    };
    $("u-cats").onclick = (e) => { const c = e.target.closest(".chip"); if (!c) return; U.cat = c.dataset.c; U.from = U.to = ""; const k = Object.keys(UNITS[U.cat]); U.from = k[0]; U.to = k[1]; fill(); blip("ui"); };
    $("u-val").oninput = update; $("u-from").onchange = (e) => { U.from = e.target.value; update(); }; $("u-to").onchange = (e) => { U.to = e.target.value; update(); };
    $("u-swap").onclick = () => { [U.from, U.to] = [U.to, U.from]; $("u-from").value = U.from; $("u-to").value = U.to; update(); blip("ui"); };
    $("u-out").onclick = () => copyText($("u-out").textContent);
    $("u-table").onclick = (e) => { const tr = e.target.closest("tr"); if (tr) copyText(tr.dataset.v); };
    fill();
  },
};
TABS["conv-base"] = {
  html: () => `<div class="panel-title"><i class="ti ti-binary" aria-hidden="true"></i>Number base converter</div>
<div class="card"><div class="card-title">Input</div>
<div class="row"><div class="inp-group" style="flex:3"><input id="b-in" value="2026" class="mono no-enter" spellcheck="false" autocomplete="off" autocapitalize="off"/></div>
<div class="inp-group" style="flex:1;min-width:120px"><select id="b-base"><option value="10">Decimal (10)</option><option value="16">Hex (16)</option><option value="2">Binary (2)</option><option value="8">Octal (8)</option></select></div></div>
<div class="base-grid" id="b-out"></div>
<div class="card-title" style="margin-top:14px">Bits — tap to flip<span class="r muted" id="b-info"></span></div>
<div class="bits" id="b-bits"></div>
</div>`,
  init: () => {
    const parseBig = (s, base) => {
      s = s.trim().toLowerCase().replace(/[_\s]/g, ""); let neg = false; if (s.startsWith("-")) { neg = true; s = s.slice(1); }
      s = s.replace(/^0x/, base === 16 ? "" : "0x").replace(/^0b/, base === 2 ? "" : "0b").replace(/^0o/, base === 8 ? "" : "0o");
      if (!s) throw new Error("Empty"); const digits = "0123456789abcdef".slice(0, base);
      let v = 0n; for (const ch of s) { const d = digits.indexOf(ch); if (d < 0) throw new Error(`"${ch}" isn't a base-${base} digit`); v = v * BigInt(base) + BigInt(d); }
      return neg ? -v : v;
    };
    const group = (s, n) => s.replace(new RegExp(`\\B(?=(.{${n}})+$)`, "g"), " ");
    let cur = 0n;
    const show = () => {
      const neg = cur < 0n, a = neg ? -cur : cur, sg = neg ? "-" : "";
      const rows = [["DEC", sg + a.toString(10).replace(/\B(?=(\d{3})+$)/g, ","), sg + a.toString(10)], ["HEX", sg + group(a.toString(16).toUpperCase(), 4), sg + a.toString(16).toUpperCase()], ["OCT", sg + a.toString(8), sg + a.toString(8)], ["BIN", sg + group(a.toString(2), 4), sg + a.toString(2)]];
      $("b-out").innerHTML = rows.map(([l, v, raw]) => `<span class="bl">${l}</span><span class="bv">${esc(v)}</span><button class="btn btn-sm" data-copy="${esc(raw)}" title="Copy"><i class="ti ti-copy"></i></button>`).join("");
      const bits = a <= 0xffffn ? 16 : 32; const u = neg ? (1n << BigInt(bits)) + cur : cur;
      const fits = a < (1n << 32n);
      $("b-bits").innerHTML = fits ? Array.from({ length: bits }, (_, i) => { const b = bits - 1 - i; const on = (u >> BigInt(b)) & 1n; return `<span class="bit ${on ? "on" : ""}" data-b="${b}" title="bit ${b} = ${2 ** b}">${on}</span>`; }).join("") : '<span class="muted" style="grid-column:1/-1">Too large for the bit view (over 32 bits)</span>';
      const ch = a >= 32n && a < 0x110000n && !neg ? String.fromCodePoint(Number(a)) : null;
      $("b-info").textContent = `${a.toString(2).length} bit${a === 1n ? "" : "s"}${neg ? " · two's complement" : ""}${ch ? ` · char “${ch}”` : ""}`;
    };
    const update = () => { try { cur = parseBig($("b-in").value, +$("b-base").value); $("b-in").classList.remove("bad"); show(); } catch (e) { $("b-in").classList.add("bad"); $("b-out").innerHTML = `<span class="bl"></span><span class="bv" style="color:var(--err)">${esc(e.message)}</span><span></span>`; } };
    $("b-in").addEventListener("input", update);
    $("b-base").addEventListener("change", () => { const base = +$("b-base").value; const neg = cur < 0n; $("b-in").value = (neg ? "-" : "") + (neg ? -cur : cur).toString(base).toUpperCase(); update(); });
    $("b-out").addEventListener("click", (e) => { const b = e.target.closest("[data-copy]"); if (b) copyText(b.dataset.copy); });
    $("b-bits").addEventListener("click", (e) => {
      const b = e.target.closest(".bit"); if (!b) return; const bit = BigInt(b.dataset.b); const bits = $("b-bits").children.length;
      let u = cur < 0n ? (1n << BigInt(bits)) + cur : cur; u ^= 1n << bit; cur = u;
      $("b-in").value = cur.toString(+$("b-base").value).toUpperCase(); ST.tabInputs["conv-base"] = snapInputs(); persist(); show(); blip("key");
    });
    update();
  },
};

/* =========================================================
   13. Overlays: help, command palette, get-the-app
========================================================= */
function openModal(html, cls = "") {
  const ov = $("ov"), m = $("modal"); m.className = "modal " + cls; m.innerHTML = html; ov.classList.add("show");
  const x = m.querySelector(".x"); if (x) x.onclick = closeModal; return m;
}
function closeModal() { $("ov").classList.remove("show"); }
$("ov").addEventListener("click", (e) => { if (e.target.id === "ov") closeModal(); });
function openHelp() {
  openModal(`<h3><i class="ti ti-keyboard"></i>Shortcuts & tricks<button class="icon-btn x" aria-label="Close"><i class="ti ti-x"></i></button></h3>
<div class="keys">
<div><kbd>Ctrl</kbd>+<kbd>K</kbd><span>Search every tool</span></div><div><kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>6</kbd><span>Switch module</span></div>
<div><kbd>[</kbd> <kbd>]</kbd><span>Previous / next tab</span></div><div><kbd>?</kbd><span>This help</span></div>
<div><kbd>Alt</kbd>+<kbd>D</kbd><span>Light / dark theme</span></div><div><kbd>Alt</kbd>+<kbd>M</kbd><span>Sounds on / off</span></div>
<div><kbd>Alt</kbd>+<kbd>R</kbd><span>Degrees / radians</span></div><div><kbd>Alt</kbd>+<kbd>C</kbd><span>Copy calculator result</span></div>
<div><kbd>Enter</kbd><span>Calculate / solve</span></div><div><kbd>Esc</kbd><span>Clear calculator · close dialog</span></div>
<div><kbd>↑</kbd> <kbd>↓</kbd><span>Browse calculator history</span></div><div>Just type<span>Keys go straight to the calculator</span></div>
<div><kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd><span>Graph zoom / reset</span></div><div><kbd>←</kbd> <kbd>→</kbd><span>Trace along a curve</span></div>
</div>
<div class="sep"></div>
<p class="muted">Every input box accepts math: <code>pi/4</code>, <code>2^10</code>, <code>sqrt(2)</code>. Type an expression with <code>x</code> in the calculator and press Enter to graph it. Your history, memory, graphs and inputs are saved on this device. Use <i class="ti ti-link"></i> to copy a link that reopens exactly what you're looking at.</p>`);
}
const ACTIONS = () => [
  ...Object.keys(MODS).flatMap((m) => MODS[m].map((t) => ({ label: `${MOD_NAMES[m]} › ${t.label}`, icon: TAB_ICON[t.id], run: () => openTab(t.id), hint: "", kw: TAB_KW[t.id] || "" }))),
  { label: "Toggle light / dark theme", icon: "sun", run: toggleTheme, hint: "Alt+D" },
  { label: `Sounds: turn ${ST.sound ? "off" : "on"}`, icon: "volume", run: toggleSound, hint: "Alt+M" },
  { label: `Angle mode: switch to ${ST.deg ? "radians" : "degrees"}`, icon: "angle", run: toggleDeg, hint: "Alt+R" },
  { label: `Vibration feedback: turn ${ST.haptic ? "off" : "on"}`, icon: "device-mobile-vibration", run: toggleHaptic, hint: "" },
  { label: "Copy a share link to this view", icon: "link", run: shareLink, hint: "" },
  { label: "Clear calculator history", icon: "trash", run: () => { ST.calcHist = []; persist(); renderCalcHist(); toast("History cleared", "trash"); }, hint: "" },
  { label: "Get the app (Android, install, iPhone)", icon: "download", run: openGetApp, hint: "" },
  { label: "Keyboard shortcuts", icon: "keyboard", run: openHelp, hint: "?" },
];
function openPalette() {
  const m = openModal(`<input id="pal-q" data-nosave="1" placeholder="Search tools & actions… (e.g. integral, hex, theme)" autocomplete="off"/><div class="pal-list" id="pal-list"></div>`, "pal");
  const q = m.querySelector("#pal-q"), list = m.querySelector("#pal-list"); let items = [], sel = 0;
  const render = () => {
    const t = q.value.toLowerCase().trim(); const words = t.split(/\s+/).filter(Boolean);
    items = ACTIONS().filter((a) => words.every((w) => (a.label + " " + (a.kw || "")).toLowerCase().includes(w))); sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = items.map((a, i) => `<div class="pal-item ${i === sel ? "sel" : ""}" data-i="${i}"><i class="ti ti-${a.icon}"></i>${esc(a.label)}<small>${a.hint}</small></div>`).join("") || '<div class="pal-item">No matches</div>';
  };
  const go = (i) => { const a = items[i]; if (!a) return; closeModal(); blip("ui"); a.run(); };
  q.addEventListener("input", () => { sel = 0; render(); });
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : items.length - 1)) % Math.max(1, items.length); render(); list.querySelector(".sel")?.scrollIntoView({ block: "nearest" }); }
    if (e.key === "Enter") { e.preventDefault(); go(sel); }
  });
  list.addEventListener("click", (e) => { const it = e.target.closest("[data-i]"); if (it) go(+it.dataset.i); });
  render(); q.focus();
}
let deferredInstall = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; });
function openGetApp() {
  const m = openModal(`<h3><i class="ti ti-download"></i>Get Math Lab<button class="icon-btn x" aria-label="Close"><i class="ti ti-x"></i></button></h3>
<div class="dl-grid">
<a class="dl" href="${APK_URL}"><i class="ti ti-brand-android"></i><b>Android</b><small>Download MathLab.apk</small></a>
<button class="dl" id="pwa-btn"><i class="ti ti-device-desktop"></i><b>Install app</b><small>Chrome / Edge — works offline</small></button>
<div class="dl"><i class="ti ti-brand-apple"></i><b>iPhone / iPad</b><small>Safari → Share → Add to Home Screen</small></div>
<a class="dl" href="${REL_URL}"><i class="ti ti-package"></i><b>All downloads</b><small>APK + offline web zip</small></a>
</div>
<p class="muted">Math Lab runs 100% on your device — no account, no ads, no tracking. Once installed it works without internet.</p>`);
  m.querySelector("#pwa-btn").onclick = async () => {
    if (deferredInstall) { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (_) {} deferredInstall = null; closeModal(); }
    else toast(/iphone|ipad/i.test(navigator.userAgent) ? "Tap Share → Add to Home Screen" : "Use your browser menu → Install app", "info-circle");
  };
}
$("get-btn").onclick = openGetApp; $("help-btn").onclick = openHelp; $("help-btn2").onclick = openHelp; $("pal-btn").onclick = openPalette;

/* =========================================================
   14. Theme, sound, haptics, share links
========================================================= */
function applyTheme() {
  document.documentElement.dataset.theme = ST.theme; $("theme-btn").innerHTML = `<i class="ti ti-${ST.theme === "dark" ? "sun" : "moon"}"></i>`;
  const mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.content = ST.theme === "dark" ? "#0f1117" : "#f3f5fa";
  document.dispatchEvent(new Event("themechange"));
}
function toggleTheme() { ST.theme = ST.theme === "dark" ? "light" : "dark"; persist(); applyTheme(); blip("ui"); if (TABS[currentTab].run && !TABS[currentTab].flush && currentTab !== "calc-sci") redrawCanvases(); }
function redrawCanvases() { // re-render mini plots with the new theme colours
  if (["calc2-deriv", "calc2-integ", "alg-quad"].includes(currentTab) && document.querySelector(".graph-canvas[style*='block']")) TABS[currentTab].run();
  if (currentTab === "geo-2d") calcGeo2d(true);
}
function applySound() { $("sound-btn").innerHTML = `<i class="ti ti-${ST.sound ? "volume" : "volume-off"}"></i>`; $("sound-btn").classList.toggle("on", ST.sound); }
function toggleSound() { ST.sound = !ST.sound; persist(); applySound(); blip("ui"); toast(ST.sound ? "Sounds on" : "Sounds off", ST.sound ? "volume" : "volume-off"); }
function applyHaptic() { $("haptic-btn").classList.toggle("on", ST.haptic); }
function toggleHaptic() { ST.haptic = !ST.haptic; persist(); applyHaptic(); blip("ui"); toast(ST.haptic ? "Vibration on" : "Vibration off", "device-mobile-vibration"); }
$("theme-btn").onclick = toggleTheme; $("sound-btn").onclick = toggleSound; $("haptic-btn").onclick = toggleHaptic;
function shareLink() {
  const p = new URLSearchParams(); p.set("tab", currentTab);
  if (currentTab === "calc-sci") { const v = $("sci-input").value.trim() || (ST.calcHist[0] && ST.calcHist[0].e) || ""; if (v) p.set("e", v); }
  else if (currentTab === "graph-plot") { p.set("f", ST.graph.fns.map((f) => f.e).filter((s) => s.trim()).join(";")); }
  else { const o = snapInputs(); Object.keys(o).forEach((k) => p.set(k, o[k])); }
  const url = location.origin + location.pathname + "#" + p.toString();
  history.replaceState(null, "", "#" + p.toString()); copyText(url, "Link copied");
}
$("share-btn").onclick = shareLink;
function fromHash() {
  if (!location.hash || location.hash.length < 2) return false;
  const p = new URLSearchParams(location.hash.slice(1)); const tab = p.get("tab"); if (!tab || !TABS[tab]) return false;
  if (tab === "calc-sci") { openTab(tab, { expr: p.get("e") || "" }); return true; }
  if (tab === "graph-plot") { const f = (p.get("f") || "").split(";").filter(Boolean).slice(0, 6); if (f.length) ST.graph.fns = f.map((e) => ({ e, on: true })); openTab(tab); return true; }
  const inputs = {}; p.forEach((v, k) => { if (k !== "tab") inputs[k] = v; }); openTab(tab, { inputs, run: true }); return true;
}
addEventListener("hashchange", fromHash);

/* =========================================================
   15. Global keyboard
========================================================= */
document.addEventListener("keydown", (e) => {
  const ovOpen = $("ov").classList.contains("show");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (ovOpen) closeModal(); else openPalette(); return; }
  if (e.key === "Escape" && ovOpen) { closeModal(); return; }
  if (ovOpen) return;
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const d = /^Digit([1-6])$/.exec(e.code); if (d) { e.preventDefault(); switchModule(Object.keys(MODS)[+d[1] - 1]); return; }
    if (e.code === "KeyD") { e.preventDefault(); return toggleTheme(); }
    if (e.code === "KeyM") { e.preventDefault(); return toggleSound(); }
    if (e.code === "KeyR") { e.preventDefault(); return toggleDeg(); }
    if (e.code === "KeyC" && currentTab === "calc-sci") { e.preventDefault(); return copyResult(); }
    return;
  }
  if (e.ctrlKey || e.metaKey) return;
  const ae = document.activeElement, typing = ae && (ae.tagName === "INPUT" || ae.tagName === "SELECT" || ae.tagName === "TEXTAREA");
  if (typing) return;
  if (e.key === "?") { e.preventDefault(); return openHelp(); }
  if (e.key === "[" || e.key === "]") { const tabs = MODS[currentModule], i = tabs.findIndex((t) => t.id === currentTab); const j = (i + (e.key === "]" ? 1 : tabs.length - 1)) % tabs.length; switchTab(tabs[j].id); return; }
  if (currentTab === "graph-plot" && GRAPH_API && ae && ae.id !== "gr-canvas") {
    if (e.key === "+" || e.key === "=") { GRAPH_API.zoom(1.5); return; } if (e.key === "-") { GRAPH_API.zoom(1 / 1.5); return; } if (e.key === "0") { GRAPH_API.home(); return; }
  }
  if (currentTab === "graph-plot" && ae && ae.id === "gr-canvas") { if (e.key === "+" || e.key === "=") GRAPH_API.zoom(1.5); else if (e.key === "-") GRAPH_API.zoom(1 / 1.5); else if (e.key === "0") GRAPH_API.home(); return; }
  if (currentTab === "calc-sci") { // type anywhere → calculator
    const inp = $("sci-input"); if (!inp) return;
    if (e.key === "Enter") { e.preventDefault(); evalSci(); flashKey("eq"); return; }
    if (e.key === "Escape") { e.preventDefault(); clearSci(); return; }
    if (e.key === "Backspace") { e.preventDefault(); backspace(); flashKey("back"); return; }
    if (e.key.length === 1 && /[0-9a-zA-Z+\-*/^().,!%πe ]/.test(e.key)) { e.preventDefault(); insert(e.key); flashKey(e.key); blip("key"); }
  }
});
function flashKey(k) {
  const flat = KEYS.flat(); const map = { "*": "*", "/": "/", "+": "+", "-": "-" };
  const idx = flat.findIndex((x) => (k === "eq" ? x.a === "eq" : k === "back" ? x.a === "back" : x.i === (map[k] || k)));
  const b = document.querySelector(`#keypad .key[data-k="${idx}"]`); if (b) { b.classList.add("pressed"); setTimeout(() => b.classList.remove("pressed"), 110); ripple(b); }
}

/* =========================================================
   16. Boot
========================================================= */
applyTheme(); applySound(); applyHaptic(); renderRecent();
if (!fromHash()) switchModule(MODS[ST.mod] ? ST.mod : "calc");
if (!ST.onboarded) { ST.onboarded = true; persist(); setTimeout(() => toast("Tip: press Ctrl+K to search every tool, ? for shortcuts", "bulb"), 1400); }
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.MathLab = { openTab, switchModule, state: () => ST };
})();
