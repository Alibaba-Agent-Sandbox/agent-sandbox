# Express runtime follow-up: actual source CLI

Date: 2026-11-05. Source: PR #234 head `bbe6e0d` plus the runtime preflight fixes.
Each case ran in a new Node process using only PATH, a temporary HOME/config
directory, ambient CI presentation and a placeholder Sandbox API key. The API URL
targeted an independently started loopback HTTP fixture. No AccessKeys or real
cloud credentials were present. Paths and input files below are descriptive;
the fixture's ephemeral address and machine paths are omitted.

Command form:

```sh
node --import tsx src/bin/abx.ts --json provider command run alicloud-express OPERATION --input-file ./input.json --yes
```

Before the credential-selection correction, supplying a Sandbox API key alone
reported missing `access_key_id` and `access_key_secret` before any HTTP request.

## Runtime timeout

Input: `{"sandbox_id":"source","timeout":600}`; operation: `sandbox.timeout`.
Exit 0, empty stderr, one `POST /sandboxes/source/timeout` request with body
`{"timeout":600}` and the expected API-key header.

```json
{"sandbox_id":"source","timeout":600}
```

## Runtime network

Input: `{"sandbox_id":"source","network":{}}`; operation: `sandbox.network.update`.
Exit 0, empty stderr, one `PUT /sandboxes/source/network` request with body `{}`
and the expected API-key header.

```json
{"sandbox_id":"source","updated":true}
```

## Runtime mounts

Input: `{"sandbox_id":"source","named_volume_mounts":[{"name":"workspace","path":"/mnt/data"}]}`;
operation: `sandbox.mounts.append`. Exit 0, empty stderr, one
`POST /sandboxes/source/fc-volume-mounts` request with the expected API-key header
and body `{"namedVolumeMounts":[{"name":"workspace","path":"/mnt/data"}]}`.

```json
{"sandbox_id":"source","appended":true}
```

## Obscured nested mounts

Operation: `sandbox.mounts.append`. Input mount paths: `/mnt/data`,
`/mnt/data-temp`, `/mnt/data/log`, with distinct placeholder Volume names.
Exit 2, empty stderr, zero HTTP requests:

```json
{"status":"error","code":"E8002","message":"Submitted mount paths must be distinct and must not overlap."}
```

No ordinary output included the placeholder API key. No local credential files
were created. The server was stopped and joined and temporary files were removed.
These are actual executable/local HTTP results; the fixture does not validate
cloud storage admission, actual mount data or network enforcement.
