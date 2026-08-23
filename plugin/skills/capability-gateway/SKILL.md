---
name: capability-gateway
description: Gate GitHub repo-management tools behind allow / hold / deny. Use when ingesting repos, planning writes, opening PRs, pushing, or releasing. Every write needs a human. Auto-push is off.
---

# Capability Gateway

Single front door for repo management. Agents do not call GitHub write tools directly. They ask the gateway.

## Capabilities

| id | risk | writes | human |
|---|---|---|---|
| `inspect` | low | no | no |
| `plan` | medium | no | no |
| `execute` | high | yes | yes |
| `pr` | high | yes | yes |
| `guard` | medium | no | no |
| `push` | critical | yes | yes — **denied in v1** |
| `release` | critical | yes | yes |

## Protocol

1. `capability_list` — what this agent may even name.
2. `capability_invoke` with `{ id, approved }`.
3. Read the verdict:
   - `allow` — call the bound MCP tools.
   - `hold` — stop. Surface the plan. Wait for a human.
   - `deny` — stop. Do not retry around the gate.

## Invariants

- Kill switch denies every capability.
- Writes without `approved=true` return `hold`, never a silent write.
- `push` is always deny in v1. Open a PR draft instead.
- Default branch is never pushed to.
- Workflow files are never auto-merged.
- Shield Pup (`guard_repo`) scans before any write-class invoke.
- Seal evidence after every invoke, including denies.

## Repo management loop

Ingest → Index → Reason → Plan → **Approve** → Execute → Verify → Notify

Do not skip Approve. Do not auto-push.

## Tools this skill may bind

- `capability_list`
- `capability_invoke`
- `repo_ingest`
- `repo_tree`
- `repo_contents`
- `agent_plan`
- `agent_execute`
- `github_create_pr`
- `guard_repo`
- `kill_switch`
