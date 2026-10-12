/** Test helper: build an in-memory `.tar.gz` like Python's `tarfile.open(mode="w:gz")` + `addfile`. */

import { gzipSync } from "node:zlib";

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

/** One ustar regular-file entry (`name` is stored verbatim, including `..` segments). */
export function tarEntry(name: string, data: Buffer, mtime: number = Math.floor(Date.now() / 1000)): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf-8");
  header.write(octal(0o644, 8), 100, "ascii");
  header.write(octal(0, 8), 108, "ascii");
  header.write(octal(0, 8), 116, "ascii");
  header.write(octal(data.length, 12), 124, "ascii");
  header.write(octal(mtime, 12), 136, "ascii");
  header.write("        ", 148, "ascii");
  header.write("0", 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  const pad = (512 - (data.length % 512)) % 512;
  return Buffer.concat([header, data, Buffer.alloc(pad, 0)]);
}

/** `tarfile` terminates an archive with two zero blocks, padded to a 10240-byte record. */
export function tarArchive(entries: Buffer[]): Buffer {
  const body = Buffer.concat([...entries, Buffer.alloc(1024, 0)]);
  const rec = 10240;
  const total = Math.ceil(body.length / rec) * rec;
  return Buffer.concat([body, Buffer.alloc(total - body.length, 0)]);
}

export function makeTarGz(files: Record<string, string>, prefix = "owner-repo-abc123"): Buffer {
  const entries = Object.entries(files).map(([rel, content]) => tarEntry(`${prefix}/${rel}`, Buffer.from(content, "utf-8")));
  return gzipSync(tarArchive(entries));
}
