# Verification: CLI legacy retry configuration docs

- Date:2026-10-18
- Result:PARTIAL; document/record/latest hosted checks pending.

The CLI HttpClient has no max_retries/retry_base_delay scheduling read;
ExecProvider forwards max_retries in the EPP core contract. This change touches
bilingual guides/changelog and this owner's records. One trailing blank line
from the accepted error-handler extraction is removed to satisfy the whitespace
gate; executable logic, generated schema, defaults and Node exports are unchanged. Existing standard built
CLI cloud lifecycle7 PASS is historical supporting evidence, not a new run.
Source contract owner: https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/60.

An initial attempt reused an identical dependency tree through a symlink; the
repository health gate rejected it. The link was removed and npm ci installed
this worktree independently from its unchanged lockfile. Final health105 PASS /
11 existing WARN /0 FAIL; hygiene/changed-document links PASS. No dependency
symlink or package artifact is tracked or published. Latest hosted checks pending.
