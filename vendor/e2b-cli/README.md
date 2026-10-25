# Pinned standard CLI sources

The separate lockfile pins CLI2.20.0 and protocol2.50.0 as development inputs.
The shipped runtime is owned source; users do not install or execute an upstream CLI.

```sh
npm ci --prefix vendor/e2b-cli
# Only when intentionally refreshing attribution inputs; requires Node22+ and tar:
node scripts/audit-standard-prebundle.mjs
npm run build
npm run vendor:e2b
npm run test:standard-provenance
```

`prebundled-sources.json` binds705 upstream source-map inputs, including610 third-party
inputs from86 exact package identities. `prebundled-notices.txt` retains supplied
license texts. `sources.json` combines these with esbuild's external dependency graph.
Normal builds verify the complete identity set and source/notice hashes without
fetching license metadata. CI installs the vendor lock, replays generation and
rejects a diff in shipped runtime/templates/notices or the combined manifest.

Some published packages provide a license identifier and README but no standalone
license file. Their entries explicitly use `published-notices-and-declared-spdx-reference`:
original package metadata/README plus canonical text pinned to the recorded SPDX
revision. Reference placeholders are labelled; no copyright holder/year is inferred.
The dual Apache/BSD protobuf notice retains the upstream Apache text and the actual
Google BSD header from its published varint implementation. Raw upstream legal
comments remain retained separately in the generated artifact.

Generated Python recipes install public `agent-sandbox-client==0.4.0a6`, which requires the matching server runtime. The generation script uses the shared current runtime pin and rewrites Python imports in both source and README examples to `agent_sandbox`; Python README configuration uses canonical ABX variables; TypeScript retains its external `e2b` package and E2B configuration contract.

Rendered notice line endings/trailing spaces are normalized for portable artifacts.
Source-file hashes still refer to the exact original bytes; copyright and terms remain intact.
