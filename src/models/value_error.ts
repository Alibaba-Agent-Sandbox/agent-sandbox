/** A caller-supplied value is unusable (the SDK's counterpart of a plain `ValueError`). */
export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}
