"""Write small COPC files with deliberately varied structure for the COPC tests.

    .venv/bin/python tests/fixtures/las/make_copc.py   (needs laspy[lazrs], numpy)

Real COPC writers (PDAL, untwine) put the whole hierarchy of a small file in
one page. These files use what the spec allows and big tiles do:
- each depth-1 node and its subtree sit in their own hierarchy page, reached
  through a pointCount -1 entry in the root page;
- one depth-1 node holds no points (pointCount 0) but has children;
- several depths, so a point budget stops part way down.

Points are a deterministic formula (see `expected` in tests/parsers/copc.test.ts),
so the tests can check every decoded point without a second copy of the file.
"""
import io
import os
import struct
import lazrs
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SCALE = 0.01
OFFSET = (637000.0, 851000.0, 0.0)
MIN_LEN = {6: 30, 7: 36, 8: 38}


def points(n):
    i = np.arange(n, dtype=np.int64)
    x = OFFSET[0] + ((i * 7919) % 10007) * 0.05
    y = OFFSET[1] + ((i * 104729) % 10009) * 0.05
    z = 100.0 + ((i * 31) % 997) * 0.01
    return i, x, y, z


def records(fmt, idx, x, y, z):
    rl = MIN_LEN[fmt]
    out = bytearray(rl * len(idx))
    for k, i in enumerate(idx):
        o = k * rl
        struct.pack_into('<iiiH', out, o,
                         round((x[k] - OFFSET[0]) / SCALE), round((y[k] - OFFSET[1]) / SCALE),
                         round((z[k] - OFFSET[2]) / SCALE), int(i) % 65536)
        out[o + 14] = 0x11  # return 1 of 1
        out[o + 16] = int(i) % 19  # classification
        if fmt >= 7:
            struct.pack_into('<HHH', out, o + 30, (i * 3 % 256) * 256, (i * 5 % 256) * 256, (i * 7 % 256) * 256)
    return bytes(out)


def write(name, fmt, n, depths):
    i, x, y, z = points(n)
    lo = np.array([x.min(), y.min(), z.min()])
    hi = np.array([x.max(), y.max(), z.max()])
    center = (lo + hi) / 2
    half = float((hi - lo).max() / 2 + 1)
    # Depth of each point: an even share per level, interleaved so every level
    # covers the whole tile, like a real writer's sampling.
    depth = i % depths
    nodes = {}
    for k in range(n):
        d = int(depth[k])
        side = 2 * half / 2 ** d
        cell = tuple(int(v) for v in np.minimum(((np.array([x[k], y[k], z[k]]) - (center - half)) // side), 2 ** d - 1))
        if d == 1 and cell == (0, 0, 0):
            d, side = 2, half / 2  # leave depth-1 octant 0 empty, push its points down
            cell = tuple(int(v) for v in np.minimum(((np.array([x[k], y[k], z[k]]) - (center - half)) // side), 3))
        nodes.setdefault((d, *cell), []).append(k)
    if (1, 0, 0, 0) not in nodes:
        nodes[(1, 0, 0, 0)] = []

    # Compress one LAZ chunk per node.
    vlr = lazrs.LazVlr.new_for_compression(fmt, 0, True)  # variable-size chunks, as COPC requires
    buf = io.BytesIO()
    comp = lazrs.LasZipCompressor(buf, vlr)
    comp.reserve_offset_to_chunk_table()
    chunks = {}
    for key in sorted(nodes):
        ks = nodes[key]
        if not ks:
            chunks[key] = (0, 0, 0)
            continue
        start = buf.tell()
        comp.compress_many(records(fmt, i[ks], x[ks], y[ks], z[ks]))
        comp.finish_current_chunk()
        chunks[key] = (start, buf.tell() - start, len(ks))
    comp.done()
    laz = buf.getvalue()
    laszip_vlr = vlr.record_data()

    header_size = 375
    copc_vlr = 54 + 160
    point_offset = header_size + copc_vlr + 54 + len(laszip_vlr)
    evlr_start = point_offset + len(laz)
    hier_start = evlr_start + 60

    # Hierarchy: the root page holds depth 0 and a -1 pointer per depth-1
    # subtree; each subtree page holds that depth-1 node and its descendants.
    def entry(key, off, size, count):
        return struct.pack('<iiiiQii', *key, off, size, count)

    def node_entry(key):
        off, size, count = chunks[key]
        return entry(key, point_offset + off if size else 0, size, count)

    subtrees = {}
    for key in nodes:
        if key[0] >= 1:
            d, cx, cy, cz = key
            s = 2 ** (d - 1)
            subtrees.setdefault((1, cx // s, cy // s, cz // s), []).append(key)
    root_entries = [k for k in nodes if k[0] == 0]
    root_size = 32 * (len(root_entries) + len(subtrees))
    pages = b''
    pointers = []
    page_off = hier_start + root_size
    for sub in sorted(subtrees):
        body = b''.join(node_entry(k) for k in sorted(subtrees[sub]))
        pointers.append(entry(sub, page_off, len(body), -1))
        pages += body
        page_off += len(body)
    root = b''.join(node_entry(k) for k in root_entries) + b''.join(pointers)
    hierarchy = root + pages

    h = bytearray(header_size)
    h[0:4] = b'LASF'
    h[24], h[25] = 1, 4
    h[26:58] = b'BAGEL make_copc.py'.ljust(32, b'\0')
    h[58:90] = b'lazrs'.ljust(32, b'\0')
    struct.pack_into('<HIIBHI', h, 94, header_size, point_offset, 2, fmt | 0x80, MIN_LEN[fmt], 0)
    struct.pack_into('<3d3d', h, 131, SCALE, SCALE, SCALE, *OFFSET)
    struct.pack_into('<6d', h, 179, hi[0], lo[0], hi[1], lo[1], hi[2], lo[2])
    struct.pack_into('<QQIQ', h, 227, 0, evlr_start, 1, n)

    def vlr_header(user, rid, length):
        return struct.pack('<H16sHH32s', 0, user, rid, length, b'')

    info = struct.pack('<5d2Q2d11Q', *center, half, half / 64, hier_start, root_size, 0.0, 0.0, *([0] * 11))
    out = bytes(h) + vlr_header(b'copc', 1, 160) + info
    out += vlr_header(b'laszip encoded', 22204, len(laszip_vlr)) + laszip_vlr
    assert len(out) == point_offset
    # lazrs writes the chunk-table pointer relative to its own stream; LAZ wants a file offset.
    rel = struct.unpack_from('<q', laz, 0)[0]
    out += struct.pack('<q', rel + point_offset) + laz[8:]
    out += struct.pack('<H16sHQ32s', 0, b'copc', 1000, len(hierarchy), b'') + hierarchy
    with open(os.path.join(HERE, name), 'wb') as f:
        f.write(out)
    print(name, len(out), 'bytes', len(nodes), 'nodes', len(subtrees), 'subtree pages')


write('deep6.copc.laz', 6, 6000, 4)
write('rgb7.copc.laz', 7, 1500, 3)
write('nir8.copc.laz', 8, 800, 2)
