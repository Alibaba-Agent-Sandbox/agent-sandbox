/** Filesystem data models (port of `models/filesystem.py`). */

import { BaseModel, type ModelInput, datetime, enumOf, field, int, optional, str, float, type PyDatetime } from "./_pydantic.js";

/** Type of filesystem entry. */
export const FileType = {
  FILE: "file",
  DIRECTORY: "directory",
} as const;
export type FileType = (typeof FileType)[keyof typeof FileType];

/** Information about a file or directory. */
export class FileInfo extends BaseModel {
  static override modelFields = {
    name: field(str()),
    path: field(str()),
    type: field(enumOf(FileType), { default: FileType.FILE }),
    size: field(int(), { default: 0 }),
    modified: field(optional(datetime()), { default: null }),
  };

  declare name: string;
  declare path: string;
  declare type: FileType;
  declare size: number;
  declare modified: PyDatetime | null;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

/** Type of filesystem watch event. */
export const WatchEventType = {
  CREATED: "created",
  MODIFIED: "modified",
  DELETED: "deleted",
  RENAMED: "renamed",
} as const;
export type WatchEventType = (typeof WatchEventType)[keyof typeof WatchEventType];

/** A filesystem change event from WatchDir. */
export class WatchEvent extends BaseModel {
  static override modelFields = {
    type: field(enumOf(WatchEventType)),
    path: field(str()),
    old_path: field(optional(str()), { default: null }), // For rename events
    timestamp: field(optional(float()), { default: null }),
  };

  declare type: WatchEventType;
  declare path: string;
  declare old_path: string | null;
  declare timestamp: number | null;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}
