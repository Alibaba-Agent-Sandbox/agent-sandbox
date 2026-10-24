# Decision: Restore built-in Express source workflows
Status: proposed

## Problem
The built-in default provider rejected all 46 source templates through the unified launcher,
although its native deployment path existed. Registry native placeholders also hid commands.

## Decision
Reuse native deployment with optional resource journals and exact TemplateID handoff.
Resolve native region/tag placeholders in the staged snapshot; retain original source bytes.
Honor explicit Dockerfile profiles. The launcher starts the application after creation rather
than also registering its startup with the platform. Preserve native step environment wrappers.
Image receipts retain the Docker-observed digest; the platform receives the unique build tag.
Live acceptance showed digest input failing with a platform image-digest mismatch.
Only the CLI declares source preparation; no new Python implementation is claimed.

## API Design
ProviderCliExtension.stageProject returns a frozen StagedProject. Native DoDeployOptions
accepts optional journal/workflow_launch for the unified launcher. The prepared result includes
owned resources and native identity. Existing native deploy behavior stays compatible.

## Alternatives considered
- Enable operation flags alone: rejected because preparation did not record resource ownership.
- Substitute a portable Dockerfile automatically: rejected because it changes author intent.

## Dependencies
Existing Express APIs, Docker/ACR and the shared resource journal. Registry consumes native
placeholder metadata through its own PR. https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/134

## Test Strategy
Unit regressions for snapshots, profiles, intent/receipt ordering, uncertain creation and
startup/environment. Real Registry source launch, API/CLI calls and owned cleanup. Full CI.

## Acceptance criteria
- Source applications pass planning and prepare through the native provider.
- Failures preserve recovery identity and clean up owned sandboxes.
- Exact build inputs and returned IDs survive the complete launch.
- Real cloud acceptance and all mandatory gates pass before merge.
