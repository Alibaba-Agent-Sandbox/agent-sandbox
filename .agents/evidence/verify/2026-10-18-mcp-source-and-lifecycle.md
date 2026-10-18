# MCP source and lifecycle verification — 2026-10-18

Result: local PASS except ten preserved platform raw-socket baseline failures;
remote exact-head CI/review pending.

Sources: original PR31 head283779a, PR23 head71aace1 (ancestor), ordinarily merged
accepted mainbdb556ab. Node22.22.2/npm10 locked install; Python3.13 clean runtime.

- Typecheck/build PASS. Lifecycle, paused-provider control plane, artifact, manager,
  privacy, existing tool/error oracles and workflow regression suite375 PASS.
- Full local suite3866 PASS/10 FAIL/56 SKIP. The same ten raw TCP/TLS/WebSocket/proxy
  host failures remain; no new behavior failure is counted as a pass.
- Actual built CLI generated app.py/requirements.txt/config.yaml in a private
  temporary directory using synthetic deployment configuration. Real credentials
  were supplied to the runtime process only, never written into that artifact.
- Fresh venv pip install of exact generated requirements, pip check and actual
  paired0.3.0 site-packages imports PASS. The two GitHub archive requirements use
  accepted SDK13b214b, not a working tree, wheel cache or invented release.
- Actual generated Uvicorn/ASGI app: authenticated HTTP, protocol initialization,
  tools/list, actual Express creation, command output, file roundtrip, destruction,
  session shutdown and exact owned absence readback:32 checks PASS,1 sandbox,
  zero residual resources. Private temporary application files, user profile and server process cleaned up.
- Initial artifact controller stopped before server readiness on a transient
  RemoteProtocolError (zero cloud resources); installation checks already passed.
  The bounded readiness loop now handles connection-stage startup failures without
  changing product assertions. The successful later run is a distinct receipt.
- Actual built CLI STDIO JSON-RPC lifecycle:14 checks PASS, including CPU/memory,
  safe metadata/list, external observation and TTL request, borrowed shutdown,
  command/file use and owned destruction/absence. No implicit renewals are restored.

The full FC manual deployment wrapper and IDE client installation were not run;
the CLI explicitly implements an artifact generator with manual steps. Source
installation, actual generated app and real backend use are verified separately.
No package release, cloud credential upload or hosted model workflow was performed.
Final quality, record/link/secret scans and exact-head remote checks follow below.

Final quality:strict TypeScript check/build PASS; eslintzero errors/255 existing
warnings; hygienePASS; repository health105 PASS/11 immutable-history WARN/zero
FAIL; scoped diff check PASS. A prose slash sequence initially triggered the
local-path scanner; rewriting that sentence fixed it without an allowlist entry.
The lifecycle controller's14 real STDIO checks and the generated app's32 real
HTTP/component checks passed independently, with zero residual owned sandboxes.

Main convergence: ordinarily merged accepted provider-owned metadata follow-up
10a2d688; preserved its implementations and immutable acceptance records. Re-ran
strict typecheck/build and54 focused lifecycle/artifact/provider-isolation tests:
PASS. Re-ran the actual built STDIO Express lifecycle:14 PASS, zero owned residuals.
