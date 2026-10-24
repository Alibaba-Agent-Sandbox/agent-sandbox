/** Provider-neutral template image profile values. */

export type ServerStart = "image_cmd" | "platform_start_cmd";

/** Image contract the template generator renders. `registry` is a pull/push note, not credentials. */
export interface TemplateProfile {
  readonly provider_id: string;
  /** True when this provider declared no profile and the generic profile was substituted. */
  readonly missing_profile: boolean;
  /** Sentence the generator includes when `missing_profile` is true. Empty otherwise. */
  readonly notice: string;
  readonly base_image: string;
  readonly entrypoint_replaceable: boolean;
  readonly server_start: ServerStart;
  readonly cmd: readonly string[] | null;
  readonly start_cmd: string | null;
  readonly ready_cmd: string | null;
  readonly arch: string;
  /** Login user persisted as the sandbox default. Empty means the image default. */
  readonly user: string;
  readonly workdir: string;
  readonly reserved_ports: readonly number[];
  readonly registry: string;
  /** Provider-owned generation advice; does not mutate or validate user resources. */
  readonly resource_notes?: string;
}

export interface ProfileFields {
  base_image: string;
  entrypoint_replaceable: boolean;
  server_start: ServerStart;
  cmd: readonly string[] | null;
  start_cmd: string | null;
  ready_cmd: string | null;
  arch: string;
  user: string;
  workdir: string;
  reserved_ports: readonly number[];
  registry: string;
  resource_notes?: string;
}
