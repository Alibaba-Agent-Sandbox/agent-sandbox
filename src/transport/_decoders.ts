/**
 * `httpx._decoders` (0.28): `Content-Encoding` decoding with the semantics of Python's `zlib.decompressobj`.
 *
 *   - gzip: a single member; bytes after the end of the stream are ignored (never a second member), a truncated stream
 *     is not an error, a bad header is `Error -3 while decompressing data: incorrect header check`;
 *   - deflate: zlib wrapper first, raw deflate when the first chunk fails to inflate;
 *   - unknown / unsupported encodings (`x-gzip`, `zstd`) are skipped, not decoded;
 *   - brotli is decoded (the request advertises it) although httpx without the optional `brotli` package would not.
 */

import * as zlib from "node:zlib";

export class ContentDecodeError extends Error {}

export interface ContentDecoder {
  decode(data: Buffer): Promise<Buffer>;
  flush(): Promise<Buffer>;
}

/** A stateful zlib engine driven chunk by chunk: output of the chunk plus how much input it did not consume. */
class Inflater {
  private out: Buffer[] = [];
  private error: Error | null = null;
  private waiter: (() => void) | null = null;

  constructor(private readonly z: zlib.Inflate | zlib.InflateRaw) {
    z.on("data", (c: Buffer) => this.out.push(c));
    z.on("error", (e: Error) => {
      this.error ??= e;
      this.waiter?.();
    });
  }

  async write(chunk: Buffer): Promise<{ out: Buffer; unused: number }> {
    if (this.error) throw zlibFailure(this.error);
    const before = this.z.bytesWritten;
    await new Promise<void>((resolve) => {
      this.waiter = resolve;
      this.z.write(chunk, () => resolve());
    });
    this.waiter = null;
    if (this.error) throw zlibFailure(this.error);
    const out = Buffer.concat(this.out);
    this.out = [];
    return { out, unused: chunk.length - (this.z.bytesWritten - before) };
  }

  close(): void {
    this.z.destroy();
  }
}

function zlibFailure(e: unknown): ContentDecodeError {
  const err = e as { errno?: number; message?: string };
  return new ContentDecodeError(
    typeof err.errno === "number" ? `Error ${err.errno} while decompressing data: ${err.message}` : String(err.message),
  );
}

const newRawInflater = (): Inflater => new Inflater(new zlib.InflateRaw());

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, buf: Buffer): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return ~c >>> 0;
}

class DeflateDecoder implements ContentDecoder {
  private firstAttempt = true;
  private z = new Inflater(new zlib.Inflate());

  async decode(data: Buffer): Promise<Buffer> {
    const wasFirst = this.firstAttempt;
    this.firstAttempt = false;
    try {
      return (await this.z.write(data)).out;
    } catch (e) {
      if (!wasFirst) throw e;
      this.z.close();
      this.z = newRawInflater();
      return this.decode(data);
    }
  }

  async flush(): Promise<Buffer> {
    this.z.close();
    return Buffer.alloc(0);
  }
}

/** `zlib.decompressobj(MAX_WBITS | 16)`: gzip header + raw deflate + CRC32 / ISIZE trailer, single member. */
class GZipDecoder implements ContentDecoder {
  private header: Buffer = Buffer.alloc(0);
  private headerDone = false;
  private z = newRawInflater();
  private ended = false;
  private trailer: Buffer = Buffer.alloc(0);
  private crc = 0;
  private size = 0;

  async decode(data: Buffer): Promise<Buffer> {
    if (!this.headerDone) {
      this.header = Buffer.concat([this.header, data]);
      const len = this.headerLength();
      if (len === null) return Buffer.alloc(0);
      const rest = this.header.subarray(len);
      this.headerDone = true;
      this.header = Buffer.alloc(0);
      return this.inflate(rest);
    }
    return this.inflate(data);
  }

  async flush(): Promise<Buffer> {
    this.z.close();
    return Buffer.alloc(0);
  }

  /** Bytes of the complete gzip header, `null` when more input is needed (throws zlib's text for a bad header). */
  private headerLength(): number | null {
    const h = this.header;
    if (h.length >= 1 && h[0] !== 0x1f) throw new ContentDecodeError("Error -3 while decompressing data: incorrect header check");
    if (h.length >= 2 && h[1] !== 0x8b) throw new ContentDecodeError("Error -3 while decompressing data: incorrect header check");
    if (h.length >= 3 && h[2] !== 8) throw new ContentDecodeError("Error -3 while decompressing data: unknown compression method");
    if (h.length >= 4 && ((h[3] as number) & 0xe0) !== 0) throw new ContentDecodeError("Error -3 while decompressing data: unknown header flags set");
    if (h.length < 10) return null;
    const flags = h[3] as number;
    let pos = 10;
    if (flags & 4) {
      if (h.length < pos + 2) return null;
      pos += 2 + h.readUInt16LE(pos);
      if (h.length < pos) return null;
    }
    for (const bit of [8, 16]) {
      if (flags & bit) {
        const end = h.indexOf(0, pos);
        if (end < 0) return null;
        pos = end + 1;
      }
    }
    if (flags & 2) {
      pos += 2;
      if (h.length < pos) return null;
    }
    return pos;
  }

  private async inflate(data: Buffer): Promise<Buffer> {
    if (this.ended) return this.consumeTrailer(data);
    if (data.length === 0) return Buffer.alloc(0);
    const { out, unused } = await this.z.write(data);
    this.crc = crc32Update(this.crc, out);
    this.size = (this.size + out.length) >>> 0;
    if (unused > 0) {
      this.ended = true;
      this.consumeTrailer(data.subarray(data.length - unused));
    }
    return out;
  }

  private consumeTrailer(data: Buffer): Buffer {
    if (this.trailer.length < 8) {
      this.trailer = Buffer.concat([this.trailer, data.subarray(0, 8 - this.trailer.length)]);
      if (this.trailer.length === 8) {
        if (this.trailer.readUInt32LE(0) !== this.crc) throw new ContentDecodeError("Error -3 while decompressing data: incorrect data check");
        if (this.trailer.readUInt32LE(4) !== this.size) throw new ContentDecodeError("Error -3 while decompressing data: incorrect length check");
      }
    }
    return Buffer.alloc(0);
  }
}

class BrotliDecoder implements ContentDecoder {
  private chunks: Buffer[] = [];

  async decode(data: Buffer): Promise<Buffer> {
    if (data.length) this.chunks.push(data);
    return Buffer.alloc(0);
  }

  async flush(): Promise<Buffer> {
    if (this.chunks.length === 0) return Buffer.alloc(0);
    try {
      return zlib.brotliDecompressSync(Buffer.concat(this.chunks));
    } catch (e) {
      throw new ContentDecodeError(String((e as Error).message));
    }
  }
}

class MultiDecoder implements ContentDecoder {
  constructor(private readonly children: ContentDecoder[]) {}

  async decode(data: Buffer): Promise<Buffer> {
    let out = data;
    for (const child of this.children) out = await child.decode(out);
    return out;
  }

  async flush(): Promise<Buffer> {
    let out: Buffer = Buffer.alloc(0);
    for (const child of this.children) out = Buffer.concat([await child.decode(out), await child.flush()]);
    return out;
  }
}

/** `Response._get_content_decoder`: one decoder per supported value, unknown values skipped; `null` for identity. */
export function contentDecoderFor(contentEncoding: string): ContentDecoder | null {
  const decoders: ContentDecoder[] = [];
  for (const raw of contentEncoding.split(",")) {
    switch (raw.trim().toLowerCase()) {
      case "gzip":
        decoders.push(new GZipDecoder());
        break;
      case "deflate":
        decoders.push(new DeflateDecoder());
        break;
      case "br":
        decoders.push(new BrotliDecoder());
        break;
      default:
        break;
    }
  }
  if (decoders.length === 0) return null;
  if (decoders.length === 1) return decoders[0] as ContentDecoder;
  return new MultiDecoder(decoders.reverse());
}
