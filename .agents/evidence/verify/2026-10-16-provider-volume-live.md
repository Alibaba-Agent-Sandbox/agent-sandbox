# Verification: authorized real Volume, Team and quota acceptance

- Date: 2026-10-16.
- Result: PARTIAL overall; real storage acceptance PASS, required aggregate gates remain failed.
- Tested CLI product revision: `940b9d558bd40d364bf9f4619e11f94eb91f37e3`, built production CLI;
  then the scoped short-name fixture change in `e2e/scenarios/13-provider-management-lifecycle.mjs`.
- Python consumer: `ec595c81030b30f0669de8989c0c432a74d136a0`.
- Environment: Linux, Node 22.22.2, Python 3.11.15, Alibaba Cloud cn-hangzhou.
- Issue/PR: [#30](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/30),
  [draft PR #35](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35).
- Authorization: user explicitly allowed temporary infrastructure using existing AK/SK,
  followed by deletion. Successful actual creation confirmed this account's Volume access.

## Commands run

Commands used an absolute production `ABX_BIN`, isolated private HOME, existing regional
AK/SK, dedicated sandbox key and exact owned IDs supplied via private input files.
Placeholder values below describe the actual settings without publishing resource identifiers.

```sh
ABX_BIN="node $PWD/dist/bin/abx.js" ABX_E2E_TEMPLATE=base \
  ABX_E2E_VOLUME_MOUNT=1 ABX_E2E_VOLUME_NAME=<owned-volume> \
  ABX_E2E_VOLUME_MOUNT_PATH=/mnt/abx-e2e/volume \
  node e2e/run.mjs --suite volume-mount-cloud --json <private-report>
# In the Python owner, with both source packages on PYTHONPATH and a unique socket:
python -m pytest e2e/test_09_volume_mounts.py -q --tb=short
# Team plan/resource-group supplied from verified eligible account configuration:
ABX_E2E_PROVIDER_MANAGEMENT_WRITE=1 ABX_E2E_MANAGEMENT_QUOTA=1 \
  node e2e/run.mjs --suite provider-management-lifecycle \
  --filter '^provider-management-lifecycle/(team-api-key-lifecycle|quota-lifecycle)' \
  --json <private-report>
```

A private orchestration script invoked the public `provider command run alicloud-express`
commands, official OSS/RAM/STS clients, `Sandbox.create`, `files.read`, command execution,
kill and exact not-found reads. Temporary infrastructure dependencies were isolated outside
the product environment: oss2 2.19.1, RAM SDK 1.3.0, STS SDK 1.2.0, python-dotenv 1.2.4.
No repository dependencies or lockfiles changed.

## Real storage results

| Check | Result | Observable evidence |
| --- | --- | --- |
| Private OSS Bucket and FC-trusted RAM role | PASS | Dedicated custom policy grants access only to the newly created Bucket; no existing role/policy was modified. |
| Volume create/get/list/delete | PASS | Two sequential test Volumes reached AVAILABLE; role configuration persisted; deleted resources returned not-found. |
| Dedicated same-Team API key | PASS | Exclusive secret file mode 0600; CLI output redacted; key metadata matched the Volume Team. |
| CLI `volume-mount-cloud/existing-volume-roundtrip` | PASS | Exact kernel mount checked before exclusive sentinel write/read/delete; sandbox deletion and built-in leak check passed. |
| Python `e2e/test_09_volume_mounts.py` | PASS | 1 passed in 8.06 seconds through the real built-in gRPC lifecycle. |
| Independent Python/OSS cross-check | PASS | SDK-created sandbox mounted the Volume, wrote/fsynced an exclusive file; separate OSS API read identical bytes, SDK read agreed, and OSS confirmed deletion. |
| Tagged sandbox query | PASS | Zero remaining resources with either exact test-run metadata tag. |

The test explicitly selected the `base` template in cn-hangzhou; this is not a claim about
all templates or regions. Custom MicroVM source images require ossfs2 >= 2.0.10 according to
the [official mounting guide](https://help.aliyun.com/zh/agent-sandbox/mount-oss-volume-1).
The root credentials were read from the existing ignored configuration and passed privately;
no credential values, account IDs or private resource names are included here.

## Cleanup

The initial three test sandboxes were deleted and their absence checked. The first
infrastructure run removed two sequential Volumes, one private Bucket, one RAM role, one
bucket-scoped custom policy and one dedicated API key. A second independent infrastructure
run supplies the added sandbox-recreation check, recorded below. Cleanup order was sandboxes, inactive/delete key, Volume, Bucket objects and
multipart uploads/Bucket, policy attachment/custom policy, then role. Each control plane
confirmed not-found, including OSS NoSuchBucket and RAM EntityNotExist. The generated key
file was removed. Existing Teams, subscriptions, credentials, storage and permissions were
not modified. Separate empty-Team/quota tests deleted their own quota overrides and Teams.

## Failed setup attempts and limits

An initial supplemental cross-check passed the unsupported `base_url` keyword to
`Sandbox.create`; it failed with TypeError before creating any sandbox. The corrected
`sandbox_base_url` invocation passed all independent checks. An initial anchored runner
filter selected zero scenarios: its zero exit is excluded from verification results. The
corrected filter explicitly checked the number and status of selected cases.

An attempt to reuse the deleted Bucket name for the supplemental run received OSS
BucketAlreadyExists (409), despite another NoSuchBucket read. No existing Bucket was
adopted or deleted; a fresh random name passed the unused-name guard and provisioning.

The legacy locked FCSandbox SDK exposes Volume status updates without a documented writable
transition. No transition was invented or tested. Newer storage types, STS credentials,
dynamic mount/attach, custom domains and other templates/regions are not established by
this run. Domain API prerequisites remain tracked in
[CLI #32](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/32).

## Team and quota regression

The original published Team/API-key lifecycle selected exactly one case and failed during
`team.create`. A separate attempt received InvalidParameter.TeamName for the long generated
name. A short alphanumeric name passed actual create/get/list, description update/readback,
zero CPU/memory quota set/get/list/delete, Team delete and not-found checks.
The shared lifecycle fixture now uses 19 alphanumeric characters with 60 random bits and
retains its unused-name and exact ownership guards. This does not invent a public maximum
length or character restriction absent from the API metadata.

After the fixture fix, the published runner selected exactly two cases:
`team-api-key-lifecycle` and `quota-lifecycle` both PASS, exit 0. Key create/get/list,
rename/readback, rotation, inactive/delete/not-found, Team description update and quota
set/get/list/delete ran against the real backend. Each newly created Team was deleted and
not-found verified by the scenario. Built-in sandbox leak-check SKIP means no sandboxes
were created by this metadata-only run; it is not counted as a cloud case pass.

## Local checks and remaining delivery gates

- `node --check e2e/scenarios/13-provider-management-lifecycle.mjs`: PASS.
- Scoped ESLint on the changed scenario: PASS, zero output/errors.
- Four relevant Vitest files (management runner skip, mount safety, shared command host,
  official FC mapping): **105 PASS**, 12.32 seconds, exit 0.
- Repository health: **105 PASS / 11 WARN / 0 FAIL**.
- Hygiene and `git diff --check`: PASS, exit 0.

The earlier complete aggregate remains **3919 PASS / 37 FAIL / 2 SKIP**, with parity and
distribution phases not reached. Baseline reproductions and details remain preserved in
[aggregate recheck](2026-10-16-provider-management-aggregate-recheck.md).
This live run resolves missing Bucket/role/key and isolated Team/quota configuration; it
does not turn that failed local aggregate into a pass. PR #35 remains draft and unmerged.

## Supplemental persistence acceptance

The extended published Python suite ran at `ec595c8` plus the scoped changes to
`e2e/test_09_volume_mounts.py`: **2 PASS in 17.17 seconds**, exit 0. The original mount
roundtrip passed again. The added persistence case wrote/fsynced an exclusive file,
destroyed the first sandbox, required its exact not-found result, created a different
sandbox mounting the same Volume, then required identical contents and deleted the file.
Both sandbox mount tables were independently inspected before file I/O. Missing persisted
files fail the read step; cleanup mode alone cannot substitute for this assertion.
An independent, paginated SDK query using the exact run metadata confirmed **zero remaining
owned sandboxes** before the test key was revoked.

The supplemental run's three sandboxes were removed. Its dedicated key was inactivated,
deleted and not-found verified; both sequential Volume resources were deleted; Bucket
objects/multipart uploads and the Bucket were removed (NoSuchBucket); the temporary policy
was detached/deleted and the role deleted (RAM EntityNotExist). The second-run cleanup
completed successfully with every owned resource absent. Across the two infrastructure
runs, six sandboxes, four sequential Volumes and two Bucket/role/custom-policy/key sets
were created and cleaned up; the metadata-only Team/key/quota runs also cleaned up their
own resources. Generated key files were removed; original credentials were unchanged.
