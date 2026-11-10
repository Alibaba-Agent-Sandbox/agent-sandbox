# Decision: Single CLI frontend and retained Sandbox operations
Status: proposed

## Problem

The executable selected one of two parsers by arguments and Provider. Consequently,
root JSON/configuration options changed availability, command help differed by path,
and the standard bundle included another CLI's unrelated authentication and template UI.
Provider selection and configuration also had duplicate public commands.

## Decision

Use the existing abx command parser once. Remove the `--native` dispatch mechanism.
Bundle the pinned `e2b@2.50.0` SDK as a library, rather than importing the upstream CLI.
Adapt the pinned terminal/stdin algorithms into small operation modules; preserve their
Apache attribution and retain source-map provenance. Native operations resolve the same
Provider, saved deployment target, configuration guidance and formatter as other commands.

Keep raw Sandbox protocol operations for exec, terminal connection, pause/resume,
metrics, snapshots, forks and network configuration. The root management commands own
create/list/status/logs/delete/recovery; the corresponding internal command callbacks
remain callable services. Provider `run OPERATION` is the execution entry;
`provider command list/info` still provide machine-readable schema discovery. Remove
`provider show/default/config/command run`; persistent configuration uses `config`.

## API Design

- `sandbox_native.ts` exposes native command objects and an explicitly configured SDK
  boundary. It resolves deployment names through `sandboxTarget`, including saved
  Provider options and connection endpoint/domain, without modifying process environment.
- `sandbox exec` ends local option parsing at the Sandbox ID. Remote flags, including
  `--help`, `--provider` and `--json`, remain remote argv. Root JSON produces one result
  with stdout/stderr/exit_code. Express keeps its unlimited default command deadline;
  the retained Provider executor keeps its previous 60-second default.
- PTY input, resize events and raw-mode restoration belong to the session. Signal
  ownership suppresses the executable's generic interruption handler until remote
  cleanup completes. Piped stdin writes are bounded to 64 KiB and signal EOF; interruption
  stops an otherwise open input stream before awaiting the remote exit.
- `CreateOptions.lifecycle` is a Provider capability, currently Express only. Its
  `{onTimeout, autoResume?}` intent becomes the existing protocol's `autoPause` and
  optional `autoResume: {enabled}` fields. Named Volume mounts retain `{name,path}`.
  Invalid combinations and unsupported Providers fail before transport creation.
- Network updates replace the egress policy; help and confirmation state that omitted
  rules and proxy settings are cleared. Unknown JSON field names are rejected.

## Alternatives considered

Keeping the second parser behind a renamed bridge would preserve contradictory output
and configuration contracts. Translating argv into that parser would still parse twice.
Reimplementing all SDK transport calls would duplicate protocol behavior. A generic
command/plugin framework is unnecessary: fixed command objects call the SDK directly.

## Dependencies

The vendor lock keeps the SDK version at 2.50.0. Bundling that SDK independently uses
its lockfile dependencies instead of the old CLI's prebundled dependency copies.
Exact supplemental npm/source license provenance is retained for protobuf/connect
packages that omit standalone license files from their npm archive.

## Test Strategy

Check public parsing and output separately from transport and terminal behavior. Use
real local HTTP requests for endpoint/key selection, saved targets, snapshots and
lifecycle/Volume wire payloads. Exercise input bytes and remote exit statuses through
real child processes, and raw mode/resize/interruption through a POSIX PTY. Keep the
existing Provider executor, files/process/system and Provider command contract tests.
Reproduce generated SDK/notices and compare their bytes. Run repository-wide checks
only after integration builds are available.

## Acceptance criteria

1. The executable imports no upstream command parser and exposes no `--native` switch.
2. Root JSON and Provider selection apply uniformly; remote argv is preserved.
3. Unique Sandbox and Provider operations remain reachable through canonical entries.
4. Native lifecycle and named Volume inputs reach the actual request body.
5. Stdin EOF, remote exit codes, signals, terminal resize and raw-mode cleanup remain tested.
6. Source/license provenance and reproducible generation are preserved.

## Evidence

See `.agents/evidence/verify/2026-11-10-single-cli-protocol.md`. Cloud acceptance and
release status are not implied by these local component results.

## Reviewed integration refinements

- A leading optional `--` after the Sandbox ID is the exec separator and is removed
  exactly once. Remaining remote argv is unchanged; Commander is not invoked again.
- Signals wait at most two seconds for remote completion after requesting termination.
  Failed or unresolved termination is reported as unknown, with local cleanup completed.
- Provider native template management shares `providers/commands.ts` with the engine.
  Express descriptors preserve its native fields. Other Providers receive thin adapters
  over existing optional template-manager methods; they are not required to implement a
  second management contract. Explicit Provider command descriptors take precedence.
- CI output is independent of cloud credential mutation consent. All-Provider list
  output explicitly marks partial observations. Saved names resolve routing before
  authentication guidance, and local-only listing bypasses cloud preflight.


Consumer closure: active scripts consume root list `{items,partial,errors}`, deployed
`sandbox_id`, and Provider-native template result wrappers. Flags for `sandbox exec` stay
before the resource ID so remote argv is unchanged. Historical golden and parity ledger
files remain immutable; the region contract replacements explicitly map retired aliases
to shared precedence tests and actual `main --opt region=...` routing. CLI/JSON modes
never serve as consent for cloud credential mutation.

Final deadline review: keep the explicit CLI execution deadline local to the native exec
session and reuse E3001, without adding a scheduling abstraction or inferring SDK timeout
origins from messages. Starting the timer before the SDK call covers startup and output;
background acknowledgement ends the CLI timer. SDK AbortSignal bounds the active request,
and deadline cleanup separately aborts its two-second kill RPC. Known/unknown process IDs
and unconfirmed remote termination are exposed accurately. See the matching verification
record for focused real-process, parser and package checks; cloud rerun belongs to the
parent's existing owned-resource verification scope.
