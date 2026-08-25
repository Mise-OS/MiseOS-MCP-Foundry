export type CapabilityRisk = "low" | "medium" | "high" | "critical";
export type EvidenceTier = "E1" | "E2" | "E3";
export type Authority = "read" | "pending" | "write";
export type GateVerdict = "allow" | "deny" | "hold";
export type Decision = "accept" | "reject" | "defer";
export type ClaimStatus = "active" | "quarantined" | "rejected";
export type RetentionKind = "retain" | "compress" | "hash_only" | "delete";

export type EventKind =
  | "cycle_start"
  | "capability_listed"
  | "capability_evaluated"
  | "capability_selected"
  | "capability_held"
  | "capability_denied"
  | "execution_started"
  | "execution_completed"
  | "balance_reconciled"
  | "kill_switch"
  | "post_exhaustion_mode"
  | "data_retention_action"
  | "evidence_sealed"
  | "error";

export interface Capability {
  id: string;
  title: string;
  description: string;
  risk: CapabilityRisk;
  writes: boolean;
  humanConfirmation: boolean;
  authority: Authority;
  evidenceTier: EvidenceTier;
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
    authority: "read",
    evidenceTier: "E1",
    tools: ["repo_ingest", "repo_tree", "repo_contents"],
  },
  {
    id: "plan",
    title: "Plan",
    description: "Turn an intent plus the index into a gated plan.",
    risk: "medium",
    writes: false,
    humanConfirmation: false,
    authority: "read",
    evidenceTier: "E1",
    tools: ["agent_plan"],
  },
  {
    id: "execute",
    title: "Execute",
    description: "Apply an approved plan. Never writes without a human.",
    risk: "high",
    writes: true,
    humanConfirmation: true,
    authority: "write",
    evidenceTier: "E1",
    tools: ["agent_execute"],
  },
  {
    id: "pr",
    title: "Open PR",
    description: "Open a pull request from an approved draft. Auto-push is off.",
    risk: "high",
    writes: true,
    humanConfirmation: true,
    authority: "write",
    evidenceTier: "E1",
    tools: ["github_create_pr"],
  },
  {
    id: "guard",
    title: "Guard",
    description: "Perimeter scan. Blocks unapproved pushes and secret leaks.",
    risk: "medium",
    writes: false,
    humanConfirmation: false,
    authority: "read",
    evidenceTier: "E1",
    tools: ["guard_repo", "kill_switch"],
  },
  {
    id: "push",
    title: "Push",
    description: "Push an approved branch. Denied in v1 — auto-push is off.",
    risk: "critical",
    writes: true,
    humanConfirmation: true,
    authority: "write",
    evidenceTier: "E1",
    tools: ["github_create_pr"],
  },
  {
    id: "release",
    title: "Release",
    description: "Start a release after gates pass. Always human-confirmed.",
    risk: "critical",
    writes: true,
    humanConfirmation: true,
    authority: "write",
    evidenceTier: "E2",
    tools: ["policy_evaluate", "kill_switch"],
  },
];

export interface GateResult {
  capability: string;
  verdict: GateVerdict;
  decision: Decision;
  reason: string;
  writes: boolean;
  authority: Authority;
  evidenceTier: EvidenceTier;
  autoPush: false;
}

export interface TopologyClaim {
  claim: string;
  evidence_tier: EvidenceTier;
  status: ClaimStatus;
}

export interface CausalClaim {
  claim: string;
  evidence_tier: EvidenceTier;
  status: ClaimStatus;
}

export interface AuditEvent {
  timestamp: string;
  event_type: EventKind;
  details: Record<string, unknown>;
}

export interface DataRetentionAction {
  action: RetentionKind;
  artifact_type: string;
  reason: string;
}

export interface CapabilityEval {
  id: string;
  name: string;
  evidence_tier: EvidenceTier;
  expected_return: null;
  downside: string | null;
  probability_ruin: null;
  capital_required: null;
  decision: Decision;
  verdict: GateVerdict;
  reason: string;
}

export interface GatewayCycle {
  schema: "miseos.capability-gateway.cycle.v1";
  frozen: boolean;
  approved: boolean;
  autoPush: false;
  capabilities_evaluated: CapabilityEval[];
  capabilities_rejected: string[];
  capabilities_selected: string[];
  capabilities_held: string[];
  writes_at_risk: number;
  evidence_tiers: Record<EvidenceTier, string[]>;
  topology_claims: TopologyClaim[];
  causal_claims: CausalClaim[];
  audit_events: AuditEvent[];
  data_retention_actions: DataRetentionAction[];
  next_action: string | null;
  integrity: string | null;
}

const TOPOLOGY: TopologyClaim[] = [
  { claim: "Default branch is never the write target.", evidence_tier: "E1", status: "active" },
  { claim: "Workflow files are never auto-merged.", evidence_tier: "E1", status: "active" },
  { claim: "Auto-push is off in v1.", evidence_tier: "E1", status: "active" },
  { claim: "Model-invented SHAs and file contents are untrusted.", evidence_tier: "E1", status: "quarantined" },
];

function nowIso() {
  return new Date().toISOString();
}

function event(type: EventKind, details: Record<string, unknown> = {}): AuditEvent {
  return { timestamp: nowIso(), event_type: type, details };
}

export function gateCapability(
  id: string,
  opts: { frozen: boolean; approved: boolean },
): GateResult {
  const cap = CAPABILITIES.find((c) => c.id === id);
  if (!cap) {
    return {
      capability: id,
      verdict: "deny",
      decision: "reject",
      reason: "Unknown capability. Do not invent a bypass.",
      writes: false,
      authority: "read",
      evidenceTier: "E3",
      autoPush: false,
    };
  }
  if (opts.frozen) {
    return {
      capability: id,
      verdict: "deny",
      decision: "reject",
      reason: "Kill switch is on. Research-only — no deployment.",
      writes: cap.writes,
      authority: cap.authority,
      evidenceTier: cap.evidenceTier,
      autoPush: false,
    };
  }
  if (cap.id === "push") {
    return {
      capability: id,
      verdict: "deny",
      decision: "reject",
      reason: "Auto-push is off in v1. Open a PR draft instead.",
      writes: true,
      authority: "write",
      evidenceTier: "E1",
      autoPush: false,
    };
  }
  if (cap.writes && !opts.approved) {
    return {
      capability: id,
      verdict: "hold",
      decision: "defer",
      reason: "Awaiting a human on the pass. Plan → approve → execute.",
      writes: true,
      authority: "pending",
      evidenceTier: cap.evidenceTier,
      autoPush: false,
    };
  }
  return {
    capability: id,
    verdict: "allow",
    decision: "accept",
    reason: cap.writes ? "Human signed the pass. Bound tools may run." : "Read path allowed.",
    writes: cap.writes,
    authority: cap.writes ? "write" : "read",
    evidenceTier: cap.evidenceTier,
    autoPush: false,
  };
}

function integrityOf(cycle: Omit<GatewayCycle, "integrity">): string {
  const raw = JSON.stringify({
    frozen: cycle.frozen,
    approved: cycle.approved,
    selected: cycle.capabilities_selected,
    held: cycle.capabilities_held,
    rejected: cycle.capabilities_rejected,
    next: cycle.next_action,
  });
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function runGatewayCycle(opts: { frozen: boolean; approved: boolean }): GatewayCycle {
  const events: AuditEvent[] = [
    event("cycle_start", { frozen: opts.frozen, approved: opts.approved, autoPush: false }),
    event("capability_listed", { ids: CAPABILITIES.map((c) => c.id) }),
  ];

  if (opts.frozen) {
    events.push(
      event("kill_switch", { reason: "Line is frozen." }),
      event("post_exhaustion_mode", { reason: "No capital — here, no writes — until the kill switch lifts." }),
    );
  }

  const evaluated: CapabilityEval[] = [];
  const rejected: string[] = [];
  const selected: string[] = [];
  const held: string[] = [];
  const tiers: Record<EvidenceTier, string[]> = { E1: [], E2: [], E3: [] };

  for (const cap of CAPABILITIES) {
    const gate = gateCapability(cap.id, opts);
    const evalRow: CapabilityEval = {
      id: cap.id,
      name: cap.title,
      evidence_tier: gate.evidenceTier,
      expected_return: null,
      downside: gate.verdict === "allow" ? null : gate.reason,
      probability_ruin: null,
      capital_required: null,
      decision: gate.decision,
      verdict: gate.verdict,
      reason: gate.reason,
    };
    evaluated.push(evalRow);
    tiers[gate.evidenceTier].push(cap.id);
    events.push(
      event("capability_evaluated", {
        id: cap.id,
        verdict: gate.verdict,
        decision: gate.decision,
        evidence_tier: gate.evidenceTier,
      }),
    );
    if (gate.verdict === "deny") {
      rejected.push(cap.id);
      events.push(event("capability_denied", { id: cap.id, reason: gate.reason }));
    } else if (gate.verdict === "hold") {
      held.push(cap.id);
      events.push(event("capability_held", { id: cap.id, reason: gate.reason }));
    } else {
      selected.push(cap.id);
      events.push(event("capability_selected", { id: cap.id, tools: cap.tools }));
    }
  }

  const writesAtRisk = evaluated.filter((e) => e.verdict === "allow" && CAPABILITIES.find((c) => c.id === e.id)?.writes).length;

  const causal: CausalClaim[] = [
    {
      claim: "Unknown numbers stay null. The gateway does not invent returns, ruin, or balances.",
      evidence_tier: "E1",
      status: "active",
    },
    {
      claim: "Write capabilities without approved=true return hold, never a silent write.",
      evidence_tier: "E1",
      status: "active",
    },
    {
      claim: "push is denied in v1 regardless of approval.",
      evidence_tier: "E1",
      status: "active",
    },
    {
      claim: opts.frozen
        ? "Kill switch collapsed every capability to deny."
        : "Kill switch is off. Read paths may run.",
      evidence_tier: "E1",
      status: opts.frozen ? "active" : "rejected",
    },
  ];

  const retention: DataRetentionAction[] = [
    {
      action: "hash_only",
      artifact_type: "intermediate_strategy_scores",
      reason: "Keep an integrity hash, not scoring matrices.",
    },
    {
      action: "delete",
      artifact_type: "raw_opportunity_snapshots",
      reason: "Repo trees can be re-fetched. Do not retain raw snapshots.",
    },
    {
      action: "retain",
      artifact_type: "audit_events",
      reason: "The cycle is the system of record.",
    },
  ];
  events.push(event("data_retention_action", { actions: retention.map((r) => r.action) }));
  events.push(event("evidence_sealed", { writes_at_risk: writesAtRisk }));

  let next: string;
  if (opts.frozen) {
    next = "Lift the kill switch, then inspect. No writes while frozen.";
  } else if (held.length) {
    next = "Surface the plan. Wait for a human on the pass. Do not retry around the gate.";
  } else if (selected.includes("pr")) {
    next = "Open the PR draft. Do not push. Seal evidence.";
  } else {
    next = "Inspect or plan. Writes stay behind approval.";
  }

  const draft: Omit<GatewayCycle, "integrity"> = {
    schema: "miseos.capability-gateway.cycle.v1",
    frozen: opts.frozen,
    approved: opts.approved,
    autoPush: false,
    capabilities_evaluated: evaluated,
    capabilities_rejected: rejected,
    capabilities_selected: selected,
    capabilities_held: held,
    writes_at_risk: writesAtRisk,
    evidence_tiers: tiers,
    topology_claims: TOPOLOGY,
    causal_claims: causal,
    audit_events: events,
    data_retention_actions: retention,
    next_action: next,
  };

  return { ...draft, integrity: integrityOf(draft) };
}

export function nextActionFor(result: GateResult): string {
  if (result.verdict === "deny" && result.capability === "push") {
    return "Open a PR draft instead. Push stays denied.";
  }
  if (result.verdict === "deny") return "Stop. Do not retry around the gate.";
  if (result.verdict === "hold") return "Surface the plan. Wait for a human.";
  if (result.writes) return "Call the bound tools. Seal evidence. Never auto-push.";
  return "Read path. Bound inspect tools may run.";
}
