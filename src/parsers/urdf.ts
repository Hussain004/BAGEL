/**
 * URDF XML parser - v1.3.0
 *
 * Parses URDF (`<robot>`) XML into a typed `UrdfModel`: a map of links + a
 * map of joints, plus root-link discovery so the 3D scene can walk the tree
 * starting from the world transform.
 *
 * Why a hand-rolled tokenizer and not `DOMParser`: URDFs are a tiny subset of
 * XML (no DTDs, no CDATA, no entity refs beyond the basic five), and BAGEL's
 * Node-based test runner doesn't carry a DOM. Rather than pull in
 * `@xmldom/xmldom` as a runtime dep or scope `jsdom` to one test file, we
 * walk the source ourselves. ~150 LOC, zero dependency, works identically
 * in the browser and the test fork.
 *
 * Scope:
 *   - Geometry primitives (`box`, `cylinder`, `sphere`, `mesh`) on `<visual>`
 *     and `<collision>`. We surface visuals; collision shapes are parsed but
 *     not currently rendered (kept for follow-ups).
 *   - Joints: `fixed`, `revolute`, `prismatic`, `continuous`, `floating`,
 *     `planar`. `<axis>`, `<origin>`, `<limit>`, and `<mimic>` are surfaced.
 *   - Material colour (rgba), via `<material><color rgba="..."/></material>`.
 *     Named-material references (`<material name="grey"/>` without an inline
 *     definition) resolve against any top-level `<material>` declarations.
 *
 * Out of scope (v1.3):
 *   - `<gazebo>`, `<sensor>`, `<transmission>`, `<safety_controller>` and any
 *     other extension elements that aren't part of the URDF visualisation
 *     model. Surfaced as `unknown-element` warnings so the user knows we saw
 *     them.
 *   - Xacro macros (`<xacro:include>`, `${...}` substitutions). Detected and
 *     surfaced as an explicit warning - users pre-process with `xacro` once.
 *   - Texture / material images. Colour only.
 */

export interface XYZRPY {
  /** Position in metres. */
  xyz: [number, number, number];
  /** Roll, pitch, yaw in radians. */
  rpy: [number, number, number];
}

export interface UrdfColor {
  rgba: [number, number, number, number];
}

export interface UrdfMaterial {
  /** Reference name (e.g. "grey"). May be empty if material is inline. */
  name?: string;
  color?: UrdfColor;
}

export type UrdfGeometry =
  | { kind: 'box'; size: [number, number, number] }
  | { kind: 'cylinder'; radius: number; length: number }
  | { kind: 'sphere'; radius: number }
  | { kind: 'mesh'; uri: string; scale: [number, number, number] };

export interface UrdfVisual {
  /** Optional name from `<visual name="…">`. */
  name?: string;
  origin?: XYZRPY;
  geometry: UrdfGeometry;
  material?: UrdfMaterial;
}

export interface UrdfLink {
  name: string;
  /** URDF allows multiple `<visual>` elements per link. Order preserved. */
  visuals: UrdfVisual[];
  /** Collision shapes (parsed but not rendered in v1.3.0). */
  collisions: UrdfVisual[];
}

export type UrdfJointType =
  | 'fixed'
  | 'revolute'
  | 'prismatic'
  | 'continuous'
  | 'floating'
  | 'planar';

export interface UrdfJointMimic {
  joint: string;
  multiplier: number;
  offset: number;
}

export interface UrdfJoint {
  name: string;
  type: UrdfJointType;
  parent: string;
  child: string;
  origin?: XYZRPY;
  /** Joint axis in the joint's local frame. Defaults to (1, 0, 0) per the spec. */
  axis: [number, number, number];
  /** Optional range limit (revolute/prismatic). */
  limit?: { lower: number; upper: number };
  /** This joint mimics another joint (`output = multiplier * mimic + offset`). */
  mimic?: UrdfJointMimic;
}

export interface UrdfModel {
  name: string;
  links: Map<string, UrdfLink>;
  joints: Map<string, UrdfJoint>;
  /** Top-level `<material>` declarations, keyed by name, for `<material name="…"/>` refs. */
  namedMaterials: Map<string, UrdfMaterial>;
  /** Links that are never a child of any joint (URDF roots, usually one). */
  rootLinks: string[];
  /** Distinct `package://` / `file://` / `http://` mesh URIs referenced anywhere in the model. */
  meshUris: string[];
}

export type UrdfWarningKind =
  | 'xacro'
  | 'unknown-element'
  | 'missing-link'
  | 'missing-attribute'
  | 'duplicate-name'
  | 'malformed';

export interface UrdfWarning {
  kind: UrdfWarningKind;
  message: string;
}

export interface UrdfParseResult {
  model: UrdfModel;
  warnings: UrdfWarning[];
}

// ─── Tiny XML tokenizer ────────────────────────────────────────────────────
//
// Recursive-descent. Handles:
//   - Elements: `<name attr="v" …>…</name>` and self-closing `<name …/>`.
//   - Attributes with single or double quoted values.
//   - The five core entity refs (`&amp; &lt; &gt; &quot; &apos;`).
//   - Comments (`<!-- … -->`) and processing instructions (`<? … ?>`) are
//     skipped.
//   - `<![CDATA[…]]>` is treated as text content (URDF never uses this, but
//     skipping it cleanly avoids crashing on the rare hand-edited file).
//
// Does NOT handle: DTD declarations, full XML namespace machinery (we only
// detect `xacro:` prefixes for the warning path), or extended entity refs.

export interface XmlElement {
  name: string;
  /** Namespace prefix if any (e.g. "xacro" for `<xacro:include>`). */
  prefix?: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated text content between child elements. URDF rarely uses this. */
  text: string;
}

class XmlError extends Error {}

function parseXml(source: string): XmlElement {
  let i = 0;
  const len = source.length;

  const skipWhitespace = (): void => {
    while (i < len) {
      const c = source.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };

  // Skip XML prolog / DOCTYPE / comments / processing instructions until the
  // first real element opens.
  const skipNoise = (): void => {
    while (i < len) {
      skipWhitespace();
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        if (end < 0) throw new XmlError('Unterminated comment');
        i = end + 3;
        continue;
      }
      if (source.startsWith('<?', i)) {
        const end = source.indexOf('?>', i + 2);
        if (end < 0) throw new XmlError('Unterminated processing instruction');
        i = end + 2;
        continue;
      }
      if (source.startsWith('<!DOCTYPE', i)) {
        // Minimal DOCTYPE skip: track depth across `[…]` and find the closing `>`.
        let depth = 0;
        i += 9;
        while (i < len) {
          const c = source[i];
          if (c === '[') depth++;
          else if (c === ']') depth--;
          else if (c === '>' && depth === 0) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      break;
    }
  };

  const decodeEntities = (s: string): string => {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, ref) => {
      switch (ref) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          if (ref.startsWith('#x') || ref.startsWith('#X')) {
            const code = parseInt(ref.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : '';
          }
          if (ref.startsWith('#')) {
            const code = parseInt(ref.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : '';
          }
          return `&${ref};`;
      }
    });
  };

  const isNameChar = (c: number): boolean => {
    // ASCII letters, digits, `-_.:` per XML name production (simplified for our use case).
    return (
      (c >= 48 && c <= 57) ||
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      c === 45 ||
      c === 46 ||
      c === 95 ||
      c === 58
    );
  };

  const readName = (): string => {
    const start = i;
    while (i < len && isNameChar(source.charCodeAt(i))) i++;
    return source.slice(start, i);
  };

  const readAttrValue = (): string => {
    const quote = source[i];
    if (quote !== '"' && quote !== "'") throw new XmlError('Expected attribute quote');
    i++;
    const start = i;
    while (i < len && source[i] !== quote) i++;
    if (i >= len) throw new XmlError('Unterminated attribute value');
    const raw = source.slice(start, i);
    i++;
    return decodeEntities(raw);
  };

  const readElement = (): XmlElement => {
    if (source[i] !== '<') throw new XmlError('Expected `<`');
    i++;
    const fullName = readName();
    if (!fullName) throw new XmlError('Expected element name');
    const colon = fullName.indexOf(':');
    const prefix = colon >= 0 ? fullName.slice(0, colon) : undefined;
    const name = colon >= 0 ? fullName.slice(colon + 1) : fullName;

    const attrs: Record<string, string> = {};
    while (true) {
      skipWhitespace();
      const c = source[i];
      if (c === '/' || c === '>') break;
      const attrName = readName();
      if (!attrName) throw new XmlError('Expected attribute name');
      skipWhitespace();
      if (source[i] !== '=') throw new XmlError('Expected `=` after attribute name');
      i++;
      skipWhitespace();
      attrs[attrName] = readAttrValue();
    }

    if (source[i] === '/') {
      i++;
      if (source[i] !== '>') throw new XmlError('Expected `>` after `/`');
      i++;
      return { name, prefix, attrs, children: [], text: '' };
    }
    if (source[i] !== '>') throw new XmlError('Expected `>`');
    i++;

    const children: XmlElement[] = [];
    let text = '';
    while (i < len) {
      if (source.startsWith('</', i)) {
        i += 2;
        skipWhitespace();
        const closeName = readName();
        if (closeName !== fullName) {
          throw new XmlError(`Mismatched closing tag: <${fullName}>…</${closeName}>`);
        }
        skipWhitespace();
        if (source[i] !== '>') throw new XmlError('Expected `>` at close');
        i++;
        return { name, prefix, attrs, children, text: text.trim() };
      }
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        if (end < 0) throw new XmlError('Unterminated comment');
        i = end + 3;
        continue;
      }
      if (source.startsWith('<![CDATA[', i)) {
        const end = source.indexOf(']]>', i + 9);
        if (end < 0) throw new XmlError('Unterminated CDATA');
        text += source.slice(i + 9, end);
        i = end + 3;
        continue;
      }
      if (source.startsWith('<?', i)) {
        const end = source.indexOf('?>', i + 2);
        if (end < 0) throw new XmlError('Unterminated processing instruction');
        i = end + 2;
        continue;
      }
      if (source[i] === '<') {
        children.push(readElement());
        continue;
      }
      // Plain character data — accumulate, decode entities on commit.
      const start = i;
      while (i < len && source[i] !== '<') i++;
      text += decodeEntities(source.slice(start, i));
    }
    throw new XmlError(`Unterminated element <${fullName}>`);
  };

  skipNoise();
  if (i >= len || source[i] !== '<') throw new XmlError('Empty XML document');
  return readElement();
}

// ─── URDF semantic layer ───────────────────────────────────────────────────

/** Parse `xyz="a b c"` / `rpy="a b c"` into a 3-tuple. */
function parse3(text: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!text) return fallback;
  const parts = text.trim().split(/\s+/);
  if (parts.length < 3) return fallback;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  return [
    Number.isFinite(x) ? x : fallback[0],
    Number.isFinite(y) ? y : fallback[1],
    Number.isFinite(z) ? z : fallback[2],
  ];
}

function parse4(text: string | undefined, fallback: [number, number, number, number]): [number, number, number, number] {
  if (!text) return fallback;
  const parts = text.trim().split(/\s+/);
  if (parts.length < 4) return fallback;
  const out = parts.slice(0, 4).map((p) => Number(p));
  return [
    Number.isFinite(out[0]) ? out[0] : fallback[0],
    Number.isFinite(out[1]) ? out[1] : fallback[1],
    Number.isFinite(out[2]) ? out[2] : fallback[2],
    Number.isFinite(out[3]) ? out[3] : fallback[3],
  ];
}

function parseOrigin(el: XmlElement | undefined): XYZRPY | undefined {
  if (!el) return undefined;
  return {
    xyz: parse3(el.attrs.xyz, [0, 0, 0]),
    rpy: parse3(el.attrs.rpy, [0, 0, 0]),
  };
}

function findChild(parent: XmlElement, name: string): XmlElement | undefined {
  for (const c of parent.children) if (c.name === name) return c;
  return undefined;
}

function findChildren(parent: XmlElement, name: string): XmlElement[] {
  return parent.children.filter((c) => c.name === name);
}

function parseGeometry(el: XmlElement | undefined): UrdfGeometry | null {
  if (!el) return null;
  const box = findChild(el, 'box');
  if (box) return { kind: 'box', size: parse3(box.attrs.size, [1, 1, 1]) };
  const cyl = findChild(el, 'cylinder');
  if (cyl) {
    const radius = Number(cyl.attrs.radius);
    const length = Number(cyl.attrs.length);
    return {
      kind: 'cylinder',
      radius: Number.isFinite(radius) ? radius : 0.1,
      length: Number.isFinite(length) ? length : 1,
    };
  }
  const sph = findChild(el, 'sphere');
  if (sph) {
    const radius = Number(sph.attrs.radius);
    return { kind: 'sphere', radius: Number.isFinite(radius) ? radius : 0.1 };
  }
  const mesh = findChild(el, 'mesh');
  if (mesh) {
    const uri = (mesh.attrs.filename ?? '').trim();
    return { kind: 'mesh', uri, scale: parse3(mesh.attrs.scale, [1, 1, 1]) };
  }
  return null;
}

function parseMaterial(el: XmlElement | undefined): UrdfMaterial | undefined {
  if (!el) return undefined;
  const out: UrdfMaterial = {};
  if (el.attrs.name) out.name = el.attrs.name;
  const color = findChild(el, 'color');
  if (color) out.color = { rgba: parse4(color.attrs.rgba, [1, 1, 1, 1]) };
  return out;
}

function parseVisual(el: XmlElement): UrdfVisual | null {
  const geometry = parseGeometry(findChild(el, 'geometry'));
  if (!geometry) return null;
  const out: UrdfVisual = { geometry };
  if (el.attrs.name) out.name = el.attrs.name;
  const origin = parseOrigin(findChild(el, 'origin'));
  if (origin) out.origin = origin;
  const material = parseMaterial(findChild(el, 'material'));
  if (material) out.material = material;
  return out;
}

function parseLink(el: XmlElement, warnings: UrdfWarning[]): UrdfLink | null {
  const name = el.attrs.name;
  if (!name) {
    warnings.push({ kind: 'missing-attribute', message: '<link> missing required `name` attribute' });
    return null;
  }
  const visuals: UrdfVisual[] = [];
  for (const v of findChildren(el, 'visual')) {
    const parsed = parseVisual(v);
    if (parsed) visuals.push(parsed);
  }
  const collisions: UrdfVisual[] = [];
  for (const v of findChildren(el, 'collision')) {
    const parsed = parseVisual(v);
    if (parsed) collisions.push(parsed);
  }
  return { name, visuals, collisions };
}

function parseJoint(el: XmlElement, warnings: UrdfWarning[]): UrdfJoint | null {
  const name = el.attrs.name;
  const type = el.attrs.type as UrdfJointType | undefined;
  if (!name) {
    warnings.push({ kind: 'missing-attribute', message: '<joint> missing required `name` attribute' });
    return null;
  }
  if (!type || !['fixed', 'revolute', 'prismatic', 'continuous', 'floating', 'planar'].includes(type)) {
    warnings.push({
      kind: 'missing-attribute',
      message: `<joint name="${name}"> has invalid or missing type "${type ?? ''}"`,
    });
    return null;
  }
  const parentEl = findChild(el, 'parent');
  const childEl = findChild(el, 'child');
  const parent = parentEl?.attrs.link;
  const child = childEl?.attrs.link;
  if (!parent || !child) {
    warnings.push({
      kind: 'missing-attribute',
      message: `<joint name="${name}"> missing parent or child link`,
    });
    return null;
  }
  const axis = parse3(findChild(el, 'axis')?.attrs.xyz, [1, 0, 0]);
  const origin = parseOrigin(findChild(el, 'origin'));
  const limitEl = findChild(el, 'limit');
  let limit: { lower: number; upper: number } | undefined;
  if (limitEl) {
    const lower = Number(limitEl.attrs.lower);
    const upper = Number(limitEl.attrs.upper);
    if (Number.isFinite(lower) && Number.isFinite(upper)) {
      limit = { lower, upper };
    }
  }
  let mimic: UrdfJointMimic | undefined;
  const mimicEl = findChild(el, 'mimic');
  if (mimicEl?.attrs.joint) {
    const multiplier = Number(mimicEl.attrs.multiplier);
    const offset = Number(mimicEl.attrs.offset);
    mimic = {
      joint: mimicEl.attrs.joint,
      multiplier: Number.isFinite(multiplier) ? multiplier : 1,
      offset: Number.isFinite(offset) ? offset : 0,
    };
  }
  const out: UrdfJoint = { name, type, parent, child, axis };
  if (origin) out.origin = origin;
  if (limit) out.limit = limit;
  if (mimic) out.mimic = mimic;
  return out;
}

/** Walk the entire document for `xacro:`-prefixed elements or `${…}` substitutions. */
function detectXacro(root: XmlElement): boolean {
  const stack: XmlElement[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (el.prefix === 'xacro') return true;
    for (const key of Object.keys(el.attrs)) {
      if (key.startsWith('xacro:')) return true;
      if (el.attrs[key].includes('${')) return true;
    }
    for (const c of el.children) stack.push(c);
  }
  return false;
}

/**
 * Parse URDF XML text into a typed model + per-element warnings.
 *
 * Throws on a fatal parse error (malformed XML, missing `<robot>` root,
 * unprocessed xacro). Anything recoverable is surfaced as a warning so the
 * modal can show "we saw these issues but the model still rendered".
 */
export function parseUrdf(xmlText: string): UrdfParseResult {
  if (!xmlText || !xmlText.trim()) {
    throw new Error('URDF text is empty.');
  }

  let root: XmlElement;
  try {
    root = parseXml(xmlText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Malformed URDF XML: ${message}`, { cause: err });
  }

  if (root.name !== 'robot') {
    throw new Error(
      `Expected top-level <robot> element, got <${root.name}>. Is this a URDF?`,
    );
  }

  if (detectXacro(root)) {
    throw new Error(
      'This file contains xacro macros (e.g. <xacro:include>) or ${…} expressions. ' +
        'BAGEL does not run xacro - pre-process with `xacro your.urdf.xacro > your.urdf` ' +
        'first and drop the resulting URDF here.',
    );
  }

  const warnings: UrdfWarning[] = [];
  const links = new Map<string, UrdfLink>();
  const joints = new Map<string, UrdfJoint>();
  const namedMaterials = new Map<string, UrdfMaterial>();

  // First pass: top-level materials (so links that reference them by name resolve).
  for (const m of findChildren(root, 'material')) {
    const mat = parseMaterial(m);
    if (mat?.name) namedMaterials.set(mat.name, mat);
  }

  for (const linkEl of findChildren(root, 'link')) {
    const link = parseLink(linkEl, warnings);
    if (!link) continue;
    if (links.has(link.name)) {
      warnings.push({
        kind: 'duplicate-name',
        message: `Duplicate <link name="${link.name}">; using the first.`,
      });
      continue;
    }
    // Resolve named material references against top-level declarations.
    for (const v of link.visuals) {
      if (v.material?.name && !v.material.color) {
        const ref = namedMaterials.get(v.material.name);
        if (ref?.color) v.material.color = ref.color;
      }
    }
    links.set(link.name, link);
  }

  for (const jointEl of findChildren(root, 'joint')) {
    const joint = parseJoint(jointEl, warnings);
    if (!joint) continue;
    if (joints.has(joint.name)) {
      warnings.push({
        kind: 'duplicate-name',
        message: `Duplicate <joint name="${joint.name}">; using the first.`,
      });
      continue;
    }
    joints.set(joint.name, joint);
  }

  // Surface unknown top-level elements (gazebo, sensor, transmission, …).
  // Tracked once per distinct element name to avoid spamming warnings on
  // URDFs with hundreds of `<gazebo>` blocks.
  const seenUnknown = new Set<string>();
  const known = new Set(['link', 'joint', 'material']);
  for (const child of root.children) {
    if (known.has(child.name)) continue;
    if (seenUnknown.has(child.name)) continue;
    seenUnknown.add(child.name);
    warnings.push({
      kind: 'unknown-element',
      message: `Ignoring <${child.name}> element(s) - not part of the URDF visualisation model.`,
    });
  }

  // Validate joint endpoints reference real links.
  for (const joint of joints.values()) {
    if (!links.has(joint.parent)) {
      warnings.push({
        kind: 'missing-link',
        message: `<joint name="${joint.name}"> references unknown parent link "${joint.parent}".`,
      });
    }
    if (!links.has(joint.child)) {
      warnings.push({
        kind: 'missing-link',
        message: `<joint name="${joint.name}"> references unknown child link "${joint.child}".`,
      });
    }
  }

  // Roots: links never referenced as a joint's child.
  const childSet = new Set<string>();
  for (const joint of joints.values()) childSet.add(joint.child);
  const rootLinks: string[] = [];
  for (const linkName of links.keys()) {
    if (!childSet.has(linkName)) rootLinks.push(linkName);
  }
  rootLinks.sort();

  const meshUris = collectMeshUris(links);

  const name = root.attrs.name ?? 'robot';
  return {
    model: { name, links, joints, namedMaterials, rootLinks, meshUris },
    warnings,
  };
}

function collectMeshUris(links: Map<string, UrdfLink>): string[] {
  const set = new Set<string>();
  for (const link of links.values()) {
    for (const v of [...link.visuals, ...link.collisions]) {
      if (v.geometry.kind === 'mesh' && v.geometry.uri) {
        set.add(v.geometry.uri);
      }
    }
  }
  return Array.from(set).sort();
}

/**
 * Extract the set of distinct `package://<name>` package names referenced by
 * the model's mesh URIs. Used by the resolver-prompt step in the URDF modal.
 */
export function extractPackageNames(model: UrdfModel): string[] {
  const set = new Set<string>();
  for (const uri of model.meshUris) {
    const match = uri.match(/^package:\/\/([^/]+)\//);
    if (match) set.add(match[1]);
  }
  return Array.from(set).sort();
}
