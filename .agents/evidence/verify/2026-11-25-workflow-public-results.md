# Public deployment results and recovery guidance

Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/276

This verification extends the bounded workflow changes recorded in `2026-11-25-workflow-status-exec.md`. It does not claim that the separate build/deploy/create migration or all legacy document examples are complete.

## Problem and implementation

The public deployment summary spread its internal launch record, exposing plan/source digests and journal IDs. Application results exposed receipt paths; recovery accepted a receipt filename and printed raw resource intents. Several errors instructed users to inspect a journal or prepare a destruction plan.

The CLI now projects supported deployment fields and actual resource identities. Application cleanup results retain resource kind, ID and state, without intent/correlation keys. Recovery uses the deployment name and the CLI's saved state. Launcher errors include the owning `abx recover NAME` command and preserve the safe failed phase. Damaged private deployment/application records produce controlled errors rather than JSON parser fragments or filenames. These changes do not change remote ownership or make uncertain deletion safe to repeat.

`credentials_file` remains an intentional application credential configuration reference. External HTTP/SDK users need its generated `businessKey`; the CLI does not print that key. This is distinct from making users pass build, plan or receipt documents between commands. The parent reviewer specifically required preserving this access until a real replacement exists. Sandbox launch metadata cannot inject an arbitrary credential-file field into the projection.

## Adversarial review

The parent approved explicit projections, named recovery and preserving actual Provider resource IDs. An independent API reviewer checked the earlier status/stream changes without a blocking finding, then caught the unknown-create error's remaining journal ID and the local-storage hint's journal directory. Both were corrected and the unknown-create branch has a regression. The reader still has local ownership state after an observation or error; no cloud creation is repeated by recovery.

## Validation

- Four focused CLI/Provider test files passed, covering deployment output/status, deployment commands and the source launcher.
- The output cases cover human-independent JSON, verbose JSON, list/recover/delete, unavailable IDs, corrupted stored JSON, intentionally retained credential-file references, and rejection of public `recover --receipt` input.
- Two managed-application cases affected by changed error guidance passed independently: replay refusal after deployment and partial destruction/retry with ownership checks.
- An earlier combined run completed with 182 passing tests, one skipped test and three failures in the new fixture: it attempted to persist a token that the existing secret rejection correctly refused. The fixture was corrected; it does not indicate a product authorization failure. The focused output suite subsequently passed all ten cases. The broader managed suite's local HTTP/subprocess checks do not constitute FC deployment verification.
- TypeScript type checking and focused ESLint passed. No new cloud resources, cloud keys or package release were created by this work.

The encompassing change owns final integrated checks, complete command-help snapshots, the remaining build/output-option cleanup and publication status.
