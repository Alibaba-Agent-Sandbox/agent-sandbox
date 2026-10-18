# Verification: production source-wheel image on Express

- Date: 2026-10-16
- Result: PARTIAL. The production image build and its resulting cloud runtime
  passed; the required complete Docker deploy wrapper remains unrun. Keep the PR
  draft until the canonical deploy run closes that gate.
- Tested product head: `37b6d276bdca875811ce7fb0ae88aca64882fcaa`.
- PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/37
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/36
- Image workflow: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/38853114487

## Actual production build

The completed GitHub Docker workflow called the production
`DockerBuilder.injectSdkWheel` and `DockerBuilder.build`. Both the original
conditional Python hello Dockerfile and a continued direct pip instruction built
and executed successfully as their non-root image user with networking disabled.
All 56 installed server Python modules matched the pinned SDK source bytes. The
continued instruction retained its extra dependency and following shell command.
All seven ordinary/image checks succeeded on the tested head.

The already built conditional image was exported; this cloud run did not rebuild
or substitute it. Artifact `12025742972` has archive SHA256
`38f267427e2f0c5997829a37ab34653aef6b284b6c15d4c93d638e62111b3a6d`.
Its checkout `245f94ec89954b908bd42c7fa429bdd29b3370e7` has the reviewed product
commit as a direct merge parent. The installed server source is
`e2cb27e24fde0a67112f82b8d44af463445a5d1a`, and the original template source is
`7cb0d9430768eec22f500ebb80b3fe9517ab1cbc`.

## Actual cloud results

A task-owned Express transfer sandbox received only the official Crane binary,
a temporary ACR credential and one signed artifact URL. It verified the complete
archive SHA256 again and pushed those exact image bytes. No GitHub token, Alibaba
AK/SK or model key was uploaded to that helper. The registry digest was
`sha256:afa4b1e6c35609f769ea4542c5dc2c94270e106c40aed3aa72e78a27fec87627`.

The official API registered a unique generation-2 template from that image and
reported READY. A newly created sandbox passed:

- Both YAML smoke commands through the Python SDK, HTTP POST and the built CLI:
  six successful calls with exact expected results.
- All 56 installed server modules compared byte for byte with the pinned source.
- The complete Python hello external HTTP suite: 21 PASS, zero FAIL, zero SKIP.

The HTTP-only controller forwarded the platform's proxy and trusted CA settings;
model and cloud credential variables were excluded. Models were disabled. The
command caller used the independently built CLI at `c269603`, CLI entry-file SHA256
`0c22eb3a8d2a149423fb88c1525cdb4a9a4e810b96bb82e6d161f5a65fa7e6e9`;
the image builder under test was the reviewed `37b6d27` production build above.

## Failures preserved and corrected

The first two cloud attempts each passed the six SDK/HTTP/CLI calls, but their
independent HTTP subprocess failed health preflight. The first omitted proxy
settings; preserving the proxy alone still omitted the platform TLS trust store.
A separate network negative control returned TLS verification failure without
the CA setting and the expected HTTP response with it. Those failed attempt
reports remain separate from the final successful run; they were not rewritten.
The final run reused the same immutable artifact SHA, verified it again and
completed all 21 HTTP checks with the corrected controller.

Earlier local full-CI failures remain documented in the original evidence:
37 failure identities were reproduced on the unchanged baseline, with no new
failure identity. The ordinary remote Node 20/22 tests, build, types, links and
installer checks passed. A generated, ignored local parity report briefly caused
one health failure; removing only that owned completed test output restored
repository health to 105 PASS, 11 historical-context WARN, zero FAIL.

## Cleanup

Both owned sandboxes were killed and confirmed absent by SDK list readback. The
official template deletion completed; a separate exact-name official list query
confirmed it absent. Official ACR DeleteImage/DeleteRepo operations removed the
owned tag and repository, each confirmed by HTTP 404 readback. No unrelated
sandbox, template or registry repository was deleted. No credentials, signed URLs,
private cloud identifiers or raw provider logs are included in this record.

## Boundaries

This verifies the changed production DockerBuilder and its real resulting cloud
image. The Docker-less local host did not run the entire `abx template deploy`
wrapper. In awesome-templates, formal provider evidence still requires its
canonical `scripts/express_e2e.py` to complete successfully; this result does not
fill that repository's `tested_on`, promote a template or claim model acceptance.
