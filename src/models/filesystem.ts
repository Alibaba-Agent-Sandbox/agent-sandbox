/** Filesystem data models. */

import { z } from "zod";

import { defineModel, lax } from "./base.js";

/** Type of filesystem entry. */
export const FileType = {
  FILE: "file",
  DIRECTORY: "directory",
} as const;
export type FileType = (typeof FileType)[keyof typeof FileType];

/** Information about a file or directory. */
export class FileInfo extends defineModel(
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(FileType).default(FileType.FILE),
    size: lax.int().default(0),
    modified: lax.date().nullable().default(null),
  }),
) {}

/** Type of filesystem watch event. */
export const WatchEventType = {
  CREATED: "created",
  MODIFIED: "modified",
  DELETED: "deleted",
  RENAMED: "renamed",
} as const;
export type WatchEventType = (typeof WatchEventType)[keyof typeof WatchEventType];

/** A filesystem change event from WatchDir. */
export class WatchEvent extends defineModel(
  z.object({
    type: z.enum(WatchEventType),
    path: z.string(),
    old_path: z.string().nullable().default(null),
    timestamp: lax.float().nullable().default(null),
  }),
) {}
