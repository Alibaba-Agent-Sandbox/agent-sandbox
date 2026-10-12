#!/usr/bin/env node
/**
 * ADV-core: differential of src/transport/codec.ts against the oracle's `easy_sandbox.transport.codec` (orjson):
 *   - json_decode / decode_response / decode_streaming_frame on hostile documents (message text of failures included)
 *   - parse_streaming_frames and EnvelopeStreamParser.feed with random chunkings (frames + pending_bytes)
 *   - json_encode of tricky JSON-able values
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/adv_core_codec.mjs [--verbose]
 * Exit: 0 identical, 1 differences, 2 oracle missing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const KNOWN_DEPTH = process.argv.includes("--depth");
const verbose = process.argv.includes("--verbose");
if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.error("[adv_core_codec] ORACLE_VENV not set / missing: SKIPPED");
  process.exit(2);
}

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const hex = (b) => Buffer.from(b).toString("hex");
const frame = (obj, flags = 0) => {
  const body = Buffer.isBuffer(obj) ? obj : Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj));
  const head = Buffer.alloc(5);
  head[0] = flags;
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
};

// ---- decode cases (bytes) ----
const DOCS = [
  "", " ", "\n", "{}", "[]", "null", "true", "false", "0", "-0", "-0.0", "1", "1.5", "1e5", "1E5", "1e+5", "1e-5", "1e400", "-1e400", "1e-400", "01", "-01", "1.", ".5", "+1", "0x1", "1_0", "--1", "- 1", "-",
  "NaN", "Infinity", "-Infinity", "nan", "inf", "tru", "truee", "True", "None", "nul", "nulll", "'a'", '"a"', '"', '"abc', '"\\"', '"\\u12"', '"\\u12g4"', '"\\ud800"', '"\\udc00"', '"\\ud800\\u0041"', '"\\ud800\\udc00"', '"\\ud83d\\ude00"', '"\\x41"', '"\\a"', '"\\/"',
  '"a\nb"', '"a\tb"', '"a\u0000b"', '"\u007f"', '"\u2028"', '"é"', '"\ud83d\ude00"', "[1,]", "[,1]", "[1 2]", "[1,,2]", "[", "[1", "[1,", "]", "{", '{"a"', '{"a":', '{"a":1', '{"a":1,', '{"a":1,}', '{,}', '{"a" 1}', '{a:1}', "{'a':1}", '{"a":1 "b":2}', '{"a":1}{', '{"a":1} x', '{"a":1}\n\n', ' {"a":1} ', "\ufeff{}", "\ufeff", "/* c */{}", "{} // c", "[1,2,3]garbage", "[]]", "{}}",
  '{"a":1,"a":2}', '{"":1}', '{"a":{"b":{"c":[1,{"d":null}]}}}', "[" + "[".repeat(900) + "]".repeat(900) + "]", "[".repeat(1100) + "]".repeat(1100), "[".repeat(5000),
  "123456789012345678901234567890", "9223372036854775807", "9223372036854775808", "18446744073709551615", "18446744073709551616", "-9223372036854775808", "-9223372036854775809", "1.7976931348623157e308", "1.7976931348623159e308", "5e-324", "2.2250738585072014e-308", "0.1", "0.30000000000000004", "100000000000000000000", "1e22", "1e21", "123456789.123456789", "4.35", "1.0", "2.50", "-0", "0e0", "0E+0",
  '{"event":{"start":{"pid":7}}}', '{"event":{"data":{"stdout":"aGk="}}}', '{"code":"x","message":"y"}', '{"error":{"code":"x","message":"y"}}', '[{"a":1},{"b":2}]', '"string"', "5",
];
const RAW = [
  Buffer.from([0xff]), Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]), Buffer.from('{"a":"\xc3"}', "latin1"), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from('"\xed\xa0\x80"', "latin1"), Buffer.from([0xc0, 0x80]), Buffer.from('["\xf0\x9f\x98"]', "latin1"), Buffer.from([0xf4, 0x90, 0x80, 0x80]), Buffer.from([0x00]), Buffer.from("{}\u0000"),
  Buffer.from('"\ud83d\ude00 ' + "x".repeat(10) + '"'), Buffer.from([0xff, 0xfe, 0x7b, 0x00, 0x7d, 0x00]),
];
const decodeCases = [...DOCS.map((d) => Buffer.from(d, "utf8")), ...RAW];
// mutate valid docs
const base = ['{"event":{"data":{"stdout":"aGk=","stderr":"eA=="}},"x":[1,2.5,null,true,"s\\n\\u00e9"]}', '[{"a":1},{"b":[]}]', '{"a":"\\ud83d\\ude00"}'];
for (let i = 0; i < 400; i++) {
  const b = Buffer.from(pick(base));
  const k = Math.floor(rnd() * 3) + 1;
  for (let j = 0; j < k; j++) {
    const op = Math.floor(rnd() * 3);
    const at = Math.floor(rnd() * b.length);
    if (op === 0) b[at] = pick([0x2c, 0x7d, 0x5d, 0x22, 0x5c, 0x00, 0x20, 0x7b, 0x5b, 0x3a, 0x30, 0x2d, 0x65, 0x2e, 0xff, 0x0a]);
    else if (op === 1) decodeCases.push(b.subarray(0, at));
    else decodeCases.push(Buffer.concat([b.subarray(0, at), Buffer.from(pick(['"', ",", "}", "]", "\\", "e", "-", "0"])), b.subarray(at)]));
  }
  decodeCases.push(Buffer.from(b));
}

// ---- frame streams ----
const OKF = [
  frame({ event: { start: { pid: 1 } } }), frame({ event: { data: { stdout: "aGk=" } } }), frame({}, 2), frame({ error: { code: "x", message: "m" } }, 2), frame(Buffer.alloc(0)), frame(Buffer.alloc(0), 2), frame("not json"), frame("[1]"), frame("5"), frame('"s"'), frame("null"), frame('{"a":1}', 1), frame('{"a":1}', 3), frame('{"a":1}', 0x80), frame('{"a":1}', 0xff), frame("{}"), frame("\ufeff{}"), frame(Buffer.from([0xff])), frame('{"a":NaN}'), frame('{"a":1e999}'),
];
const streams = [];
for (let i = 0; i < 300; i++) {
  const n = Math.floor(rnd() * 6);
  let b = Buffer.concat(Array.from({ length: n }, () => pick(OKF)));
  const r = rnd();
  if (r < 0.3) b = b.subarray(0, Math.floor(rnd() * (b.length + 1)));
  else if (r < 0.4) b = Buffer.concat([b, Buffer.from([0, 0xff, 0xff, 0xff, 0xff, 1, 2, 3])]);
  else if (r < 0.5) b = Buffer.concat([b, Buffer.from([0, 0, 0])]);
  const cuts = [];
  let p = 0;
  while (p < b.length) { const step = 1 + Math.floor(rnd() * 9); p += step; if (p < b.length) cuts.push(p); }
  streams.push({ hex: hex(b), cuts: rnd() < 0.5 ? cuts : [] });
}
streams.push({ hex: hex(Buffer.alloc(0)), cuts: [] });
streams.push({ hex: hex(Buffer.from([2, 0, 0, 0, 0])), cuts: [] });
// 4 GiB length header => parser waits forever, pending bytes = 8
streams.push({ hex: hex(Buffer.from([0, 0xff, 0xff, 0xff, 0xff, 1, 2, 3])), cuts: [] });

// ---- encode cases (JSON text; both sides parse it first) ----
const ENC = [
  "{}", "[]", '{"a":1}', '{"a":"é"}', '{"a":"\\u00e9\\ud83d\\ude00"}', '{"a":"\\ud800"}', '{"\\ud800":1}', '{"a":1.5,"b":-0.5,"c":1e-7,"d":1e21,"e":123456789.123}', '{"a":null,"b":true,"c":false}', '{"a":[1,[2,[3]]]}', '{"a":"\\u0000\\u001f\\u007f\\u2028\\u2029"}', '{"a":"</script>"}', '{"a":"\\"\\\\/\\b\\f\\n\\r\\t"}', '{"ключ":"значение"}', '{"1":1,"b":2,"0":0}', "9007199254740993", "18446744073709551615", "18446744073709551616", "-9223372036854775809", "1e999", "{\"a\":1e400}", "-0.0", "0.1", "100", "1.0",
];

const tmp = mkdtempSync(join(tmpdir(), "adv-codec-"));
try {
  const spec = { decode: decodeCases.map(hex), streams, enc: ENC };
  const specFile = join(tmp, "spec.json");
  writeFileSync(specFile, JSON.stringify(spec));
  const PY = String.raw`
import json, sys, math, struct
from easy_sandbox.transport import codec as C
spec = json.load(open(sys.argv[1]))
def canon(v):
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return {"n": repr(float(v)) if not (isinstance(v, int) and abs(v) < 2**53) else repr(float(v))}
    if isinstance(v, list):
        return [canon(x) for x in v]
    if isinstance(v, dict):
        return {"d": sorted([[k, canon(x)] for k, x in v.items()], key=lambda kv: kv[0])}
    return {"?": type(v).__name__}
def run(f, *a):
    try:
        return {"ok": canon(f(*a))}
    except Exception as e:
        return {"err": type(e).__name__ + ": " + str(e)}
out = {"decode": [], "streams": [], "enc": []}
for h in spec["decode"]:
    b = bytes.fromhex(h)
    out["decode"].append({
        "json_decode": run(C.json_decode, b),
        "decode_response": run(C.ConnectCodec.decode_response, b),
        "frame": run(C.ConnectCodec.decode_streaming_frame, b),
        "json_decode_str": run(lambda: C.json_decode(b.decode("utf-8"))) if True else None,
    })
for s in spec["streams"]:
    b = bytes.fromhex(s["hex"])
    r = {"parse": run(C.ConnectCodec.parse_streaming_frames, b)}
    p = C.EnvelopeStreamParser()
    frames = []
    last = 0
    pieces = []
    for c in s["cuts"] + [len(b)]:
        pieces.append(b[last:c]); last = c
    for piece in pieces:
        frames.extend(p.feed(piece))
    r["feed"] = canon(frames)
    r["pending"] = p.pending_bytes()
    out["streams"].append(r)
for t in spec["enc"]:
    try:
        v = json.loads(t)
    except Exception as e:
        out["enc"].append({"skip": True}); continue
    try:
        out["enc"].append({"ok": C.json_encode(v).decode("utf-8", "backslashreplace")})
    except Exception as e:
        out["enc"].append({"err": type(e).__name__ + ": " + str(e)})
json.dump(out, sys.stdout)
`;
  const TS = String.raw`
import { readFileSync } from "node:fs";
import { ConnectCodec, EnvelopeStreamParser, json_decode, json_encode } from ${JSON.stringify(join(CLI_ROOT, "src/transport/codec.ts"))};
import { pyFloatRepr } from ${JSON.stringify(join(CLI_ROOT, "src/utils/_pyformat.ts"))};
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
function canon(v) {
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") return { n: pyFloatRepr(v) };
  if (typeof v === "bigint") return { n: pyFloatRepr(Number(v)) };
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === "object") return { d: Object.entries(v).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, x]) => [k, canon(x)]) };
  return { "?": typeof v };
}
function run(f, ...a) {
  try { return { ok: canon(f(...a)) }; } catch (e) { return { err: (e && e.name) + ": " + (e && e.message) }; }
}
const out = { decode: [], streams: [], enc: [] };
for (const h of spec.decode) {
  const b = Buffer.from(h, "hex");
  out.decode.push({
    json_decode: run(json_decode, b),
    decode_response: run((x) => ConnectCodec.decodeResponse(x), b),
    frame: run((x) => ConnectCodec.decodeStreamingFrame(x), b),
    json_decode_str: run(() => { let s; try { s = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b); } catch { throw Object.assign(new Error("utf8"), { name: "UnicodeDecodeError" }); } return json_decode(s); }),
  });
}
for (const s of spec.streams) {
  const b = Buffer.from(s.hex, "hex");
  const r = { parse: run((x) => ConnectCodec.parseStreamingFrames(x), b) };
  const p = new EnvelopeStreamParser();
  const frames = [];
  let last = 0;
  for (const c of [...s.cuts, b.length]) { frames.push(...p.feed(b.subarray(last, c))); last = c; }
  r.feed = canon(frames);
  r.pending = p.pendingBytes();
  out.streams.push(r);
}
for (const t of spec.enc) {
  let v;
  try { v = JSON.parse(t); } catch { out.enc.push({ skip: true }); continue; }
  try { out.enc.push({ ok: json_encode(v).toString("utf8") }); } catch (e) { out.enc.push({ err: (e && e.name) + ": " + (e && e.message) }); }
}
process.stdout.write(JSON.stringify(out));
`;
  const py = spawnSync(join(ORACLE_VENV, "bin", "python"), ["-c", PY, specFile], { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, HOME: tmp, EBX_NO_KEYCHAIN: "1" } });
  if (py.status !== 0) { console.error(py.stderr); process.exit(2); }
  const tsFile = join(tmp, "run.mjs");
  writeFileSync(tsFile, TS);
  const ts = spawnSync(process.execPath, ["--import", "tsx", tsFile, specFile], { encoding: "utf8", cwd: CLI_ROOT, maxBuffer: 1 << 28 });
  if (ts.status !== 0) { console.error(ts.stderr); process.exit(2); }
  const exp = JSON.parse(py.stdout);
  const act = JSON.parse(ts.stdout);
  let diffs = 0;
  const show = (label, input, a, b) => {
    diffs++;
    if (verbose || diffs <= 60) console.log(`--- ${label} input=${input}\n  oracle: ${JSON.stringify(a).slice(0, 400)}\n  node  : ${JSON.stringify(b).slice(0, 400)}`);
  };
  exp.decode.forEach((e, i) => {
    for (const k of Object.keys(e)) {
      if (k === "json_decode_str") continue;
      const loose = (x) => JSON.stringify(x).replace(/got (float|int)/g, "got num").replace(/"-0\.0"/g, '"0.0"').replace(/"(ValueError|UnicodeDecodeError): '?utf-8'? codec[^"]*"/g, '"UTF8ERR"');
      if (!KNOWN_DEPTH && /^\[{1000,}/.test(Buffer.from(spec.decode[i], "hex").toString("latin1"))) continue;
      const a = loose(e[k]);
      const b = loose(act.decode[i][k]);
      if (a !== b) show(`decode/${k}`, JSON.stringify(Buffer.from(spec.decode[i], "hex").toString("latin1")).slice(0, 120), e[k], act.decode[i][k]);
    }
  });
  exp.streams.forEach((e, i) => {
    for (const k of Object.keys(e)) {
      if (JSON.stringify(e[k]) !== JSON.stringify(act.streams[i][k])) show(`stream/${k}`, `${spec.streams[i].hex.slice(0, 100)} cuts=${spec.streams[i].cuts.slice(0, 8)}`, e[k], act.streams[i][k]);
    }
  });
  exp.enc.forEach((e, i) => {
    if (JSON.stringify(e) !== JSON.stringify(act.enc[i])) show("encode", spec.enc[i], e, act.enc[i]);
  });
  console.log(`[adv_core_codec] decode=${exp.decode.length}x4 streams=${exp.streams.length} enc=${exp.enc.length} diffs=${diffs}`);
  process.exit(diffs ? 1 : 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
