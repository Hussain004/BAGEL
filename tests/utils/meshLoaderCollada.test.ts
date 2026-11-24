// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { loadMesh, clearMeshCache } from '../../src/utils/meshLoader';
import {
  _resetPackageResolverForTests,
  resolveRelativeUri,
  setFileBinding,
  setUrlBinding,
} from '../../src/parsers/packageResolver';

/** A one-triangle Collada file whose material samples the texture at `initFrom`. */
function dae(initFrom: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>
  <library_images><image id="tex"><init_from>${initFrom}</init_from></image></library_images>
  <library_effects><effect id="fx"><profile_COMMON>
    <newparam sid="surf"><surface type="2D"><init_from>tex</init_from></surface></newparam>
    <newparam sid="samp"><sampler2D><source>surf</source></sampler2D></newparam>
    <technique sid="common"><lambert><diffuse><texture texture="samp" texcoord="UV"/></diffuse></lambert></technique>
  </profile_COMMON></effect></library_effects>
  <library_materials><material id="mat"><instance_effect url="#fx"/></material></library_materials>
  <library_geometries><geometry id="g"><mesh>
    <source id="p"><float_array id="pa" count="9">0 0 0 1 0 0 0 1 0</float_array>
      <technique_common><accessor source="#pa" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <source id="t"><float_array id="ta" count="6">0 0 1 0 0 1</float_array>
      <technique_common><accessor source="#ta" count="3" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
    <vertices id="v"><input semantic="POSITION" source="#p"/></vertices>
    <triangles material="m" count="1"><input semantic="VERTEX" source="#v" offset="0"/><input semantic="TEXCOORD" source="#t" offset="0" set="0"/><p>0 1 2</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="s"><node id="n"><instance_geometry url="#g">
    <bind_material><technique_common><instance_material symbol="m" target="#mat"/></technique_common></bind_material>
  </instance_geometry></node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#s"/></scene>
</COLLADA>`;
}

function fileAt(path: string, body: string): File {
  const f = new File([body], path.split('/').pop()!);
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

/**
 * Texture URLs the loader asked for. A texture's image is only attached once
 * it loads, which never happens in jsdom, so record what each <img> is pointed at.
 */
let imageSrcs: string[] = [];
const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
Object.defineProperty(HTMLImageElement.prototype, 'src', {
  configurable: true,
  get: srcDescriptor.get,
  set(v: string) {
    imageSrcs.push(v);
    srcDescriptor.set!.call(this, v);
  },
});
async function textureUrls(uri: string): Promise<string[]> {
  imageSrcs = [];
  const mesh = await loadMesh(uri);
  let textured = 0;
  mesh.traverse((n) => {
    const m = (n as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (m?.map) textured++;
  });
  expect(textured).toBe(1);
  return imageSrcs;
}

const blobFor = new Map<string, Blob>();
let revoked: string[] = [];
beforeEach(() => {
  _resetPackageResolverForTests();
  clearMeshCache();
  blobFor.clear();
  revoked = [];
  let n = 0;
  // jsdom has no object URLs; name them after the file so the test can see which one was used.
  URL.createObjectURL = vi.fn((b: Blob) => {
    const url = `blob:test/${n++}/${(b as File).name}`;
    blobFor.set(url, b);
    return url;
  });
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
});
afterEach(() => vi.restoreAllMocks());

describe('Collada textures from a dropped package folder (#119)', () => {
  it('resolves a ../ texture path with a percent-encoded space to the folder file', async () => {
    setFileBinding('bot', [
      fileAt('bot/meshes/arm.dae', dae('../textures/wood%20grain.png')),
      fileAt('bot/textures/wood grain.png', 'png'),
    ]);
    const urls = await textureUrls('package://bot/meshes/arm.dae');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^blob:test\/\d+\/wood grain\.png$/);
  });

  it('finds an absolute exporter path by file name inside the package', async () => {
    setFileBinding('bot', [
      fileAt('bot/meshes/base.dae', dae('file:///home/someone/blender/textures/metal.png')),
      fileAt('bot/materials/metal.png', 'png'),
    ]);
    expect((await textureUrls('package://bot/meshes/base.dae'))[0]).toMatch(/^blob:test\/\d+\/metal\.png$/);
  });

  it('still loads the mesh, untextured, when the texture is not in the folder', async () => {
    setFileBinding('bot', [fileAt('bot/meshes/arm.dae', dae('missing.png'))]);
    const urls = await textureUrls('package://bot/meshes/arm.dae');
    // Falls through to the plain reference, which simply fails to load.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/missing\.png$/);
    expect(urls[0]).not.toMatch(/^blob:/);
  });

  it('resolves against a URL-bound package as well', async () => {
    setUrlBinding('bot', 'https://cdn.example.com/bot');
    globalThis.fetch = vi.fn(async () => new Response(dae('../textures/t.png'))) as typeof fetch;
    expect(await textureUrls('package://bot/meshes/arm.dae')).toEqual(['https://cdn.example.com/bot/textures/t.png']);
  });
});

describe('resolveRelativeUri', () => {
  const base = 'package://bot/meshes/arm/link.dae';
  it.each([
    ['tex.png', 'package://bot/meshes/arm/tex.png'],
    ['./tex.png', 'package://bot/meshes/arm/tex.png'],
    ['../../textures/a b.png', 'package://bot/textures/a b.png'],
    ['..\\textures\\win.png', 'package://bot/meshes/textures/win.png'],
    ['sub/x%20y.jpg', 'package://bot/meshes/arm/sub/x y.jpg'],
    ['file:///C:/Users/me/tex.png', 'package://bot/tex.png'],
    ['C:\\Users\\me\\tex.png', 'package://bot/tex.png'],
    ['/abs/tex.png', 'package://bot/tex.png'],
    ['https://cdn.example.com/t.png', 'https://cdn.example.com/t.png'],
    ['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
    ['package://other/t.png', 'package://other/t.png'],
  ])('%s', (ref, want) => {
    expect(resolveRelativeUri(base, ref)).toBe(want);
  });

  it('resolves against an http mesh URL like a browser would', () => {
    expect(resolveRelativeUri('https://h.com/m/x.dae', '../t/a.png')).toBe('https://h.com/t/a.png');
  });
});
