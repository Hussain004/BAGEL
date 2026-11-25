/**
 * grid_map_msgs/GridMap as a point cloud: one point per cell at
 * (x, y, elevation), so the 3D scene, TF, colour modes and overlays all work
 * as they do for PointCloud2. Read the way grid_map_ros reads it
 * (GridMapRosConverter::fromMessage, GridMapMsgHelpers, GridMapMath):
 *
 * - each layer is a Float32MultiArray; column-major (Eigen's default) when
 *   `layout.dim[0].label` is "column_index", row-major when "row_index".
 *   rows run along x, columns along y; sizes come from the layout.
 * - the buffer is circular: buffer index (r, c) unwraps to
 *   ((r - outer_start_index) mod rows, (c - inner_start_index) mod cols).
 * - unwrapped (0, 0) is the cell at +x, +y: its centre is half the map
 *   length minus half a cell from the map position; x and y fall by one
 *   resolution per row and per column.
 * - the map position is info.pose.position x, y (grid_map ignores the rest).
 *
 * Cells whose height is NaN (unknown) are skipped.
 */

import type { PointCloud2Message } from './pointcloud';

type Obj = Record<string, unknown>;

export function isGridMapType(type: string): boolean {
  return type.endsWith('/GridMap');
}

export function isGridMapValue(v: unknown): v is Obj {
  const o = v as Obj | null;
  return !!o && typeof o.info === 'object' && Array.isArray(o.layers) && Array.isArray(o.data);
}

/** The layer drawn as height: elevation if the map has it, else the first layer. */
export function heightLayer(layers: string[]): string | undefined {
  return layers.find((l) => l === 'elevation') ?? layers.find((l) => l.startsWith('elevation')) ?? layers[0];
}

/** The layer drawn as colour: `color` (packed RGB) if present, else the first other layer. */
export function colorLayer(layers: string[], height: string | undefined): string | undefined {
  return layers.find((l) => l === 'color') ?? layers.find((l) => l !== height);
}

interface Grid {
  rows: number;
  cols: number;
  rowMajor: boolean;
  data: ArrayLike<number>;
}

function gridOf(arr: Obj | undefined): Grid | null {
  const layout = arr?.layout as { dim?: Array<{ label?: string; size?: number }> } | undefined;
  const dim = layout?.dim ?? [];
  const data = arr?.data as ArrayLike<number> | undefined;
  if (dim.length < 2 || !data) return null;
  const rowMajor = dim[0]!.label === 'row_index';
  const outer = Number(dim[0]!.size ?? 0);
  const inner = Number(dim[1]!.size ?? 0);
  const [rows, cols] = rowMajor ? [outer, inner] : [inner, outer];
  if (!rows || !cols || data.length < rows * cols) return null;
  return { rows, cols, rowMajor, data };
}

/** The cloud for a GridMap message, or null when it has no usable height layer. */
export function gridMapToPointCloud2(msg: Obj): PointCloud2Message | null {
  const layers = (msg.layers as unknown[]).map(String);
  const data = msg.data as Obj[];
  const hName = heightLayer(layers);
  if (!hName) return null;
  const height = gridOf(data[layers.indexOf(hName)]);
  if (!height) return null;
  const cName = colorLayer(layers, hName);
  const colorGrid = cName ? gridOf(data[layers.indexOf(cName)]) : null;
  const color = colorGrid && colorGrid.rows === height.rows && colorGrid.cols === height.cols ? colorGrid : null;
  const packedRgb = cName === 'color' && !!color;

  const info = msg.info as { resolution?: number; length_x?: number; length_y?: number; pose?: { position?: { x?: number; y?: number } } };
  const res = Number(info.resolution ?? 0);
  if (!(res > 0)) return null;
  const { rows, cols } = height;
  // The lengths in the message decide the first cell; fall back to the buffer size.
  const lenX = Number(info.length_x ?? rows * res) || rows * res;
  const lenY = Number(info.length_y ?? cols * res) || cols * res;
  const px = Number(info.pose?.position?.x ?? 0);
  const py = Number(info.pose?.position?.y ?? 0);
  const startR = Number(msg.outer_start_index ?? 0);
  const startC = Number(msg.inner_start_index ?? 0);
  const firstX = px + lenX / 2 - res / 2;
  const firstY = py + lenY / 2 - res / 2;

  const POINT_STEP = 16; // x y z float32, then intensity float32 or rgb uint32
  const out = new Uint8Array(rows * cols * POINT_STEP);
  const view = new DataView(out.buffer);
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const at = height.rowMajor ? r * cols + c : c * rows + r;
      const z = height.data[at]!;
      if (!Number.isFinite(z)) continue;
      const ur = (((r - startR) % rows) + rows) % rows;
      const uc = (((c - startC) % cols) + cols) % cols;
      const o = n * POINT_STEP;
      view.setFloat32(o, firstX - ur * res, true);
      view.setFloat32(o + 4, firstY - uc * res, true);
      view.setFloat32(o + 8, z, true);
      const v = color ? color.data[color.rowMajor ? r * cols + c : c * rows + r]! : z;
      if (packedRgb) {
        // grid_map packs RGB into the float's bits, as PCL does.
        f32[0] = v;
        view.setUint32(o + 12, u32[0]!, true);
      } else {
        view.setFloat32(o + 12, Number.isFinite(v) ? v : 0, true);
      }
      n++;
    }
  }
  return {
    header: msg.header as PointCloud2Message['header'],
    height: 1,
    width: n,
    is_bigendian: false,
    point_step: POINT_STEP,
    row_step: n * POINT_STEP,
    is_dense: true,
    fields: [
      { name: 'x', offset: 0, datatype: 7, count: 1 },
      { name: 'y', offset: 4, datatype: 7, count: 1 },
      { name: 'z', offset: 8, datatype: 7, count: 1 },
      packedRgb ? { name: 'rgb', offset: 12, datatype: 6, count: 1 } : { name: 'intensity', offset: 12, datatype: 7, count: 1 },
    ],
    data: out.subarray(0, n * POINT_STEP),
  };
}
