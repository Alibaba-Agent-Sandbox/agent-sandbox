# Decision: Align agent-sandbox installation guidance with the website CLI mirror

Status: proposed

## Problem
The website already serves verified CLI release artifacts, but active installation guidance still points users at direct GitHub downloads and describes website hosting as future work. Registry also describes a fixed older CLI version while its installer selects another release.

## Decision
Use https://www.agent-sandbox.cn/install.sh for the default macOS/Linux installation in CLI README translations, the binary guide, getting-started/MCP/workflow/troubleshooting guides, agent installation guidance and CHANGELOG. Explain the complete-release mirror, SHA-256 verification, mirror publication timing, current-version retention, explicit older-version GitHub behavior and download overrides. Keep the existing Windows PowerShell GitHub entry and documented manual mirrored binaries. Preserve intentional upstream fallback instructions and historical verification records. No executable source changes.

## API Design
N/A — this decision does not involve API changes. Documentation describes the delivered website installer and existing ABX_VERSION, ABX_INSTALL_DIR and ABX_DOWNLOAD_BASE contracts. It does not introduce a website install.ps1 endpoint.

## Alternatives considered
Leaving mixed default URLs keeps the reported GitHub download failure in common entry points. Duplicating installer logic or binary hosting in registry adds an unnecessary owner. Editing generated aggregate output would bypass upstream source ownership.

## Dependencies
Website delivery is already accepted: https://github.com/Alibaba-Agent-Sandbox/website/pull/19 and https://github.com/Alibaba-Agent-Sandbox/website/pull/20 . The mirror manifest and installer provenance are served by the website; registry has no separate CLI binary mirror.

## Test Strategy
Validate changed links, bilingual coverage, ADR structure and repository hygiene. Exercise the documented website installer in a fresh temporary directory using real public release bytes, and verify the manual macOS ARM64 download/checksum. Run mandatory repository checks and current-head CI. Build the registry from the intended CLI docs plus accepted source checkouts and inspect rendered Chinese/English help, publish and aggregate install pages; verify public pages after deployment. No unrelated cloud sandbox tests are needed for prose.

## Acceptance criteria
Every active default POSIX installation example in scope uses the official domain; GitHub appears only for deliberate fallback/manual older-release and Windows instructions. The docs match deployed mirror/version behavior, translated guidance agrees, checks pass, each owner has a reviewed PR, and registry public help/publish/aggregated binary guides contain the new entry after deployment.

## Evidence
[Verification](../../../evidence/verify/2026-10-20-website-cli-mirror-docs.md).
