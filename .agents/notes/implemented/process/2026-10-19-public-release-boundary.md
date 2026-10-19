# Decision: State the public CLI release boundary

Status: implemented

## Problem

Current source and built candidates differ from the public v0.3.0 tag, npm is unpublished, and README registry.com links do not reach the maintained canonical registry. CI green alone does not establish public distribution or template certification.

## Decision

Correct EN/ZH site links and describe the existing-tag/current-main distinction, next-release version/artifact gate, and separate experimental template/provider boundaries. Do not create a tag or publish a package during this review.

## API Design

Documentation only; commands and package version remain unchanged.

## Alternatives considered

Reusing v0.3.0 for different current code would hide the compatibility boundary. Treating a package name as publication would preserve a failing install route.

## Dependencies

Actual public npm metadata, GitHub tag/release metadata and canonical website/registry readback. Source acceptance belongs to each template/provider repository.

## Test Strategy

Build/pack/install the current locked npm artifact in a fresh consumer, execute SEA and installed CLI against real Express locally, check full notice output and help, run documentation/health/hygiene and current-head CI.

## Acceptance criteria

Both languages match verified publication state and reachable canonical sites; the reviewed docs pass checks and latest-head CI. No npm publish, release tag, secret upload or model/cloud Actions.

## Implementation

Release-boundary documentation landed in https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/64 . A subsequent active-guide sweep corrects the remaining canonical website/registry links; historical archive/design evidence remains unchanged. Public package release remains separate and unperformed.
