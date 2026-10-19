# Public CLI release boundary — 2026-10-19

Result: PASS for artifact/installation/Express-core checks and public-state review; new package publication is not performed.

Source: accepted main f20f9d2346 (full head captured in release review), Node22.22.2 Linux x86_64. Locked npm ci, production build, npm pack and standalone SEA build PASS. Tarball installed in a new consumer through generated package-lock and npm ci; version, standard create help, native image help and complete219073-byte notice output PASS. Actual installed npm and SEA execute a controlled command in a real owned Express sandbox PASS; independent cleanup0. These checks do not prove a new published version or native third-party provider deployment.

Public npm metadata GET404. Existing GitHub v0.3.0 tag resolves7854c314055fd9c196332babffca7c2aa608f805, distinct from current main; five target binaries and checksums exist for that historical release. This review executed only the current Linux x64 candidate. Both canonical .cn sites GET200. Registry .com did not resolve in this environment; website .com served different/older content and is not used as deployment evidence.

Changed README EN/ZH and CHANGELOG only, plus this owner decision/evidence. Health/hygiene, scoped links and latest-head hosted CI follow before merge. No new release, npm publication, dispatch credential or cloud/model Actions.

Documentation gates: repository health105 PASS/11 registered historical WARN/0 FAIL; check:hygiene PASS; git diff --check PASS. Current public canonical links were read back HTTP200; historical release links and metadata were checked against the GitHub API. Runtime source is unchanged by this documentation PR.
