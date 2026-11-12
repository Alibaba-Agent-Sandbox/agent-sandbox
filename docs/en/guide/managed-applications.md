# Deploy a managed Agents application

Managed applications expose one Gateway endpoint. Sessions create isolated Sandbox compute as needed;
clients keep using the Gateway URL across sessions and application updates. This workflow supports
`specVersion: 1` with `application.type: agents-api` on Alibaba Cloud Express and Function Compute.
Use the [current source CLI](../../../README.md#installation); published 0.5.10 uses the previous command layout.
Node.js 20+, Docker, an ACR namespace and the template's Python smoke dependencies are required on the deployment host.

Start from the [Agents API template](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/tree/main/agents-api).
It supplies the Sandbox image, Server recipe, native configuration references and business smoke script. Its API is an
OpenAI Agents inspired subset with explicit queue and compute-close behavior; use its API guide for supported requests.
SSE connections return finite slices of up to 20 seconds. Save the persistent event cursor and reconnect
with `Last-Event-ID`; a finished stream slice does not mean the turn completed.

Configure the one resource file, `template.yaml`. It contains the native FC resources in `deployment` and application settings in `application`; publication metadata in `registry.yaml` is optional for local use. Provide its native `${env('NAME')}` references from your process environment or a private local `.env`. Keep the original configuration directory available for later apply/update commands; secret values are excluded from source snapshots and persisted plans.

| Input | Purpose and source |
| --- | --- |
| `ABX_MANAGED_DATABASE_URL` | Existing dedicated PostgreSQL URL reachable by all Server roles; obtain it from your database administrator. |
| `SANDBOX_API_KEY`, `SANDBOX_BASE_URL`, `SANDBOX_DOMAIN`, `SANDBOX_REGION` | Sandbox service authentication and the matching regional API/domain. The Worker uses these to create and clean up Session compute. |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Your model provider's key, HTTPS API base URL and usable model ID. Select the supported `codex` or `qwen-code` adapter in `application.bindings.model`. |
| `AGENTS_FC_ROLE_ARN` | Existing FC execution role with Worker/Dispatcher invocation permissions; used by the native FC `role` props. This differs from the deployment host's AccessKey. |
| Deployment credentials | Select your Serverless Devs credential profile with `deployment.access`; prepare its cloud AccessKeys separately. |
| Business/control authentication | Defaults generate separate private keys at first deployment and securely reuse them from the current user's application credential store. These keys do not come from a cloud console. |
| Ingress | Choose the acknowledged FC test alias or an existing HTTPS root custom domain in `application.bindings.ingress`. |

The current application path requires these references before preview/apply; it does not interactively collect and persist arbitrary application fields. Do not put secrets into YAML literals or an image context.

For a private database, set `application.state.vpcConfig` to the existing `vpcId`, `vSwitchIds` and `securityGroupId`. The database URL remains `application.state.databaseUrl`, for example `${env('ABX_MANAGED_DATABASE_URL')}`.
Use existing network IDs for the database's reachable VPC; the CLI does not create networks or change
their access rules. All three functions receive this native VPC configuration. The profile explicitly
enables FC Internet access for the model and Sandbox endpoints, and verifies that setting on readback.
Confirm both database and public endpoint access with the candidate business smoke. See
[FC VPC Internet access](https://help.aliyun.com/zh/functioncompute/how-do-functions-in-a-vpc-access-the-internet-1).
The database URI must name one explicit host, database and user; routing/schema query overrides
such as `host` or `options` are unsupported. The first deployment pins a persistent database identity,
and later revisions reject an empty, replaced or differently routed ledger. Database migration is a
separate operator workflow. Coordinate credential rotation with retained Workers; each revision keeps
its original resolved credentials until retired.
For a database with a private certificate authority, add State `databaseCa: "${file('/path/to/database-ca.pem')}"`
or `databaseCa: "${env('AGENTS_DATABASE_CA_PEM')}"`, keeping `sslmode=verify-full` in the URI.
Only certificate PEM chains up to 64 KiB are accepted. This runtime CA input goes to the three Server
roles and is excluded from images, plans, receipts and the Sandbox environment. The CLI keeps
CA material outside the FC environment budget. Compiled role environment names and values
share a 4 KiB UTF-8 budget, including candidate authentication and the persistent state pin;
oversized configurations fail before FC functions are created. Large CA chains still require
acceptance by the selected FC container command limits.

The default business/control keys are generated only by initial `deploy`, saved under the current user's
private application credential store, and reused by later commands. Output gives `credentials_file`;
an external client can read its `businessKey` privately. Back up this file securely. Explicit binding values
remain temporary inputs and are not copied into the store. Keep the internal key unchanged while retained
revisions exist. The Sandbox application token (`ABX_SERVER_TOKEN`) is a separate guest-control credential.

Set the template's `deployment.access` to your named Serverless Devs credential profile,
`abx` for configured Express AccessKeys, or `env` for explicit cloud credential environment variables.
The selected identity is verified with STS before changes. The existing Express template preparation adapter
requires deployment AccessKeys; STS-only template preparation is not supported in this profile.
No management API key is automatically created or renewed by `deploy`.

Preview and deploy under an application name:

```bash
abx deploy . --name my-agents --plan
abx deploy . --name my-agents --yes
abx status my-agents
```

`--plan` checks the local template and summarizes resources without building or making cloud changes.
`deploy` builds the Server image, prepares its Sandbox Template, deploys the three functions, validates
the candidate and publishes the Gateway. It returns `endpoint`, `credentials_file` and `receipt_file`.
External clients use the endpoint and business key. FC built-in domains are for testing; production
uses an existing HTTPS custom domain.

To update, edit the project and run the same `deploy` command with the same name. Existing Sessions
retain their Worker and Sandbox Template; new Sessions use the current revision. Keep local deployment
records and receipts available for cleanup. Deployments from multiple hosts must be serialized by your
pipeline; the local lock does not coordinate independent hosts.

```bash
abx status my-agents --revisions
abx recover my-agents
abx delete my-agents --revision OLD_REVISION --yes
abx delete my-agents --yes
```

`recover` observes interrupted operations without repeating creation or publication. A stopped local
wait does not prove cloud work stopped. Retiring a revision drains it before removing its resources;
deleting the application drains all recorded revisions. If cleanup is incomplete, keep the records,
inspect with `recover`, resolve the reported uncertainty, and retry deletion.
An existing receipt can be imported with `abx recover my-agents --receipt PATH`.

`abx logs my-agents --role gateway` reads an existing FC log store. The default recipe does not
configure FC logging; configure the function's `logConfig` and required logging access before using
this command. Continuous application log following is not supported.

Template authors can build once for several deployments:

```bash
abx template build . --out .abx/build.json --yes
abx deploy . --build .abx/build.json --name my-agents --yes
# After every application using this build has been deleted:
abx template build --clean .abx/build.json --yes
```

An explicitly supplied build belongs to its author and remains after application deletion.
The CLI refuses to clean it while a deployment still uses it. An automatic deployment build is owned
by that application's lifecycle. Images listed for manual cleanup must be removed with ACR tooling
only after no retained template or function references them.

The database, model account, execution role and supplied custom domain remain yours. Deletion retains
the database history and admission fence. To create another application after complete deletion,
choose a new application name or a fresh empty state database. `deploy` never reopens a drained ledger.

Managed custom Sandbox fields belong in `sandbox.instance`. Its `timeout` is the single maximum lifetime; other supported instance resources are passed to Session creation. Custom environment values go only to the Worker secret input, while model/runtime names and ownership metadata remain reserved. Volume mounts must not overlap `/workspace` or `/home/user/.agent-sandbox`; lifecycle requires kill on timeout without automatic resume. Native FC `auto` network/storage/log resources, arbitrary native actions and component-created auxiliary resources are currently unsupported by this Managed lifecycle. Use explicit supported existing-resource configuration.

Observation and cleanup reuse the saved control credentials and known resource ownership; they do not require a model key or the original source tree. Restore the existing control credentials if missing. No replacement control key is generated during cleanup.
