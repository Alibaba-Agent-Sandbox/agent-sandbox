/** Provider-owned CLI option/help metadata. No cloud execution on discovery. */
import { Argument, Option, argument, option } from "../../../cli/kit.js";
import { Choice, FLOAT, INT, Path as ClickPath } from "../../../cli/types.js";
import { cleandoc } from "../../../utils/_py.js";
import { regionOption } from "../../../cli/region.js";
export /**
 * Shared help for the three `--token` options (task 206). The persistent `abx config set github_token` flow is
 * recommended; the flag remains a temporary override with an explicit leak warning.
 */
const _GITHUB_TOKEN_HELP = "GitHub token for private repos / higher rate limits. Prefer " +
    "'abx config set github_token' (masked input, stored once in ~/.abx/.env); " +
    "--token is a temporary override that may leak into shell history and the " +
    "process list (env: GITHUB_TOKEN).";

export /** The option set of `template install`. */
function _installParams(opts: {
    acrNamespaceHelp: string;
    cpuHelp: string;
    memoryHelp: string;
}): Array<Argument | Option> {
    return [
        argument(["template_ref"]),
        option(["--registry-url"], { default: "https://github.com", help: "Registry URL (default: GitHub)" }),
        option(["--registry-type"], {
            type: new Choice(["github", "local"]),
            default: null,
            help: "Registry type (auto-detected if not specified)",
        }),
        option(["--token"], { default: null, envvar: "GITHUB_TOKEN", help: _GITHUB_TOKEN_HELP }),
        option(["--alias", "-a"], { default: null, help: "Template alias" }),
        option(["--download-only"], {
            is_flag: true,
            default: false,
            help: "Only download to local cache (skip build and deploy)",
        }),
        option(["--dir", "dest_dir"], {
            default: null,
            type: new ClickPath(),
            help: "Download template source into this directory instead of the cache",
        }),
        option(["--acr-namespace"], { envvar: "ACR_NAMESPACE", default: null, help: opts.acrNamespaceHelp }),
        option(["--cpu"], { type: INT, default: null, help: opts.cpuHelp }),
        option(["--memory"], { type: INT, default: null, help: opts.memoryHelp }),
        option(["--yes", "-y"], { is_flag: true, default: false, help: "Skip confirmation prompt" }),
        regionOption(),
    ] as Array<Argument | Option>;
}
export const templateUi: Record<string, { params: readonly (Argument | Option)[]; help: string }> = {};
templateUi["install"] =  { params: _installParams({
    acrNamespaceHelp: "ACR namespace for deploy (env: ACR_NAMESPACE, or set in .env file)",
    cpuHelp: "CPU cores (default: from template.yaml or 2)",
    memoryHelp: "Memory in MB (default: from template.yaml or 2048)",
}), help: cleandoc(`Download a template and (by default) build + deploy it.

    By default, install downloads the template, then runs docker build,
    pushes to ACR, and creates a sandbox template via the official API —
    cloud-side operations that can incur Alibaba Cloud costs (ACR
    storage/traffic, template resources). Use --download-only to skip the
    build/deploy step and only download to the local cache
    (~/.abx/templates/).

    Use --dir <path> to download into a specific directory instead of
    the cache.

    TEMPLATE_REF can be a bare template name from the official index
    (alibaba-agent-sandbox/awesome-templates) or a registry reference. Bare names
    are resolved against the remote index; entries may pin a version, in
    which case that pinned ref is honoured.

    A GitHub token (private repos / higher rate limits) is taken from
    --token, then the GITHUB_TOKEN environment variable, then ./.env, then
    the stored github_token; prefer 'abx config set github_token' - --token
    may leak into shell history and process listings.

    \b
    Examples:
      abx template install python-hello --download-only   # install by index name
      abx template install owner/repo --acr-namespace my-ns
      abx template install owner/repo@v1.0 --download-only
      abx template install owner/repo//subdir --dir ./local-copy
      abx template install owner/repo --acr-namespace my-ns --region cn-shanghai

    \b
    Related commands:
      abx template search QUERY  Find a template in the index
      abx template list          List registered templates
      abx create ID   Launch the installed template
    `) };
templateUi["list"] =  { params: [
    regionOption(),
], help: cleandoc(`List custom templates registered for the current account.

    The native entry uses the Alibaba Cloud FCSandbox API with AK/SK.
    Standard template listing uses the Sandbox API key.
    This command does not search the community template index.

    \b
    Examples:
      abx --native template list
      abx --native template list --region cn-shanghai
      abx --native --json template list
      abx template list --format json

    \b
    Related commands:
      abx template info TEMPLATE_ID
      abx template search QUERY
      abx template install TEMPLATE_REF
    `) };
templateUi["info"] =  { params: [
    argument(["template_id"]),
    regionOption(),
], help: cleandoc(`Show details for a template ID.

    This uses the Alibaba Cloud FCSandbox GetTemplate API and requires
    configured AccessKey credentials.

    \b
    Examples:
      abx template info tmpl-abc123
      abx template info tmpl-abc123 --region cn-shanghai
      abx --json template info tmpl-abc123

    \b
    Related commands:
      abx template list
      abx create TEMPLATE_ID
      abx template delete TEMPLATE_ID
    `) };
templateUi["create"] =  { params: [
    argument(["image"]),
    option(["--name", "-n"], { required: true, help: "Template name" }),
    option(["--team-id"], {
        envvar: ["TEAM_ID", "E2B_TEAM_ID"],
        default: null,
        help: "Team ID (or env TEAM_ID / E2B_TEAM_ID; auto-resolved if omitted)",
    }),
    option(["--cpu"], { type: FLOAT, default: 2, help: "CPU cores (default 2)" }),
    option(["--memory"], { type: INT, default: 2048, help: "Memory in MB (default 2048)" }),
    option(["--disk-size"], { type: INT, default: null, help: "Disk size in MB" }),
    option(["--internet-access/--no-internet-access"], {
        default: null,
        help: "Internet access (default: platform decides)",
    }),
    option(["--start-cmd"], { default: null, help: "Container start command" }),
    option(["--ready-cmd"], { default: null, help: "Container readiness check command" }),
    option(["--generation"], {
        type: INT,
        default: null,
        help: "Sandbox generation (default 1). 1=first-gen (rund), 2=second-gen MicroVM.",
    }),
    option(["--force"], {
        is_flag: true,
        default: false,
        help: "If a generation-1 template with this name already exists, delete it and create it again.",
    }),
    option(["--envd-inject/--no-envd-inject"], { default: false, help: "Enable envd injection in build" }),
    option(["--target-image"], {
        default: null,
        help: "Destination image ref for envd copy (auto-derived with random suffix if omitted)",
    }),
    option(["--registry-type"], {
        type: new Choice(["acr", "acree"]),
        default: null,
        help: "Registry type (auto-detected from --acree-instance-id)",
    }),
    option(["--acree-instance-id"], { envvar: "ACREE_INSTANCE_ID", default: null, help: "ACR EE instance ID (cri-...)" }),
    option(["--registry-username"], { default: null, help: "Registry login username (for pulling image)" }),
    option(["--registry-password"], { default: null, help: "Registry login password (for pulling image)" }),
    regionOption(),
], help: cleandoc(`Create a sandbox template from an existing container image.

    Uses the official Alibaba Cloud FCSandbox CreateTemplate API.
    Requires AK/SK credentials (set with 'abx config init --build').

    \b
    Examples:
      abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag \\
        --name my-template
      abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag \\
        --name my-template --team-id team-xxx --cpu 4 --memory 4096
      abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag \\
        --name my-template --envd-inject --generation 1
      abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag \\
        --name my-template --region cn-shanghai

    \b
    Related commands:
      abx template push IMAGE       Push a local image to ACR first
      abx template info TEMPLATE_ID Inspect the created template
      abx create ID      Launch a sandbox from the template
    `) };
templateUi["push"] =  { params: [
    argument(["image"]),
    option(["--acr-registry"], { envvar: "ACR_REGISTRY", default: "registry.cn-hangzhou.aliyuncs.com", help: "ACR registry host" }),
    option(["--acr-namespace"], {
        envvar: "ACR_NAMESPACE",
        required: false,
        default: null,
        help: "ACR namespace (env: ACR_NAMESPACE, or set in .env file)",
    }),
    option(["--acr-username"], {
        envvar: "ACR_USERNAME",
        default: null,
        help: "ACR login username (default: ALICLOUD_ACCESS_KEY_ID)",
    }),
    option(["--acr-password"], {
        envvar: "ACR_PASSWORD",
        default: null,
        help: "ACR login password (default: ALICLOUD_ACCESS_KEY_SECRET)",
    }),
    option(["--acree-instance-id"], { envvar: "ACREE_INSTANCE_ID", default: "", help: "ACR EE instance ID (cri-...)" }),
    regionOption(),
], help: cleandoc(`Push a locally-built image to Alibaba Cloud ACR.

    IMAGE is a local image tag (e.g. \`\`python-hello:latest\`\`) produced by
    a local \`\`docker build\`\`.  The repository name and tag are derived from
    IMAGE.  Prints the full ACR image URL on success.

    \b
    Examples:
      abx template push python-hello:latest --acr-namespace my-ns
      abx template push python-hello:latest --acr-namespace my-ns --region cn-shanghai
      abx template push my-tmpl:v1 --acr-namespace prod \\
        --acree-instance-id cri-xxx

    \b
    Related commands:
      abx template build TEMPLATE_DIR  Build, push, and register a template
      abx template from-image IMAGE        Register an existing image
      abx config set access_key_id KEY
    `) };
templateUi["build"] =  { params: [
    argument(["template_dir"], { type: new ClickPath(), envvar: "ABX_TEMPLATE_DIR" }),
    option(["--acr-registry"], { envvar: "ACR_REGISTRY", default: "registry.cn-hangzhou.aliyuncs.com", help: "ACR registry host" }),
    option(["--acr-namespace"], {
        envvar: "ACR_NAMESPACE",
        required: false,
        default: null,
        help: "ACR namespace (env: ACR_NAMESPACE, or set in .env file)",
    }),
    option(["--acr-repo"], {
        envvar: "ACR_REPO",
        default: null,
        help: "ACR repository name (defaults to template.yaml name or dir name)",
    }),
    option(["--acr-username"], {
        envvar: "ACR_USERNAME",
        default: null,
        help: "ACR login username (default: ALICLOUD_ACCESS_KEY_ID)",
    }),
    option(["--acr-password"], {
        envvar: "ACR_PASSWORD",
        default: null,
        help: "ACR login password (default: ALICLOUD_ACCESS_KEY_SECRET)",
    }),
    option(["--acree-instance-id"], { envvar: "ACREE_INSTANCE_ID", default: "", help: "ACR EE instance ID (cri-...)" }),
    option(["--vpc-id"], { envvar: "ACR_VPC_ID", default: "", help: "VPC ID for ACR EE" }),
    option(["--vswitch-ids"], { envvar: "ACR_VSWITCH_IDS", default: "", help: "Comma-separated VSwitch IDs" }),
    option(["--security-group-id"], { envvar: "ACR_SECURITY_GROUP_ID", default: "", help: "Security group ID" }),
    option(["--alias", "-a"], { default: null, help: "Template alias" }),
    option(["--tag", "-t"], { default: "latest", help: "Docker image tag" }),
    option(["--platform"], { default: "linux/amd64", help: "Target platform" }),
    option(["--cpu"], {
        type: INT,
        default: null,
        help: "CPU cores (default: from template.yaml resources.cpu, fallback 2)",
    }),
    option(["--memory"], {
        type: INT,
        default: null,
        help: "Memory in MB (default: from template.yaml resources.memory, fallback 2048)",
    }),
    option(["--start-cmd"], { default: null, help: "Container start command" }),
    option(["--ready-cmd"], { default: null, help: "Container readiness check command" }),
    option(["--timeout"], { type: INT, default: 600, help: "Build timeout in seconds" }),
    option(["--dockerfile", "-f"], { default: null, type: new ClickPath({ exists: true }), help: "Custom Dockerfile path" }),
    option(["--build"], {
        type: new Choice(["auto", "dockerfile", "steps"]),
        default: "auto",
        show_default: true,
        help: "Publish path: auto (Dockerfile if present, otherwise template.yaml build steps), dockerfile, or steps",
    }),
    option(["--disk-size"], { type: INT, default: null, help: "Disk size in MB (official API only)" }),
    option(["--internet-access/--no-internet-access"], {
        default: null,
        help: "Internet access (default: platform decides; official API only)",
    }),
    option(["--team-id"], {
        envvar: ["TEAM_ID", "E2B_TEAM_ID"],
        default: null,
        help: "Team ID for official API (or env TEAM_ID / E2B_TEAM_ID)",
    }),
    option(["--envd-inject/--no-envd-inject"], { default: false, help: "Enable envd injection (default False)" }),
    option(["--generation"], {
        type: INT,
        default: null,
        help: "Sandbox generation (default: template.yaml 'generation'; else 2 when the provider starts the server and commands.py exists; else 1). " +
            "1=first-gen (rund), 2=second-gen MicroVM.",
    }),
    option(["--force"], {
        is_flag: true,
        default: false,
        help: "If a generation-1 template with this name already exists, delete it and create it again. " +
            "Without --force, deploy stops and prints 'abx template delete <id> -y'.",
    }),
    option(["--target-image"], {
        default: null,
        help: "Destination image ref for envd copy (auto-derived with random suffix if omitted)",
    }),
    option(["--yes", "-y"], { is_flag: true, default: false, help: "Skip confirmation prompt" }),
    option(["-v", "--verbose", "verbose_flag"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
    regionOption(),
], help: cleandoc(`Build Docker image locally, push to ACR, and create a sandbox template.

    Full pipeline with cloud side effects: the local docker build is
    local-only, but the ACR push and the remote template registration
    can incur Alibaba Cloud costs (ACR storage/traffic, template
    resources).

    Publish path (--build, default auto):

    \b
    auto: a Dockerfile publishes that image. Otherwise template.yaml build
      steps are sent as CreateTemplate sandboxConfig.steps.
    dockerfile: local docker build → ACR push → CreateTemplate. template.yaml
      build steps are not sent.
    steps: no local Docker and no ACR push. sandboxConfig.image is base.image
      and sandboxConfig.steps is the expanded build block. Official API only.

    \b
    Registration uses the official CreateTemplate API.

    \b
      dockerfile mode: local docker build → ACR push → official CreateTemplate API.
      Requires AK/SK credentials (set with 'abx config init --build').

    TEMPLATE_DIR may also be supplied through ABX_TEMPLATE_DIR.
    For automation/CI, pass --yes and configure credentials through environment variables.

    \b
    Examples:
      abx template build ./examples/templates/python-hello \\
        --acr-namespace my-ns --acr-repo python-hello
      abx template build ./my-template \\
        --acr-namespace prod --acree-instance-id cri-xxx
      abx template build ./my-template \\
        --acr-namespace prod --disk-size 10240 --internet-access
      abx template build ./my-template \\
        --acr-namespace prod
      abx template build ./my-template --acr-namespace prod --region cn-shanghai
      abx template build ./my-template --build steps --yes

    \b
    Related commands:
      abx template scaffold DIRECTORY    Scaffold template source files
      abx template push IMAGE        Push an existing local image only
      abx create ID       Launch the completed template
    `) };
templateUi["deploy"] =  { params: [...templateUi["build"]!.params], help: "Build, push, and create template in one step (alias of 'template build').\n\n" +
    "Builds a Docker image locally, pushes it to ACR, and creates a sandbox " +
    "template. The ACR push and the remote template registration are " +
    "cloud-side operations that can incur Alibaba Cloud costs (ACR " +
    "storage/traffic, template resources).\n\n" +
    "If TEMPLATE_DIR is missing, confirm creation and continue, or use --yes/-y " +
    "or CI mode to create a Python template project without prompts. Existing files are kept.\n\n" +
    "Requires AK/SK credentials from 'abx config init --build' " +
    "(access_key_id / access_key_secret). dockerfile mode also needs a Docker " +
    "daemon and an ACR namespace (--acr-namespace, 'abx config set acr_namespace', " +
    "or ACR_NAMESPACE). --build steps skips Docker and ACR. " +
    "--acr-username/--acr-password override the AccessKey used to push.\n\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx template deploy ./examples/templates/python-hello \\\n" +
    "    --acr-namespace my-ns --acr-repo python-hello\n" +
    "  abx template deploy ./my-template --acr-namespace prod --yes\n" +
    "  abx --json template deploy ./my-template -y\n" +
    "    # one JSON object on stdout; the id is the TemplateID field\n\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx template scaffold DIRECTORY  Scaffold a template project\n" +
    "  abx template list            Verify the registered template\n" +
    "  abx create ID     Launch a sandbox from the template" };
templateUi["delete"] =  { params: [
    argument(["template_id"]),
    option(["--yes", "-y"], { is_flag: true, default: false, help: "Skip confirmation prompt" }),
    regionOption(),
], help: cleandoc(`Delete a custom template from the remote platform.

    This irreversible operation does not remove the local template cache.
    Confirmation is required unless --yes is supplied.

    \b
    Examples:
      abx template delete tmpl-abc123
      abx template delete tmpl-abc123 --yes --region cn-shanghai

    \b
    Related commands:
      abx template info TEMPLATE_ID  Verify the target before deletion
      abx template list              Confirm the template was removed
      abx template install REF       Reinstall a template
    `) };

export const createParams = [option(["--acr-namespace"], { envvar: "ACR_NAMESPACE", default: null, help: "ACR namespace for building the generated template (env: ACR_NAMESPACE, or set in .env file)" })];

/** Full publish help is adapter-owned metadata used by both entry points. */
export const DEPLOY_HELP = cleandoc(`Publish a template project: build, push to ACR, register the template (same as 'abx template deploy').

    Runs one publish path. No LLM is involved.
    PATH is the template directory (default: .). --build auto (the default)
    uses a Dockerfile when one is present, and otherwise template.yaml build
    steps. dockerfile mode builds and pushes an image, then waits until the
    template is ready. steps mode sends base.image and sandboxConfig.steps
    and does not use Docker or ACR. template.yaml supplies the template name
    and resources.

    A missing PATH offers template creation and continues after confirmation.
    --yes/-y or CI mode creates a Python template project without prompts.
    Existing project files are kept.

    To author the files first, use 'abx template scaffold': --adopt for an existing
    project, a natural-language description to generate the files, or
    --template for a scaffold.

    Accepts every option of 'abx template deploy' (--acr-namespace,
    --alias, --yes, -v/--verbose, ...). The ACR namespace and AccessKey are
    set with 'abx config init --build'.

    \b
    Examples:
      abx deploy --acr-namespace my-ns           # publish ./ as a template
      abx deploy ./my-template --yes             # non-interactive
      abx --json deploy ./my-template -y         # JSON on stdout; id is TemplateID
      abx deploy ./my-template -v                # with debug logs

    \b
    Typical flow:
      abx template scaffold --adopt .                      # 1a. author from a project
      abx template scaffold --prompt "a python data science env"   # 1b. generate from a description
      abx deploy ./<name> --acr-namespace my-ns       # 2. publish
      abx create <TEMPLATE_ID> --detach    # 3. launch a sandbox

    \b
    Related commands:
      abx template scaffold          Author Dockerfile / template.yaml
      abx template deploy DIR    The same pipeline with a required DIRECTORY
      abx create --prompt "DESCRIPTION"   Generate + publish + launch in one go
    `);
