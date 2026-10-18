/**
 * Python `base64.b64decode(s)` (non-strict `validate=False`) semantics, including the errors it raises.
 *
 * Not a mirror of a Python module: shared so protocol code that wraps `b64decode` in `try/except` behaves identically
 * (non-alphabet characters are discarded; wrong padding / impossible lengths raise).
 */

const TABLE = new Int16Array(256).fill(-1);
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("").forEach((c, i) => {
  TABLE[c.charCodeAt(0)] = i;
});

/** Raised like `binascii.Error`. */
export class BinasciiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Error";
  }
}

export function pyB64Decode(s: string): Buffer {
  if (typeof s !== "string") throw new TypeError("argument should be a bytes-like object or ASCII string");
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) throw new Error("string argument should contain only ASCII characters");
  }
  const out: number[] = [];
  let quadPos = 0;
  let leftchar = 0;
  let pads = 0;
  let dataChars = 0;
  let padDone = false;
  scan: for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x3d) {
      if (quadPos >= 2 && quadPos + ++pads >= 4) {
        padDone = true;
        break scan;
      }
      continue;
    }
    const v = TABLE[code] as number;
    if (v < 0) continue;
    pads = 0;
    dataChars++;
    switch (quadPos) {
      case 0:
        quadPos = 1;
        leftchar = v;
        break;
      case 1:
        quadPos = 2;
        out.push(((leftchar << 2) | (v >> 4)) & 0xff);
        leftchar = v & 0xf;
        break;
      case 2:
        quadPos = 3;
        out.push(((leftchar << 4) | (v >> 2)) & 0xff);
        leftchar = v & 0x3;
        break;
      default:
        quadPos = 0;
        out.push(((leftchar << 6) | v) & 0xff);
        leftchar = 0;
    }
  }
  if (!padDone && quadPos !== 0) {
    if (quadPos === 1) {
      throw new BinasciiError(
        `Invalid base64-encoded string: number of data characters (${dataChars}) cannot be 1 more than a multiple of 4`,
      );
    }
    throw new BinasciiError("Incorrect padding");
  }
  return Buffer.from(out);
}
