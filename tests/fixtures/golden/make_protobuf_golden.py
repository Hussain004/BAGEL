"""
Regenerates protobuf.golden.json: descriptor sets and messages written by the
reference Python protobuf library, with the values BAGEL should decode them to.

    python3 make_protobuf_golden.py > protobuf.golden.json

The schema covers what hand-written fixtures tend to miss: oneofs, proto3
optional, maps (scalar and message values), nested enums and messages, every
scalar type, packed and unpacked repeated fields, and Timestamp/Duration
imported from their real well-known-type files.
"""
import json
import random
import sys

from google.protobuf import descriptor_pb2, descriptor_pool, message_factory
from google.protobuf import duration_pb2, timestamp_pb2
from google.protobuf.descriptor import FieldDescriptor as FD

F = descriptor_pb2.FieldDescriptorProto


def field(msg, name, number, type_, label=F.LABEL_OPTIONAL, type_name=None, oneof=None, proto3_optional=False):
    f = msg.field.add()
    f.name, f.number, f.type, f.label = name, number, type_, label
    if type_name:
        f.type_name = type_name
    if oneof is not None:
        f.oneof_index = oneof
    if proto3_optional:
        f.proto3_optional = True
    return f


def build():
    fd = descriptor_pb2.FileDescriptorProto()
    fd.name, fd.package, fd.syntax = "golden.proto", "golden", "proto3"
    fd.dependency.extend(["google/protobuf/timestamp.proto", "google/protobuf/duration.proto"])

    inner = fd.message_type.add()
    inner.name = "Inner"
    field(inner, "id", 1, F.TYPE_INT32)
    field(inner, "label", 2, F.TYPE_STRING)

    m = fd.message_type.add()
    m.name = "Everything"
    e = m.enum_type.add()
    e.name = "Kind"
    for i, n in enumerate(["KIND_UNKNOWN", "KIND_A", "KIND_B"]):
        v = e.value.add()
        v.name, v.number = n, i
    entry = m.nested_type.add()
    entry.name = "ScoresEntry"
    entry.options.map_entry = True
    field(entry, "key", 1, F.TYPE_STRING)
    field(entry, "value", 2, F.TYPE_DOUBLE)
    entry2 = m.nested_type.add()
    entry2.name = "ThingsEntry"
    entry2.options.map_entry = True
    field(entry2, "key", 1, F.TYPE_INT32)
    field(entry2, "value", 2, F.TYPE_MESSAGE, type_name=".golden.Inner")
    m.oneof_decl.add().name = "choice"
    m.oneof_decl.add().name = "_maybe"

    R = F.LABEL_REPEATED
    scalars = [
        ("f_double", 1, F.TYPE_DOUBLE), ("f_float", 2, F.TYPE_FLOAT), ("f_int32", 3, F.TYPE_INT32),
        ("f_int64", 4, F.TYPE_INT64), ("f_uint32", 5, F.TYPE_UINT32), ("f_uint64", 6, F.TYPE_UINT64),
        ("f_sint32", 7, F.TYPE_SINT32), ("f_sint64", 8, F.TYPE_SINT64), ("f_fixed32", 9, F.TYPE_FIXED32),
        ("f_fixed64", 10, F.TYPE_FIXED64), ("f_sfixed32", 11, F.TYPE_SFIXED32), ("f_sfixed64", 12, F.TYPE_SFIXED64),
        ("f_bool", 13, F.TYPE_BOOL), ("f_string", 14, F.TYPE_STRING), ("f_bytes", 15, F.TYPE_BYTES),
    ]
    for n, num, t in scalars:
        field(m, n, num, t)
    field(m, "kind", 20, F.TYPE_ENUM, type_name=".golden.Everything.Kind")
    field(m, "inner", 21, F.TYPE_MESSAGE, type_name=".golden.Inner")
    field(m, "at", 22, F.TYPE_MESSAGE, type_name=".google.protobuf.Timestamp")
    field(m, "span", 23, F.TYPE_MESSAGE, type_name=".google.protobuf.Duration")
    for n, num, t in [("r_double", 30, F.TYPE_DOUBLE), ("r_int32", 31, F.TYPE_INT32), ("r_sint64", 32, F.TYPE_SINT64),
                      ("r_fixed32", 33, F.TYPE_FIXED32), ("r_bool", 34, F.TYPE_BOOL), ("r_uint64", 35, F.TYPE_UINT64)]:
        field(m, n, num, t, R)
    field(m, "r_kind", 36, F.TYPE_ENUM, R, ".golden.Everything.Kind")
    field(m, "r_string", 37, F.TYPE_STRING, R)
    field(m, "r_bytes", 38, F.TYPE_BYTES, R)
    field(m, "r_inner", 39, F.TYPE_MESSAGE, R, ".golden.Inner")
    field(m, "scores", 40, F.TYPE_MESSAGE, R, ".golden.Everything.ScoresEntry")
    field(m, "things", 41, F.TYPE_MESSAGE, R, ".golden.Everything.ThingsEntry")
    field(m, "pick_int", 50, F.TYPE_INT32, oneof=0)
    field(m, "pick_text", 51, F.TYPE_STRING, oneof=0)
    field(m, "pick_inner", 52, F.TYPE_MESSAGE, type_name=".golden.Inner", oneof=0)
    field(m, "maybe", 53, F.TYPE_INT32, oneof=1, proto3_optional=True)
    # An unpacked repeated field, as proto2-era producers write it.
    field(m, "r_unpacked", 60, F.TYPE_INT32, R).options.packed = False

    ts, du = descriptor_pb2.FileDescriptorProto(), descriptor_pb2.FileDescriptorProto()
    timestamp_pb2.DESCRIPTOR.CopyToProto(ts)
    duration_pb2.DESCRIPTOR.CopyToProto(du)
    fds = descriptor_pb2.FileDescriptorSet()
    fds.file.extend([ts, du, fd])  # dependencies first, as protoc --include_imports orders them
    pool = descriptor_pool.DescriptorPool()
    for f in fds.file:
        pool.Add(f)
    cls = message_factory.GetMessageClass(pool.FindMessageTypeByName("golden.Everything"))
    return fds, cls


def rand_scalar(rng, t):
    if t == FD.TYPE_DOUBLE: return rng.choice([0.0, 1.5, -2.25, 1e300, 5e-324, rng.uniform(-1e6, 1e6)])
    if t == FD.TYPE_FLOAT: return rng.choice([0.0, 0.5, -3.5, 3.4028234663852886e38, float(rng.randint(-1000, 1000)) / 8])
    if t == FD.TYPE_INT32: return rng.choice([0, 1, -1, 2**31 - 1, -2**31, rng.randint(-10**6, 10**6)])
    if t == FD.TYPE_INT64: return rng.choice([0, -1, 2**53, -2**53 - 1, 2**63 - 1, -2**63, rng.randint(-10**12, 10**12)])
    if t == FD.TYPE_UINT32: return rng.choice([0, 1, 2**32 - 1, rng.randint(0, 2**32 - 1)])
    if t == FD.TYPE_UINT64: return rng.choice([0, 2**53 - 1, 2**53, 2**64 - 1, rng.randint(0, 2**40)])
    if t == FD.TYPE_SINT32: return rng.choice([0, -1, 1, 2**31 - 1, -2**31])
    if t == FD.TYPE_SINT64: return rng.choice([0, -1, 2**62, -2**62, 2**63 - 1, -2**63, rng.randint(-10**9, 10**9)])
    if t == FD.TYPE_FIXED32: return rng.choice([0, 2**32 - 1, rng.randint(0, 2**32 - 1)])
    if t == FD.TYPE_FIXED64: return rng.choice([0, 2**64 - 1, 1700000000123456789])
    if t == FD.TYPE_SFIXED32: return rng.choice([0, -1, 2**31 - 1, -2**31])
    if t == FD.TYPE_SFIXED64: return rng.choice([0, -1, 2**63 - 1, -2**63])
    if t == FD.TYPE_BOOL: return rng.random() < 0.5
    if t == FD.TYPE_STRING: return rng.choice(["", "a", "héllo wörld", "日本語", "x" * rng.randint(0, 60), "\U0001F600"])
    if t == FD.TYPE_BYTES: return bytes(rng.randrange(256) for _ in range(rng.choice([0, 1, 5, 40])))
    raise ValueError(t)


def fill(rng, msg):
    d = msg.DESCRIPTOR
    for f in d.fields:
        if rng.random() < 0.35:
            continue
        if f.message_type is not None and f.message_type.GetOptions().map_entry:
            vt = f.message_type.fields_by_name["value"]
            for _ in range(rng.randint(0, 4)):
                k = rng.choice(["a", "b", "c", "dd"]) if f.message_type.fields_by_name["key"].type == FD.TYPE_STRING else rng.randint(-5, 5)
                if vt.type == FD.TYPE_MESSAGE:
                    fill(rng, getattr(msg, f.name)[k])
                else:
                    getattr(msg, f.name)[k] = rand_scalar(rng, vt.type)
        elif f.is_repeated:
            for _ in range(rng.randint(0, 4)):
                if f.type == FD.TYPE_MESSAGE:
                    fill(rng, getattr(msg, f.name).add())
                elif f.type == FD.TYPE_ENUM:
                    getattr(msg, f.name).append(rng.randint(0, 2))
                else:
                    getattr(msg, f.name).append(rand_scalar(rng, f.type))
        elif f.type == FD.TYPE_MESSAGE:
            if f.message_type.full_name == "google.protobuf.Timestamp":
                getattr(msg, f.name).seconds = rng.randint(0, 2**33)
                getattr(msg, f.name).nanos = rng.randint(0, 999999999)
            elif f.message_type.full_name == "google.protobuf.Duration":
                getattr(msg, f.name).seconds = rng.randint(-1000, 1000)
                getattr(msg, f.name).nanos = rng.randint(0, 999999)
            else:
                fill(rng, getattr(msg, f.name))
        elif f.type == FD.TYPE_ENUM:
            setattr(msg, f.name, rng.randint(0, 2))
        else:
            setattr(msg, f.name, rand_scalar(rng, f.type))


def js(v):
    """JSON form of a decoded value; ints beyond 2**53 and bytes are tagged."""
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, int):
        return v if abs(v) <= 2**53 - 1 else {"$big": str(v)}
    if isinstance(v, float):
        return v
    if isinstance(v, (bytes, bytearray)):
        return {"$bytes": bytes(v).hex()}
    raise TypeError(type(v))


def expected(msg):
    """The shape BAGEL decodes to: proto field names, defaults filled, Timestamp -> {sec, nsec}."""
    out = {}
    for f in msg.DESCRIPTOR.fields:
        val = getattr(msg, f.name)
        if f.message_type is not None and f.message_type.GetOptions().map_entry:
            vt = f.message_type.fields_by_name["value"]
            out[f.name] = {str(k): (expected(v) if vt.type == FD.TYPE_MESSAGE else js(v)) for k, v in val.items()}
        elif f.is_repeated:
            out[f.name] = [expected(x) if f.type == FD.TYPE_MESSAGE else js(x) for x in val]
        elif f.type == FD.TYPE_MESSAGE:
            if not msg.HasField(f.name):
                out[f.name] = None  # absent
            elif f.message_type.full_name in ("google.protobuf.Timestamp", "google.protobuf.Duration"):
                out[f.name] = {"sec": js(val.seconds), "nsec": val.nanos}
            else:
                out[f.name] = expected(val)
        else:
            out[f.name] = js(val)  # an unset scalar reads as its default
    return out


def main():
    fds, cls = build()
    rng = random.Random(20260711)
    cases = []
    for _ in range(120):
        m = cls()
        fill(rng, m)
        cases.append({"hex": m.SerializeToString().hex(), "expected": expected(m)})
    json.dump({"generator": "make_protobuf_golden.py (protobuf %s)" % __import__("google.protobuf").protobuf.__version__,
               "message": "golden.Everything", "descriptorSetHex": fds.SerializeToString().hex(), "cases": cases},
              sys.stdout, separators=(",", ":"))


main()
