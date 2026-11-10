# Application ecosystem and delivery product plan

Date: 2026-11-10. Status: product proposal; individual implementation and delivery
claims require their owning repository's evidence. This records the user's
November 9 product direction and subsequent clarifications. It is an independent
product plan, separate from the earlier console template-marketplace plan.

## Product purpose

Make Agent Sandbox easier to use and integrate into real business, increase
sustained adoption and support commercialization. The developer-toolchain and
application-building responsibilities are recorded here because the CLI owns
that part of delivery; other repositories retain their own implementation records.

| Component | Planned responsibility |
| --- | --- |
| Open source project | Developer tools, source, business templates, Registry, community adoption and contributions |
| Compute Nest | Application management and online deployment execution, connecting the ecosystem with Alibaba Cloud |
| FC and SAE | Serving for business APIs, ingress, scheduling and applicable application components |
| Agent Sandbox | Isolated execution of code, tools and business tasks |

FC, SAE and Agent Sandbox can each provide an application entry. Their cooperation
serves Sandbox adoption and sales. Business scope can expand to AI applications
beyond Agents when the Sandbox value is concrete. Expected business benefits are
planning hypotheses, not measured conversion or performance results.

## Three construction directions

1. Ship immediately useful business templates, with Agents API as an initial
   example: necessary configuration, a real business endpoint, coherent API
   semantics and runnable examples.
2. Support meaningful customization: parameters, prompts, code, tools, data
   connections and execution logic, followed by reproducible build, publication
   and update of the user's existing application.
3. Provide simple application lifecycle management around templates, applications
   and CI/CD: create, use, customize, publish, operate and clean up.

A valuable business template includes its business interface, implementation,
configuration, extension points, build/deployment description and actual examples.
Preinstalling a coding executable and exposing arbitrary command execution alone
does not meet this goal. Business APIs should expose task/session status, progress,
results, artifacts and applicable cancellation/error semantics. API availability
alone establishes no performance improvement.

## Core product objects and journey

A template is a reusable definition. An application has its own configuration,
source/version references, published endpoint, delivery records and managed
resources. Multiple deployments can be separate applications.

The primary journey is discover a useful template, supply necessary configuration,
create an application, perform a real task through its API or UI, customize when
needed, then publish an update to that application and continue using it. Selected
business templates should support initial use before the user creates a source
repository. Local development and configuration editing remain valid paths.

CI/CD has two planned paths: system-provided pipelines such as Yunxiao, and binding
an application's existing Jenkins or GitLab CI/CD pipeline. Both feed application
delivery and retain coherent release records. Binding these tools is a design
requirement, not an assertion that integrations have shipped.

Optional online AI Coding may edit application source inside a temporary Sandbox,
run checks and show the proposed diff. The user reviews changes before the same
CI/CD path publishes them. It is a proposed customization entry and not an already
available platform feature.

## Template author and application management

Authors define a real task, input/output/API contract, configurable values,
extension points and deployment/resource requirements. Configuration documentation
explains which changes apply per request, which update application configuration,
and which require a build and release. Authors can publish reusable versions;
application users choose whether to adopt upstream changes while preserving their
own modifications. Private customization and optional community contribution are
both valid outcomes.

Application management presents configuration, source/version, releases, endpoint,
health, logs and applicable task/resource state. Serving, Sandbox and persistent
resources must have clear ownership and cleanup behavior. A release needs explicit
handling of existing sessions and data; a service endpoint alone does not prove
that update, recovery or deletion is complete.

## Evolution and evidence boundary

Start with a complete Agents API business journey, then improve editable template
creation/build/publication and application update. Add simple application-level
CI/CD and management, and evaluate online AI Coding and more business templates
when those core journeys work.

[The earlier managed Agents delivery](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/296)
provides a concrete starting point. The
[unified CLI candidate](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/247)
is a separate source implementation with remaining acceptance gates. Neither
proves the complete Compute Nest/FC/SAE product experience described here.

This archive condenses the workspace's application delivery plan, lifecycle design
and user journeys. It does not repeat dated competitor research as a fresh audit,
assign personnel, approve an unimplemented engine or claim a release.
