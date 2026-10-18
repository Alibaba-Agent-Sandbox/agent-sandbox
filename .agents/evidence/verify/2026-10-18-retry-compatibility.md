# Verification: CLI legacy retry configuration docs

- Date:2026-10-18
- Result:PARTIAL; document/record/latest hosted checks pending.

The CLI HttpClient has no max_retries/retry_base_delay scheduling read;
ExecProvider forwards max_retries in the EPP core contract. This change touches
only bilingual guides/changelog and this owner's records, not those source
modules, generated schema, defaults or Node exports. Existing standard built
CLI cloud lifecycle7 PASS is historical supporting evidence, not a new run.
Source contract owner: https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/60.
