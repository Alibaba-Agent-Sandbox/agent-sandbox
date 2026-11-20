# Decision: Portable native Devs execution

Status: proposed

## Problem

The new resource engine worked from source and an installed npm package, but a real
standalone SEA failed native parsing. Its `process.execPath` is the CLI, not a generic
Node interpreter, and filesystem `require.resolve` cannot depend on a nearby checkout.
The existing version-only binary smoke did not establish native-engine availability.

## Decision

Keep the official pinned parser and component loader. Build their existing runners
plus dependencies into ordinary CJS assets embedded in the SEA. The same executable
starts only fixed parser/component worker modes before public CLI initialization.
The parent owns a private scratch directory and removes it after child termination;
the child writes its own fixed asset with `wx`, rejecting preexisting files/symlinks,
then loads it as a normal filesystem CJS module. This preserves upstream dynamic
component/file imports without introducing a generic run-file command or another
Node download. npm retains its existing Node/installed-dependency path.

Use static imports for the new resource path's Express, FC, ACR, STS and credential
SDKs and argument parser. Normalize the real CJS namespace only at the module boundary
so Node ESM and esbuild CJS use the same constructors/models.

## API Design

Public YAML and CLI syntax do not change. Private worker selection accepts only
`parser` and `component`; stdin carries the existing request, FD3 the structured
result and FD4 component log events. Existing redaction, credential snapshots and
component deadlines remain in force. Retired private application tooling is outside
the new public resource path and is not expanded by this change.

## Alternatives considered

- Requiring a second external Node or an adjacent node_modules tree would violate
  the standalone distribution's supported use.
- Merely bundling the loader into the injected main loses its ordinary dynamic
  filesystem require behavior.
- Reimplementing Devs parsing or FC deployment would create another contract.
- Accepting an arbitrary run-file argument would add an unnecessary execution API.

## Dependencies

Existing locked SDKs, official Devs dependencies, esbuild and Node SEA assets. No new
production package or external cloud service is introduced.

## Test Strategy

Test Node ESM and independent CJS SDK constructors, signed local HTTP operations,
worker selection and private-file rejection, and real bundled official dependencies.
Copy the actual SEA outside the checkout, remove external Node/module paths and run
vars/env/file/dotenv resolution plus the published FC3 component against a loopback
server. Verify creation conflict behavior, FD3/FD4, redaction and owned cleanup.

## Acceptance criteria

The installed npm artifact and relocated Linux SEA both pass their actual executable
checks. CI builds the SEA and uses the exact SHA-256-verified published FC3 archive;
help/version or fixture components alone cannot satisfy the native component gate.
Other platform release checks and managed cloud application acceptance remain distinct.

## Evidence

- [Portable native-engine verification](../../../evidence/verify/2026-11-13-portable-native-engine.md).
