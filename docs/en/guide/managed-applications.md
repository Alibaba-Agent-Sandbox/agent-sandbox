# Deploy a managed Agents application

Managed applications expose one Gateway endpoint. Sessions create isolated Sandbox compute as needed;
clients keep using the Gateway URL across sessions and application updates. This workflow supports
the explicit `application.deployment.profile: fc-managed-agents` profile on Alibaba Cloud Express and Function Compute.
Use the [current source CLI](../../../README.md#installation); published 0.5.10 uses the previous command layout.
Node.js 20+, Docker, an ACR namespace and the template's Python smoke dependencies are required on the deployment host.

Start from the [Agents API template](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/tree/main/agents-api).
It supplies the Sandbox image, Server recipe, binding example and business smoke script. Its API is an
OpenAI Agents inspired subset with explicit queue and compute-close behavior; use its API guide for supported requests.
SSE connections return finite slices of up to 20 seconds. Save the persistent event cursor and reconnect
with `Last-Event-ID`; a finished stream slice does not mean the turn completed.

Keep deployment input private and outside the image build context:

```bash
mkdir -p .abx
cp bindings.example.json .abx/bindings.json
chmod 600 .abx/bindings.json
```

Fill the example's environment references before deploying. The bindings have separate purposes:

| Binding | Required value and source |
| --- | --- |
| State | An existing PostgreSQL database URL reachable by all three FC functions. Prepare a dedicated database and its access rules with your database administrator. |
| Sandbox access | Your account/region's Sandbox API key, explicit API URL, data domain and region. This key creates and cleans up agent compute. |
| Model | A model provider key, HTTPS base URL, explicit model ID and supported adapter. Only the Worker resolves this binding for the guest's declared model environment. |
| Client authentication | `{ "generate": true }` creates the default business key on first deployment; alternatively supply token SHA-256 digests, owners and scopes. External clients send the raw business key as a Bearer token. |
| Internal authentication | `{ "generate": true, "roleArn": { "env": "AGENTS_FC_ROLE_ARN" } }` creates the private control key. The existing execution role must trust FC and permit invocation of this application's Worker/Dispatcher. This differs from the deployment host's AccessKey. |
| Ingress | `function-alias` with `aliasName` and explicit `allowTestDomain: true`, or an existing exclusive root HTTPS `custom-domain` binding with `domainName`, `protocol: HTTPS` and `aliasName`. |

For a private database, the State value may be `{ "databaseUrl": { "env": "AGENTS_DATABASE_URL" },
"vpcConfig": { "vpcId": "vpc-…", "vSwitchIds": ["vsw-…"], "securityGroupId": "sg-…" } }`.
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
For a database with a private certificate authority, add State `databaseCa: { "file": "/path/to/database-ca.pem" }`
or `databaseCa: { "env": "AGENTS_DATABASE_CA_PEM" }`, keeping `sslmode=verify-full` in the URI.
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

Set the template's `application.deployment.accessRef` to your named Serverless Devs credential profile,
`abx` for configured Express AccessKeys, or `env` for explicit cloud credential environment variables.
The selected identity is verified with STS before changes. The existing Express template preparation adapter
requires deployment AccessKeys; STS-only template preparation is not supported in this profile.
No management API key is automatically created or renewed by `deploy`.

Preview and deploy under an application name:

```bash
abx deploy . --name my-agents --plan
abx deploy . --name my-agents --bindings .abx/bindings.json --yes
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
abx deploy . --build .abx/build.json --name my-agents --bindings .abx/bindings.json --yes
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
