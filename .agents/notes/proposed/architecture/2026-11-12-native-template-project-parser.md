# Decision: Resolve template projects through the native Devs parser

Status: implemented locally in part; acceptance and release gates remain open

## Problem

The new template v1 contract includes a native Serving project and references in
Sandbox and application configuration. The existing FC component loader does not
resolve Devs project expressions. Implementing similar-looking substitutions in
the CLI would create a second dialect and leave relative paths and dependencies
ambiguous. Loading the official parser inside the CLI would also let its dotenv
and configuration behavior mutate shared process state.

## Decision

Use the pinned official parser in a bounded, isolated Node child. The one original
project directory remains its working directory. The native deployment project
and private Sandbox/application payload are resolved together using native
expressions. Resolved values travel through a private pipe, never normal output.
Raw parser errors are withheld; missing environment references identify their
name and original JSON Pointer without exposing other resolved values.

Parsing lists original action declarations but never executes actions or
components. General Serving apply/remove still needs an owned-resource lifecycle;
this parser alone does not deliver it. Managed lifecycle remains with the existing
coordinator. A later consumer must distinguish static intent loading from explicit
private resolution and must not serialize resolved credentials into plans.

## API Design

`resolveDevsProject(document, file, environment?)` returns a private resolved
document, ordered component steps and original action declarations. The explicit
environment parameter permits callers to pass temporary configuration without
changing the CLI process environment. `devsActionDeclarations` only reads intent.

## Alternatives considered

- Hand-written env/vars substitution: rejected because it duplicates native
  semantics and cannot provide real native dependency behavior.
- Import the parser into the CLI: rejected because native dotenv/configuration
  behavior and future engine environment changes would affect other operations.
- Replace Managed cleanup with generic component remove: rejected because
  candidate verification, old Session routing and drain have independent meaning.

## Dependencies

Pinned `@serverless-devs/parse-spec@0.0.29` and
`@serverless-devs/engine@0.1.6-beta.2`, installed with the repository lockfile.
The engine dependency is available for the continuing integration; current parser
code does not invoke it or claim arbitrary component lifecycle support.

## Test Strategy

Use the real installed parser for native env/vars, relative file references,
resource output dependency order, missing-reference diagnostics, dotenv isolation
and action non-execution. Run the repository test/lint/typecheck gates. Record
source fixture checks separately from later cloud and real-model acceptance.

## Acceptance criteria

- Static discovery does not need secret resolution; actual execution has one
  explicit, isolated native parser path.
- Native FC names and values, including memorySize4096, are preserved.
- No parser error or ordinary output exposes resolved private values.
- Plan and receipt writers retain intent/references instead of secret values.
- Full v1 consumers, real cloud/model E2E and required repository gates are
  recorded before claiming migration complete.

## Evidence

- [Parser verification](../../../evidence/verify/2026-11-12-native-template-project-parser.md).

## Consumer resolution

The canonical two-stage decoder is copied by immutable source hashes. Public plans
never receive the complete resolved compiler output. Native FC and Sandbox private
maps remain ephemeral. Cleanup has a narrower service contract than apply so it cannot
accidentally acquire model or source-build requirements. The stale v6 profile/schema
runtime copies had no product imports after migration and were removed; their Git
history and earlier engineering evidence remain intact.

The SDK owns launch JSON/vectors and Python behavior. The CLI owns the standalone JS
planner, with no additional canonical imports; consumers must perform complete owner
schema admission before using the prerequisite planner. Shared vectors verify the
public v1 shape. Registry can copy the planner and its launch JSON without an implicit
private spec projection.
