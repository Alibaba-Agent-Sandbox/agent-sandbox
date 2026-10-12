/** `click._utils`: sentinels distinguishing "not provided" from `None` (`null`). */

export class Sentinel {
  constructor(readonly name: string) {}
  toString(): string {
    return `Sentinel.${this.name}`;
  }
}

/** Value was not provided at all (as opposed to explicitly `null`). */
export const UNSET = new Sentinel("UNSET");

/** An option was given as a bare flag without a value but is not a flag option (prompt / `flag_value`). */
export const FLAG_NEEDS_VALUE = new Sentinel("FLAG_NEEDS_VALUE");
