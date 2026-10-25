import {describe, expect, it} from "vitest";
import vectors from "./fixtures/launch-vectors.json" with {type: "json"};
import {planTemplateLaunch, type LaunchProvider} from "../../src/template/launch_plan.mjs";
describe("canonical whole-template launch vectors", () => {
  for (const value of vectors.cases) it(value.id, () => {
    const vector = value as unknown as {input: {manifest: unknown; provider: LaunchProvider; consumer: string; prepared: boolean}; expected?: unknown; error?: boolean};
    const run = () => planTemplateLaunch(vector.input.manifest, vector.input.provider, vector.input.consumer, vector.input.prepared);
    if (vector.error) expect(run).toThrow();
    else expect(run()).toEqual(vector.expected);
  });
});
