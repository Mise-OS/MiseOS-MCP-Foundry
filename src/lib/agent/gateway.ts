export type CapabilityRisk = "low" | "medium" | "high" | "critical";

export interface Capability {
  id: string;
  title: string;
  description: string;
  risk: CapabilityRisk;
  writes: boolean;
  humanConfirmation: boolean;
  tools: string[];
}

export const CAPABILITIES: Capability[] = [
  {
    id: "inspect",
    title: "Inspect",
    description: "Read repo tree, file contents, commits, and status.",
    risk: "low",
    writes: false,
    humanConfirmation: false,
    tools: ["repo_ingest", "repo_tree", "repo_contents"],
  },
  {
    id: "plan",
    title: "Plan",
    description: "Turn an intent plus the index into a gated plan.",
    risk: "medium",
    writes: false,
    humanConfirmation: false,
    tools: ["agent_plan"],
  },
  {
    id: "execute",
    title: "Execute",
    description: "Apply an approved plan. Never writes without a human.",
    risk: "high",
    writes: true,
    humanConfirmation: true,
    tools: ["agent_execute"],
  },
  {
    id: "pr",
    title: "Open PR",
    description: "Open a pull request from an approved draft. Auto-push is off.",
    risk: "high",
    writes: true,
    humanConfirmation: true,
    tools: ["github_create_pr"],
  },
  {
    id: "guard",
    title: "Guard",
    description: "Perimeter scan. Blocks unapproved pushes and secret leaks.",
    risk: "medium",
    writes: false,
    humanConfirmation: false,
    tools: ["guard_repo", "kill_switch"],
  },
  {
    id: "push",
    title: "Push",
    description: "Push an approved branch. Denied in v1 — auto-push is off.",
    risk: "critical",
    writes: true,
    humanConfirmation: true,
    tools: ["github_create_pr"],
  },
  {
    id: "release",
    title: "Release",
    description: "Start a release after gates pass. Always human-confirmed.",
    risk: "critical",
    writes: true,
    humanConfirmation: true,
    tools: ["policy_evaluate", "kill_switch"],
  },
];

export type GateVerdict = "allow" | "deny" | "hold";

export interface GateResult {
  capability: string;
  verdict: GateVerdict;
  reason: string;
  writes: boolean;
  autoPush: false;
}

export function gateCapability(
  id: string,
  opts: { frozen: boolean; approved: boolean },
): GateResult {
  const cap = CAPABILITIES.find((c) => c.id === id);
  if (!cap) {
    return { capability: id, verdict: "deny", reason: "Unknown capability.", writes: false, autoPush: false };
  }
  if (opts.frozen) {
    return { capability: id, verdict: "deny", reason: "Kill switch is on.", writes: cap.writes, autoPush: false };
  }
  if (cap.id === "push") {
    return {
      capability: id,
      verdict: "deny",
      reason: "Auto-push is off in v1. Open a PR draft instead.",
      writes: true,
      autoPush: false,
    };
  }
  if (cap.writes && !opts.approved) {
    return {
      capability: id,
      verdict: "hold",
      reason: "Awaiting approval. Plan → approve → execute.",
      writes: true,
      autoPush: false,
    };
  }
  return {
    capability: id,
    verdict: "allow",
    reason: cap.humanConfirmation && !opts.approved ? "Read path allowed." : "Capability allowed.",
    writes: cap.writes,
    autoPush: false,
  };
}
