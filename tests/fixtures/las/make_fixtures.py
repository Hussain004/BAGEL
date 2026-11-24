"""Regenerate the LAS / LAZ test fixtures in this folder.

    python -m venv .venv && .venv/bin/pip install "laspy[lazrs]" numpy
    .venv/bin/python tests/fixtures/las/make_fixtures.py

Every fmtN.laz holds the same deterministic points (see
tests/parsers/las.test.ts, `expected`), written by laspy with the lazrs LAZ
backend for point formats 0 to 10.

simple.las, simple.laz (the same points, LASzip-compressed) and 100-points.las
come from the PDAL test suite (BSD licence), so a second producer is covered.
So do 1.2-with-color.copc.laz (simple.las's points as COPC) and
autzen_clip_native.copc.laz. make_copc.py writes the other .copc.laz files.
"""
import os
import laspy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
N = 300

i = np.arange(N)
x = 637000.0 + i * 0.37
y = 851000.0 + (i * 7 % 100) * 0.5
z = 100.0 + (i % 50) * 0.25

for fmt in range(11):
    version = "1.2" if fmt <= 3 else "1.4"
    header = laspy.LasHeader(point_format=fmt, version=version)
    header.scales = np.array([0.01, 0.01, 0.01])
    header.offsets = np.array([637000.0, 851000.0, 0.0])
    las = laspy.LasData(header)
    las.x, las.y, las.z = x, y, z
    las.intensity = (i * 13) % 65536
    las.classification = i % 19
    if "red" in las.point_format.dimension_names:
        las.red = (i * 3 % 256) * 256
        las.green = (i * 5 % 256) * 256
        las.blue = (i * 7 % 256) * 256
    las.write(os.path.join(HERE, f"fmt{fmt}.laz"), laz_backend=laspy.LazBackend.Lazrs)
