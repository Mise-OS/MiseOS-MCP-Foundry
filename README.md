# MiseOS MCP Foundry

A kitchen control plane for composing micro-agents, binding MCP tools, and running a **gated copilot** over GitHub repos.

Ingest → Index → Reason → Plan → **Approve** → Execute → Verify → Notify

Auto-push is off in v1. Writes never land on the default branch without a human.

## Repo Steward

Open **Steward** on the line. Shield Pup holds the perimeter.

1. Ingest a public GitHub repo (`owner/repo` or URL). High-signal files are selected, chunked, and cached.
2. Run an intent: **Generate PR**, **Fix bug automatically**, **Refactor file**, or **Explain commit**.
3. The planner returns a structured plan (`plan`, `actions`, `codeChanges`).
4. If the plan writes, the task stops on **Awaiting approval**.
5. Approve to execute. The executor drafts a patch and a PR.
6. Review the draft, download a `.patch`, or open on GitHub when a token is present.

Kill switch freezes execute and GitHub writes. Auto-push is off.

## Registry Atrium

Open **Registry**. A 3D hall of Season 1 plates with Ultra Mythic pedestals — Shield Pup, Release Sentinel, and the Agent SDK.

- Drag to orbit, scroll or pinch to zoom
- Click a plate to inspect its registry record
- Department filters
- `R` toggles the roster
- `Escape` closes the panel
- **Hall** lists pets, extras, and mythics
- **Packages** is the SDK / container catalog

## Capability gateway

Repo-management tools go through **Capability Gateway**. Agents list, then invoke. Writes `hold` until a human approves. `push` is denied in v1.

Install the plugin from `plugin/` (Claude Code plugin layout):

- `plugin/skills/capability-gateway/SKILL.md`
- `plugin/skills/repo-steward/SKILL.md`
- `plugin/.mcp.json` + `plugin/mcp/gateway.mjs`

## Architecture

```
src/lib/agent/
  types.ts              shared contracts
  select.ts             high-signal file picker
  chunk.ts              chunk cache + retrieval
  guardrails.ts         approval + freeze gates
  pipeline.server.ts    ingest, plan, execute, PR write, webhooks
  actions.ts            TanStack server functions
src/lib/steward.ts      client orchestrator
src/data/exhibits.ts    atrium + hall catalog
src/components/foundry/
  Steward.tsx           insights + Shield Pup perimeter
  TaskCenter.tsx        plan + approval
  PrDrafts.tsx          PR viewer
  Registry.tsx          atrium, hall, packages
  AtriumScene.tsx       three.js exhibition
```

Planner and executor call xAI `grok-4.5` with JSON object output when the key is present, and fall back to a deterministic steward plan so the loop still closes.

GitHub writes use the Contents + Pulls API. Without `GITHUB_TOKEN` the draft stays local. `AUTO_PUSH` is hardcoded `false`.

## MCP tools

| Tool | Role |
|---|---|
| `repo_ingest` | Parse repo, keep high-signal files, build index |
| `agent_plan` | Structured plan from intent + index |
| `agent_execute` | Run an approved plan |
| `github_create_pr` | Open PR from an approved draft |
| `guard_repo` | Shield Pup perimeter scan |
| `kill_switch` | Freeze the line |

## Safety

- No write before `userApproved`
- Workflow files are never auto-merged
- Default branch is never pushed to
- Evidence seals after every run
- Shield Pup bark is the first deny

## License

See [LICENSE](LICENSE).
