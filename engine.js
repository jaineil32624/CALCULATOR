/* Math Lab engine — a safe expression parser, evaluator, compiler, symbolic
   differentiator, simplifier and polynomial toolkit. No eval(), no Function().
   Works in the browser (window.MathEngine) and in Node (module.exports). */
(function (root) {
  "use strict";

  const DEG = Math.PI / 180;
  const FUNCS = {
    sin:  { n: 1, trig: 1, f: (a) => Math.sin(a) },
    cos:  { n: 1, trig: 1, f: (a) => Math.cos(a) },
    tan:  { n: 1, trig: 1, f: (a) => Math.tan(a) },
    sec:  { n: 1, trig: 1, f: (a) => 1 / Math.cos(a) },
    csc:  { n: 1, trig: 1, f: (a) => 1 / Math.sin(a) },
    cot:  { n: 1, trig: 1, f: (a) => 1 / Math.tan(a) },
    asin: { n: 1, itrig: 1, f: Math.asin },
    acos: { n: 1, itrig: 1, f: Math.acos },
    atan: { n: 1, itrig: 1, f: Math.atan },
    sinh: { n: 1, f: Math.sinh }, cosh: { n: 1, f: Math.cosh }, tanh: { n: 1, f: Math.tanh },
    asinh: { n: 1, f: Math.asinh }, acosh: { n: 1, f: Math.acosh }, atanh: { n: 1, f: Math.atanh },
    sqrt: { n: 1, f: Math.sqrt }, cbrt: { n: 1, f: Math.cbrt },
    abs:  { n: 1, f: Math.abs }, sign: { n: 1, f: Math.sign },
    ln:   { n: 1, f: Math.log }, exp: { n: 1, f: Math.exp },
    log:  { n: [1, 2], f: (a, b) => (b === undefined ? Math.log10(a) : Math.log(a) / Math.log(b)) },
    log2: { n: 1, f: Math.log2 },
    floor: { n: 1, f: Math.floor }, ceil: { n: 1, f: Math.ceil }, round: { n: 1, f: Math.round },
    fact: { n: 1, f: (a) => factorial(a) },
    gamma: { n: 1, f: (a) => gamma(a) },
    nCr:  { n: 2, f: (a, b) => nCr(a, b) },
    nPr:  { n: 2, f: (a, b) => nPr(a, b) },
    mod:  { n: 2, f: (a, b) => ((a % b) + b) % b },
    min:  { n: [1, 99], f: (...a) => Math.min(...a) },
    max:  { n: [1, 99], f: (...a) => Math.max(...a) },
    gcd:  { n: 2, f: (a, b) => gcd(a, b) },
    lcm:  { n: 2, f: (a, b) => (a && b ? Math.abs(a * b) / gcd(a, b) : 0) },
    hypot: { n: [1, 99], f: (...a) => Math.hypot(...a) },
  };
  const ALIAS = { arcsin: "asin", arccos: "acos", arctan: "atan", sqr: "sqrt", root: "sqrt", ncr: "nCr", npr: "nPr", lg: "log", factorial: "fact" };
  const CONSTS = { pi: Math.PI, "π": Math.PI, e: Math.E, tau: 2 * Math.PI, "τ": 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2, "φ": (1 + Math.sqrt(5)) / 2, inf: Infinity, infinity: Infinity, "∞": Infinity };
  const VARS = ["x", "ans", "a"];

  function gcd(a, b) { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) [a, b] = [b, a % b]; return a; }
  function factorial(n) {
    if (n < 0) throw new Error("Factorial of a negative number");
    if (Number.isInteger(n)) { if (n > 170) return Infinity; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
    return gamma(n + 1);
  }
  function gamma(z) { // Lanczos approximation
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5; return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }
  function nCr(n, r) { n = Math.round(n); r = Math.round(r); if (r < 0 || r > n) return 0; r = Math.min(r, n - r); let v = 1; for (let i = 1; i <= r; i++) v = (v * (n - r + i)) / i; return Math.round(v); }
  function nPr(n, r) { n = Math.round(n); r = Math.round(r); if (r < 0 || r > n) return 0; let v = 1; for (let i = 0; i < r; i++) v *= n - i; return v; }

  /* ---------------- tokenizer ---------------- */
  const KNOWN = () => Object.keys(FUNCS).concat(Object.keys(ALIAS), Object.keys(CONSTS), VARS).sort((a, b) => b.length - a.length);
  let KNOWN_SORTED = null;
  function splitIdent(id) {
    // "sinx" -> sin x, "2pix" -> pi x, "xsin" -> x sin
    if (!KNOWN_SORTED) KNOWN_SORTED = KNOWN();
    const lower = (s) => s.toLowerCase();
    const out = []; let s = id;
    while (s.length) {
      const k = KNOWN_SORTED.find((n) => lower(s).startsWith(lower(n)));
      if (!k) throw new Error(`Unknown name "${id}"`);
      out.push(s.slice(0, k.length)); s = s.slice(k.length);
    }
    return out;
  }
  function canon(name) {
    const l = name.toLowerCase();
    if (FUNCS[name]) return name;
    const f = Object.keys(FUNCS).find((k) => k.toLowerCase() === l); if (f) return f;
    if (ALIAS[l]) return ALIAS[l];
    if (l in CONSTS || CONSTS[name] !== undefined) return CONSTS[name] !== undefined ? name : l;
    if (VARS.includes(l)) return l;
    return null;
  }
  function tokenize(src) {
    const s = String(src).replace(/[×✕⋅·]/g, "*").replace(/[÷∕]/g, "/").replace(/[−–—]/g, "-").replace(/\*\*/g, "^");
    const toks = []; let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      if (num) { toks.push({ t: "num", v: parseFloat(num[0]), s: num[0] }); i += num[0].length; continue; }
      const id = /^[A-Za-zπτφ∞α-ω_][A-Za-z0-9_]*/.exec(s.slice(i));
      if (id) {
        const c = canon(id[0]);
        if (c) toks.push({ t: "id", v: c });
        else for (const part of splitIdent(id[0])) toks.push({ t: "id", v: canon(part) });
        i += id[0].length; continue;
      }
      if ("+-*/^%!(),²³√".includes(ch)) { toks.push({ t: "op", v: ch }); i++; continue; }
      if (ch === "[" || ch === "{") { toks.push({ t: "op", v: "(" }); i++; continue; }
      if (ch === "]" || ch === "}") { toks.push({ t: "op", v: ")" }); i++; continue; }
      throw new Error(`Unexpected character "${ch}"`);
    }
    return toks;
  }

  /* ---------------- Pratt parser -> AST ---------------- */
  const N = (v) => ({ type: "num", v });
  const S = (name) => ({ type: "sym", name });
  const B = (op, a, b) => ({ type: "bin", op, a, b });
  const C = (name, ...args) => ({ type: "call", name, args });
  const NEG = (a) => ({ type: "neg", a });

  function parse(src) {
    const toks = tokenize(src);
    if (!toks.length) throw new Error("Empty expression");
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isOp = (t, v) => t && t.t === "op" && t.v === v;
    const startsOperand = (t) => t && (t.t === "num" || t.t === "id" || isOp(t, "(") || isOp(t, "√"));

    function lbp(t) {
      if (!t) return 0;
      if (t.t === "op") {
        switch (t.v) {
          case "+": case "-": return 10;
          case "*": case "/": return 20;
          case "%": return startsOperand(toks[p + 1]) ? 20 : 50;
          case "^": return 40;
          case "!": case "²": case "³": return 50;
          case "(": case "√": return 20; // implicit multiplication
          default: return 0;
        }
      }
      if (t.t === "id" && t.v === "mod") return 20;
      return 20; // number / identifier directly after an operand -> implicit multiplication
    }
    function nud(t) {
      if (!t) throw new Error("Unexpected end of expression");
      if (t.t === "num") return N(t.v);
      if (t.t === "id") {
        if (FUNCS[t.v]) {
          const spec = FUNCS[t.v];
          if (isOp(peek(), "(")) {
            next(); const args = [];
            if (!isOp(peek(), ")")) { do { args.push(expr(0)); } while (isOp(peek(), ",") && next()); }
            if (!isOp(next(), ")")) throw new Error(`Missing ")" after ${t.v}(`);
            checkArity(t.v, spec, args.length);
            return C(t.v, ...args);
          }
          if (isOp(peek(), "^") ) { // sin^2(x) -> sin(x)^2
            next(); const pw = expr(41); const arg = expr(30); checkArity(t.v, spec, 1); return B("^", C(t.v, arg), pw);
          }
          checkArity(t.v, spec, 1);
          return C(t.v, expr(30));
        }
        return S(t.v);
      }
      if (isOp(t, "(")) { const e = expr(0); if (!isOp(next(), ")")) throw new Error('Missing ")"'); return e; }
      if (isOp(t, "-")) return NEG(expr(30));
      if (isOp(t, "+")) return expr(30);
      if (isOp(t, "√")) return C("sqrt", expr(30));
      throw new Error(`Unexpected "${t.v}"`);
    }
    function led(t, left) {
      if (t.t === "id" && t.v === "mod" && !isOp(peek(), "(")) return C("mod", left, expr(20));
      if (t.t !== "op" || isOp(t, "(") || isOp(t, "√")) { p--; return B("*", left, expr(20)); }
      switch (t.v) {
        case "+": return B("+", left, expr(10));
        case "-": return B("-", left, expr(10));
        case "*": return B("*", left, expr(20));
        case "/": return B("/", left, expr(20));
        case "%": return startsOperand(peek()) ? C("mod", left, expr(20)) : B("/", left, N(100));
        case "^": return B("^", left, expr(39));
        case "!": return C("fact", left);
        case "²": return B("^", left, N(2));
        case "³": return B("^", left, N(3));
      }
      throw new Error(`Unexpected "${t.v}"`);
    }
    function expr(rbp) {
      let left = nud(next());
      while (rbp < lbp(peek())) left = led(next(), left);
      return left;
    }
    const ast = expr(0);
    if (p < toks.length) throw new Error(isOp(peek(), ")") ? 'Unmatched ")"' : `Unexpected "${peek().v ?? peek().s}"`);
    return ast;
  }
  function checkArity(name, spec, n) {
    const ok = Array.isArray(spec.n) ? n >= spec.n[0] && n <= spec.n[1] : n === spec.n;
    if (!ok) throw new Error(`${name}() takes ${Array.isArray(spec.n) ? spec.n.join("–") : spec.n} argument${spec.n === 1 ? "" : "s"}`);
  }

  /* ---------------- compiler (AST -> closure) ---------------- */
  function compile(ast) {
    switch (ast.type) {
      case "num": { const v = ast.v; return () => v; }
      case "sym": {
        const n = ast.name;
        if (n === "x") return (env) => (env.x === undefined ? err("x has no value here") : env.x);
        if (n === "ans") return (env) => env.ans || 0;
        if (n in CONSTS) { const v = CONSTS[n]; return () => v; }
        return (env) => (env.vars && n in env.vars ? env.vars[n] : err(`Unknown "${n}"`));
      }
      case "neg": { const a = compile(ast.a); return (env) => -a(env); }
      case "bin": {
        const a = compile(ast.a), b = compile(ast.b);
        switch (ast.op) {
          case "+": return (env) => a(env) + b(env);
          case "-": return (env) => a(env) - b(env);
          case "*": return (env) => a(env) * b(env);
          case "/": return (env) => a(env) / b(env);
          case "^": return (env) => pow(a(env), b(env));
        }
        break;
      }
      case "call": {
        const spec = FUNCS[ast.name]; const args = ast.args.map(compile); const f = spec.f;
        if (spec.trig) return (env) => f(env.deg ? args[0](env) * DEG : args[0](env));
        if (spec.itrig) return (env) => { const r = f(args[0](env)); return env.deg ? r / DEG : r; };
        if (args.length === 1) { const a0 = args[0]; return (env) => f(a0(env)); }
        if (args.length === 2) { const a0 = args[0], a1 = args[1]; return (env) => f(a0(env), a1(env)); }
        return (env) => f(...args.map((g) => g(env)));
      }
    }
    throw new Error("Bad expression");
  }
  function pow(a, b) {
    if (a < 0 && !Number.isInteger(b)) { // real odd roots: (-8)^(1/3) = -2
      const inv = 1 / b, r = Math.round(inv);
      if (Math.abs(inv - r) < 1e-9 && r % 2 !== 0) return -Math.pow(-a, b);
    }
    return Math.pow(a, b);
  }
  function err(m) { throw new Error(m); }
  function evaluate(src, env = {}) { const ast = typeof src === "string" ? parse(src) : src; return compile(ast)(env); }
  function makeFn(src, env = {}) {
    const ast = typeof src === "string" ? parse(src) : src; const g = compile(ast); const e = Object.assign({}, env);
    return (x) => { e.x = x; try { return g(e); } catch (_) { return NaN; } };
  }
  function hasVar(ast, v = "x") {
    if (ast.type === "sym") return ast.name === v;
    if (ast.type === "num") return false;
    if (ast.type === "neg") return hasVar(ast.a, v);
    if (ast.type === "bin") return hasVar(ast.a, v) || hasVar(ast.b, v);
    return ast.args.some((a) => hasVar(a, v));
  }

  /* ---------------- printer ---------------- */
  function fmt(n) {
    if (Number.isNaN(n)) return "NaN";
    if (!isFinite(n)) return n > 0 ? "∞" : "-∞";
    if (n === 0) return "0";
    const a = Math.abs(n);
    if (a < 1e-9 || a >= 1e15) { const [m, e] = n.toExponential(8).split("e"); return parseFloat(m) + "e" + e.replace("+", ""); }
    return String(parseFloat(n.toPrecision(12)));
  }
  const PREC = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 4 };
  function prec(ast) {
    if (ast.type === "bin") return PREC[ast.op];
    if (ast.type === "neg") return 3;
    if (ast.type === "num" && ast.v < 0) return 3;
    return 9;
  }
  function toStr(ast) {
    switch (ast.type) {
      case "num": return fmt(ast.v);
      case "sym": return ast.name === "pi" ? "π" : ast.name;
      case "neg": { const s = toStr(ast.a); return "-" + (prec(ast.a) <= 3 && ast.a.type !== "call" ? `(${s})` : s); }
      case "call": return `${ast.name}(${ast.args.map(toStr).join(", ")})`;
      case "bin": {
        const op = ast.op, P = PREC[op];
        let l = toStr(ast.a), r = toStr(ast.b);
        const pl = prec(ast.a), pr = prec(ast.b);
        if (op === "^") {
          if (pl <= 4) l = `(${l})`;
          if (pr < 9) r = `(${r})`;
          return `${l}^${r}`;
        }
        if (pl < P) l = `(${l})`;
        if (pr < P || (pr === P && (op === "-" || op === "/"))) r = `(${r})`;
        else if (op === "*" && pr === 3) r = `(${r})`;
        if (op === "*") {
          const juxt = ast.a.type === "num" && (ast.b.type === "sym" || ast.b.type === "call" || (ast.b.type === "bin" && ast.b.op === "^" && ast.b.a.type === "sym") || r.startsWith("("));
          return juxt ? l + r : `${l}·${r}`;
        }
        if (op === "/") return `${l}/${r}`;
        return op === "-" && r.startsWith("-") ? `${l} - (${r})` : `${l} ${op} ${r}`;
      }
    }
    return "?";
  }

  /* ---------------- simplifier ---------------- */
  const isNum = (a, v) => a.type === "num" && (v === undefined || a.v === v);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function simp(ast) {
    switch (ast.type) {
      case "num": case "sym": return ast;
      case "neg": {
        const a = simp(ast.a);
        if (isNum(a)) return N(-a.v);
        if (a.type === "neg") return a.a;
        if (a.type === "bin" && a.op === "*" && isNum(a.a)) return simp(B("*", N(-a.a.v), a.b));
        return NEG(a);
      }
      case "call": {
        const args = ast.args.map(simp);
        if (args.every((a) => isNum(a)) && ["sqrt", "abs", "exp", "ln", "log"].includes(ast.name)) {
          const v = FUNCS[ast.name].f(...args.map((a) => a.v));
          if (Number.isInteger(v)) return N(v);
        }
        if (ast.name === "ln" && isNum(args[0], 1)) return N(0);
        if (ast.name === "ln" && args[0].type === "sym" && args[0].name === "e") return N(1);
        return C(ast.name, ...args);
      }
      case "bin": {
        let a = simp(ast.a), b = simp(ast.b); const op = ast.op;
        if (isNum(a) && isNum(b)) {
          const v = op === "+" ? a.v + b.v : op === "-" ? a.v - b.v : op === "*" ? a.v * b.v : op === "/" ? a.v / b.v : pow(a.v, b.v);
          if (op !== "/" || Number.isInteger(v) || Math.abs(v * 1e6 - Math.round(v * 1e6)) < 1e-9) return N(parseFloat(v.toPrecision(14)));
        }
        if (op === "+") {
          if (isNum(a, 0)) return b; if (isNum(b, 0)) return a;
          if (b.type === "neg") return simp(B("-", a, b.a));
          if (isNum(b) && b.v < 0) return B("-", a, N(-b.v));
          if (same(a, b)) return simp(B("*", N(2), a));
        }
        if (op === "-") {
          if (isNum(b, 0)) return a; if (isNum(a, 0)) return simp(NEG(b));
          if (b.type === "neg") return simp(B("+", a, b.a));
          if (isNum(b) && b.v < 0) return B("+", a, N(-b.v));
          if (same(a, b)) return N(0);
        }
        if (op === "*") {
          if (isNum(a, 0) || isNum(b, 0)) return N(0);
          if (isNum(a, 1)) return b; if (isNum(b, 1)) return a;
          if (isNum(a, -1)) return simp(NEG(b)); if (isNum(b, -1)) return simp(NEG(a));
          if (isNum(b) && !isNum(a)) [a, b] = [b, a];
          if (a.type === "neg") return simp(NEG(B("*", a.a, b)));
          if (b.type === "neg") return simp(NEG(B("*", a, b.a)));
          if (isNum(a) && b.type === "bin" && b.op === "*" && isNum(b.a)) return simp(B("*", N(a.v * b.a.v), b.b));
          if (isNum(a) && b.type === "bin" && b.op === "/" && isNum(b.a)) return simp(B("/", N(a.v * b.a.v), b.b));
          if (!isNum(a) && b.type === "bin" && b.op === "*" && isNum(b.a)) return simp(B("*", b.a, B("*", a, b.b)));
          if (a.type === "bin" && a.op === "*" && isNum(a.a) && !isNum(b)) return simp(B("*", a.a, B("*", a.b, b)));
          if (same(a, b)) return simp(B("^", a, N(2)));
          if (a.type === "bin" && a.op === "^" && same(a.a, b) && isNum(a.b)) return simp(B("^", b, N(a.b.v + 1)));
          if (b.type === "bin" && b.op === "^" && same(b.a, a) && isNum(b.b)) return simp(B("^", a, N(b.b.v + 1)));
          if (b.type === "bin" && b.op === "/") return simp(B("/", B("*", a, b.a), b.b));
          if (a.type === "bin" && a.op === "/") return simp(B("/", B("*", a.a, b), a.b));
        }
        if (op === "/") {
          if (isNum(a, 0)) return N(0); if (isNum(b, 1)) return a;
          if (same(a, b)) return N(1);
          if (a.type === "neg") return simp(NEG(B("/", a.a, b)));
          if (isNum(b) && a.type === "bin" && a.op === "*" && isNum(a.a)) return simp(B("*", N(a.a.v / b.v), a.b));
          const coef = (t) => (isNum(t) ? [t.v, null] : t.type === "bin" && t.op === "*" && isNum(t.a) ? [t.a.v, t.b] : [1, t]);
          const [ka, ra] = coef(a), [kb, rb] = coef(b);
          if ((ka !== 1 || kb !== 1) && Number.isInteger(ka) && Number.isInteger(kb) && kb !== 0) {
            const g = gcd(ka, kb) * (kb < 0 ? -1 : 1);
            if (g !== 1) { const na = ka / g, nb = kb / g; const top = ra ? B("*", N(na), ra) : N(na); const bot = rb ? B("*", N(nb), rb) : N(nb); return simp(B("/", top, bot)); }
          }
          if (ra && rb && same(ra, rb)) return simp(B("/", N(ka), N(kb)));
          if (a.type === "bin" && a.op === "/") return simp(B("/", a.a, B("*", a.b, b)));
          if (b.type === "bin" && b.op === "^" && same(b.a, a) && isNum(b.b)) return simp(B("/", N(1), B("^", a, N(b.b.v - 1))));
          if (a.type === "bin" && a.op === "^" && same(a.a, b) && isNum(a.b)) return simp(B("^", b, N(a.b.v - 1)));
        }
        if (op === "^") {
          if (isNum(b, 0)) return N(1); if (isNum(b, 1)) return a;
          if (isNum(a, 1)) return N(1);
          if (a.type === "bin" && a.op === "^" && isNum(a.b) && isNum(b)) return simp(B("^", a.a, N(a.b.v * b.v)));
        }
        return B(op, a, b);
      }
    }
    return ast;
  }
  function simplify(ast) {
    let cur = ast;
    for (let i = 0; i < 8; i++) { const nx = simp(cur); if (same(nx, cur)) break; cur = nx; }
    return cur;
  }

  /* ---------------- symbolic derivative ---------------- */
  function derive(ast, rules = new Set()) {
    const d = (a) => derive(a, rules);
    const chain = (outer, u) => { if (!(u.type === "sym" && u.name === "x")) rules.add("Chain rule"); return B("*", outer, d(u)); };
    switch (ast.type) {
      case "num": rules.add("Constant rule"); return N(0);
      case "sym": if (ast.name === "x") { rules.add("d/dx[x] = 1"); return N(1); } rules.add("Constant rule"); return N(0);
      case "neg": return NEG(d(ast.a));
      case "bin": {
        const { a, b, op } = ast;
        if (op === "+" || op === "-") { rules.add("Sum / difference rule"); return B(op, d(a), d(b)); }
        if (op === "*") {
          if (!hasVar(a)) { rules.add("Constant multiple rule"); return B("*", a, d(b)); }
          if (!hasVar(b)) { rules.add("Constant multiple rule"); return B("*", b, d(a)); }
          rules.add("Product rule"); return B("+", B("*", d(a), b), B("*", a, d(b)));
        }
        if (op === "/") {
          if (!hasVar(b)) { rules.add("Constant multiple rule"); return B("/", d(a), b); }
          rules.add("Quotient rule"); return B("/", B("-", B("*", d(a), b), B("*", a, d(b))), B("^", b, N(2)));
        }
        if (op === "^") {
          if (!hasVar(b)) { rules.add("Power rule"); return chain(B("*", b, B("^", a, simplify(B("-", b, N(1))))), a); }
          if (!hasVar(a)) { rules.add("Exponential rule"); return chain(B("*", B("^", a, b), C("ln", a)), b); }
          rules.add("Logarithmic differentiation");
          return B("*", B("^", a, b), B("+", B("*", d(b), C("ln", a)), B("/", B("*", b, d(a)), a)));
        }
        break;
      }
      case "call": {
        const u = ast.args[0], X = (n, ...g) => C(n, ...g);
        const r = (name) => rules.add(name);
        switch (ast.name) {
          case "sin": r("d/dx[sin u] = cos u"); return chain(X("cos", u), u);
          case "cos": r("d/dx[cos u] = -sin u"); return chain(NEG(X("sin", u)), u);
          case "tan": r("d/dx[tan u] = sec² u"); return chain(B("^", X("sec", u), N(2)), u);
          case "sec": r("d/dx[sec u] = sec u·tan u"); return chain(B("*", X("sec", u), X("tan", u)), u);
          case "csc": r("d/dx[csc u] = -csc u·cot u"); return chain(NEG(B("*", X("csc", u), X("cot", u))), u);
          case "cot": r("d/dx[cot u] = -csc² u"); return chain(NEG(B("^", X("csc", u), N(2))), u);
          case "asin": r("d/dx[asin u] = 1/√(1-u²)"); return chain(B("/", N(1), X("sqrt", B("-", N(1), B("^", u, N(2))))), u);
          case "acos": r("d/dx[acos u] = -1/√(1-u²)"); return chain(NEG(B("/", N(1), X("sqrt", B("-", N(1), B("^", u, N(2)))))), u);
          case "atan": r("d/dx[atan u] = 1/(1+u²)"); return chain(B("/", N(1), B("+", N(1), B("^", u, N(2)))), u);
          case "sinh": r("d/dx[sinh u] = cosh u"); return chain(X("cosh", u), u);
          case "cosh": r("d/dx[cosh u] = sinh u"); return chain(X("sinh", u), u);
          case "tanh": r("d/dx[tanh u] = 1/cosh² u"); return chain(B("/", N(1), B("^", X("cosh", u), N(2))), u);
          case "exp": r("d/dx[eᵘ] = eᵘ"); return chain(X("exp", u), u);
          case "ln": r("d/dx[ln u] = 1/u"); return chain(B("/", N(1), u), u);
          case "log":
            if (ast.args.length === 2) { const base = ast.args[1]; if (hasVar(base)) break; r("d/dx[log_b u] = 1/(u·ln b)"); return chain(B("/", N(1), B("*", u, X("ln", base))), u); }
            r("d/dx[log u] = 1/(u·ln 10)"); return chain(B("/", N(1), B("*", u, X("ln", N(10)))), u);
          case "log2": r("d/dx[log₂ u] = 1/(u·ln 2)"); return chain(B("/", N(1), B("*", u, X("ln", N(2)))), u);
          case "sqrt": r("d/dx[√u] = 1/(2√u)"); return chain(B("/", N(1), B("*", N(2), X("sqrt", u))), u);
          case "cbrt": r("d/dx[∛u] = 1/(3∛u²)"); return chain(B("/", N(1), B("*", N(3), B("^", X("cbrt", u), N(2)))), u);
          case "abs": r("d/dx[|u|] = sign(u)"); return chain(X("sign", u), u);
        }
        if (!ast.args.some((a) => hasVar(a))) { rules.add("Constant rule"); return N(0); }
        throw new Error(`Can't differentiate ${ast.name}() symbolically`);
      }
    }
    throw new Error("Can't differentiate this expression");
  }
  function derivative(src, order = 1) {
    let ast = typeof src === "string" ? parse(src) : src; const rules = new Set(); const chain = [];
    for (let i = 0; i < order; i++) { ast = simplify(derive(ast, rules)); chain.push(ast); }
    return { ast, str: toStr(ast), rules: [...rules], chain: chain.map(toStr) };
  }

  /* ---------------- polynomials ---------------- */
  const padd = (p, q) => { const r = []; for (let i = 0; i < Math.max(p.length, q.length); i++) r[i] = (p[i] || 0) + (q[i] || 0); return trim(r); };
  const pmul = (p, q) => { const r = new Array(p.length + q.length - 1).fill(0); p.forEach((a, i) => q.forEach((b, j) => (r[i + j] += a * b))); return trim(r); };
  const pscale = (p, k) => trim(p.map((c) => c * k));
  function trim(p) { const r = p.map((c) => (Math.abs(c) < 1e-12 ? 0 : parseFloat(c.toPrecision(14)))); while (r.length > 1 && r[r.length - 1] === 0) r.pop(); return r.length ? r : [0]; }
  function toPoly(ast) {
    switch (ast.type) {
      case "num": return [ast.v];
      case "sym": if (ast.name === "x") return [0, 1]; if (ast.name in CONSTS) return [CONSTS[ast.name]]; throw new Error(`"${ast.name}" is not allowed in a polynomial`);
      case "neg": return pscale(toPoly(ast.a), -1);
      case "bin": {
        const { a, b, op } = ast;
        if (op === "+") return padd(toPoly(a), toPoly(b));
        if (op === "-") return padd(toPoly(a), pscale(toPoly(b), -1));
        if (op === "*") return pmul(toPoly(a), toPoly(b));
        if (op === "/") { const q = toPoly(b); if (q.length !== 1 || q[0] === 0) throw new Error("Can only divide a polynomial by a non-zero number"); return pscale(toPoly(a), 1 / q[0]); }
        if (op === "^") {
          const e = toPoly(b); if (e.length !== 1 || !Number.isInteger(e[0]) || e[0] < 0 || e[0] > 40) throw new Error("Exponents must be whole numbers 0–40");
          let r = [1]; const base = toPoly(a); for (let i = 0; i < e[0]; i++) r = pmul(r, base); return r;
        }
      }
    }
    if (!hasVar(ast)) return [compile(ast)({})];
    throw new Error("Not a polynomial in x");
  }
  function polyStr(p) {
    const terms = [];
    for (let k = p.length - 1; k >= 0; k--) {
      const c = p[k]; if (!c) continue;
      const a = Math.abs(c), sign = c < 0 ? "-" : "+";
      const coef = a === 1 && k > 0 ? "" : fmt(a);
      const v = k === 0 ? "" : k === 1 ? "x" : `x^${k}`;
      terms.push([sign, coef + v]);
    }
    if (!terms.length) return "0";
    return terms.map(([s, t], i) => (i === 0 ? (s === "-" ? "-" + t : t) : ` ${s} ${t}`)).join("");
  }
  function polyEval(p, x) { let r = 0; for (let k = p.length - 1; k >= 0; k--) r = r * x + p[k]; return r; }
  function polyDeriv(p) { return p.length <= 1 ? [0] : trim(p.slice(1).map((c, i) => c * (i + 1))); }
  function polyRoots(p) { // Durand–Kerner, returns [{re, im}]
    p = trim(p); const n = p.length - 1; if (n < 1) return [];
    const lead = p[n]; const a = p.map((c) => c / lead);
    const cm = (x, y) => ({ re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re });
    const cd = (x, y) => { const d = y.re * y.re + y.im * y.im || 1e-300; return { re: (x.re * y.re + x.im * y.im) / d, im: (x.im * y.re - x.re * y.im) / d }; };
    const ev = (z) => { let r = { re: 1, im: 0 }; for (let k = n - 1; k >= 0; k--) { r = cm(r, z); r.re += a[k]; } return r; };
    const bound = 1 + Math.max(...a.slice(0, n).map(Math.abs));
    let zs = Array.from({ length: n }, (_, k) => ({ re: bound * 0.9 * Math.cos((2 * Math.PI * k) / n + 0.4), im: bound * 0.9 * Math.sin((2 * Math.PI * k) / n + 0.4) }));
    for (let it = 0; it < 800; it++) {
      let delta = 0;
      zs = zs.map((z, i) => {
        let den = { re: 1, im: 0 }; zs.forEach((w, j) => { if (i !== j) den = cm(den, { re: z.re - w.re, im: z.im - w.im }); });
        const step = cd(ev(z), den); delta = Math.max(delta, Math.abs(step.re) + Math.abs(step.im));
        return { re: z.re - step.re, im: z.im - step.im };
      });
      if (delta < 1e-14) break;
    }
    return zs.map((z) => ({ re: Math.abs(z.re) < 1e-9 ? 0 : z.re, im: Math.abs(z.im) < 1e-8 ? 0 : z.im })).sort((u, v) => u.re - v.re || u.im - v.im);
  }

  /* ---------------- numeric helpers ---------------- */
  function simpson(f, a, b, n = 2000) {
    if (a === b) return 0; const h = (b - a) / n; let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
    return (s * h) / 3;
  }
  function adaptive(f, a, b, eps = 1e-10, depth = 0) {
    const c = (a + b) / 2, fa = f(a), fb = f(b), fc = f(c);
    const whole = ((b - a) / 6) * (fa + 4 * fc + fb);
    const rec = (a, b, fa, fb, fc, whole, eps, d) => {
      const c = (a + b) / 2, l = (a + c) / 2, r = (c + b) / 2, fl = f(l), fr = f(r);
      const left = ((c - a) / 6) * (fa + 4 * fl + fc), right = ((b - c) / 6) * (fc + 4 * fr + fb);
      if (d > 40 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
      return rec(a, c, fa, fc, fl, left, eps / 2, d + 1) + rec(c, b, fc, fb, fr, right, eps / 2, d + 1);
    };
    return rec(a, b, fa, fb, fc, whole, eps, depth);
  }
  function toFraction(x, maxDen = 10000) {
    if (!isFinite(x) || Number.isInteger(x)) return null;
    let h1 = 1, h2 = 0, k1 = 0, k2 = 1, b = x;
    for (let i = 0; i < 40; i++) {
      const a = Math.floor(b); [h1, h2] = [a * h1 + h2, h1]; [k1, k2] = [a * k1 + k2, k1];
      if (k1 > maxDen) return null;
      if (Math.abs(x - h1 / k1) < 1e-12 * Math.max(1, Math.abs(x))) return k1 === 1 ? null : `${h1}/${k1}`;
      b = 1 / (b - a); if (!isFinite(b)) break;
    }
    return null;
  }

  const api = { parse, tokenize, compile, evaluate, makeFn, hasVar, toStr, simplify, derive, derivative, toPoly, polyStr, polyEval, polyDeriv, polyRoots, simpson, adaptive, fmt, toFraction, factorial, FUNCS, CONSTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MathEngine = api;
})(typeof self !== "undefined" ? self : this);
