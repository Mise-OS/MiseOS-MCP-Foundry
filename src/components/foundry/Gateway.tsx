import { useState } from "react";
import {
  Check,
  Download,
  Shield,
  ShieldOff,
  Stamp,
} from "lucide-react";
import {
  CAPABILITIES,
  nextActionFor,
  type Capability,
  type GateVerdict,
  type GatewayCycle,
} from "@/lib/agent/gateway";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFoundry } from "@/lib/store";
import { cn, formatClock } from "@/lib/utils";
import { toast } from "sonner";

const VERDICT_TONE: Record<GateVerdict, string> = {
  allow: "text-forest",
  hold: "text-warn",
  deny: "text-danger",
};

export function Gateway() {
  const frozen = useFoundry((s) => s.frozen);
  const toggleFrozen = useFoundry((s) => s.toggleFrozen);
  const invokeCapability = useFoundry((s) => s.invokeCapability);
  const runGatewayCycle = useFoundry((s) => s.runGatewayCycle);
  const lastVerdict = useFoundry((s) => s.lastVerdict);
  const cycles = useFoundry((s) => s.cycles);
  const [approved, setApproved] = useState(false);
  const [picked, setPicked] = useState<string>("inspect");

  const cycle = cycles[0] ?? null;
  const pickedCap = CAPABILITIES.find((c) => c.id === picked);

  function invoke(id: string) {
    setPicked(id);
    const result = invokeCapability(id, approved);
    toast(result.verdict.toUpperCase() + " · " + result.reason);
  }

  function runCycle() {
    const next = runGatewayCycle(approved);
    toast(`Cycle sealed · ${next.integrity}`);
  }

  function exportCycle() {
    if (!cycle) return;
    const blob = new Blob([JSON.stringify(cycle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gateway-cycle-${cycle.integrity}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Audit cycle exported");
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-forest">Capability gateway</p>
          <h2 className="font-display text-3xl text-cream md:text-4xl">The pass</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Agents list, then invoke. Reads run. Writes hold until a human stamps the ticket.
            Push is denied. Unknown quantities stay null.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={approved ? "forest" : "ghost"}
            size="sm"
            onClick={() => setApproved((v) => !v)}
          >
            <Stamp className="size-3.5" />
            {approved ? "Pass signed" : "Sign the pass"}
          </Button>
          <Button variant={frozen ? "danger" : "ghost"} size="sm" onClick={toggleFrozen}>
            {frozen ? <ShieldOff className="size-3.5" /> : <Shield className="size-3.5" />}
            {frozen ? "Frozen" : "Kill switch"}
          </Button>
        </div>
      </div>

      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {CAPABILITIES.map((cap) => (
          <CapabilityCard
            key={cap.id}
            cap={cap}
            active={picked === cap.id}
            verdict={lastVerdict?.capability === cap.id ? lastVerdict.verdict : cycleVerdict(cycle, cap.id)}
            onInvoke={() => invoke(cap.id)}
          />
        ))}
        <li className="h-full">
          <button
            onClick={runCycle}
            aria-label="Run audit cycle"
            className="flex h-full min-h-36 w-full flex-col justify-between rounded-lg bg-cream p-4 text-left text-obsidian transition-opacity hover:opacity-92"
          >
            <span className="font-mono text-[11px] uppercase tracking-wide">Audit</span>
            <span>
              <span className="block font-display text-2xl">Run cycle</span>
              <span className="mt-1 block text-xs opacity-70">Seal all seven verdicts.</span>
            </span>
          </button>
        </li>
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-2xl text-cream">Stamp</h3>
            {lastVerdict ? (
              <span className={cn("font-mono text-xs uppercase tracking-wide", VERDICT_TONE[lastVerdict.verdict])}>
                {lastVerdict.verdict}
              </span>
            ) : (
              <Badge>idle</Badge>
            )}
          </div>
          {lastVerdict && pickedCap ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-fg">{lastVerdict.reason}</p>
              <p className="text-sm text-muted">{nextActionFor(lastVerdict)}</p>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-subtle">Authority</dt>
                  <dd className="mt-1 font-mono text-cream">{lastVerdict.authority}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Evidence</dt>
                  <dd className="mt-1 font-mono text-cream">{lastVerdict.evidenceTier}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Decision</dt>
                  <dd className="mt-1 font-mono text-cream">{lastVerdict.decision}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Auto-push</dt>
                  <dd className="mt-1 font-mono text-cream">off</dd>
                </div>
              </dl>
              <p className="font-mono text-[11px] text-subtle">
                Bound · {pickedCap.tools.join(" · ")}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">Tap a capability. The gateway stamps allow, hold, or deny.</p>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
            <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-forest">Levels</p>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              <li className="flex justify-between gap-3">
                <span className="text-muted">Read</span>
                <span className="text-cream">automatic</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-muted">Write unsigned</span>
                <span className="text-warn">hold</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-muted">Write signed</span>
                <span className="text-forest">allow</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-muted">Push</span>
                <span className="text-danger">deny</span>
              </li>
            </ul>
          </div>
          {cycle ? (
            <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-forest">Last cycle</p>
                <Button variant="quiet" size="sm" onClick={exportCycle}>
                  <Download className="size-3.5" />
                  Export
                </Button>
              </div>
              <p className="mt-2 font-mono text-xs text-cream">{cycle.integrity}</p>
              <p className="mt-2 text-sm text-fg">{cycle.next_action}</p>
              <p className="mt-2 text-xs text-muted">
                {cycle.capabilities_selected.length} allow · {cycle.capabilities_held.length} hold ·{" "}
                {cycle.capabilities_rejected.length} deny
              </p>
            </div>
          ) : null}
        </aside>
      </div>

      {cycle ? <CycleLog cycle={cycle} /> : null}
    </div>
  );
}

function cycleVerdict(cycle: GatewayCycle | null, id: string): GateVerdict | null {
  const row = cycle?.capabilities_evaluated.find((e) => e.id === id);
  return row?.verdict ?? null;
}

function CapabilityCard({
  cap,
  active,
  verdict,
  onInvoke,
}: {
  cap: Capability;
  active: boolean;
  verdict: GateVerdict | null;
  onInvoke: () => void;
}) {
  return (
    <li>
      <button
        onClick={onInvoke}
        aria-label={`${cap.title}, ${cap.risk} risk`}
        className={cn(
          "flex h-full min-h-36 w-full flex-col justify-between rounded-lg p-4 text-left transition-colors duration-150",
          active ? "bg-elevated text-cream" : "bg-surface text-fg shadow-[var(--shadow-border)] hover:shadow-[var(--shadow-border-hover)]",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">{cap.risk}</span>
          {verdict ? (
            <span className={cn("font-mono text-[11px] uppercase", VERDICT_TONE[verdict])}>{verdict}</span>
          ) : (
            <span className="font-mono text-[11px] text-subtle">{cap.evidenceTier}</span>
          )}
        </div>
        <div>
          <p className="font-display text-xl text-cream">{cap.title}</p>
          <p className="mt-1 text-xs text-muted">{cap.description}</p>
        </div>
      </button>
    </li>
  );
}

function CycleLog({ cycle }: { cycle: GatewayCycle }) {
  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h3 className="font-display text-2xl text-cream">Claims</h3>
        <ul className="mt-4 flex flex-col gap-3">
          {cycle.topology_claims.concat(cycle.causal_claims).map((c) => (
            <li key={c.claim} className="flex gap-3 text-sm">
              <Check className={cn("mt-0.5 size-3.5 shrink-0", c.status === "active" ? "text-forest" : "text-subtle")} />
              <span>
                <span className="text-fg">{c.claim}</span>
                <span className="mt-0.5 block font-mono text-[11px] text-subtle">
                  {c.evidence_tier} · {c.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h3 className="font-display text-2xl text-cream">Events</h3>
        <ol className="mt-4 flex max-h-80 flex-col gap-3 overflow-y-auto">
          {cycle.audit_events.map((ev, i) => (
            <li key={`${ev.timestamp}-${i}`} className="grid grid-cols-[16px_1fr] gap-3">
              <span className="relative flex justify-center">
                <span className="absolute inset-y-0 w-px bg-line" />
                <span className="relative mt-1 size-2 rounded-full bg-forest" />
              </span>
              <div>
                <p className="font-mono text-[11px] text-forest">{ev.event_type.replaceAll("_", " ")}</p>
                <p className="text-xs text-muted">{formatClock(Date.parse(ev.timestamp) || Date.now())}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-subtle">
          Retention · {cycle.data_retention_actions.map((a) => a.action).join(" · ")}
        </p>
      </div>
    </section>
  );
}
