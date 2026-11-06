# Deploy a managed Agents application

Managed applications expose one Gateway endpoint. Sessions create isolated Sandbox compute as needed;
clients keep using the Gateway URL across sessions and application updates. This workflow supports
the `spec_version: 6`, `managed-bridge-v1` template profile on Alibaba Cloud Express and Function Compute.
Use the npm CLI built from a revision containing `abx app --help`; CLI 0.5.8 does not include these commands.
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
| Client authentication | `{ "generate": true }` creates the default business key on first apply; alternatively supply token SHA-256 digests, owners and scopes. External clients send the raw business key as a Bearer token. |
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

The default business/control keys are generated only by initial `apply`, saved under the current user's
private application credential store, and reused by later commands. Output gives `credentials_file`;
an external client can read its `businessKey` privately. Back up this file securely. Explicit binding values
remain temporary inputs and are not copied into the store. Keep the internal key unchanged while retained
revisions exist. The Sandbox application token (`ABX_SERVER_TOKEN`) is a separate guest-control credential.

Set the template's `application.deployment.accessRef` to your named Serverless Devs credential profile,
`abx` for configured Express AccessKeys, or `env` for explicit cloud credential environment variables.
The selected identity is verified with STS before changes. The existing Express template preparation adapter
requires deployment AccessKeys; STS-only template preparation is not supported in this profile.
No management API key is automatically created or renewed by `app`.

Build and review before applying:

```bash
abx app build template.yaml --out .abx/build.json --yes
abx app plan template.yaml --build-receipt .abx/build.json --out .abx/plan.json
abx app apply .abx/plan.json --bindings .abx/bindings.json --yes
```

An unused, confirmed Server build can be removed with `abx app clean-build .abx/build.json --yes`.
Once apply records its use, clean it through the application's retire/destroy lifecycle. A failed push
retains its random tag and journal; an unknown remote result needs native inspection before cleanup.

`build` prepares a digest-pinned Server image and exact FC component dependencies. `plan` reads local
inputs and generates no credentials or cloud resources. Plans expire after 24 hours; changing source,
tools or the prior receipt requires a new plan. Put generated files in `.abx/`, which the build excludes.
An application apply prepares a uniquely named Sandbox Template, deploys the three functions, runs the
template's candidate smoke and publishes the stable Gateway alias. The receipt reports `endpoint` and `receipt_file`.
Configure external clients with this endpoint and the business key. FC built-in domains are for testing;
use an existing HTTPS custom domain for production.

For an update, build again and give `plan` the last ready receipt:

```bash
abx app plan template.yaml --build-receipt .abx/build.json \
  --previous-receipt .abx/previous.receipt.json --out .abx/update.json
abx app apply .abx/update.json --bindings .abx/bindings.json --yes
abx app status .abx/current.receipt.json --bindings .abx/bindings.json
```

Use the actual receipt paths returned by apply. Existing Sessions retain their original Worker and
Sandbox Template; new Sessions use the current revision. Serialize deployments from multiple hosts
in your deployment system. The CLI excludes simultaneous local deployments; FC alias updates do not
provide a distributed compare-and-swap guarantee.

`status` inspects recorded native resources; with bindings it also reads durable activity. `reconcile`
refreshes observation after an interrupted operation without repeating resource creation or publishing.
Unknown outcomes retain their recovery identities. A stopped local wait does not prove cloud work stopped.

```bash
abx app reconcile .abx/current.receipt.json --bindings .abx/bindings.json --yes
abx app retire .abx/current.receipt.json --revision <old-revision> \
  --bindings .abx/bindings.json --yes
abx app plan --destroy .abx/current.receipt.json --out .abx/destroy.json
abx app destroy .abx/destroy.json --bindings .abx/bindings.json --yes
```

Retire stops the old revision from accepting new Sessions or inputs, closes its remaining reusable
Sessions and deletes its resources only after cleanup is confirmed. Destroy fences new inputs and
drains all recorded revisions before deleting owned resources, including resources retained after
an unsuccessful update. Keep the previous receipts available: they identify retained resources and
their control functions. If drain or deletion is incomplete, retain the receipts, observe progress,
then retry retirement or create a fresh destruction plan.
The database, model account, execution role and custom domain are supplied resources and remain yours.
Destruction preserves the database's admission fence and history. To create another application after
complete destruction, choose a new template application name or a fresh empty state database. Deploy
normal revisions with the previous receipt; apply never reopens a drained ledger automatically.
Owned Server tags are removed after their recorded application references are gone. Supplied
`serverImage` digests are borrowed and preserved. They are sent unchanged to FC; if that registry
path rejects digest input, use the managed Server build recipe. That recipe sends its unique owned
tag and verifies FC's resolved digest against the frozen plan. The CLI waits for image preparation
and completed updates before invoking or publishing functions; failures retain recovery receipts.
Sandbox build images retain manual cleanup entries;
remove those exact images with ACR tooling after no retained template or function references them.

The final temporary-credential check retries only HTTP 502/503/504 within 30 seconds and four attempts.
An accepted credential or any other failure stops the operation; retain the receipt and inspect it instead of replaying apply.

Before the final credential check, the stable health endpoint must return the new deployment revision.
Health-only HTTP 404/502/503/504 responses may wait within 30 seconds; authentication 404 never counts as rejection.

Candidate and stable HTTP routes must each serve the planned revision before publication completes. Health checks wait up to30 seconds for404/502/503/504; a wrong revision or other error stops deployment. Failed apply operations are inspected rather than replayed.
