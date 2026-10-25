# Verification: Whole-template Express startup and cleanup

- Date: 2026-10-25
- Result: PASS for the focused scenarios below.
- Candidate: CLI 0.5.0 from `ea28f207c8a0016cf798f5a355e3c363c7c936f4`, compiled with `npm run build`.
- Runtime: Node 22.22.2, Linux; real Alibaba Cloud Express in cn-hangzhou.
- Credentials: inherited environment only; no credential values or private service addresses recorded.
- Runner: `e2e/unified-template-launch.mjs`.

## Reproduction

Build the candidate and supply the documented Sandbox API endpoint/key and Alibaba Cloud AccessKeys through the environment. Run:

```sh
ABX_BIN="node $PWD/dist/bin/abx.js" node e2e/unified-template-launch.mjs
```

Do not rebuild the same dist directory while the runner is active. The runner creates isolated local manifests/state and submits each resource mutation once.

## Results

| Scenario | Result | Scope |
| --- | --- | --- |
| Managed base | PASS | Local spec v5 manifest with provider `alicloud-express`, template_id `base`; launch returned its sandbox ID and empty services map; remote command succeeded |
| Source preparation | PASS | Native platform steps on official `runtime/base:v0.0.49`, generation 2; no local Docker requirement; build marker created |
| Whole application startup | PASS | One start command started two Python HTTP services on ports 9101 and 9102; ready command queried both locally |
| Service result | PASS | Both declared services returned in the launch result |
| Remote execution | PASS | Shell command read and checked the source build marker |
| Sandbox cleanup | PASS | DELETE of each journaled owned sandbox followed by independent GET 404 |
| Template cleanup | PASS | Deleted the journaled owned source template and confirmed its absence in platform inventory |

The final runner exited 0. No unresolved resource intents or owned resources remained. Earlier probe attempts failed in the probe's native-flag placement or overlapped build cleanup; they were cleaned independently and are not counted as successful runs.

## Limits

The managed case uses a local v5 manifest, not the still-v4 production catalog. Catalog-name resolution is separately covered with a supplied catalog fixture. The HTTP services are Python standard-library servers; this is not an Agent Sandbox Server business API or model test. Docker-based official template builds and OpenSandbox remain a separate coordinated matrix. These results prove the new preparation/startup/all-service result/cleanup path, not every template or Provider.
