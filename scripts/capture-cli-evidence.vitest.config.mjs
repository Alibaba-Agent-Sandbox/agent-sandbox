import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/test_cli_evidence/capture_cli_evidence.capture.ts"],
    environment: "node",
    testTimeout: 120000,
  },
});
