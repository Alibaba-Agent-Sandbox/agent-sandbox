# MCP boundaries

MCP exposes the project's existing Sandbox operations to AI clients. It reuses Provider selection, configuration and resource lifecycle rather than defining another backend or deployment system.

The local CLI supports STDIO and HTTP through `mcp start`; `mcp install` writes client launch configuration, while `mcp status/stop` manage the recorded local process. STDIO stdout carries protocol messages only. HTTP authentication and Sandbox platform credentials serve different purposes. Help and tool discovery do not prove cloud execution support.

A deployable HTTP MCP service is an ordinary Sandbox source project produced by `template init --template mcp`, then deployed with `deploy`. Its generated service uses the Python server runtime. The local CLI service and generated HTTP service expose the tools their respective runtimes implement; clients should query the actual tool list rather than assume identical coverage. The generated service requires explicit backend configuration for the sandboxes it creates.

Creating a Sandbox, starting a task, inspecting a result and deleting resources remain distinct tool effects. Unknown remote outcomes are not retried automatically. Local cancellation does not establish remote termination. Template validation and business acceptance must inspect actual output and owned cleanup rather than just return codes.

See [MCP integration](../guide/mcp-integration.md), [the Agent Skill](../../../SKILL.md), [Provider contracts](../../../references/provider-contracts.md), and [task workflows](../../../references/task-workflows.md) for installation, authentication and operational checks.
