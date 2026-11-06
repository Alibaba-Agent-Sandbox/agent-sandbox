# Managed Gateway readiness: real local HTTP component

- Date: 2026-11-06.
- Change: [Issue 237](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/237).
- Result: selected real HTTP component and the complete managed application test file PASS; final required CI remains separate.
- Boundary: two real local HTTP servers, native fetch/text/JSON parsing and real retry delays. FC
  control operations, hooks and persistent-state responses remain controlled fixtures. No cloud,
  PostgreSQL, model or sandbox execution is claimed by this component.

## Reason for this gate

The existing stage regressions used injected probe/fetch responses. Real Express/PTY verification did
not execute the managed apply readiness branch. Before merge, independent reviewers required the
smallest real local HTTP component for that exact production path. No product code changed for this gate.

## Actual path and assertions

The existing full `applyPlan` fixture creates independent candidate and stable TCP listeners. Its
injected probe is removed, and both fetch and Date.now are asserted not to be mocked. Each origin
returns HTTP 200 with a wrong revision, then HTTP 200 with invalid JSON, then the exact frozen revision.
The real application probe performs HTTP reads, text decoding, JSON parsing and four one-second delays.

At each HTTP observation, the test checks the persisted receipt phase, absence of enabled dispatch,
hook count and credential-check count. Candidate hooks run only after its third exact response.
The stable temporary-credential request runs only after its own third exact response and returns
HTTP 401; the dispatcher timer enables afterward. The final receipt and returned status are ready.
The complete event order is asserted, not inferred from a final flag. Finally closes every listener
and connection, including failure paths. The case has a 20-second test deadline.

## Before/after and independent verification

- In the author's isolated checkout, the positive case passed in 6.66 seconds (one PASS, 106 filtered).
  Targeted ESLint, whole-source TypeScript noEmit and diff checks passed.
- Removing only HTTP 200 from the production unready-observation list in that isolated checkout made
  the new case fail at candidate attempt 1 with the expected safe mismatch error. The product source
  was restored byte-for-byte afterward. The owning checkout was not changed for this negative control.
- An independent reviewer executed the same positive component: one PASS, 106 filtered, 6.03 seconds.
- After applying the reviewed test-only patch to the owning checkout, its selected component passed:
  one PASS, 106 filtered, 7.34 seconds. Whole-source TypeScript, targeted ESLint and diff checks passed.
- The owning checkout then ran the complete managed application file with the installed public a7
  runtime enabled: all 107 cases passed in 201.05 seconds, with zero skips. This includes the selected
  component and is not 108 unique cases. The earlier `99a0395` full local CI and Node 20/22 remote matrix
  had also passed; only this test import/case and engineering evidence are added afterward.

The reviewed patch SHA-256 is `c5ddd2c90f541efe57c04126f460f6a3ba851b43d9622ac31bb17eb380a52c22`.
The resulting test-file SHA-256 is `d085780271d6cf7337071737b1f0c508d6cccfb7de2ce6c0a86df75596b2e6ee`.
Only the existing managed application test file gains the HTTP import and one component case.

## Limits

This proves the managed apply probe's actual HTTP/parse/delay/order path with real local origins.
It is not a real FC deployment or a model outcome. Earlier complete Express failures and the selected
real lifecycle recovery remain distinct evidence. Formal publication and final public managed-template
acceptance remain independent gates.
