# Providers and Credentials (CLI spec) — review log

Reviewed document: [`providers-and-credentials-cli.md`](../../design/providers-and-credentials-cli.md).
The full review of the shared design (rounds 1 and 2, all findings and resolutions) is in `python-sdk/docs/en/design/providers-and-credentials-review.md`; this file records what changed **in the CLI spec** as a result, plus CLI-specific findings.

> **Disclosure.** The two rounds were done by the author in separate "attacker" modes (round 1: completeness/back-compat; round 2: UX/security/testability), not by independent reviewers (none could be spawned). A third, independent pass by the CLI worker (checklist step 9) is expected.

| # | Round | Finding | Change in this spec |
|---|---|---|---|
| C1 | 1 | `config list` rename vs "goldens only change where the spec says" | §0 table lists exactly the changed surfaces; `--legacy-names` escape hatch |
| C2 | 1 | Old dotenv precedence quirk (per-name instead of per-layer) | §2.1 layer-first; §0 row "Dotenv precedence normalised" |
| C3 | 1 | Config keys settable via `config set` for new keys were undefined (`acr_*`, `team_id`) | §1.3 storage per key (phase 1 / phase 2) |
| C4 | 1 | Clearing a key left legacy-named copies that "came back" | §3.3 clearing removes every stored name |
| C5 | 1 | `config set api_url` echo text must stay byte-identical | §3.3 echo the key as typed |
| C6 | 2 | Provider override slot (`uses_core`) let a plugin read generic credentials implicitly | §1.3 / §2.1 replaced by `core.inherit` ∩ consented list; consent screen `Inherit` warning line; `info` shows `Inherits` |
| C7 | 2 | `--link` pins nothing | §5.3 requires `--yes`, banner, POSIX only; error row added |
| C8 | 2 | `Security` line looked enforced | §5.3 labelled "declared by the plugin (not enforced)" |
| C9 | 2 | Qualified ids only for non-builtin could still mislead after the default changes | §4.4 legacy format only when ambient **and** effective are `alicloud-express` |
| C10 | 2 | `--provider` typos gave an unhelpful error | §4.1 `Did you mean` hint |
| C11 | 2 | Discoverability of `provider` and which provider answered | §0: `abx --help` related-commands line, `abx info` `Provider` row (non-builtin only) |
| C12 | 2 | Plugin stderr/`initialize` could leak secrets | §7 test 7: stderr redaction + no logging of `initialize` |
| C13 | 2 | Installer ordering: validation must precede any file write | §7 test 6: `ls-tree` validation before blobs are written |

Open for the CLI worker: confirm Node `smol-toml` handles every manifest in `examples/providers/`; confirm `git cat-file --batch` availability on the minimum supported git (2.20).

## Implementation-phase addendum (round 3, found while implementing the Python side)

| # | Finding | Resolution |
|---|---|---|
| I1 | `-32002` mapped to `SandboxCreationError` (E2000, exit 1) contradicted the documented exit 4 | New E8005 `ProviderResourceNotFoundError`; mapping and `epp-error-mapping.json` updated; spec §9.1 |
| I2 | Contract kit failed on providers whose `kill` raises for an unknown id | Host adapter swallows E8005 on kill; kit requires idempotent kill; spec §9.2 |
| I3 | `list_commands` crashed for sandboxes without envd (`epp://` marker) | Skip envd auth/listing for marker URLs; spec §9.3 |
| I4 | A clean plugin exit left grandchildren alive | `EppClient.close` always reaps the process group; spec §9.6 |
| I5 | Python interpreters write `__pycache__` into the digest-verified plugin dir, breaking integrity on second run | `PYTHONDONTWRITEBYTECODE=1` in the scrubbed env; spec §9.5 |
| I6 | `Sandbox` had no way to release a plugin process | `Sandbox.close()`; spec §9.7 |
| I7 | Migration left an empty `[transport]` table | Dropped; `migration-vectors.json` covers it; spec §9.8 |
| I8 | `sandbox.yaml`/`@sandbox` provider plumbing lives in a file owned by another workstream | Deferred; listed in §9.10 and the CLI checklist |

