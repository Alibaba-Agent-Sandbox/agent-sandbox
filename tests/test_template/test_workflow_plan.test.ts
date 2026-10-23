import { describe, expect, it } from "vitest";
import vectors from "./fixtures/workflow-vectors.json" with {type: "json"};
import { planWorkflow, validateWorkflowManifest } from "../../src/template/workflow_plan.mjs";
describe("canonical workflow vectors", () => {
  for (const vector of vectors.cases) it(vector.id, () => {
    const v = vector as unknown as {input:{manifest:unknown;provider:Parameters<typeof planWorkflow>[1];workflow_id:string;consumer:string};expected?:unknown;error?:string};
    if (v.error) expect(() => planWorkflow(v.input.manifest,v.input.provider,v.input.workflow_id,v.input.consumer)).toThrow();
    else expect(planWorkflow(v.input.manifest,v.input.provider,v.input.workflow_id,v.input.consumer)).toEqual(v.expected);
  });
  it("does not interpret application deployment metadata as workflow integer fields", () => {
    const sample = structuredClone(vectors.cases[0].input.manifest) as unknown as Record<string,unknown>;
    sample.resources = {cpu:0.5}; expect(() => validateWorkflowManifest(sample)).not.toThrow();
  });
});
