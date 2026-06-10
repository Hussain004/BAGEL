/**
 * Safe, zero-dependency math expression compiler.
 *
 * Parses a string like "sqrt(linear.x^2 + linear.y^2)" into a compiled
 * closure that accepts a variable dictionary and returns a number or null.
 *
 * Supported operators (in precedence order, highest first):
 *   ^ (right-assoc power), unary -, * /, + -
 *
 * Built-in functions: sqrt abs sin cos tan asin acos atan atan2
 *   log log2 log10 exp floor ceil round sign pow min max clamp deg rad
 *
 * Built-in constants: pi PI e E
 *
 * Variable names may contain dots and bracket-index notation to reference
 * flattenNumeric paths: e.g. "linear.x", "covariance[0]".
 *
 * Any null variable, division by zero, or non-finite result yields null
 * (rendered as a gap in uPlot rather than crashing the series).
 */

export type Vars = Record<string, number | null>;
export type CompiledExpr = (vars: Vars) => number | null;

// ---- token kinds ----
const N_NUM = 'N';
const N_IDENT = 'I';
const N_PLUS = '+';
const N_MINUS = '-';
const N_STAR = '*';
const N_SLASH = '/';
const N_CARET = '^';
const N_LPAREN = '(';
const N_RPAREN = ')';
const N_COMMA = ',';
const N_EOF = '$';

type TokKind =
  | typeof N_NUM | typeof N_IDENT | typeof N_PLUS | typeof N_MINUS
  | typeof N_STAR | typeof N_SLASH | typeof N_CARET
  | typeof N_LPAREN | typeof N_RPAREN | typeof N_COMMA | typeof N_EOF;

interface Token { kind: TokKind; num?: number; str?: string; pos: number; }

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const m = src.slice(i).match(/^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/);
      if (!m) throw new Error(`Invalid number at position ${i}`);
      toks.push({ kind: N_NUM, num: parseFloat(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      // Greedily capture dot-paths and bracket-index notation used by flattenNumeric
      const m = src.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*/);
      if (!m) throw new Error(`Invalid identifier at position ${i}`);
      toks.push({ kind: N_IDENT, str: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    switch (ch) {
      case '+': toks.push({ kind: N_PLUS, pos: i++ }); break;
      case '-': toks.push({ kind: N_MINUS, pos: i++ }); break;
      case '*': toks.push({ kind: N_STAR, pos: i++ }); break;
      case '/': toks.push({ kind: N_SLASH, pos: i++ }); break;
      case '^': toks.push({ kind: N_CARET, pos: i++ }); break;
      case '(': toks.push({ kind: N_LPAREN, pos: i++ }); break;
      case ')': toks.push({ kind: N_RPAREN, pos: i++ }); break;
      case ',': toks.push({ kind: N_COMMA, pos: i++ }); break;
      default: throw new Error(`Unexpected character '${ch}' at position ${i}`);
    }
  }
  toks.push({ kind: N_EOF, pos: src.length });
  return toks;
}

// ---- built-in functions ----
// Each receives an array of evaluated args (number | null). Null propagates.

const BUILTINS: Record<string, (args: Array<number | null>) => number | null> = {
  sqrt:  ([a]) => a == null ? null : (a < 0 ? null : Math.sqrt(a)),
  abs:   ([a]) => a == null ? null : Math.abs(a),
  sin:   ([a]) => a == null ? null : Math.sin(a),
  cos:   ([a]) => a == null ? null : Math.cos(a),
  tan:   ([a]) => a == null ? null : Math.tan(a),
  asin:  ([a]) => a == null ? null : Math.asin(a),
  acos:  ([a]) => a == null ? null : Math.acos(a),
  atan:  ([a]) => a == null ? null : Math.atan(a),
  atan2: ([y, x]) => y == null || x == null ? null : Math.atan2(y, x),
  log:   ([a]) => a == null ? null : (a <= 0 ? null : Math.log(a)),
  log2:  ([a]) => a == null ? null : (a <= 0 ? null : Math.log2(a)),
  log10: ([a]) => a == null ? null : (a <= 0 ? null : Math.log10(a)),
  exp:   ([a]) => a == null ? null : Math.exp(a),
  floor: ([a]) => a == null ? null : Math.floor(a),
  ceil:  ([a]) => a == null ? null : Math.ceil(a),
  round: ([a]) => a == null ? null : Math.round(a),
  sign:  ([a]) => a == null ? null : Math.sign(a),
  pow:   ([a, b]) => a == null || b == null ? null : Math.pow(a, b),
  min:   (args) => args.some(a => a == null) ? null : Math.min(...(args as number[])),
  max:   (args) => args.some(a => a == null) ? null : Math.max(...(args as number[])),
  clamp: ([a, lo, hi]) => a == null || lo == null || hi == null ? null : Math.max(lo, Math.min(hi, a)),
  deg:   ([a]) => a == null ? null : a * (180 / Math.PI),
  rad:   ([a]) => a == null ? null : a * (Math.PI / 180),
};

// ---- recursive-descent parser ----
// Precedence (lowest to highest):
//   additive (+/-) < multiplicative (*/) < unary (-) < power (^) < primary

class Parser {
  private pos = 0;
  private readonly toks: Token[];
  constructor(toks: Token[]) { this.toks = toks; }

  parse(): CompiledExpr {
    const fn = this.parseAdditive();
    if (this.peek().kind !== N_EOF) {
      const t = this.peek();
      throw new Error(`Unexpected '${t.str ?? t.kind}' at position ${t.pos}`);
    }
    return fn;
  }

  private peek(): Token { return this.toks[this.pos]; }
  private consume(): Token { return this.toks[this.pos++]; }
  private expect(k: TokKind): void {
    const t = this.consume();
    if (t.kind !== k) throw new Error(`Expected '${k}' but got '${t.str ?? t.kind}' at position ${t.pos}`);
  }

  private parseAdditive(): CompiledExpr {
    let left = this.parseMultiplicative();
    while (this.peek().kind === N_PLUS || this.peek().kind === N_MINUS) {
      const op = this.consume().kind;
      const right = this.parseMultiplicative();
      const l = left, r = right;
      left = op === N_PLUS
        ? (v) => { const a = l(v), b = r(v); return a == null || b == null ? null : a + b; }
        : (v) => { const a = l(v), b = r(v); return a == null || b == null ? null : a - b; };
    }
    return left;
  }

  private parseMultiplicative(): CompiledExpr {
    let left = this.parseUnary();
    while (this.peek().kind === N_STAR || this.peek().kind === N_SLASH) {
      const op = this.consume().kind;
      const right = this.parseUnary();
      const l = left, r = right;
      left = op === N_STAR
        ? (v) => { const a = l(v), b = r(v); return a == null || b == null ? null : a * b; }
        : (v) => { const a = l(v), b = r(v); return a == null || b == null ? null : (b === 0 ? null : a / b); };
    }
    return left;
  }

  // Unary minus has LOWER precedence than power: -2^3 = -(2^3) = -8
  private parseUnary(): CompiledExpr {
    if (this.peek().kind === N_MINUS) {
      this.consume();
      const inner = this.parseUnary();
      return (v) => { const a = inner(v); return a == null ? null : -a; };
    }
    if (this.peek().kind === N_PLUS) {
      this.consume();
      return this.parseUnary();
    }
    return this.parsePower();
  }

  // Power is right-associative: 2^3^2 = 2^(3^2) = 512
  private parsePower(): CompiledExpr {
    const base = this.parsePrimary();
    if (this.peek().kind === N_CARET) {
      this.consume();
      const exp = this.parseUnary(); // right-assoc: re-enters via unary
      return (v) => { const a = base(v), b = exp(v); return a == null || b == null ? null : Math.pow(a, b); };
    }
    return base;
  }

  private parsePrimary(): CompiledExpr {
    const t = this.peek();

    if (t.kind === N_NUM) {
      this.consume();
      const val = t.num!;
      return () => val;
    }

    if (t.kind === N_IDENT) {
      this.consume();
      const name = t.str!;

      // Function call
      if (this.peek().kind === N_LPAREN) {
        this.consume();
        const args: CompiledExpr[] = [];
        if (this.peek().kind !== N_RPAREN) {
          args.push(this.parseAdditive());
          while (this.peek().kind === N_COMMA) {
            this.consume();
            args.push(this.parseAdditive());
          }
        }
        this.expect(N_RPAREN);
        const fn = BUILTINS[name];
        if (!fn) throw new Error(`Unknown function '${name}'`);
        return (v) => fn(args.map(a => a(v)));
      }

      // Constants
      if (name === 'pi' || name === 'PI') return () => Math.PI;
      if (name === 'e' || name === 'E') return () => Math.E;

      // Variable lookup (dot-paths like "linear.x" are a single token)
      return (v: Vars) => (name in v ? v[name] : null);
    }

    if (t.kind === N_LPAREN) {
      this.consume();
      const inner = this.parseAdditive();
      this.expect(N_RPAREN);
      return inner;
    }

    throw new Error(`Unexpected '${t.str ?? t.kind}' at position ${t.pos}`);
  }
}

/**
 * Compile a math expression string.
 *
 * Returns a `CompiledExpr` function on success, or an error message string
 * on parse failure. The compiled function returns null for any undefined
 * variable, division by zero, or non-finite result.
 */
export function compileExpr(src: string): CompiledExpr | string {
  const trimmed = src.trim();
  if (!trimmed) return 'Expression cannot be empty';
  try {
    const toks = tokenize(trimmed);
    const parser = new Parser(toks);
    const raw = parser.parse();
    return (v: Vars) => {
      const val = raw(v);
      if (val == null || !Number.isFinite(val)) return null;
      return val;
    };
  } catch (e) {
    return (e as Error).message;
  }
}
