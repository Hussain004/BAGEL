"""
Regenerates lz4-chunks.mcap: an MCAP written by the official Python `mcap`
writer with lz4 chunk compression, so BAGEL's lz4 reading is checked against
another implementation's output rather than its own.

    python3 make_lz4_mcap.py lz4-chunks.mcap

Two JSON channels, small chunks so there are many of them, and payloads that
range from very compressible to not at all.
"""
import json
import random
import sys

from mcap.writer import CompressionType, Writer

rng = random.Random(4)
with open(sys.argv[1], "wb") as f:
    w = Writer(f, compression=CompressionType.LZ4, chunk_size=4096)
    w.start(profile="", library="python-mcap-lz4-fixture")
    schema = w.register_schema(name="Reading", encoding="jsonschema", data=b'{"type":"object"}')
    a = w.register_channel(topic="/counter", message_encoding="json", schema_id=schema)
    b = w.register_channel(topic="/blob", message_encoding="json", schema_id=schema)
    for i in range(300):
        t = 1_700_000_000_000_000_000 + i * 10_000_000
        w.add_message(a, log_time=t, publish_time=t, data=json.dumps({"i": i, "label": "tick " * (i % 7)}).encode())
        if i % 3 == 0:
            noise = "".join(rng.choice("abcdef0123456789") for _ in range(rng.randint(0, 600)))
            w.add_message(b, log_time=t, publish_time=t, data=json.dumps({"i": i, "noise": noise}).encode())
    w.finish()
