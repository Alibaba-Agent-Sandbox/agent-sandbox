/**
 * Environment names the built-in alicloud-express provider actually reads.
 *
 * One name per key (docs/en/guide/providers.md). These strings are the CLI-facing
 * list for missing-credential errors. They are not a second registry: the generated
 * config keys stay the source of truth, and this module only repeats those canonical
 * names so an error can quote them without importing the generator.
 */

export const SANDBOX_API_KEY_ENV = "ABX_SANDBOX_API_KEY";
export const SANDBOX_BASE_URL_ENV = "ABX_SANDBOX_BASE_URL";
export const SANDBOX_DOMAIN_ENV = "ABX_SANDBOX_DOMAIN";
export const ACCESS_KEY_ID_ENV = "ALICLOUD_ACCESS_KEY_ID";
export const ACCESS_KEY_SECRET_ENV = "ALICLOUD_ACCESS_KEY_SECRET";
export const REGION_ENV = "ALIBABA_CLOUD_REGION_ID";

const WHERE = "process environment, ./.env, or ~/.abx/.env";

/** Suggestion when no sandbox API key was found. */
export const API_KEY_ENV_SUGGESTION =
  `Set ${SANDBOX_API_KEY_ENV}. That is the only sandbox API key environment variable that is read (${WHERE}).`;

/** Suggestion when the AccessKey pair was not found. */
export const AKSK_ENV_SUGGESTION =
  `Set ${ACCESS_KEY_ID_ENV} and ${ACCESS_KEY_SECRET_ENV}. Those are the only AccessKey environment variables that are read (${WHERE}).`;

/** Missing sandbox API key; AccessKeys are a separate control-plane credential. */
export const CREDENTIAL_ENV_SUGGESTION =
  API_KEY_ENV_SUGGESTION +
  ` The base URL is ${SANDBOX_BASE_URL_ENV}, the domain is ${SANDBOX_DOMAIN_ENV}, and the region is ${REGION_ENV}.`;
