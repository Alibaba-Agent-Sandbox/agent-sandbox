# Verification: CLI application token through server proxies

- Date: 2026-10-24
- Result: PASS
- Change: [Issue 140](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/140)
- Candidate: CLI 0.4.16, fix/application-token-proxy.

## Executed

- Targeted transport/application regressions: 28 passed, including real local HTTP Bearer-only and proxy-compatible authentication, gateway header case variants and anonymous requests.
- Typecheck and build passed. The version capture was generated into a new 0.4.16 golden directory (1 selected case passed; 117 unrelated cases were excluded by the filter). Historical 0.4.15 evidence is unchanged.
- Root-cause probe [40109164062](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/actions/runs/40109164062): direct Bearer 200, proxy Bearer 401, proxy X-Access-Token 200 against the same owned sandbox; successful responses asserted the hello result and independent container cleanup passed. This verifies the diagnosis, not this candidate client implementation.

- Lint passed with 0 errors and 274 existing warnings; repository health passed with 106 PASS, 11 historical WARN and 0 FAIL.
- Complete remote [CI 40110188573](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40110188573) passed, including Node 20/22 tests, parity, installer, typecheck and package build. [Docs 40110188661](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40110188661) passed. No additional full local suite was run for this patch.

## Actual OpenSandbox regression

[Run 40110372103](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/actions/runs/40110372103) passed using these exact sources:

| Repository | Revision |
| --- | --- |
| awesome-providers | `65d8e5a9c130f424c05a662fe430b0eb04793c0e` |
| agent-sandbox | `80c45cd2594d0fc997badfd31246d60ffa434de5` |
| python-sdk | `588d126af9310ee5536ea631856b092b84c6ce6b` |
| nodejs-sdk | `344d297df816063b6580d7f2bb34180111ad9a54` |
| awesome-templates | `295aff8f45f710eadf46d164b7ce4150b2c914ec` |

The python-hello template completed default/direct, portable/direct and default/proxy project launches and actual CLI/Python application calls. The independent Node client called the protected command through the proxy twice. Raw direct Bearer/proxy Bearer/proxy X-Access-Token probes retained the expected 200/401/200 distinction; successful requests asserted the application result. Independent Docker resource readback confirmed cleanup.

This covers one template and the stated launch paths against the pinned single-tenant OpenSandbox server. It does not certify all 46 templates, every gateway credential combination or multi-tenant server configuration. Existing gateway X-Access-Token values remain authoritative and are never replaced.

## Review and delivery boundary

Independent cross-agent review found no blocker in copied header assembly, case-insensitive gateway preservation, Bearer compatibility, anonymous requests, redirect rejection or no-retry behavior. Final evidence-only commit CI remains a merge gate. This record does not claim package publication.
