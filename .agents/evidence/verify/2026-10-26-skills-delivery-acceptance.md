# Verification: Seventeen Sandbox Skill delivery scenarios

- Date: 2026-10-26
- Result: PARTIAL. Do not close [tracking Issue46](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/46).
- Environment: real Alibaba Cloud Express in cn-hangzhou, explicitly selected existing Team; Linux, Node.js22 and Python3.11; credentials supplied privately through environment, never recorded.
- Candidate CLI base:2e32256; Python SDK base:8959e4f. Local package version strings0.5.6/0.4.0a6 do not mean modified source is a published release.

## Interpretation
Each PASS below certifies only its described real scenario. A capability declaration, mocked test, installed instruction file and real workflow are different evidence. All17 requirements are NOT delivered merely because a tool inventory is complete. Installed-agent autonomy was exercised for the CLI/MCP Skill; SDK/template/provider workflow receipts were produced by the collaborating agents, not by a separately installed-client matrix for every Skill.

## Results
| Item | Result | Real observation | Boundary or remaining requirement |
| --- | --- | --- | --- |
| P0.1 Lifecycle and selected configuration | PASS | Actual selected-Team key binding; explicit cn-hangzhou endpoint; list/state/TTL/delete; matching-template 1 CPU/1024 MiB verified. Mismatched overrides fail and roll back. | One existing Team and region tested; region metadata remains unknown. Cross-Team permissions and a second region were not tested. |
| P0.2 Execution, files, recovery and failures | PASS | 102400-byte binary SHA256 roundtrip; background job survives MCP restart; logs/results/cancel; code, execution timeout, missing sandbox and bounded Python MemoryError distinguished. | Linux shell execution tested. Native Express code.execute is unsupported; no sandbox-wide physical OOM induced. |
| P0.3 OCI image to usable Template | PASS | Real public image build, ready polling, sandbox business result 385; intentional RUN exit42 build fails with diagnosis; templates deleted independently. | Representative public image only; private registry credential paths and arbitrary images are not certified. |
| P0.4 Persistent storage | PASS | Private OSS real RW/RO mounts; exact mountinfo and file hash; kill and recreate persistence; owned bucket/role/policy/volume cleanup. | OSS is the tested first storage type. Generation2 required official ossfs2/FUSE installation plus supported append-volume API. |
| P0.5 Installation and connectivity | PASS | Actual Cursor-generated MCP configuration invokes a cloud task; Qwen Code loads installed source Skill, discovers capabilities, creates one sandbox, returns42, file roundtrip, status and kill; independent404. | Qwen tested with explicit reviewed MCP config and an available model. This is not an all-client certification. |
| P1.1 Startup acceleration | PARTIAL | Native Template Cache official API and new CLI CRUD passed; creating→ready, list, delete→404. Three before/after create+command samples recorded. | No native WarmPool target/cluster supplied; no workload/SLA benchmark or verified Cache fee comparison. Template Cache is not a running pool. |
| P1.2 Cost analysis | PARTIAL | Read all24 pages/2311 October FC bill rows;2276 Sandbox costs grouped privately; non-Sandbox rows excluded; amounts not published. | No historical Team/Template mapping or tags, utilization baseline or WarmPool inventory; no account-wide savings claim. |
| P1.3 Deep pause and resume | PASS | Actual PAUSED state, reconnect, same in-memory HTTP token, process/service, file and exact persistent mount/read-only checks. | MicroVM generation2 tested; no all-provider or service-SLA claim. |
| P1.4 Snapshot reuse | PASS | Platform snapshot listing/restoration, two clones, file content and write isolation; real maintained standard contract passes. | External VM snapshots were not supplied. Snapshot-clone mount override rejected400; no arbitrary VM import claim. |
| P1.5 Template upgrade and rollback | PARTIAL | Real v1→v2→v1 business execution and independent cleanup. Cache can be explicitly managed by template ID. | Automatic update synchronization of caches and native WarmPool was not verified; requires a version policy and target pool. |
| P1.6 Network and credentials | PARTIAL | Public egress200→deny/nonzero→restore200, DNS diagnosis; model API401 without credential→200 with platform header injection, no credential in sandbox env/code. | Old base template CA trust failed; new official v0.0.44 image passed with TLS verification. No target VPC/private service supplied. |
| P1.7 Repository and expiring preview | PASS | Pinned public repository fetch, dependency/test/start checks; actual preview200 then unsigned/tampered/expired403. | Expiry implemented in the tested application HMAC layer; platform-native gateway expiry is not claimed. |
| P1.8 Browser, desktop and takeover | PARTIAL | Actual desktop GUI screenshot/actions; separate VNC controller simulates operator step, Agent resumes same browser; independent state and replay timeline. | Operator is simulated, not an actual human login. Screenshot timeline is not full-motion video. Private traffic-token validation recorded separately. |
| P1.9 Agent framework | PASS | Real LangGraph selected flow: one user/conversation reuses sandbox, different users separate environments/files; both resources independently404. | Deterministic framework integration tested; no claim of a separate LLM-driven workload or multi-framework coverage. |
| P1.10 Remote MCP | PARTIAL | Real HTTPS temporary hosted MCP, bearer401, separate sessions, manual tools, automatic owned-resource cleanup; ownership defects repaired and retested. | Temporary acceptance service, not a persistent official managed production endpoint. Same credential borrowing is not cross-user isolation. |
| P2.1 Third-party tools | PASS | Actual filesystem MCP2026.7.10 initialize/tools/read_file, upgrade2026.8.31, same actual call, logs and process/package cleanup. | Selected filesystem MCP requires no external service credential. Arbitrary third-party Skills were not certified. |
| P2.2 Parallel environments | PASS | Three real sandboxes execute exit0/7/0; failed logs/environment retained and reconnected, other resources released, final owned cleanup verified. | Bounded three-way sample, not throughput/scale acceptance. |

## Reproducible owner evidence
- [CLI core/resource verification](2026-10-26-cli-live-resource-verification.md) and [explicit Team/region](2026-10-26-explicit-team-region.md).
- [Template/business/tool acceptance](2026-10-26-skill-template-tools-acceptance.md); maintained CLI `e2e/skill-template-acceptance.mjs`.
- [Native Template Cache adapter](2026-10-26-express-template-cache-commands.md); maintained `e2e/skill-template-cache-acceptance.mjs`.
- [SDK storage/state, framework, hosted MCP and tools](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/.agents/evidence/verify/2026-10-26-skill-storage-state-acceptance.md).
- Sanitized supplemental receipts: [matrix](2026-10-26-skills-delivery-acceptance/matrix.json), [installed Qwen Skill](2026-10-26-skills-delivery-acceptance/installed-qwen-skill.json), [network baseline](2026-10-26-skills-delivery-acceptance/network-live.json), [old-template CA failure](2026-10-26-skills-delivery-acceptance/network-credential-base-ca-before.json), [official-image credential injection](2026-10-26-skills-delivery-acceptance/network-credential-live.json), [billing read](2026-10-26-skills-delivery-acceptance/billing-analysis-receipt.json), [cache timing](2026-10-26-skills-delivery-acceptance/cache-live.json), [additional independent cleanup](2026-10-26-skills-delivery-acceptance/root-additional-cleanup.json).

## Defects and adversarial review
Real cloud mismatches led to [Issue185](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/185) resource verification and [SDK Issue139](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/139) borrowed-session ownership. An independent adversarial agent rejected the first ownership fix after reproducing provider/raw-ID collisions and late completion. Deterministic before/after regressions and independent review followed. CLI queued-shutdown registration was independently reproduced and repaired under [Issue187](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/187). Cache operations are [Issue186](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/186).

## Timing and costs
The initial Cache API404 baseline does not establish globally cold image state. Three create+command times before were1410/1074/1227ms and after were1076/1097/1100ms. These samples are not an SLA or proof of a statistically significant improvement. Cache quota/retention documentation does not supply a verified fee; no zero-cost assumption is made.

For the tested lightweight business fixture, a matching1CPU/1GiB template executed successfully. At the currently documented China-mainland Default CPU/memory reference rates, modeled compute is CNY0.117108 per active hour versus0.234216 for2CPU/2GiB, excluding charged disk, storage, traffic and other products. This is a sizing hypothesis, not measured invoice savings or production workload adequacy. [Official pricing](https://help.aliyun.com/zh/agent-sandbox/product-overview/billing-overview).

Billing analysis is read-only. Actual per-Sandbox amounts/IDs are retained in a private local artifact rather than committed; all2276 Sandbox bill rows lacked tags. Team/Template allocation, idle identification and verified savings remain incomplete.

## Cleanup and remaining prerequisites
All test runners track only their own resources and verify independent absence; failures/initial harness defects are preserved in owner receipts. Never run account-wide cleanup. Supplementary root resources were independently checked404; private network Template was deleted and independently absent. Temporary API key deletion and OSS/RAM/volume cleanup have dedicated owner receipts. Active final hosted-MCP/desktop checks have their own final cleanup receipts.

To finish the remaining requirements: select a real native WarmPool environment, supply workload/SLA/budget inputs, establish historical Team/Template cost mapping and utilization, select a VPC target, and define the permanent managed remote-MCP service/tenant boundary. No user response or missing configuration is treated as approval or a passing test.

## Candidate repository gates

- `make ci` with the selected SDK/provider checkouts: hygiene/typecheck/lint/build PASS; Vitest4497PASS,1skip,20FAIL across6 local network/engine suites. The two updated help snapshots now PASS. Retained failures include HTTP501 body `项目网络审计已关闭`, local-loopback502 responses and malformed-wire/TLS/proxy expectations changed by the execution environment. No test expectations, proxy policy or runtime network behavior were weakened to hide them.
- `npm run parity:coverage` with the selected SDK source: PASS907/907 ledger entries;11 moved-to-SDK cases verified.
- Selected real cloud cases and independent cleanup are recorded above. A selected pass does not convert these full-suite failures to passes. Remote CI on the final PR head remains a separate required gate.

## Page publication
Website [PR65](https://github.com/Alibaba-Agent-Sandbox/website/pull/65) is merged at f4476bb69c87436a682be1a3e3ef2acc41f5cb69. [PR CI](https://github.com/Alibaba-Agent-Sandbox/website/actions/runs/40266456070) and [normal deployment](https://github.com/Alibaba-Agent-Sandbox/website/actions/runs/40266680625) passed. TLS-verifying HTTP reads of both live start pages returned200 and independent CLI/Python/MCP/Agent Skill tabs. Local Chromium four-layout functional acceptance passed; online Chromium was blocked by its environment CA trust, separately from successful system-trust HTTP readback.

- Maintained `node e2e/mcp-lifecycle.mjs`: PASS15/15 against real STDIO/cloud after correcting the fixture to match observed base2CPU/2048MiB and compare provider-qualified handles with native metadata IDs explicitly.
- Final repository health: PASS106,11 historical warnings,0 failures. Credential-value scan of all changed/untracked CLI and SDK files:0 matches. Generated parity raw report is retained outside the repository; its workstation paths are not published.
