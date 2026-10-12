/**
 * PyYAML `yaml.safe_load` (YAML 1.1 resolvers, merge keys, duplicate keys allowed, multi-document streams rejected).
 * The single implementation lives in `utils/_pyyaml.ts` (also the base of the agent's `safe_dump`).
 */
export { safeLoadValue as safeLoad } from "../utils/_pyyaml.js";
