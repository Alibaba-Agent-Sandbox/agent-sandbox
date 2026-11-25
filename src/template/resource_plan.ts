/** Named resources and deferred output references. Ordinary expressions use the official Devs parser. */
import type { TemplateV1, SandboxV1, DevsResourceV1 } from "./contract-v1/normalize.mjs";
import { ApplicationError, record } from "../application/config.js";
export type ResourceOutput = Record<string, unknown>;
export interface ResourceNode {name: string; kind: "sandbox" | "serving"; declaration: SandboxV1 | DevsResourceV1; dependencies: string[]}
const references = /\$\{resources\.([A-Za-z_][A-Za-z0-9_-]*)\.output((?:\.[A-Za-z_][A-Za-z0-9_-]*)*)\}/g;
function visit(value: unknown, fn: (value: string) => void): void {
  if (typeof value === "string") fn(value);
  else if (Array.isArray(value)) value.forEach(item => visit(item, fn));
  else if (record(value)) Object.values(value).forEach(item => visit(item, fn));
}
/** Stable topological order. Missing references and cycles are diagnosed before effects. */
export function resourcePlan(document: TemplateV1): ResourceNode[] {
  const nodes: ResourceNode[] = [];
  for (const kind of ["sandbox", "serving"] as const) for (const [name, declaration] of Object.entries(document[kind] ?? {})) {
    const deps = new Set<string>();
    visit(declaration, value => { for (const match of value.matchAll(references)) deps.add(match[1]); });
    // Success/final actions can consume their own completed output; creation props cannot.
    const controls = kind === "sandbox" ? (declaration as SandboxV1).template : (declaration as DevsResourceV1).props;
    let selfInput = false;
    visit([controls, (declaration as SandboxV1).volumes, declaration.actions?.["pre-deploy"]], value => {for (const match of value.matchAll(references)) if (match[1] === name) selfInput = true;});
    if (!selfInput) deps.delete(name);
    nodes.push({name, kind, declaration, dependencies: [...deps]});
  }
  const byName = new Map(nodes.map(node => [node.name, node]));
  if (byName.size !== nodes.length) throw new ApplicationError("Resource logical names must be globally unique.");
  const ordered: ResourceNode[] = [], visiting = new Set<string>(), complete = new Set<string>();
  const add = (name: string): void => {
    if (complete.has(name)) return;
    if (visiting.has(name)) throw new ApplicationError(`Resource dependency cycle at '${name}'.`);
    const node = byName.get(name); if (!node) throw new ApplicationError(`Unknown resource output reference '${name}'.`);
    visiting.add(name); node.dependencies.forEach(add); visiting.delete(name); complete.add(name); ordered.push(node);
  };
  nodes.forEach(node => add(node.name));
  return ordered;
}
/** Resolve only the reserved resource-output namespace, preserving whole-value types. */
export function resourceValues<T>(value: T, outputs: Record<string, ResourceOutput>): T {
  const get = (resource: string, trail: string): unknown => {
    let current: unknown = outputs[resource];
    if (current === undefined) throw new ApplicationError(`Resource '${resource}' has no ready output.`);
    for (const key of trail.split(".").filter(Boolean)) {
      if (!record(current) || !Object.hasOwn(current, key)) throw new ApplicationError(`Missing output '${resource}${trail}'.`);
      current = current[key];
    }
    return structuredClone(current);
  };
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") {
      const all = [...item.matchAll(references)];
      if (all.length === 1 && all[0][0] === item) return get(all[0][1], all[0][2]);
      return item.replace(references, (_match, resource: string, trail: string) => {
        const result = get(resource, trail);
        if (typeof result !== "string" && typeof result !== "number" && typeof result !== "boolean") throw new ApplicationError("Structured outputs require a whole-value reference.");
        return String(result);
      });
    }
    if (Array.isArray(item)) return item.map(walk);
    if (record(item)) return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
    return item;
  };
  return walk(value) as T;
}
