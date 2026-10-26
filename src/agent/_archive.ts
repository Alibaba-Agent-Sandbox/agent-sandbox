import { parsePax } from "../utils/tar_format.js";
/**
 * Dependency-free `.tar.gz` / `.zip` reading and *safe* extraction for the
 * Qwen Code standalone installer.
 *
 * The tar path reproduces CPython's `tarfile` `filter="data"` semantics
 * (absolute-name stripping, destination containment checked on real paths,
 * special-file rejection, link-target checks, permission masking); the zip
 * path reproduces `ZipFile.extractall` name sanitising and CRC checking.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

export type TarKind = "file" | "dir" | "symlink" | "hardlink" | "special";

export interface TarMember {
  name: string;
  kind: TarKind;
  mode: number;
  linkname: string;
  data: Buffer;
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

function cstring(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString("utf8");
}

function octal(buf: Buffer, start: number, length: number): number {
  const field = buf.subarray(start, start + length);
  if ((field[0] as number) & 0x80) {
    let value = 0;
    for (let i = 1; i < field.length; i += 1) value = value * 256 + (field[i] as number);
    return value;
  }
  const text = cstring(buf, start, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new ArchiveError("invalid header");
  return parseInt(text, 8);
}



/** Parse every member of a (gzip-compressed or plain) tar archive. */
export function readTarMembers(archive: string): TarMember[] {
  let raw = fs.readFileSync(archive);
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    raw = zlib.gunzipSync(raw);
  } else if (raw.length >= 3 && raw.subarray(0, 3).toString("latin1") === "BZh") {
    throw new ArchiveError("bzip2-compressed tar archives are not supported");
  } else if (raw.length >= 6 && raw.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))) {
    throw new ArchiveError("xz-compressed tar archives are not supported");
  }

  const members: TarMember[] = [];
  let offset = 0;
  let longName: string | null = null;
  let longLink: string | null = null;
  let pax: Record<string, string> = {};
  let globalPax: Record<string, string> = {};

  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    const stored = parseInt(cstring(header, 148, 8).trim() || "0", 8);
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 0x20 : (header[i] as number);
    if (Number.isNaN(stored) || stored !== sum) throw new ArchiveError("bad checksum");

    let name = cstring(header, 0, 100);
    const mode = octal(header, 100, 8);
    let size = octal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] as number);
    let linkname = cstring(header, 157, 100);
    const magic = header.subarray(257, 262).toString("latin1");
    if (magic === "ustar") {
      const prefix = cstring(header, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    offset += 512;

    if (typeflag === "x" || typeflag === "g" || typeflag === "L" || typeflag === "K") {
      const body = raw.subarray(offset, offset + size);
      offset += Math.ceil(size / 512) * 512;
      if (typeflag === "x") pax = { ...pax, ...parsePax(body) };
      else if (typeflag === "g") globalPax = { ...globalPax, ...parsePax(body) };
      else if (typeflag === "L") longName = cstring(body, 0, body.length);
      else longLink = cstring(body, 0, body.length);
      continue;
    }

    const effective = { ...globalPax, ...pax };
    if (longName !== null) name = longName;
    if (longLink !== null) linkname = longLink;
    if (effective.path !== undefined) name = effective.path;
    if (effective.linkpath !== undefined) linkname = effective.linkpath;
    if (effective.size !== undefined) size = parseInt(effective.size, 10);
    longName = null;
    longLink = null;
    pax = {};

    let kind: TarKind;
    switch (typeflag) {
      case "\0":
      case "0":
      case "7":
        kind = name.endsWith("/") ? "dir" : "file";
        break;
      case "1":
        kind = "hardlink";
        break;
      case "2":
        kind = "symlink";
        break;
      case "5":
        kind = "dir";
        break;
      case "3":
      case "4":
      case "6":
        kind = "special";
        break;
      default:
        kind = "file";
    }

    const carriesData = kind === "file";
    if (carriesData && offset + size > raw.length) throw new ArchiveError("unexpected end of data");
    const data = carriesData ? Buffer.from(raw.subarray(offset, offset + size)) : Buffer.alloc(0);
    if (carriesData || (typeflag !== "1" && typeflag !== "2" && kind !== "dir")) {
      offset += Math.ceil(size / 512) * 512;
    }
    members.push({ name: kind === "dir" ? name.replace(/\/+$/, "") || name : name, kind, mode, linkname, data });
  }
  return members;
}

export function isWithin(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** `os.path.realpath(p, strict=ALLOW_MISSING)`: resolve symlinks of the existing prefix. */
export function realpathAllowMissing(target: string): string {
  const missing: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return path.join(real, ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...missing.reverse());
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

class FilterError extends ArchiveError {}

interface FilteredMember {
  name: string;
  mode: number | null;
  linkname: string;
}

/** CPython `tarfile.data_filter` (`_get_filtered_attrs(for_data=True)`). */
function dataFilter(member: TarMember, destPath: string): FilteredMember {
  const dest = realpathAllowMissing(destPath);
  let name = member.name;
  if (name.startsWith("/") || name.startsWith(path.sep)) {
    name = member.name.replace(path.sep === "/" ? /^\/+/ : /^[/\\]+/, "");
  }
  if (path.isAbsolute(name)) throw new FilterError(`${member.name}: Member has an absolute path`);
  if (name.replace(/\\/g, "/").split("/").includes("..")) {
    const normalized = path.normalize(name);
    if (normalized !== name) name = normalized;
  }
  let target = realpathAllowMissing(path.join(dest, name));
  if (!isWithin(target, dest)) {
    throw new FilterError(`${member.name}: Member would be extracted to ${target}, which is outside the destination`);
  }
  let mode: number | null = member.mode & 0o755;
  if (member.kind === "file" || member.kind === "hardlink") {
    if (!(mode & 0o100)) mode &= ~0o111;
    mode |= 0o600;
  } else if (member.kind === "dir" || member.kind === "symlink") {
    mode = null;
  } else {
    throw new FilterError(`${member.name}: Refusing to extract special file`);
  }
  let linkname = member.linkname;
  if (member.kind === "hardlink" || member.kind === "symlink") {
    if (path.isAbsolute(linkname) || linkname.startsWith("/")) {
      throw new FilterError(`${member.name}: Link has an absolute path`);
    }
    if (target === dest) {
      throw new FilterError(`${member.name}: Member would be extracted to ${target}, which is outside the destination`);
    }
    const normalized = path.normalize(linkname);
    linkname = normalized;
    let linkTarget: string;
    if (member.kind === "symlink") {
      const linkDir = path.dirname(name.replace(/[/\\]+$/, ""));
      linkTarget = path.join(dest, linkDir, normalized);
    } else {
      linkTarget = path.join(dest, normalized);
    }
    target = realpathAllowMissing(linkTarget);
    if (!isWithin(target, dest)) {
      throw new FilterError(`${member.name}: Link would be extracted to ${target}, which is outside the destination`);
    }
  }
  return { name, mode, linkname };
}

export function extractTarMembers(members: TarMember[], dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const dirs: string[] = [];
  for (const member of members) {
    const filtered = dataFilter(member, dest);
    const target = path.join(dest, filtered.name);
    switch (member.kind) {
      case "dir":
        // data filter => mode None => tarfile.makedir uses the system default (0o777 & ~umask), never 0o700
        fs.mkdirSync(target, { recursive: true });
        dirs.push(target);
        break;
      case "file": {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.rmSync(target, { force: true });
        fs.writeFileSync(target, member.data);
        if (filtered.mode !== null) fs.chmodSync(target, filtered.mode);
        break;
      }
      case "symlink":
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.rmSync(target, { force: true });
        fs.symlinkSync(filtered.linkname, target);
        break;
      case "hardlink": {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.rmSync(target, { force: true });
        const source = path.join(dest, filtered.linkname);
        try {
          fs.linkSync(source, target);
        } catch {
          fs.copyFileSync(source, target);
        }
        break;
      }
      default:
        throw new FilterError(`${member.name}: Refusing to extract special file`);
    }
  }
}

// ---------------------------------------------------------------------------
// zip
// ---------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  flags: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function readZipEntries(raw: Buffer): ZipEntry[] {
  const minEocd = 22;
  let eocd = -1;
  for (let i = raw.length - minEocd; i >= Math.max(0, raw.length - minEocd - 0xffff); i -= 1) {
    if (raw.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ArchiveError("File is not a zip file");
  const count = raw.readUInt16LE(eocd + 10);
  let pos = raw.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (raw.readUInt32LE(pos) !== 0x02014b50) throw new ArchiveError("Bad magic number for central directory");
    const flags = raw.readUInt16LE(pos + 8);
    const method = raw.readUInt16LE(pos + 10);
    const crc = raw.readUInt32LE(pos + 16);
    const compressedSize = raw.readUInt32LE(pos + 20);
    const size = raw.readUInt32LE(pos + 24);
    const nameLen = raw.readUInt16LE(pos + 28);
    const extraLen = raw.readUInt16LE(pos + 30);
    const commentLen = raw.readUInt16LE(pos + 32);
    const localOffset = raw.readUInt32LE(pos + 42);
    const nameBytes = raw.subarray(pos + 46, pos + 46 + nameLen);
    const name = flags & 0x800 ? nameBytes.toString("utf8") : nameBytes.toString("latin1");
    entries.push({ name, method, crc, compressedSize, size, localOffset, flags });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(raw: Buffer, entry: ZipEntry): Buffer {
  const base = entry.localOffset;
  if (raw.readUInt32LE(base) !== 0x04034b50) throw new ArchiveError("Bad magic number for file header");
  const nameLen = raw.readUInt16LE(base + 26);
  const extraLen = raw.readUInt16LE(base + 28);
  const start = base + 30 + nameLen + extraLen;
  const body = raw.subarray(start, start + entry.compressedSize);
  let data: Buffer;
  if (entry.method === 0) data = Buffer.from(body);
  else if (entry.method === 8) data = zlib.inflateRawSync(body);
  else throw new ArchiveError(`That compression method is not supported: ${entry.method}`);
  if (crc32(data) !== entry.crc) throw new ArchiveError(`Bad CRC-32 for file '${entry.name}'`);
  return data;
}

export function zipNames(archive: string): string[] {
  return readZipEntries(fs.readFileSync(archive)).map((entry) => entry.name);
}

/** `ZipFile.extractall(dest)`: names are sanitised like CPython (`..`, `.` and empty parts dropped). */
export function extractZip(archive: string, dest: string): void {
  const raw = fs.readFileSync(archive);
  const entries = readZipEntries(raw);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of entries) {
    const parts = entry.name.split("/").filter((part) => part !== "" && part !== "." && part !== "..");
    const target = path.join(dest, ...parts);
    if (entry.name.endsWith("/")) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    const data = readZipEntry(raw, entry);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}
