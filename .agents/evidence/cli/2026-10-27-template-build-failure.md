# CLI capture: real template build failure

Date: 2026-10-27. Local CLI 0.5.7 candidate; real Docker instruction `RUN echo <synthetic-secret> && exit 23`. Placeholder cloud credentials. No push, template or sandbox submitted, confirmed by the resource journal.

Command: `abx --provider alicloud-express --json template launch <local-project> --yes`

stdout (only journal UUID normalized):

```json
{"status":"error","message":"Docker build failed (exit 1): a build instruction failed. Inspect recovery journal <journal-id> before retrying any submitted operation.","code":"E7020","suggestion":"Inspect the Docker build output and the failing instruction. Use --verbose on an intentional retry after checking the recovery journal."}
```

Exit status: 1. Final CLI stdout/stderr omitted the synthetic secret.
