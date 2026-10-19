/** Compatibility export for legacy Express handlers; generic routes select provider factories. */
export { requireTemplateFeature } from "../providers/alicloud_express/cli/selection.js";
export type TemplateFeature = "templates.read" | "templates.build";
