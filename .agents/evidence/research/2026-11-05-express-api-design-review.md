# Express API completion after adversarial design review

Date: 2026-11-05. This records the implementation decision after three independent agents challenged the preceding coverage audit and exchanged counterexamples. Product implementation starts after this record; the previous review remains unchanged.

## Accepted changes

1. Fix template step loss on same-name updates. Preserve undefined versus an explicit empty array and use current generated update models. Paths that reject duplicate template names keep that behavior.
2. Use Sandbox/2026-08-20 for current native management. Preserve the published status-only Volume update as an explicit legacy branch, mutually exclusive with current storage/mount updates. Never retry one API family as another after failure. Support JuiceFS, current resource fields, Volume storage-class filtering and Quota.instanceCount. CPU/memory quota remain required; instance count supports omission, -1 removal, zero disable and positive limits.
3. Add complete structured template CRUD inputs sharing the provider's template service. Expose runtime network/log/build/storage-client settings without proliferating top-level flags or unrestricted SDK-method passthrough.
4. Add provider-owned runtime mount append and network update. Append is a non-replayed mutation; network update replaces the supplied configuration, including explicit empty clearing. Refuse unsupported or create-only update fields. Error/output redaction covers secrets contained in operation inputs as well as configuration.
5. Add explicit native create network-file input, preserving the default pinned standard CLI's PTY/lifecycle semantics. Correct qualified-reference lifecycle routing while preserving provider ownership and mismatch errors. Provide a discoverable runtime timeout operation.
6. Correct Python typed Express pause/resume through a provider-owned documented pause/connect protocol. Resume must rebind returned session credentials/URL so a previously used object remains usable. Application-client creation remains free of implicit connect/resume/TTL mutations.
7. Preserve distinct envd, public traffic and application credentials. Retain traffic tokens in memory and offer explicit attach input when GET cannot recover them; exclude them from repr, default serialization and session files. Do not return live session credentials through generic provider command outputs.
8. Add Python application commands.invoke(name, arguments, request_timeout=...) and preserve existing run keyword semantics. Add matching application HTTP command discovery/invocation to Node, within its existing package scope.
9. Add the STS security-token configuration at the Python-owned shared source; regenerate CLI/Node configuration exports. Pass the complete credential triple into native SDKs without inventing credential acquisition/refresh machinery.
10. Update bilingual usage documentation, actual command discovery/reference, changelogs and each changed repository's engineering record and verification evidence.

## Boundaries retained

- No new full Node cloud SDK or duplicate cloud mappings. Node application HTTP commands are in scope.
- No guessed AgentRun/FC domain APIs, NAT/PrivateLink/OSS infrastructure provisioner, undocumented OS/region admission, generic RPC escape hatch or automatic management-key renewal.
- API Key creation/renewal retains its independent confirmation rules. Existing configured keys may be reused; secret values are never printed or committed.
- Official contradictions in network/metrics/runtime descriptions are recorded as service-validation conditions, not solved by speculative client restrictions.
- Invalid IP policy inputs are rejected locally according to the documented IPv4/exclusivity/length rules. Do not invent an expiry-clearing mode until its actual representation is established.

## Delivery and acceptance

Implementation belongs to independent task branches and PRs in CLI, Python and Node owners. Shared contract changes land before consumers. Each behavior change needs a meaningful failing regression, then real-component acceptance for the relevant behavior, full required local/remote gates, independent review and verified merge. Missing service admission or access is reported without weakening assertions. Cloud cleanup only touches resources created by this task and is independently verified.

The preceding audit's method counts are not acceptance counts. Completion is tracked by behavior, schema/request/response preservation, public entry reachability, error/timeout behavior and owned resource cleanup.
