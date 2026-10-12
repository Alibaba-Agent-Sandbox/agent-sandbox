/** pytest `caplog` fixture equivalent: a handler on the root logger that collects every record. */

import { afterEach, beforeEach } from "vitest";

import { Handler, type Level, type LogRecord, logging } from "../../src/utils/logging.js";

export class CapLog extends Handler {
  records: LogRecord[] = [];
  private _undo: (() => void)[] = [];

  override emit(record: LogRecord): void {
    record.message = record.getMessage();
    this.records.push(record);
  }

  get messages(): string[] {
    return this.records.map((r) => r.getMessage());
  }

  get text(): string {
    return this.records.map((r) => `${r.levelname} ${r.name}:${r.getMessage()}`).join("\n");
  }

  clear(): void {
    this.records = [];
  }

  /** `caplog.at_level(level, logger=name)`: run `fn` with the logger/handler level lowered, then restore. */
  at_level<T>(level: Level, loggerName: string | null, fn: () => T): T {
    const root = logging.getLogger(loggerName);
    const prevLogger = root.level;
    const prevHandler = this.level;
    root.setLevel(level);
    this.setLevel(level);
    try {
      return fn();
    } finally {
      root.setLevel(prevLogger);
      this.setLevel(prevHandler);
    }
  }

  /** Async-friendly `caplog.at_level`: returns the restore function. */
  set_level(level: Level, loggerName: string | null): () => void {
    const lg = logging.getLogger(loggerName);
    const prevLogger = lg.level;
    const prevHandler = this.level;
    lg.setLevel(level);
    this.setLevel(level);
    return () => {
      lg.setLevel(prevLogger);
      this.setLevel(prevHandler);
    };
  }

  install(): void {
    logging.getLogger().addHandler(this);
  }

  uninstall(): void {
    logging.getLogger().removeHandler(this);
    for (const u of this._undo.splice(0)) u();
  }
}

export function useCaplog(): CapLog {
  const cap = new CapLog();
  beforeEach(() => {
    cap.clear();
    cap.install();
  });
  afterEach(() => cap.uninstall());
  return cap;
}
