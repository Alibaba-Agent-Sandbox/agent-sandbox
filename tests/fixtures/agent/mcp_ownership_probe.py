"""Exercise the generated app with controlled Sandbox handles and no cloud calls."""

import asyncio
import json
import os
import sys
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from agent_sandbox.api.sandbox import Sandbox
from agent_sandbox.models.sandbox import SandboxStatus


class SandboxFixture:
    def __init__(self, sandbox_id: str) -> None:
        self.id = sandbox_id
        self.status = SandboxStatus.RUNNING
        self.url = "https://placeholder.invalid"
        self.deleted = 0
        self.closed = 0
        self.files = SimpleNamespace(read=self.read)

    async def read(self, path: str, *, encoding: str) -> str:
        assert path == "/tmp/fixture.txt"
        assert encoding == "utf-8"
        return self.id

    async def kill(self) -> None:
        self.deleted += 1

    async def close(self) -> None:
        self.closed += 1


async def verify() -> None:
    from app import app

    owned = SandboxFixture("fixture-owned")
    borrowed = SandboxFixture("fixture-borrowed")
    counts = {"create": 0, "connect": 0}

    async def create(**_options: object) -> SandboxFixture:
        counts["create"] += 1
        return owned

    async def connect(*, sandbox_id: str, **_options: object) -> SandboxFixture:
        assert sandbox_id == borrowed.id
        counts["connect"] += 1
        return borrowed

    transport = httpx.ASGITransport(app=app)
    auth = {"Authorization": f"Bearer {os.environ['ABX_MCP_AUTH_TOKEN']}"}
    initialize = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "mcp-ownership-verifier", "version": "1"},
        },
    }
    with patch.object(Sandbox, "create", create), patch.object(Sandbox, "connect", connect):
        async with app.router.lifespan_context(app), httpx.AsyncClient(
            transport=transport, base_url="http://placeholder.invalid", headers=auth,
        ) as client:
            first = await client.post("/mcp", json=initialize)
            second = await client.post("/mcp", json=initialize)
            first.raise_for_status()
            second.raise_for_status()
            owner_session = {"Mcp-Session-Id": first.headers["Mcp-Session-Id"]}
            borrower_session = {"Mcp-Session-Id": second.headers["Mcp-Session-Id"]}
            assert owner_session != borrower_session

            async def call(session: dict[str, str], name: str, arguments: dict) -> dict:
                response = await client.post("/mcp", headers=session, json={
                    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": {"name": name, "arguments": arguments},
                })
                response.raise_for_status()
                return response.json()["result"]

            started = await call(owner_session, "create_sandbox", {})
            assert not started.get("isError"), started
            path = {"path": "/tmp/fixture.txt"}
            result = await call(owner_session, "read_file", path)
            assert json.loads(result["content"][0]["text"]) == {"content": owned.id}
            empty = await call(borrower_session, "get_sandbox", {})
            assert empty["isError"] is True, empty
            result = await call(borrower_session, "read_file", {**path, "sandbox_id": borrowed.id})
            assert json.loads(result["content"][0]["text"]) == {"content": borrowed.id}

            closed = await client.delete("/mcp", headers=borrower_session)
            assert closed.status_code == 200
            assert borrowed.closed == 1 and borrowed.deleted == 0
            assert owned.deleted == 0
            closed = await client.delete("/mcp", headers=owner_session)
            assert closed.status_code == 200
            assert owned.deleted == 1

    assert counts == {"create": 1, "connect": 1}, counts
    print(json.dumps({"independent_defaults": True, "owned_deleted": True, "borrowed_closed_only": True}))


if __name__ == "__main__":
    sys.path.insert(0, sys.argv[1])
    asyncio.run(verify())
