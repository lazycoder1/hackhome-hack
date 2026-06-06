import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { timeAgo, statusValidationTone } from "../lifecycle";
import type { ActivityEvent, PocStatusDetail } from "../types";
import { Banner, EmptyState, Section, Spinner } from "./ui";

type KindMeta = { label: string; color: string; icon: string };

const KIND_META: Record<ActivityEvent["kind"], KindMeta> = {
  monitor_tick: { label: "Monitored", color: "var(--color-sky)", icon: "◎" },
  classification: { label: "Classified", color: "var(--color-sky)", icon: "❖" },
  action_proposed: { label: "Proposed", color: "var(--color-gold)", icon: "•" },
  action_gated: { label: "Awaiting approval", color: "var(--color-gold)", icon: "⏸" },
  action_sent: { label: "Action taken", color: "var(--color-grass)", icon: "✓" },
  escalation: { label: "Escalated to SE", color: "var(--color-flame)", icon: "▲" },
  llm_activated: { label: "Agent drafted", color: "var(--color-berry)", icon: "✎" },
  skipped: { label: "Skipped", color: "var(--color-muted)", icon: "↷" },
  email_sent: { label: "Email sent", color: "var(--color-brand)", icon: "→✉" },
  email_received: { label: "Email received", color: "var(--color-grass)", icon: "✉←" },
  nudge_decision: { label: "Decision", color: "var(--color-muted)", icon: "⚑" },
  audit: { label: "Activity", color: "var(--color-muted)", icon: "·" },
};

function useActivity(pocId: string) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEvents(await api.getActivity(pocId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [pocId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  return { events, error, reload: load };
}

/** A gated nudge that hasn't been approved/rejected yet. */
function pendingNudges(events: ActivityEvent[]): ActivityEvent[] {
  const decided = new Set(
    events
      .filter((e) => e.kind === "email_sent" || e.kind === "nudge_decision")
      .map((e) => e.refs?.approvalTokenId)
      .filter(Boolean),
  );
  return events.filter(
    (e) =>
      e.kind === "action_gated" && e.refs?.approvalTokenId && !decided.has(e.refs.approvalTokenId),
  );
}

export function ActivityView({ poc }: { poc: PocStatusDetail }) {
  const { events, error, reload } = useActivity(poc.pocId);

  if (!events && !error) {
    return (
      <div className="grid place-items-center py-12">
        <Spinner label="Loading agent activity…" />
      </div>
    );
  }

  const list = events ?? [];
  const pending = pendingNudges(list);
  const emailsSent = list.filter((e) => e.kind === "email_sent").length;
  const emailsReceived = list.filter((e) => e.kind === "email_received").length;
  const report = poc.latestMonitoringReport;
  const criteriaMet =
    report?.successCriteriaProgress?.filter((c) => c.status === "met").length ?? 0;
  const criteriaTotal = report?.successCriteriaProgress?.length ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {error && <Banner tone="danger">Couldn’t load activity ({error}).</Banner>}

        {pending.length > 0 && (
          <Section title={`Needs your approval · ${pending.length}`}>
            <p className="mb-3 text-sm text-[var(--color-muted)]">
              The agent drafted these customer messages and is holding them until you approve.
              Nothing is sent without your sign-off.
            </p>
            <div className="space-y-3">
              {pending.map((nudge) => (
                <NudgeCard key={nudge.id} pocId={poc.pocId} nudge={nudge} onDone={reload} />
              ))}
            </div>
          </Section>
        )}

        <Section title={`Agent activity timeline · ${list.length}`}>
          {list.length === 0 ? (
            <EmptyState
              title="No activity yet"
              hint="Once this PoC is being monitored, the agent's ticks, drafts, emails, and escalations show here."
            />
          ) : (
            <ol className="relative space-y-3 border-l-2 border-[var(--color-hairline)] pl-5">
              {list.map((event) => (
                <TimelineRow key={event.id} event={event} />
              ))}
            </ol>
          )}
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="POV progress">
          {report ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <span
                  className="chip"
                  style={{
                    background: statusValidationTone(monitoringTone(report.status)),
                    color: "#fff",
                  }}
                >
                  {report.status.replaceAll("_", " ")}
                </span>
                <span className="chip" style={{ background: "#fff" }}>
                  risk: {report.riskLevel}
                </span>
              </div>
              <div className="text-sm font-semibold">
                Success criteria: {criteriaMet}/{criteriaTotal} met
              </div>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                Last checked {timeAgo(report.checkedAt)}
              </p>
            </>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">
              Not monitored yet. The always-on loop populates this once the PoC is live.
            </p>
          )}
        </Section>

        <Section title="Where things stand">
          <Stat label="Pending your approval" value={pending.length} tone="var(--color-gold)" />
          <Stat label="Emails sent" value={emailsSent} tone="var(--color-brand)" />
          <Stat label="Emails received" value={emailsReceived} tone="var(--color-grass)" />
          <Stat
            label="Escalations to SE"
            value={list.filter((e) => e.kind === "escalation").length}
            tone="var(--color-flame)"
          />
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-hairline)] py-2 last:border-0">
      <span className="text-sm font-medium text-[var(--color-ink-soft)]">{label}</span>
      <span
        className="grid h-6 min-w-[1.5rem] place-items-center rounded-md border-2 border-[var(--color-line)] px-1.5 text-xs font-extrabold text-white"
        style={{ background: tone }}
      >
        {value}
      </span>
    </div>
  );
}

function NudgeCard({
  pocId,
  nudge,
  onDone,
}: {
  pocId: string;
  nudge: ActivityEvent;
  onDone: () => void;
}) {
  const payload = nudge.payload ?? {};
  const subject = String(payload.subject ?? "Customer message");
  const [body, setBody] = useState(String(payload.markdownBody ?? ""));
  const recipients = Array.isArray(payload.recipients) ? (payload.recipients as string[]) : [];
  const [busy, setBusy] = useState<null | "approved" | "rejected">(null);
  const [err, setErr] = useState<string | null>(null);

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(decision);
    setErr(null);
    try {
      await api.decideNudge(pocId, nudge.refs!.approvalTokenId!, {
        decision,
        editedBody: decision === "approved" ? body : undefined,
        decidedBy: "se@poc-pilot.local",
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="pop-sm p-4">
      <div className="mb-1 flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-wide text-[var(--color-berry)]">
        <span>✎ Agent draft</span>
        {nudge.cadenceKey && (
          <span className="text-[var(--color-muted)]">· {nudge.cadenceKey}</span>
        )}
      </div>
      <div className="text-sm font-extrabold">{subject}</div>
      <div className="mono mt-1 text-[0.7rem] text-[var(--color-muted)]">
        to {recipients.join(", ") || "customer"}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="mt-2 min-h-[88px] w-full rounded-[8px] border-2 border-[var(--color-line)] bg-white p-2.5 text-sm font-medium outline-none focus:shadow-[2px_2px_0_0_#151515]"
      />
      {err && <p className="mt-2 text-xs font-semibold text-[var(--color-fail)]">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button
          className="btn btn-grass btn-sm"
          disabled={Boolean(busy)}
          onClick={() => decide("approved")}
        >
          {busy === "approved" ? "Sending…" : "✓ Approve & send"}
        </button>
        <button
          className="btn btn-flame btn-sm"
          disabled={Boolean(busy)}
          onClick={() => decide("rejected")}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function TimelineRow({ event }: { event: ActivityEvent }) {
  const meta = KIND_META[event.kind];
  return (
    <li className="relative">
      <span
        className="absolute -left-[27px] grid h-5 w-5 place-items-center rounded-full border-2 border-[var(--color-line)] text-[0.6rem] text-white"
        style={{ background: meta.color }}
      >
        {meta.icon}
      </span>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-xs font-extrabold uppercase tracking-wide"
          style={{ color: meta.color }}
        >
          {meta.label}
        </span>
        <span className="mono shrink-0 text-[0.65rem] text-[var(--color-muted)]">
          {timeAgo(event.ts)}
        </span>
      </div>
      <p className="text-sm font-medium text-[var(--color-ink)]">{event.summary}</p>
      <div className="mt-0.5 text-[0.68rem] text-[var(--color-muted)]">
        {event.actor.replaceAll("_", " ")}
        {event.refs?.emailId ? ` · ${event.refs.emailId}` : ""}
      </div>
    </li>
  );
}

function monitoringTone(status: string): "pass" | "warn" | "fail" | undefined {
  if (status === "criteria_met") return "pass";
  if (status === "on_track") return "pass";
  if (status === "at_risk" || status === "inactive") return "warn";
  if (status === "blocked" || status === "unknown") return "fail";
  return undefined;
}
