/** PAX header decoding shared by the installer and template archive readers. */
export function parsePax(data: Buffer, stopOnInvalidRecord = false): Record<string, string> {
  const result: Record<string, string> = {};
  let position = 0;
  while (position < data.length) {
    const space = data.indexOf(0x20, position);
    if (space < 0) break;
    const length = parseInt(data.subarray(position, space).toString("ascii"), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data.subarray(space + 1, position + length - 1);
    const equals = record.indexOf(0x3d);
    if (equals < 0) {
      if (stopOnInvalidRecord) break;
    } else result[record.subarray(0, equals).toString("utf8")] = record.subarray(equals + 1).toString("utf8");
    position += length;
  }
  return result;
}
