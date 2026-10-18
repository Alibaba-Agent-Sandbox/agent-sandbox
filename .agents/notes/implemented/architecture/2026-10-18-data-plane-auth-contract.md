# Decision: Separate CLI runtime API-key and control-plane AK/SK authentication
Status: implemented

## Problem

The runtime auth factory automatically selects a guessed AK/SK key exchange.
Its RPC GET/signature/parser and one-hour expiry do not match a confirmed token
service. Official CreateApiKey creates a structured credential resource instead.
Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/52.

## Decision

Retire the guessed exchange/private signing helpers. Require an explicit or
canonical sandbox API key for runtime requests, refusing AK/SK-only before I/O.
Keep official template/ACR AccessKey clients unchanged and independent. Retain
custom programmatic adapters with strict non-empty string return validation;
there is no custom CLI exchange flag. Update missing-runtime-key guidance and
both language docs plus the shipped static usage guide.

## API Design

Factory options and their names remain accepted for source compatibility; only
API Key selects default runtime authentication. InvalidAPIKeyError E1001 now
explains the AK/SK-only migration. Deep imports of removed private helpers need
their own documented custom service. No CLI command is renamed or removed.

## Alternatives considered

- Automatically call official CreateApiKey: creates credentials without a
  documented STS-style refresh/lifecycle contract, so not an automatic fallback.
- Keep the unconfirmed experimental default: still selects invalid behavior.
- Remove explicit custom adapter: breaks legitimate caller-owned integrations.

## Dependencies

Shared SDK authentication owner:
https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/55.
The locked official @alicloud/fcsandbox20260509 1.5.1 CreateApiKey call was
inspected without calling the cloud: POST /pop/2026-05-09/api-keys, ROA/AK,
structured apiKey.apiKeyValue. It exists; no key resource was minted.
Registry/website aggregate the changed source guides; no catalog feature is added.

## Test Strategy

Unit refusal/token-shape/caching regressions, full type/lint/test/build, actual
built CLI configured sandbox calls, missing-key refusal and independent official
control-plane reads. Preserve golden captures; record affected CLI evidence.

## Acceptance criteria

- No guessed exchange or implicit key creation remains in the default runtime.
- API-key priority, provider scoping and official template/ACR behavior remain.
- Invalid callback values cannot become a stringified bearer token.
- Required checks, bilingual docs/changelog/records and component acceptance pass.
