# Verification: real DockerBuilder runtime and cloud follow-up preparation

- Date: 2026-10-16
- Result: PASS for real production image construction; cloud follow-up pending.
- Tested head: `378105445b99c0b67906f151047902502df06fce`.
- [Actual workflow](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/38851404848).

## Actual results

The dedicated GitHub Docker workflow completed successfully. Its script called
the built CLI's real `DockerBuilder.injectSdkWheel` and `DockerBuilder.build` for
both the original Python hello conditional Dockerfile and a continued direct pip
instruction. No substitute materializer or fake Docker process was used.

Both images passed network-disabled container execution as their non-root user.
The installed server version and all server Python module bytes matched the fixed
public SDK source. Python hello returned the expected greeting and script result;
the continued case preserved the extra httpx pin and post-install shell marker.
The script removed its owned images and contexts. Ordinary CI and Docs links also
completed successfully at this head. These are real image/component results,
not a provider deployment claim.

## Accepted maintenance integration

The branch now includes the independently reviewed and merged repository-health
fix from [PR 39](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/39),
main `62cb6c9`. The changelog conflict preserves both fixes; two inherited current
document EOF blank lines were normalized after the staged whitespace check caught
them. No historical evidence was rewritten. Product Dockerfile rewriting is
unchanged by this synchronization.

## Prepared cloud artifact

The necessary follow-up exports only the already built conditional Python hello
image before local cleanup. A one-day artifact holds its Docker archive, SHA256,
CLI checkout, pinned SDK/template source revisions and local image ID. Upload
occurs only after the complete two-image script succeeds. No cloud, registry or
model credentials are provided to GitHub; no image is rebuilt for export.

A separate local transfer/official-registration controller will use this actual
production-generated image for SDK/CLI/HTTP cloud checks and owned cleanup. It
must actually pass before recording that cloud result. This export is PENDING at
the preparation revision, and neither this file nor an uploaded archive claims
that the full `abx template deploy` wrapper ran on the Docker-less local machine.

Preparation checks: Node syntax and scoped ESLint PASS; workflow structure parse
PASS; configured-secret and staged whitespace checks run before the scoped commit.
