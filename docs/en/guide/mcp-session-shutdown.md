# MCP requests that finish during session shutdown

An MCP session may end while the backend is still creating a sandbox or connecting a client.
The manager coordinates shutdown and handle registration atomically. A late create is cancelled
and its newly created sandbox is deleted. A late connection to an explicit existing sandbox is
cancelled and only its client handle is closed; the existing sandbox remains available.

This cleanup follows the request's ownership. Explicitly addressing an existing sandbox does not
transfer its deletion ownership to this session. An explicit authorized `kill_sandbox` request
retains its separate meaning. Accepted background-task retention also retains its existing scope.

After a disconnected creation with an uncertain backend outcome, inspect the actual returned ID
or the task's resource inventory before repeating a mutation. A request cancellation and a cleanup
failure are separate results; the platform lifetime remains the final bound if deletion fails.

Maintainers can exercise the real handle path with:

```bash
npm run build
node e2e/skill-mcp-shutdown-acceptance.mjs --output ./mcp-shutdown-new.json
```

Supply the configured sandbox runtime API key/origin through environment variables. The scenario
uses actual Express create/connect/command/kill operations. Its test hooks delay real SDK handles
and control lock scheduling to reproduce the race deterministically. It verifies new owned-resource
HTTP404, a borrowed sandbox's surviving business command and final independent deletion of both
task-owned test sandboxes. The hooks do not mock cloud responses.
