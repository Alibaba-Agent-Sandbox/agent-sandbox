# Provider preflight verification — 2026-10-18

Result: local scoped PASS; final hosted CI pending. No native feature activation.

Basead704f41, Node22.22.2, locked npm10 installation.

- Before fix:8 FAIL/2 PASS; after fix:10 PASS. Five real HTTP loopback statuses
 403/409/429/500/503 each make one POST and no successful fallback GET.
- Native PTY absence rejects with typed feature error before wire adapter access.
- Wrong provider internal deployment rejects before config/project access; missing
  generated-deploy adapter rejects before model/workspace generation.
- Actual built CLI installs a real local node/1 provider, observes the qualified
  resource on that provider, rejects conflicting ownership, and refuses foreign
  template/generation routes. Temporary HOME/store removed in finally. An initial
  copied probe carried a standard-frontend exec assumption outside native main's
  contract; the scoped native preflight probe records its separate passing run.
- Real local Express cloud-readonly/cloud-lifecycle:73 PASS/1 SKIP (destructive
  account-wide kill opt-in);2 sandboxes created, zero leaked, leak check PASS.
  Includes actual auth errors, templates, lifecycle, commands/files/process/system
  and named server commands. No cloud/model Actions acceptance added.
- Typecheck/build PASS. Full local suite3877 PASS/10 known platform raw-socket
  FAIL/56 SKIP; no new behavior failure. Hosted matrix must independently pass.
- Lintzero errors; final hygiene/health/record checks follow publication preparation.

No conditional success, package release or broad provider-feature parity is claimed.
The migration parent remains draft for its own account-dependent acceptance.
