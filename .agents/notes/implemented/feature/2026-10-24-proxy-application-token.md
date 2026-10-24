# Decision: Keep application identity through server proxies

Status: implemented

## Problem

OpenSandbox server proxy strips Authorization. The same owned sandbox accepted direct Bearer and proxied X-Access-Token but rejected proxied Bearer in the [real probe](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/actions/runs/40109164062). Existing application clients send the explicit service token only as Bearer.

## Decision

Keep Bearer and additionally send the same explicit application token in the server's existing X-Access-Token header only when that header is unoccupied, checking names case-insensitively. Copy gateway headers for each request; never mutate the descriptor or replace gateway credentials. Retain binding checks, redirect rejection and single-request behavior.

## API Design

No new options, provider fields or authentication protocol. The existing application_token parameter and ABX_SERVER_TOKEN continue to identify the application. Only request header assembly changes. Anonymous requests remain anonymous. CLI 0.4.16 is a new immutable release.

## Alternatives considered

- Replace Bearer: breaks services accepting only that existing scheme.
- Override gateway X-Access-Token: confuses separate credential audiences.
- Retry after a 401 with another header: needlessly replays requests and changes the no-retry contract.
- Add provider-specific authentication configuration: unnecessary for existing server headers.

## Dependencies

The existing server runtime accepts both headers. Python client changes belong to [python-sdk](https://github.com/Alibaba-Agent-Sandbox/python-sdk); independent Node client changes are tracked in [nodejs-sdk Issue 11](https://github.com/Alibaba-Agent-Sandbox/nodejs-sdk/issues/11). CLI tracking: [Issue 140](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/140).

## Test Strategy

Exercise a real local HTTP service accepting only Bearer and one accepting only the header retained by the proxy, gateway case variants, unchanged caller headers, and absent tokens. Run owner CI and the actual OpenSandbox proxy consumer workflow before acceptance.

## Acceptance criteria

The selected application's request succeeds through the real proxy with the explicit token, existing Bearer-only and gateway-authenticated routes remain compatible, and cleanup is verified. No full-template runtime certification is implied.

## Evidence

[Verification](../../../evidence/verify/2026-10-24-proxy-application-token.md).
