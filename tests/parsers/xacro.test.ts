/**
 * xacro expansion. The *.expected.urdf fixtures were produced by the real
 * ROS xacro 2.1.1 (pip install xacro; xacro f.urdf.xacro -o f.expected.urdf),
 * so these compare BAGEL against the reference tool, attribute for attribute.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandXacro, joinUri } from '../../src/parsers/xacro';
import { parseUrdf, parseXml, type XmlElement } from '../../src/parsers/urdf';
import { evaluate, floatRepr, globalNames, pyStr } from '../../src/parsers/xacroExpr';

const DIR = join(__dirname, '../fixtures/xacro');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const readFile = async (uri: string) => read(uri);

/** Order-insensitive attributes, ordered children, trimmed text. */
const norm = (el: XmlElement): unknown => ({
  tag: el.prefix ? `${el.prefix}:${el.name}` : el.name,
  attrs: Object.fromEntries(Object.entries(el.attrs).sort(([a], [b]) => a.localeCompare(b))),
  text: el.text.trim(),
  children: el.children.map(norm),
});

const expand = (src: string, args?: Record<string, string>) => expandXacro(src, { args, readFile });

describe('expandXacro matches ROS xacro', () => {
  for (const name of ['basic', 'macros', 'includes']) {
    it(`${name}.urdf.xacro`, async () => {
      const out = await expandXacro(read(`${name}.urdf.xacro`), { uri: `${name}.urdf.xacro`, readFile });
      expect(norm(parseXml(out))).toEqual(norm(parseXml(read(`${name}.expected.urdf`))));
    });
  }

  it('the expanded basic robot parses as a URDF', async () => {
    const { model } = parseUrdf(await expandXacro(read('basic.urdf.xacro')), { xacroExpanded: true });
    expect([...model.links.keys()]).toEqual(expect.arrayContaining(['bot_base', 'bot_left_wheel', 'bot_right_wheel', 'lidar', 'always']));
    expect(model.links.has('never')).toBe(false);
  });

  it('applies $(arg) overrides over <xacro:arg default>', async () => {
    const { model } = parseUrdf(await expandXacro(read('basic.urdf.xacro'), { args: { prefix: 'r2_', use_lidar: 'false' } }), { xacroExpanded: true });
    expect(model.links.has('r2_base')).toBe(true);
    expect(model.links.has('lidar')).toBe(false);
  });
});

describe('expandXacro errors (the same cases ROS xacro rejects)', () => {
  const wrap = (body: string) => `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="t">${body}</robot>`;

  it('a root attribute using a property defined later', async () => {
    await expect(expand('<robot xmlns:xacro="x" name="${n}"><xacro:property name="n" value="a"/></robot>')).rejects.toThrow(/name 'n' is not defined/);
  });

  it('more block arguments than the macro takes', async () => {
    await expect(expand(wrap('<xacro:macro name="m" params="*b"><xacro:insert_block name="b"/></xacro:macro><xacro:m><a/><b/></xacro:m>'))).rejects.toThrow(/Unused block "b"/);
  });

  it('abs() is only available as python.abs()', async () => {
    await expect(expand(wrap('<l v="${abs(-1)}"/>'))).rejects.toThrow(/name 'abs' is not defined/);
    expect(await expand(wrap('<l v="${python.abs(-1)}"/>'))).toContain('v="1"');
  });

  it('a circular lazy property', async () => {
    await expect(expand(wrap('<xacro:property name="a" value="${b}"/><xacro:property name="b" value="${a}"/><l v="${a}"/>'))).rejects.toThrow(/circular variable definition/);
  });

  it('an unknown macro, a missing parameter, and an unknown parameter', async () => {
    await expect(expand(wrap('<xacro:nope/>'))).rejects.toThrow(/unknown macro name: xacro:nope/);
    await expect(expand(wrap('<xacro:macro name="m" params="a"/><xacro:m/>'))).rejects.toThrow(/Undefined parameters \[a\]/);
    await expect(expand(wrap('<xacro:macro name="m" params="a"/><xacro:m a="1" b="2"/>'))).rejects.toThrow(/Invalid parameter "b"/);
  });

  it('an unterminated substitution, and a non-integer index', async () => {
    await expect(expand(wrap('<l v="a ${1 + 2"/>'))).rejects.toThrow(/Unterminated substitution/);
    await expect(expand(wrap('<l v="${[1, 2][0.5]}"/>'))).rejects.toThrow(/indices must be integers/);
  });

  it('cannot reach JavaScript internals through names or members', async () => {
    for (const e of ['math.constructor', "python.constructor.constructor('return 1')()", 'xacro.hasOwnProperty', 'constructor', 'toString']) {
      await expect(expand(wrap(`<l v="\${${e}}"/>`)), e).rejects.toThrow(/has no attribute|is not defined/);
    }
  });

  it('a non-boolean condition', async () => {
    await expect(expand(wrap('<xacro:if value="maybe"><l/></xacro:if>'))).rejects.toThrow(/not a boolean expression/);
  });

  it('a missing include, unless optional; and a self-include', async () => {
    const reader = async (uri: string) => {
      if (uri === 'self.xacro') return wrap('<xacro:include filename="self.xacro"/>');
      throw new Error('404');
    };
    await expect(expandXacro(wrap('<xacro:include filename="gone.xacro"/>'), { readFile: reader })).rejects.toThrow(/Cannot include "gone.xacro"/);
    await expect(expandXacro(wrap('<xacro:include filename="gone.xacro" optional="true"/><l/>'), { readFile: reader })).resolves.toContain('<l/>');
    await expect(expandXacro(wrap('<xacro:include filename="self.xacro"/>'), { uri: 'top.xacro', readFile: reader })).rejects.toThrow(/includes itself/);
  });
});

describe('expandXacro details', () => {
  const wrap = (body: string) => `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="t">${body}</robot>`;

  it('$(find pkg) becomes a package:// URI, and includes resolve through it', async () => {
    const seen: string[] = [];
    const reader = async (uri: string) => {
      seen.push(uri);
      return wrap('<xacro:property name="r" value="0.3"/>');
    };
    const out = await expandXacro(wrap('<xacro:include filename="$(find my_robot)/urdf/parts.xacro"/><m f="$(find my_robot)/meshes/a.dae" r="${r}"/>'), { readFile: reader });
    expect(seen).toEqual(['package://my_robot/urdf/parts.xacro']);
    expect(out).toContain('f="package://my_robot/meshes/a.dae"');
    expect(out).toContain('r="0.3"');
  });

  it('relative includes resolve against the including file, at any depth', () => {
    expect(joinUri('package://pkg/urdf/robot.xacro', 'parts/arm.xacro')).toBe('package://pkg/urdf/parts/arm.xacro');
    expect(joinUri('package://pkg/urdf/parts/arm.xacro', '../common.xacro')).toBe('package://pkg/urdf/common.xacro');
    expect(joinUri('robot.xacro', 'a.xacro')).toBe('a.xacro');
    expect(joinUri('https://h.example/x/r.xacro', 'y.xacro')).toBe('https://h.example/x/y.xacro');
    expect(joinUri('anything', 'package://other/z.xacro')).toBe('package://other/z.xacro');
  });

  it('escapes special characters on output and the result re-parses', async () => {
    const out = await expand(wrap(`<l v="\${'a &lt; b &amp; &quot;c&quot;'}"/>`));
    expect(parseXml(out).children[0]!.attrs.v).toBe('a < b & "c"');
  });

  it('expanding many documents in a row shares no state between them', async () => {
    for (let i = 0; i < 200; i++) {
      const out = await expand(wrap(`<xacro:arg name="n" default="${i}"/><xacro:property name="p" value="$(arg n)"/><xacro:macro name="m${i % 3}" params="x:=${i}"><l v="\${x * 2}"/></xacro:macro><xacro:m${i % 3}/><q p="\${p}"/>`));
      expect(out).toContain(`v="${i * 2}"`);
      expect(out).toContain(`p="${i}"`);
    }
    // A macro from an earlier document must not leak into a later one.
    await expect(expand(wrap('<xacro:m0/>'))).rejects.toThrow(/unknown macro/);
  });
});

describe('xacro expressions follow Python', () => {
  const ev = (s: string) => pyStr(evaluate(s, globalNames({})));
  it('keeps int and float apart, and prints floats like Python', () => {
    expect([ev('1'), ev('1.0'), ev('3/2'), ev('4/2'), ev('7//2'), ev('7.0//2'), ev('-7%3'), ev('2**-1'), ev('2**10')]).toEqual(['1', '1.0', '1.5', '2.0', '3', '3.0', '2', '0.5', '1024']);
    expect([floatRepr(0.1 + 0.2), floatRepr(1e16), floatRepr(1e-5), floatRepr(123456789012345.6), floatRepr(-0), floatRepr(0.0001)]).toEqual([
      '0.30000000000000004', '1e+16', '1e-05', '123456789012345.6', '-0.0', '0.0001',
    ]);
  });
  it('short-circuits and/or/if, chains comparisons, rounds half to even', () => {
    expect([ev('0 or 5'), ev('3 and 0'), ev("1 if 0 else 'x'"), ev('1 < 2 < 1'), ev('round(2.5)'), ev('round(3.5)'), ev('not 0')]).toEqual(['5', '0', 'x', 'False', '2', '4', 'True']);
    expect(ev('1 or undefined_name')).toBe('1');
  });
  it('refuses dunder names', () => {
    expect(() => ev('__import__')).toThrow(/invalid name/);
  });
});
