# Pinned Sandbox protocol sources

The separate lockfile pins `e2b@2.50.0` as the bundled protocol SDK and
`@e2b/cli@2.20.0` as the provenance of the adapted terminal/stdin algorithms.
The shipped runtime contains the SDK; `abx` owns the command parser, help,
configuration and output. No upstream CLI is installed or executed by users.

```sh
npm ci --prefix vendor/e2b-cli
npm run vendor:e2b
npm run test:standard-provenance
```

When intentionally refreshing attribution inputs (Node 22+ and tar required):

```sh
node scripts/audit-standard-prebundle.mjs
node scripts/audit-standard-prebundle.mjs --sdk
```

`prebundled-sources.json` and `prebundled-notices.txt` retain the pinned upstream
CLI source-map provenance. They remain historical source evidence for the
terminal/stdin port, even though its command parser and template generators
are no longer bundled. `sources.json` lists the actual SDK bundle dependencies
and the upstream CLI attribution for the adapted source.

`sdk-license-sources.json` and `sdk-license-notices.txt` retain exact-version
license sources for SDK dependencies whose npm archives omit a standalone
license file. The protobuf entry includes the original BSD varint notice and
the Apache license from its published commit. Generation verifies the retained
notice digest and dependency identities offline. The npm lockfile pins the
package archives; CI replays generation and rejects changed artifacts.

Rendered notice line endings and trailing spaces are normalized. Source hashes
refer to original bytes; copyright and license terms remain intact.
