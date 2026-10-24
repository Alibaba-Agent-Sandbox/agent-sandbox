# Verification: CLI application token through server proxies

- Date: 2026-10-24
- Result: PARTIAL
- Change: [Issue 140](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/140)
- Candidate: CLI 0.4.16, fix/application-token-proxy.

## Executed

- Targeted transport/application regressions: 28 passed, including real local HTTP Bearer-only and proxy-compatible authentication, gateway header case variants and anonymous requests.
- Typecheck and build passed. The version capture was generated into a new 0.4.16 golden directory (1 selected case passed; 117 unrelated cases were excluded by the filter). Historical 0.4.15 evidence is unchanged.
- Root-cause probe [40109164062](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/actions/runs/40109164062): direct Bearer 200, proxy Bearer 401, proxy X-Access-Token 200 against the same owned sandbox; successful responses asserted the hello result and independent container cleanup passed. This verifies the diagnosis, not this candidate client implementation.

## Pending

Final candidate lint/full CI, repository health and real OpenSandbox client proxy regression. No package publication or all-template runtime pass is claimed.
