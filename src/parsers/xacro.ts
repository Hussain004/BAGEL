/**
 * A xacro evaluator: expands a `.xacro` / `.urdf.xacro` file into plain URDF
 * in the browser, following ROS 2 xacro (2.x, in-order processing). The test
 * fixtures match ROS xacro 2.1.1's output exactly, and the ros2_control_demos
 * and urdf_tutorial descriptions expand and parse. Mirrored from xacro's own
 * source where it matters:
 *
 * - properties: `value`, `default`, `remove`, `scope="parent|global"`,
 *   `lazy_eval`, and block properties; every stored value goes through
 *   xacro's `_eval_literal` (so "0.5" becomes a number), and lazy ones are
 *   evaluated on first use in the table that holds them;
 * - `${...}` (see xacroExpr.ts), `$(arg)`, `$(find pkg)` (as `package://pkg`,
 *   which BAGEL's package mapping resolves), `$(eval)`, `$(optenv)`,
 *   `$(dirname)`, and `$$` escapes; a lone `${...}` keeps its type;
 * - macros with defaults (`a:=1`), forwarding (`a:=^`, `a:=^|1`), `*block`
 *   and `**content` parameters, `insert_block`, dynamic `xacro:call`, and
 *   the caller's scope visible inside the body, as xacro does;
 * - `xacro:if` / `unless`, `xacro:arg`, `xacro:element` / `attribute`, and
 *   `xacro:include` (with `ns` and `optional`) through a caller-supplied reader.
 *
 * Not supported: `load_yaml` (BAGEL has no YAML parser; it fails with a clear
 * message, which rules out e.g. the UR descriptions), `'...' % x` string
 * formatting, comment evaluation, `$(env)` (a browser has no environment),
 * and globbed includes.
 */

import { detectXacro, parseXml, type XmlElement } from './urdf';
import { PyFloat, XacroError, evaluate, globalNames, parsePyFloat, pyStr, truthy, type Lookup, type Members, type Value } from './xacroExpr';

export { XacroError };

export interface XacroOptions {
  /** Values for `$(arg name)`, overriding `<xacro:arg default>`. */
  args?: Record<string, string>;
  /** URI of the file being expanded, for relative includes and `$(dirname)`. */
  uri?: string;
  /** Read an included file by URI (`package://pkg/...` or a path relative to `uri`). */
  readFile?: (uri: string) => Promise<string>;
}

// --- symbol tables (xacro's Table / NameSpace) --------------------------------

type Block = { block: XmlElement };
const isBlock = (v: unknown): v is Block => typeof v === 'object' && v !== null && 'block' in v;

class Table implements Members {
  readonly vals = new Map<string, Value>();
  readonly lazy = new Set<string>();
  private readonly resolving: string[] = [];
  readonly parent: Table | null;
  readonly isNamespace: boolean;
  readonly ctx: Ctx;
  constructor(parent: Table | null, ctx: Ctx, isNamespace = false) {
    this.parent = parent;
    this.ctx = ctx;
    this.isNamespace = isNamespace;
  }

  set(key: string, value: Value, unevaluated: boolean): void {
    const v = literal(value);
    this.vals.set(key, v);
    if (unevaluated && typeof v === 'string') this.lazy.add(key);
    else this.lazy.delete(key);
  }

  has(key: string): boolean {
    return this.vals.has(key) || (this.parent?.has(key) ?? false);
  }

  get(key: string): Value | undefined {
    if (this.vals.has(key)) {
      if (this.lazy.has(key)) {
        if (this.resolving.includes(key)) {
          throw new XacroError(`circular variable definition: ${[...this.resolving, key].join(' -> ')}`);
        }
        this.resolving.push(key);
        try {
          this.vals.set(key, literal(evalText(this.vals.get(key) as string, this)));
        } finally {
          this.resolving.pop();
        }
        this.lazy.delete(key);
      }
      return this.vals.get(key);
    }
    return this.parent ? this.parent.get(key) : undefined;
  }

  delete(key: string): void {
    this.vals.delete(key);
    this.parent?.delete(key);
  }

  /** The outermost table (xacro's top(): the document's global scope). */
  top(): Table {
    return this.parent ? this.parent.top() : this;
  }

  member(name: string): Value | undefined {
    return this.get(name);
  }

  lookup: Lookup = (name) => this.get(name) ?? this.ctx.globals(name);
}

/** xacro's Table._eval_literal: stored text that reads as a number or boolean becomes one. */
function literal(v: Value): Value {
  if (typeof v !== 'string') return v;
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1);
  if (v.includes('_')) return v;
  if (/^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10);
  const f = parsePyFloat(v);
  if (f !== null) return new PyFloat(f);
  if (v === 'true' || v === 'True') return true;
  if (v === 'false' || v === 'False') return false;
  return v;
}

interface Macro {
  params: string[];
  defaults: Map<string, { forward: string | null; value: string | null }>;
  body: XmlElement;
}

class MacroTable {
  readonly map = new Map<string, Macro | MacroTable>();
  readonly parent: MacroTable | null;
  constructor(parent: MacroTable | null) {
    this.parent = parent;
  }
  get(name: string): Macro | MacroTable | undefined {
    return this.map.get(name) ?? this.parent?.get(name);
  }
}

interface Ctx {
  args: Record<string, string>;
  globals: Lookup;
  readFile?: (uri: string) => Promise<string>;
  /** Stack of file URIs being expanded (top is the current one). */
  files: string[];
}

// --- text: ${...}, $(...), $$ -----------------------------------------------

/** xacro's eval_text: a lone expression keeps its type, otherwise the pieces join as text. */
function evalText(text: string, symbols: Table): Value {
  if (!text.includes('$')) return text;
  const parts: Value[] = [];
  const re = /\$\$+[{(]|\$\{[^}]*\}|\$\([^)]*\)|[^$]+|\$[^{($]+|\$$/y;
  while (re.lastIndex < text.length) {
    const m = re.exec(text);
    if (!m) throw new XacroError(`Unterminated substitution in "${text}"`);
    const tok = m[0];
    if (/^\$\$+[{(]$/.test(tok)) parts.push(tok.slice(1));
    else if (tok.startsWith('${')) parts.push(evalExpr(pyStr(evalText(tok.slice(2, -1), symbols)), symbols));
    else if (tok.startsWith('$(')) parts.push(evalExtension(pyStr(evalText(tok.slice(2, -1), symbols)), symbols));
    else parts.push(tok);
  }
  return parts.length === 1 ? parts[0]! : parts.map(pyStr).join('');
}

function evalExpr(src: string, symbols: Table): Value {
  try {
    return evaluate(src.trim(), symbols.lookup);
  } catch (err) {
    throw new XacroError(`${err instanceof Error ? err.message : String(err)}\nwhen evaluating expression '${src}'`);
  }
}

function evalExtension(src: string, symbols: Table): Value {
  const [cmd, ...rest] = src.trim().split(/\s+/);
  const ctx = symbols.ctx;
  switch (cmd) {
    case 'arg': {
      const v = ctx.args[rest[0] ?? ''];
      if (v === undefined) throw new XacroError(`Undefined substitution argument ${rest[0]}`);
      return v;
    }
    case 'find':
      return `package://${rest[0]}`;
    case 'eval':
      return evalExpr(src.trim().slice(4), symbols);
    case 'optenv':
      return rest.slice(1).join(' ');
    case 'dirname': {
      const f = ctx.files[ctx.files.length - 1] ?? '';
      return f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
    }
    case 'env':
      throw new XacroError(`$(env ${rest[0]}): a browser has no environment variables; use $(optenv ${rest[0]} default)`);
    default:
      throw new XacroError(`Unknown substitution $(${src})`);
  }
}

/** xacro's get_boolean_value for if / unless conditions. */
function asCondition(v: Value, original: string): boolean {
  if (typeof v === 'string') {
    if (v === 'true' || v === 'True') return true;
    if (v === 'false' || v === 'False') return false;
    if (/^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10) !== 0;
    throw new XacroError(`Xacro conditional "${original}" evaluated to "${v}", which is not a boolean expression.`);
  }
  return truthy(v);
}

// --- tree helpers -------------------------------------------------------------

const tagOf = (el: XmlElement) => (el.prefix ? `${el.prefix}:${el.name}` : el.name);
const clone = (el: XmlElement): XmlElement => ({ ...el, attrs: { ...el.attrs }, children: el.children.map(clone) });

function setTag(el: XmlElement, tag: string) {
  const i = tag.indexOf(':');
  el.prefix = i >= 0 ? tag.slice(0, i) : undefined;
  el.name = i >= 0 ? tag.slice(i + 1) : tag;
}

function attr(el: XmlElement, name: string, required = true): string | undefined {
  const v = el.attrs[name];
  if (v === undefined && required) throw new XacroError(`<${tagOf(el)}> is missing its "${name}" attribute`);
  return v;
}

/** URI of `ref` relative to the file `base` (package://, http(s) and bare paths). */
export function joinUri(base: string, ref: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref) || ref.startsWith('/')) return ref;
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]*\/?)(.*)$/i.exec(base);
  const [root, path] = m ? [m[1]!, m[2]!] : ['', base];
  const dir = path.split('/').slice(0, -1);
  for (const seg of ref.split('/')) {
    if (seg === '..') dir.pop();
    else if (seg && seg !== '.') dir.push(seg);
  }
  return root + dir.join('/');
}

// --- in-order processing (xacro's eval_all) -----------------------------------

const MACRO_ARG = /^\s*([^\s:=]+?)\s*:?=\s*(\^\|?)?(\$\{.*?\}|\$\(.*?\)|(?:'.*?'|".*?"|[^\s'"]+)+|)(?:\s+|$)(.*)$/;

function grabMacro(el: XmlElement, macros: MacroTable) {
  let name = attr(el, 'name')!;
  if (name === 'call') throw new XacroError("Invalid use of macro name 'call'");
  if (name.includes('.')) throw new XacroError(`macro names must not contain '.': ${name}`);
  if (name.startsWith('xacro:')) name = name.slice(6);
  // XML attribute normalisation turns newlines into spaces before xacro sees them.
  let params = (el.attrs.params ?? '').replace(/\s+/g, ' ');
  const macro: Macro = { params: [], defaults: new Map(), body: el };
  while (params.trim()) {
    const m = MACRO_ARG.exec(params);
    if (m) {
      const [, param, forward, value, rest] = m;
      macro.params.push(param!);
      macro.defaults.set(param!, { forward: forward ? param! : null, value: value || null });
      params = rest!;
    } else {
      const [param, ...rest] = params.trim().split(/\s+/);
      macro.params.push(param!);
      params = rest.join(' ');
    }
  }
  macros.map.set(name, macro);
}

function grabProperty(el: XmlElement, table: Table) {
  const name = pyStr(evalText(attr(el, 'name')!, table));
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new XacroError(`Property names must be valid python identifiers: ${name}`);
  if (name.startsWith('__')) throw new XacroError(`Property names must not start with double underscore: ${name}`);
  let value: Value | undefined = el.attrs.value;
  const def = el.attrs.default;
  const remove = asCondition(evalText(el.attrs.remove ?? 'false', table), el.attrs.remove ?? 'false');
  if ([value !== undefined, def !== undefined, remove].filter(Boolean).length > 1) {
    throw new XacroError(`Property attributes default, value, and remove are mutually exclusive: ${name}`);
  }
  if (remove) {
    table.delete(name);
    return;
  }
  if (def !== undefined) {
    if (table.has(name)) return;
    value = def;
  }
  let key = name;
  if (value === undefined) {
    key = `**${name}`;
    value = { block: el } as Block;
  }
  let lazy = asCondition(evalText(el.attrs.lazy_eval ?? 'true', table), el.attrs.lazy_eval ?? 'true');
  let target = table;
  const scope = el.attrs.scope;
  if (scope === 'global') {
    target = table.top();
    lazy = false;
  } else if (scope === 'parent') {
    if (!table.parent) return;
    target = table.parent;
    lazy = false;
    if (!table.isNamespace) while (target.isNamespace && target.parent) target = target.parent;
  }
  if (!lazy && typeof value === 'string') value = evalText(value, table);
  target.set(key, value, lazy);
}

async function evalAll(el: XmlElement, macros: MacroTable, symbols: Table): Promise<void> {
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k.startsWith('xacro:') || k === 'xmlns:xacro') delete el.attrs[k];
    // `file://$(find pkg)/...` (common in Gazebo-minded descriptions) would read file://package://.
    else el.attrs[k] = pyStr(evalText(v, symbols)).replace(/file:\/\/(?=package:\/\/)/g, '');
  }
  if (el.text) el.text = pyStr(evalText(el.text, symbols));
  const out: XmlElement[] = [];
  for (const child of el.children) out.push(...(await evalNode(child, el, macros, symbols)));
  el.children = out;
}

/** Evaluate one child node; returns what replaces it in its parent. */
async function evalNode(node: XmlElement, parent: XmlElement, macros: MacroTable, symbols: Table): Promise<XmlElement[]> {
  const tag = tagOf(node);
  switch (tag) {
    case 'xacro:insert_block': {
      const name = attr(node, 'name')!;
      const multi = symbols.get(`**${name}`);
      const single = multi === undefined ? symbols.get(`*${name}`) : undefined;
      const found = multi ?? single;
      if (!isBlock(found)) throw new XacroError(`Undefined block "${name}"`);
      const block = clone(found.block);
      await evalAll(block, macros, symbols);
      return multi !== undefined ? block.children : [block];
    }
    case 'xacro:include':
      return processInclude(node, macros, symbols);
    case 'xacro:property':
      grabProperty(node, symbols);
      return [];
    case 'xacro:macro':
      grabMacro(node, macros);
      return [];
    case 'xacro:arg': {
      const name = attr(node, 'name')!;
      if (!(name in symbols.ctx.args)) symbols.ctx.args[name] = pyStr(evalText(attr(node, 'default')!, symbols));
      return [];
    }
    case 'xacro:element': {
      const name = pyStr(evalText(attr(node, 'xacro:name')!, symbols));
      if (!name) throw new XacroError('xacro:element: empty name');
      delete node.attrs['xacro:name'];
      setTag(node, name);
      return evalNode(node, parent, macros, symbols);
    }
    case 'xacro:attribute': {
      const name = pyStr(evalText(attr(node, 'name')!, symbols));
      if (!name) throw new XacroError('xacro:attribute: empty name');
      parent.attrs[name] = pyStr(evalText(attr(node, 'value')!, symbols));
      return [];
    }
    case 'xacro:if':
    case 'xacro:unless': {
      const cond = attr(node, 'value')!;
      let keep = asCondition(evalText(cond, symbols), cond);
      if (tag === 'xacro:unless') keep = !keep;
      if (!keep) return [];
      await evalAll(node, macros, symbols);
      return node.children;
    }
  }
  if (node.prefix === 'xacro') return callMacro(node, macros, symbols);
  await evalAll(node, macros, symbols);
  return [node];
}

function resolveMacro(fullName: string, macros: MacroTable, symbols: Table): { macro: Macro; macros: MacroTable; symbols: Table } {
  const direct = macros.get(fullName);
  if (direct && !(direct instanceof MacroTable)) return { macro: direct, macros, symbols };
  const path = fullName.split('.');
  const name = path.pop()!;
  let m: MacroTable = macros;
  let s: Table = symbols;
  for (const ns of path) {
    const nm = m.get(ns);
    const nsym = s.get(ns);
    if (!(nm instanceof MacroTable) || !(nsym instanceof Table)) throw new XacroError(`unknown macro name: xacro:${fullName}`);
    m = nm;
    s = nsym;
  }
  const macro = path.length > 0 ? m.get(name) : undefined;
  if (!macro || macro instanceof MacroTable) throw new XacroError(`unknown macro name: xacro:${fullName}`);
  return { macro, macros: m, symbols: s };
}

async function callMacro(node: XmlElement, macros: MacroTable, symbols: Table): Promise<XmlElement[]> {
  let name = node.name;
  if (name === 'call') {
    name = pyStr(evalText(attr(node, 'macro')!, symbols));
    delete node.attrs.macro;
  }
  const found = resolveMacro(name, macros, symbols);
  const m = found.macro;
  const body = clone(m.body);
  const scoped = new Table(found.symbols, symbols.ctx);
  const scopedMacros = new MacroTable(found.macros);
  const params = [...m.params];
  for (const [k, v] of Object.entries(node.attrs)) {
    const at = params.indexOf(k);
    if (at < 0) throw new XacroError(`Invalid parameter "${k}" for macro "${name}"`);
    params.splice(at, 1);
    scoped.set(k, evalText(v, symbols), false);
  }
  node.attrs = {};
  // Block arguments are evaluated in the caller's scope, then handed over in order.
  await evalAll(node, macros, symbols);
  const blocks = [...node.children];
  for (const param of [...params]) {
    if (!param.startsWith('*')) continue;
    const block = blocks.shift();
    if (!block) throw new XacroError(`Not enough blocks for macro "${name}"`);
    params.splice(params.indexOf(param), 1);
    scoped.set(param, { block } as Block, true);
  }
  if (blocks.length > 0) throw new XacroError(`Unused block "${tagOf(blocks[0]!)}" in a call of macro "${name}"`);
  for (const param of [...params]) {
    const d = m.defaults.get(param);
    if (!d) continue;
    let value: Value | undefined;
    if (d.forward !== null) value = symbols.get(d.forward);
    if (value === undefined) {
      if (d.value === null) throw new XacroError(`Undefined substitution argument ${param} (forwarded with ^ but not defined)`);
      value = evalText(d.value, symbols);
    }
    scoped.set(param, value, false);
    params.splice(params.indexOf(param), 1);
  }
  if (params.length > 0) throw new XacroError(`Undefined parameters [${params.join(',')}] for macro "${name}"`);
  // The macro element's own name / params were consumed at definition; only its content expands.
  body.attrs = {};
  await evalAll(body, scopedMacros, scoped);
  return body.children;
}

async function processInclude(node: XmlElement, macros: MacroTable, symbols: Table): Promise<XmlElement[]> {
  const ctx = symbols.ctx;
  const spec = pyStr(evalText(attr(node, 'filename')!, symbols));
  if (/[*?[]/.test(spec)) throw new XacroError(`Globbed include "${spec}" is not supported`);
  const optional = node.attrs.optional !== undefined && asCondition(evalText(node.attrs.optional, symbols), node.attrs.optional);
  const uri = joinUri(ctx.files[ctx.files.length - 1] ?? '', spec);
  let nsMacros = macros;
  let nsSymbols = symbols;
  if (node.attrs.ns) {
    const ns = pyStr(evalText(node.attrs.ns, symbols));
    nsMacros = new MacroTable(macros);
    nsSymbols = new Table(symbols, ctx, true);
    macros.map.set(ns, nsMacros);
    symbols.set(ns, nsSymbols as unknown as Value, false);
  }
  if (!ctx.readFile) throw new XacroError(`Cannot include "${spec}": no way to read other files here`);
  if (ctx.files.includes(uri)) throw new XacroError(`"${uri}" includes itself`);
  let text: string;
  try {
    text = await ctx.readFile(uri);
  } catch (err) {
    if (optional) return [];
    throw new XacroError(`Cannot include "${spec}" (${uri}): ${err instanceof Error ? err.message : String(err)}`);
  }
  const root = parseXml(text);
  ctx.files.push(uri);
  try {
    await evalAll(root, nsMacros, nsSymbols);
  } finally {
    ctx.files.pop();
  }
  return root.children;
}

// --- output -------------------------------------------------------------------

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

export function serializeXml(el: XmlElement, indent = ''): string {
  const attrs = Object.entries(el.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  const tag = tagOf(el);
  if (el.children.length === 0 && !el.text) return `${indent}<${tag}${attrs}/>`;
  const inner = [el.text ? `${indent}  ${escText(el.text)}` : '', ...el.children.map((c) => serializeXml(c, `${indent}  `))].filter(Boolean);
  return `${indent}<${tag}${attrs}>\n${inner.join('\n')}\n${indent}</${tag}>`;
}

/** Whether text is a xacro document (xacro elements or `${...}`); false for anything that is not XML. */
export function isXacro(text: string): boolean {
  try {
    return detectXacro(parseXml(text));
  } catch {
    return false;
  }
}

/** Expand a xacro document into URDF XML text. Throws XacroError with xacro-style messages. */
export async function expandXacro(text: string, opts: XacroOptions = {}): Promise<string> {
  const args = { ...(opts.args ?? {}) };
  const ctx: Ctx = { args, globals: globalNames(args), readFile: opts.readFile, files: [opts.uri ?? ''] };
  const root = parseXml(text);
  const symbols = new Table(null, ctx);
  await evalAll(root, new MacroTable(null), symbols);
  return `<?xml version="1.0"?>\n${serializeXml(root)}\n`;
}
