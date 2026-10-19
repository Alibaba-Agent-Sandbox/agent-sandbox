# Verification: npm publication recovery — 2026-10-19

Result: PASS for local recovery regression and public binary acceptance. Hosted current-head checks and the recovered npm upload remain delivery gates.

Base e1301f4536e58134e4ca9612bfb073f62803e158, CLI0.4.0, Linux x86_64, Node22.22.2/npm12.0.2.

## Observed failure

The initial release run https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39241317803 passed type/build/unit checks. Candidate installation failed with exit128 because npm resolved the bare dist-pack/name.tgz argument as a GitHub shorthand. The npm publish step did not execute. No npm publication success is claimed by this preparation record.

## Executed verification

- New tests/test_release/test_npm_workflow.test.ts:8 PASS. Six executions of the actual workflow guard, explicit tag checkout assertion, and a real tarball/global install using the workflow's actual command with byte-identity readback.
- An independent shell/YAML harness:7 PASS, including corrected glob installation of the actual0.4.0 npm candidate and complete version/root/standard/native help/notices checks.
- GitHub binary matrix https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39240421662:five platforms PASS, including actual npm and SEA execution before upload. Main source CI https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39240299100 PASS.
- Five public native binaries and their checksum files were verified against GitHub server SHA256 digests before publishing https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.4.0 . Public default-latest installer used no authentication, version override or download override. Installed Linux SHA2562475d0f43cd7fa2924414b213693fbf2e4f4389de8700a20efb9b14d99d7a1db, version/help/complete notices PASS.
- Publicly installed binary, locally initiated real Express with ABX credentials only:actual CLI create,stdout,remote exit7,100KiB upload,independent remote SHA256,download byte equality,list,kill plus independent HTTP404.8 PASS; zero owned sandboxes remaining.

English/Chinese binary guides and Unreleased changelog explain recovery and distinguish public binary availability from npm index availability. No source/runtime code, previous release tag or historical evidence changed. Additional repository check results and latest-head hosted gates are attached to the PR before merge. Actual recovered upload/public npm install remains tracked by Issue66.

Final local repository gates: typecheck PASS; new regression-file ESLint PASS with zero warnings/errors; health105 PASS/11 registered historical WARN/0 FAIL; hygiene PASS; git diff --check PASS. Existing runtime full-suite checkpoint remains in the preceding publication record; unchanged network assertions run again in hosted Node20/22 before merge.

Active EN/ZH getting-started, troubleshooting and best-practices guides now use an explicit official-index check instead of a stale permanent unpublished claim; binary references identify the verified0.4.0 release. This does not preclaim npm upload success.
