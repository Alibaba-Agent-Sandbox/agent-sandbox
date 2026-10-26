import { parsePax } from "./tar_format.js";
/**
 * Minimal `tarfile.open(path, "r:gz")` replacement (ustar, GNU long names and pax headers) with the behaviours the
 * registry client relies on: `getmembers()` order, `name` normalisation, `isfile()` classification and
 * `extractfile()`.
 */

import * as zlib from "node:zlib";

export class ReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadError";
  }
  override toString(): string {
    return this.message;
  }
}

export class EOFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EOFError";
  }
  override toString(): string {
    return this.message;
  }
}

export class ZlibError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "error";
  }
  override toString(): string {
    return this.message;
  }
}

const BLOCK = 512;

const REGTYPE = "0";
const AREGTYPE = "\0";
const CONTTYPE = "7";
const GNUTYPE_SPARSE = "S";
const DIRTYPE = "5";
const XHDTYPE = "x";
const XGLTYPE = "g";
const SOLARIS_XHDTYPE = "X";
const GNUTYPE_LONGNAME = "L";
const GNUTYPE_LONGLINK = "K";

const REGULAR_TYPES = new Set([REGTYPE, AREGTYPE, CONTTYPE, GNUTYPE_SPARSE]);

export class TarInfo {
  name = "";
  size = 0;
  mode = 0;
  type: string = REGTYPE;
  linkname = "";
  offset = 0;
  offset_data = 0;
  pax_headers: Record<string, string> = {};

  isreg(): boolean {
    return REGULAR_TYPES.has(this.type);
  }
  isfile(): boolean {
    return this.isreg();
  }
  isdir(): boolean {
    return this.type === DIRTYPE;
  }
}

function nts(b: Buffer): string {
  const i = b.indexOf(0);
  return (i < 0 ? b : b.subarray(0, i)).toString("utf-8");
}

function nti(b: Buffer): number {
  if (b[0] !== undefined && (b[0] === 0o200 || b[0] === 0o377)) {
    let n = 0;
    for (let i = 1; i < b.length; i++) n = n * 256 + (b[i] as number);
    if (b[0] === 0o377) n = n - 256 ** (b.length - 1);
    return n;
  }
  const s = nts(b).trim();
  if (s === "") return 0;
  if (!/^[0-7]+$/.test(s)) throw new ReadError("invalid header");
  return parseInt(s, 8);
}

function calcChecksums(block: Buffer): [number, number] {
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i++) {
    let v = block[i] as number;
    if (i >= 148 && i < 156) v = 0x20;
    unsigned += v;
    signed += v > 127 ? v - 256 : v;
  }
  return [unsigned, signed];
}



class HeaderEOF extends Error {}

export class TarArchive {
  private members: TarInfo[] | null = null;
  private readonly data: Buffer;

  constructor(data: Buffer) {
    this.data = data;
    this.firstmember();
  }

  private firstmember(): void {
    if (this.data.length === 0) throw new ReadError("empty file");
    this.loadMembers();
  }

  getmembers(): TarInfo[] {
    return this.loadMembers();
  }

  private loadMembers(): TarInfo[] {
    if (this.members !== null) return this.members;
    const members: TarInfo[] = [];
    let offset = 0;
    let globalPax: Record<string, string> = {};
    let pendingPax: Record<string, string> | null = null;
    let pendingName: string | null = null;
    let pendingLink: string | null = null;
    const buf = this.data;

    for (;;) {
      if (offset + BLOCK > buf.length) {
        if (offset === 0) throw new ReadError("truncated header");
        if (offset < buf.length) {
          /* trailing partial block: ignored by tarfile after the first member */
        }
        break;
      }
      const block = buf.subarray(offset, offset + BLOCK);
      if (block.every((b) => b === 0)) break;
      const stored = (() => {
        try {
          return nti(block.subarray(148, 156));
        } catch {
          return -1;
        }
      })();
      const [u, s] = calcChecksums(block);
      if (stored !== u && stored !== s) {
        if (offset === 0) throw new ReadError("bad checksum");
        break;
      }

      const info = new TarInfo();
      try {
        info.name = nts(block.subarray(0, 100));
        info.mode = nti(block.subarray(100, 108));
        info.size = nti(block.subarray(124, 136));
      } catch (e) {
        if (offset === 0) throw e;
        break;
      }
      info.type = String.fromCharCode(block[156] as number);
      info.linkname = nts(block.subarray(157, 257));
      const prefix = nts(block.subarray(345, 500));
      info.offset = offset;
      info.offset_data = offset + BLOCK;
      if (info.type === AREGTYPE && info.name.endsWith("/")) info.type = DIRTYPE;
      if (info.type === DIRTYPE) info.name = info.name.replace(/\/+$/, "");
      if (prefix && ![GNUTYPE_LONGNAME, GNUTYPE_LONGLINK, GNUTYPE_SPARSE].includes(info.type)) {
        info.name = `${prefix}/${info.name}`;
      }

      const padded = (n: number): number => Math.ceil(n / BLOCK) * BLOCK;
      const dataEnd = info.offset_data + info.size;

      if (info.type === GNUTYPE_LONGNAME || info.type === GNUTYPE_LONGLINK) {
        if (dataEnd > buf.length) throw new ReadError("unexpected end of data");
        const text = nts(buf.subarray(info.offset_data, dataEnd));
        if (info.type === GNUTYPE_LONGNAME) pendingName = text;
        else pendingLink = text;
        offset = info.offset_data + padded(info.size);
        continue;
      }
      if (info.type === XHDTYPE || info.type === SOLARIS_XHDTYPE || info.type === XGLTYPE) {
        if (dataEnd > buf.length) throw new ReadError("unexpected end of data");
        const pax = parsePax(buf.subarray(info.offset_data, dataEnd), true);
        if (info.type === XGLTYPE) globalPax = { ...globalPax, ...pax };
        else pendingPax = { ...(pendingPax ?? {}), ...pax };
        offset = info.offset_data + padded(info.size);
        continue;
      }

      if (pendingName !== null) {
        info.name = pendingName;
        pendingName = null;
      }
      if (pendingLink !== null) {
        info.linkname = pendingLink;
        pendingLink = null;
      }
      const pax = { ...globalPax, ...(pendingPax ?? {}) };
      pendingPax = null;
      if (Object.keys(pax).length) {
        info.pax_headers = pax;
        if (pax["path"] !== undefined) info.name = pax["path"] as string;
        if (pax["linkpath"] !== undefined) info.linkname = pax["linkpath"] as string;
        if (pax["size"] !== undefined && /^\d+$/.test(pax["size"] as string)) info.size = Number(pax["size"]);
      }
      if (info.type === DIRTYPE) info.name = info.name.replace(/\/+$/, "");
      members.push(info);
      offset = info.offset_data + (info.isreg() || info.type === GNUTYPE_SPARSE ? padded(info.size) : 0);
      if (!info.isreg() && info.type !== GNUTYPE_SPARSE) {
        /* link / dir / device members carry no data blocks */
      }
    }
    this.members = members;
    return members;
  }

  /** `tf.extractfile(member)`: file contents for regular members, `null` otherwise. */
  extractfile(member: TarInfo): Buffer | null {
    if (!member.isreg()) return null;
    const end = member.offset_data + member.size;
    if (end > this.data.length) throw new ReadError("unexpected end of data");
    return this.data.subarray(member.offset_data, end);
  }
}

/** `tarfile.open(path, "r:gz")` on an in-memory buffer. */
export function openTarGz(raw: Buffer): TarArchive {
  if (raw.length === 0) throw new ReadError("empty file");
  if (raw.length < 2 || raw[0] !== 0x1f || raw[1] !== 0x8b) {
    throw new ReadError("not a gzip file");
  }
  let data: Buffer;
  try {
    data = zlib.gunzipSync(raw);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "Z_BUF_ERROR") {
      throw new EOFError("Compressed file ended before the end-of-stream marker was reached");
    }
    throw new ZlibError(`Error -3 while decompressing data: ${(e as Error).message}`);
  }
  return new TarArchive(data);
}
