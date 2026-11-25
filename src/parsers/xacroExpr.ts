/**
 * The Python expression subset xacro evaluates inside `${...}`, with Python's
 * value semantics where they show up in a URDF: int and float stay distinct
 * (`1` prints as `1`, `1.0` as `1.0`, `0.1*3` as `0.30000000000000004`),
 * `/` always gives a float, `//` and `%` floor, `and` / `or` return an
 * operand, and floats print the way Python's `str()` does.
 *
 * Supported: numbers, strings, True / False / None, lists, `+ - * / // % **`,
 * comparisons (chained), `and or not in`, `a if c else b`, calls, indexing,
 * `ns.name` access, and the names xacro exposes: math functions and
 * constants (directly and as `math.*`), common builtins, and `xacro.arg()`.
 */

export class PyFloat {
  readonly v: number;
  constructor(v: number) {
    this.v = v;
  }
}

export type PyFunction = (...args: Value[]) => Value;
/** Something with named members: a namespace table, or the math / python / xacro modules. */
export interface Members {
  member(name: string): Value | undefined;
}
export type Value = number | PyFloat | boolean | string | null | Value[] | PyFunction | Members | { block: unknown };

export class XacroError extends Error {}

const isMembers = (v: Value): v is Members => typeof v === 'object' && v !== null && 'member' in v;
const isNum = (v: Value): v is number | PyFloat | boolean => typeof v === 'number' || typeof v === 'boolean' || v instanceof PyFloat;
const nv = (v: Value): number => (v instanceof PyFloat ? v.v : typeof v === 'boolean' ? (v ? 1 : 0) : (v as number));
const isF = (v: Value) => v instanceof PyFloat;
const mk = (x: number, float: boolean): Value => (float ? new PyFloat(x) : x);
const typeName = (v: Value) =>
  v === null ? 'NoneType' : typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'int' : v instanceof PyFloat ? 'float'
  : typeof v === 'string' ? 'str' : Array.isArray(v) ? 'list' : typeof v === 'function' ? 'function' : 'object';

/** Python's repr() of a float. */
export function floatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [mant, expStr] = x.toExponential().split('e');
  const exp = Number(expStr);
  const neg = mant.startsWith('-');
  const digits = mant.replace('-', '').replace('.', '');
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const e = Math.abs(exp).toString().padStart(2, '0');
    return `${neg ? '-' : ''}${m}e${exp < 0 ? '-' : '+'}${e}`;
  }
  let s: string;
  if (exp >= 0) {
    s = digits.length > exp + 1 ? `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}` : `${digits.padEnd(exp + 1, '0')}.0`;
  } else {
    s = `0.${'0'.repeat(-exp - 1)}${digits}`;
  }
  return (neg ? '-' : '') + s;
}

export function pyRepr(v: Value): string {
  return typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : pyStr(v);
}

/** Python's str(). */
export function pyStr(v: Value): string {
  if (v === null) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return String(v);
  if (v instanceof PyFloat) return floatRepr(v.v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  return String(v);
}

export function truthy(v: Value): boolean {
  if (v === null || v === false || v === '') return false;
  if (isNum(v)) return nv(v) !== 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function eq(a: Value, b: Value): boolean {
  if (isNum(a) && isNum(b)) return nv(a) === nv(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]!));
  return a === b;
}

function cmp(a: Value, b: Value, op: string): boolean {
  if (op === '==') return eq(a, b);
  if (op === '!=') return !eq(a, b);
  if (op === 'in' || op === 'not in') {
    const has = typeof b === 'string' && typeof a === 'string' ? b.includes(a) : Array.isArray(b) ? b.some((x) => eq(x, a)) : (() => {
      throw new XacroError(`argument of type '${typeName(b)}' is not iterable`);
    })();
    return op === 'in' ? has : !has;
  }
  let x: number | string, y: number | string;
  if (isNum(a) && isNum(b)) [x, y] = [nv(a), nv(b)];
  else if (typeof a === 'string' && typeof b === 'string') [x, y] = [a, b];
  else throw new XacroError(`'${op}' not supported between '${typeName(a)}' and '${typeName(b)}'`);
  return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
}

function arith(op: string, a: Value, b: Value): Value {
  if (isNum(a) && isNum(b)) {
    const x = nv(a), y = nv(b);
    const f = isF(a) || isF(b);
    switch (op) {
      case '+': return mk(x + y, f);
      case '-': return mk(x - y, f);
      case '*': return mk(x * y, f);
      case '/':
        if (y === 0) throw new XacroError('division by zero');
        return new PyFloat(x / y);
      case '//':
        if (y === 0) throw new XacroError('integer division or modulo by zero');
        return mk(Math.floor(x / y), f);
      case '%':
        if (y === 0) throw new XacroError('integer division or modulo by zero');
        return mk(x - y * Math.floor(x / y), f);
      case '**':
        return !f && y >= 0 ? x ** y : new PyFloat(x ** y);
    }
  }
  if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
  if (op === '+' && Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (op === '*' && typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, b));
  if (op === '*' && Array.isArray(a) && typeof b === 'number') return Array.from({ length: Math.max(0, b) }, () => a).flat();
  // Returning the text unchanged would name links "%s_link"; refuse instead.
  if (op === '%' && typeof a === 'string') throw new XacroError("old-style string formatting ('...' % x) is not supported; use '...' + str(x)");
  throw new XacroError(`unsupported operand type(s) for ${op}: '${typeName(a)}' and '${typeName(b)}'`);
}

// --- tokens -----------------------------------------------------------------

type Tok = { t: 'num'; v: Value } | { t: 'str'; v: string } | { t: 'name'; v: string } | { t: 'op'; v: string } | { t: 'end' };
const OPS = ['**', '//', '==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%', '(', ')', '[', ']', ',', '.'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num && !(c === '.' && !/\d/.test(src[i + 1] ?? ''))) {
      const text = num[0];
      out.push({ t: 'num', v: /[.eE]/.test(text) ? new PyFloat(Number(text)) : Number(text) });
      i += text.length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const e = src[j + 1]!;
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new XacroError('unterminated string');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (name) { out.push({ t: 'name', v: name[0] }); i += name[0].length; continue; }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new XacroError(`invalid syntax at "${src.slice(i)}"`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  out.push({ t: 'end' });
  return out;
}

// --- parser to closures (so `and`, `or` and `if` short-circuit) --------------

type Node = () => Value;
export type Lookup = (name: string) => Value | undefined;

export function evaluate(src: string, lookup: Lookup): Value {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const isOp = (v: string) => { const t = peek(); return t.t === 'op' && t.v === v; };
  const isKw = (v: string) => { const t = peek(); return t.t === 'name' && t.v === v; };
  const expect = (v: string) => {
    if (!isOp(v)) throw new XacroError(`expected "${v}" in "${src}"`);
    p++;
  };

  const ternary = (): Node => {
    const a = orExpr();
    if (!isKw('if')) return a;
    p++;
    const cond = orExpr();
    if (!isKw('else')) throw new XacroError(`expected "else" in "${src}"`);
    p++;
    const b = ternary();
    return () => (truthy(cond()) ? a() : b());
  };
  const orExpr = (): Node => {
    let a = andExpr();
    while (isKw('or')) { p++; const l = a, r = andExpr(); a = () => { const x = l(); return truthy(x) ? x : r(); }; }
    return a;
  };
  const andExpr = (): Node => {
    let a = notExpr();
    while (isKw('and')) { p++; const l = a, r = notExpr(); a = () => { const x = l(); return truthy(x) ? r() : x; }; }
    return a;
  };
  const notExpr = (): Node => {
    if (isKw('not')) { p++; const a = notExpr(); return () => !truthy(a()); }
    return comparison();
  };
  const comparison = (): Node => {
    const first = sum();
    const rest: [string, Node][] = [];
    for (;;) {
      const t = peek();
      if (t.t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) { p++; rest.push([t.v, sum()]); }
      else if (isKw('in')) { p++; rest.push(['in', sum()]); }
      else if (isKw('not') && toks[p + 1]?.t === 'name' && (toks[p + 1] as { v: string }).v === 'in') { p += 2; rest.push(['not in', sum()]); }
      else break;
    }
    if (rest.length === 0) return first;
    return () => {
      let left = first();
      for (const [op, n] of rest) {
        const right = n();
        if (!cmp(left, right, op)) return false;
        left = right;
      }
      return true;
    };
  };
  const binary = (next: () => Node, ops: string[]) => (): Node => {
    let a = next();
    for (;;) {
      const t = peek();
      if (t.t !== 'op' || !ops.includes(t.v)) return a;
      p++;
      const l = a, r = next(), op = t.v;
      a = () => arith(op, l(), r());
    }
  };
  const unary = (): Node => {
    if (isOp('-')) { p++; const a = unary(); return () => { const v = a(); if (!isNum(v)) throw new XacroError(`bad operand type for unary -: '${typeName(v)}'`); return mk(-nv(v), isF(v)); }; }
    if (isOp('+')) { p++; return unary(); }
    return power();
  };
  const term = binary(unary, ['*', '/', '//', '%']);
  const sum = binary(term, ['+', '-']);
  const power = (): Node => {
    const a = postfix();
    if (!isOp('**')) return a;
    p++;
    const b = unary();
    return () => arith('**', a(), b());
  };
  const postfix = (): Node => {
    let a = atom();
    for (;;) {
      if (isOp('(')) {
        p++;
        const args: Node[] = [];
        while (!isOp(')')) { args.push(ternary()); if (!isOp(')')) expect(','); }
        p++;
        const f = a;
        a = () => {
          const fn = f();
          if (typeof fn !== 'function') throw new XacroError(`'${typeName(fn)}' object is not callable`);
          return fn(...args.map((n) => n()));
        };
      } else if (isOp('[')) {
        p++;
        const idx = ternary();
        expect(']');
        const l = a;
        a = () => {
          const c = l(), k = idx();
          if ((typeof c === 'string' || Array.isArray(c)) && isNum(k)) {
            if (!Number.isInteger(nv(k))) throw new XacroError('indices must be integers');
            const i = nv(k) < 0 ? c.length + nv(k) : nv(k);
            if (i < 0 || i >= c.length) throw new XacroError('index out of range');
            return c[i] as Value;
          }
          throw new XacroError(`'${typeName(c)}' object is not subscriptable`);
        };
      } else if (isOp('.')) {
        p++;
        const t = peek();
        if (t.t !== 'name') throw new XacroError(`expected a name after "." in "${src}"`);
        p++;
        const l = a, key = t.v;
        a = () => {
          const o = l();
          const v = isMembers(o) ? o.member(key) : undefined;
          if (v === undefined) throw new XacroError(`'${typeName(o)}' has no attribute '${key}'`);
          return v;
        };
      } else return a;
    }
  };
  const atom = (): Node => {
    const t = peek();
    p++;
    if (t.t === 'num') return () => t.v;
    if (t.t === 'str') {
      // Adjacent literals concatenate, as in Python.
      let s = t.v;
      while (peek().t === 'str') s += (toks[p++] as { v: string }).v;
      return () => s;
    }
    if (t.t === 'name') {
      if (t.v === 'True') return () => true;
      if (t.v === 'False') return () => false;
      if (t.v === 'None') return () => null;
      if (t.v.startsWith('__')) throw new XacroError(`Use of invalid name: ${t.v}`);
      return () => {
        const v = lookup(t.v);
        if (v === undefined) throw new XacroError(`name '${t.v}' is not defined`);
        return v;
      };
    }
    if (t.t === 'op' && t.v === '(') { const a = ternary(); expect(')'); return a; }
    if (t.t === 'op' && t.v === '[') {
      const items: Node[] = [];
      while (!isOp(']')) { items.push(ternary()); if (!isOp(']')) expect(','); }
      p++;
      return () => items.map((n) => n());
    }
    throw new XacroError(`invalid syntax in "${src}"`);
  };

  const root = ternary();
  if (peek().t !== 'end') throw new XacroError(`invalid syntax in "${src}"`);
  return root();
}

// --- the names xacro exposes ------------------------------------------------

const f1 = (fn: (x: number) => number): PyFunction => (x) => new PyFloat(fn(nv(x)));
const toInt = (v: Value): number => {
  if (typeof v === 'string') {
    if (!/^\s*[+-]?\d+\s*$/.test(v)) throw new XacroError(`invalid literal for int(): '${v}'`);
    return parseInt(v, 10);
  }
  return Math.trunc(nv(v));
};
const toFloat = (v: Value): PyFloat => {
  if (typeof v === 'string') {
    const n = parsePyFloat(v);
    if (n === null) throw new XacroError(`could not convert string to float: '${v}'`);
    return new PyFloat(n);
  }
  return new PyFloat(nv(v));
};
/** Python round(): ties go to the even neighbour. */
function roundHalfEven(x: number, nd = 0): number {
  const m = 10 ** nd;
  const y = x * m;
  const r = Math.round(y);
  const half = Math.abs(y % 1) === 0.5;
  return (half && r % 2 !== 0 ? r - 1 : r) / m;
}

export function parsePyFloat(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (/^[+-]?(inf|infinity)$/.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  if (/^[+-]?nan$/.test(t)) return NaN;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(t) ? Number(t) : null;
}

const MATH: Record<string, Value> = {
  pi: new PyFloat(Math.PI), e: new PyFloat(Math.E), tau: new PyFloat(2 * Math.PI), inf: new PyFloat(Infinity), nan: new PyFloat(NaN),
  sin: f1(Math.sin), cos: f1(Math.cos), tan: f1(Math.tan), asin: f1(Math.asin), acos: f1(Math.acos), atan: f1(Math.atan),
  sinh: f1(Math.sinh), cosh: f1(Math.cosh), tanh: f1(Math.tanh), sqrt: f1(Math.sqrt), exp: f1(Math.exp), log10: f1(Math.log10),
  log2: f1(Math.log2), fabs: f1(Math.abs),
  radians: f1((x) => (x * Math.PI) / 180), degrees: f1((x) => (x * 180) / Math.PI),
  atan2: (y, x) => new PyFloat(Math.atan2(nv(y), nv(x))),
  hypot: (...xs) => new PyFloat(Math.hypot(...xs.map(nv))),
  pow: (x, y) => new PyFloat(nv(x) ** nv(y)),
  fmod: (x, y) => new PyFloat(nv(x) % nv(y)),
  copysign: (x, y) => new PyFloat(Math.sign(nv(y)) * Math.abs(nv(x)) || (Object.is(nv(y), -0) ? -Math.abs(nv(x)) : Math.abs(nv(x)))),
  log: (x, b) => new PyFloat(b === undefined ? Math.log(nv(x)) : Math.log(nv(x)) / Math.log(nv(b))),
  floor: (x) => Math.floor(nv(x)), ceil: (x) => Math.ceil(nv(x)), trunc: (x) => Math.trunc(nv(x)),
  isnan: (x) => Number.isNaN(nv(x)), isinf: (x) => !Number.isFinite(nv(x)) && !Number.isNaN(nv(x)),
};

const BUILTINS: Record<string, Value> = {
  abs: (x) => (isNum(x) ? mk(Math.abs(nv(x)), isF(x)) : (() => { throw new XacroError('bad operand for abs()'); })()),
  min: (...xs) => (xs.length === 1 && Array.isArray(xs[0]) ? xs[0] : xs).reduce((a, b) => (cmp(b, a, '<') ? b : a)),
  max: (...xs) => (xs.length === 1 && Array.isArray(xs[0]) ? xs[0] : xs).reduce((a, b) => (cmp(b, a, '>') ? b : a)),
  round: (x, nd) => (nd === undefined || nd === null ? roundHalfEven(nv(x)) : new PyFloat(roundHalfEven(nv(x), nv(nd)))),
  int: (x) => toInt(x ?? 0),
  float: (x) => toFloat(x ?? 0),
  str: (x) => pyStr(x ?? ''),
  bool: (x) => truthy(x ?? false),
  len: (x) => (typeof x === 'string' || Array.isArray(x) ? x.length : (() => { throw new XacroError(`object of type '${typeName(x)}' has no len()`); })()),
  list: (x) => (Array.isArray(x) ? [...x] : typeof x === 'string' ? [...x] : []),
  sum: (x) => (Array.isArray(x) ? x.reduce((a, b) => arith('+', a, b), 0) : 0),
  range: (a, b, s) => {
    const [lo, hi, st] = b === undefined ? [0, nv(a), 1] : [nv(a), nv(b), s === undefined ? 1 : nv(s)];
    const out: Value[] = [];
    for (let i = lo; st > 0 ? i < hi : i > hi; i += st) out.push(i);
    return out;
  },
  sorted: (x) => (Array.isArray(x) ? [...x].sort((a, b) => (cmp(a, b, '<') ? -1 : cmp(a, b, '>') ? 1 : 0)) : []),
};

// Own keys only: `math.constructor` must not reach JS's Object / Function.
const module = (members: Record<string, Value>): Members => ({
  member: (n) => (Object.prototype.hasOwnProperty.call(members, n) ? members[n] : undefined),
});

/** The global names, given the current `$(arg)` values. */
export function globalNames(args: Record<string, string>): Lookup {
  // xacro exposes only these builtins globally; the rest live under `python.`.
  const direct = ['len', 'str', 'float', 'int', 'bool', 'list', 'min', 'max', 'round', 'sorted', 'range'];
  const loadYaml: PyFunction = (f) => {
    throw new XacroError(`load_yaml(${pyRepr(f ?? '')}) is not supported in BAGEL yet; expand this robot with ROS xacro and drop the .urdf`);
  };
  const g: Record<string, Value> = {
    ...MATH,
    ...Object.fromEntries(direct.map((n) => [n, BUILTINS[n]!])),
    load_yaml: loadYaml,
    math: module(MATH),
    python: module(BUILTINS),
    xacro: module({
      arg: (n) => {
        const v = args[pyStr(n)];
        if (v === undefined) throw new XacroError(`Undefined substitution argument ${pyStr(n)}`);
        return v;
      },
      load_yaml: loadYaml,
    }),
  };
  return (n) => (Object.prototype.hasOwnProperty.call(g, n) ? g[n] : undefined);
}
