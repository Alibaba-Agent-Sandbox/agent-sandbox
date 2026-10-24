import { DockerBuildError } from "../../models/errors.js";

/** Expand the existing Express image placeholders without asking a model to choose a tag. */
export function materializeBaseImage(value: string, configuredRegion?: string | null): string {
  if (!value.includes("<region>") && !value.includes("<tag>")) return value;
  const region = process.env["ABX_BASE_IMAGE_REGION"] || configuredRegion || process.env["ALIBABA_CLOUD_REGION_ID"] || "cn-hangzhou";
  const tag = process.env["ABX_BASE_IMAGE_TAG"] || "v0.0.49";
  if (!/^[a-z0-9-]+$/.test(region)) throw new DockerBuildError(`Base image region ${region} is not a lowercase DNS label.`);
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(tag)) throw new DockerBuildError(`Base image tag ${tag} is not a Docker tag.`);
  return value.replaceAll("<region>", region).replaceAll("<tag>", tag);
}
