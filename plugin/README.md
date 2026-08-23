# MiseOS MCP Foundry plugin

Claude Code / MCP plugin for gated GitHub repo management.

## Install

Copy `plugin/` into a Claude Code plugins directory, or clone this repository and point the host at `plugin/`.

## Skills

- **capability-gateway** — allow / hold / deny for inspect, plan, execute, PR, guard, push, release
- **repo-steward** — ingest → plan → approve → execute. Auto-push is off.

## MCP

`plugin/mcp/gateway.mjs` speaks JSON-RPC on stdin/stdout.

Tools:

- `capability_list`
- `capability_invoke`

The kitchen Foundry app hosts the live tools (`repo_ingest`, `agent_plan`, `github_create_pr`, `guard_repo`).
