// Do not ship files emitted for source modules that have since been retired.
import { rmSync } from "node:fs";

rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });
