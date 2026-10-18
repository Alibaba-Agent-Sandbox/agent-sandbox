# Verification: compatible toolchain patches and accepted records

- Date:2026-10-18
- Result:PARTIAL; combined local/real component evidence complete, hosted pending.
- Base:a48daa37b1ad830e2446358b0b1b3f6c89b8cf4f.

Independent bot PR50 head7b1d235 and PR51 headd384a5e each had five passing
hosted checks. This follow-up tests the combined current-main tree, not those
stale bases. Ordinary merge resolved only adjacent root dependency rows,
retaining Vitest5.0.4 and typescript-eslint8.71.2 plus both transitive lock changes.
An initial merge index-write failure was retried with autostash disabled; no
shared history was replaced. npm ci before conflict resolution refused markers;
that attempt is not installation acceptance. Final locked installation runs after
JSON parsing and a normal merge commit. No production dependency or source changed.

Moved accepted decision notes only after verifying actual merges:
PR6 merge2c823d22a7fbce7d066e392954d5014b408bb211;
PR53 bea80a5c4023a746249692e2816f6d6c78082fb8;
PR54 31015b6a9fd7f77efa92e5ca0becdc845ff3a8b7;
PR56 54757ce78ba56e48630d1ab0c96035bdcf145b21;
PR58 a48daa37b1ad830e2446358b0b1b3f6c89b8cf4f.
Historical captures, golden ledger and merged evidence remain untouched.

Final npm ci PASS from combined lockfile (two existing install-script warnings);
typecheck/build PASS. Full npm test:3651 PASS/12 FAIL/56 SKIP in709.82s; all12
failed identities exactly match the earlier same-runtime baseline (filesystem
mode, REPL and intercepted TCP/TLS/proxy/WebSocket cases),0 introduced identities.
Unconfigured optional Python source cross-checks are SKIP, not passes. The suite
is not reported green. Lint0errors/222existingwarnings; health105PASS/11WARN/0FAIL;
hygiene/whitespace PASS. No extra cloud test is inferred from unit fixtures.
Fresh frozen built standard lifecycle:7PASS (create/info/text and JSON exec,
100KiB binary roundtrip/kill/leak check),1 created/0 leaked. Actual executable
abx0.3.0 built from this combined source; no rebuild during that run. Historical
evidence and CLI golden/ledger bytes remain unchanged. Required latest-head
hosted Node20/22/build/installer/types/document checks pending before merge.

Final current-install review also corrects CLI README/guide/Skill entry points:
GitHub v0.3.0 exists (five binaries and five matching checksum assets); npm is
still unavailable. Retire stale unreleased-binary claims, positive unavailable
npm/npx instructions and unrelated Python package name. Use tested paired native
SDK source e86cb0b and owner installation guide. This follow-up is prose only;
source/locked dependencies and the frozen7PASS cloud artifact remain unchanged.
Fresh install/metadata/document checks recorded separately; latest hosted gates
rerun on the final combined head. No new release or name change.

Fresh official release proof:all five v0.3.0 binaries/checksums listed; actual
Linux-x64 binary downloaded into an isolated native temporary directory, its
published SHA256 verified, executable --version exit0 reportsabx0.3.0. No APIkey
or cloud call used for this check; temporary files removed. Public npm metadata
for CLI/NodeSDK remains404. Final install-doc health105PASS/11WARN/0FAIL and
hygiene PASS; SDK pair/all-extras real install proof remains independently linked.

Remove npm metadata-derived version/runtime badges from both current READMEs because official metadata404 cannot support them. Source Node20/22 support remains explicitly documented and tested. No runtime or dependency change.

Hosted68778db failed exactly3 existing Skill-document contracts: both language
no-curl-pipe rules and shared npm-command disclosure. The final guidance now
retains those rules, uses source installation with the binary guide as an
alternative, and describes npm as unavailable in both languages. No test/gate
was removed or weakened; focused existing document regressions rerun below.

Existing bilingual Skill-document regressions:24PASS. Health105/11/0,hygiene/whitespace PASS. Required latest-head full hosted matrix remains pending.
