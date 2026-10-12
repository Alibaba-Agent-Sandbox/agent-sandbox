/**
 * Shared fixtures / helpers for the offline template-fixture tests (port of `tests/test_templates/conftest.py`).
 *
 * `tests/fixtures/templates/` holds the minimal fixture template (`python-hello`) used to exercise the install pipeline
 * offline: no network, no real platform API, no docker daemon.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach } from "vitest";

import { delenv } from "../helpers/templateSupport.js";
import { _CI_ENV_VARS } from "../_support/env.js";

export const TEMPLATES_DIR = fileURLToPath(new URL("../fixtures/templates/", import.meta.url)).replace(/[/\\]$/, "");

export const EXPECTED_FIXTURE_TEMPLATES: readonly string[] = ["python-hello"];

/** Every template folder under the fixture directory (sorted, hidden directories skipped). */
export function discoverTemplateDirs(): string[] {
  if (!fs.existsSync(TEMPLATES_DIR) || !fs.statSync(TEMPLATES_DIR).isDirectory()) return [];
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter((n) => !n.startsWith(".") && fs.statSync(path.join(TEMPLATES_DIR, n)).isDirectory())
    .sort()
    .map((n) => path.join(TEMPLATES_DIR, n));
}

/** `_suppress_ci_detection` autouse fixture: the CLI must never auto-enable JSON mode. */
export function useSuppressCiDetection(): void {
  beforeEach(() => {
    for (const v of _CI_ENV_VARS) delenv(v);
  });
}
