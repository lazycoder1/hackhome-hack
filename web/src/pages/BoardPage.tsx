import { Link, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { PageHeader } from "../components/AppShell";
import { Dot, Spinner, StatusPill, ValidationBadge } from "../components/ui";
import { Story } from "../components/Story";
import { PHASES, PHASE_BY_STATUS, timeAgo } from "../lifecycle";
import type { PhaseId } from "../lifecycle";
import { usePocs } from "../hooks";
import type { PocStatusSummary } from "../types";

const ACTIVE_PHASES: PhaseId[] = ["setup", "validate"];

export function BoardPage() {
  const navigate = useNavigate();
  const { pocs, error, flashIds } = usePocs();

  const byPhase = useMemo(() => {
    const map: Record<PhaseId, PocStatusSummary[]> = {
      intake: [],
      confirm: [],
      setup: [],
      validate: [],
      handoff: [],
      live: [],
    };
    for (const p of pocs ?? []) map[PHASE_BY_STATUS[p.status]].push(p);
    return map;
  }, [pocs]);

  const total = pocs?.length ?? 0;
  const awaiting = byPhase.confirm.filter((p) => p.status === "confirmation_sent").length;
  const inFlight = byPhase.setup.length + byPhase.validate.length;
  const needsReview = (pocs ?? []).filter((p) => p.status === "needs_human_review").length;

  return (
    <>
      <PageHeader
        title="PoC Pipeline"
        subtitle="Every PostHog proof-of-concept, from discovery call to live handoff."
        right={
          <div className="flex items-center gap-2">
            <Story id="US-O8" side="bottom">
              <button className="btn" onClick={() => navigate("/approvals")}>
                ✓ Approvals{awaiting ? ` · ${awaiting}` : ""}
              </button>
            </Story>
            <Story id="US-O11" side="bottom">
              <button className="btn btn-primary" onClick={() => navigate("/intake")}>
                + New PoC
              </button>
            </Story>
          </div>
        }
      />

      <div className="px-6 py-5 md:px-8">
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total PoCs" value={total} story="US-O2" />
          <Stat label="Awaiting approval" value={awaiting} tone="var(--color-gold)" story="US-O8" />
          <Stat
            label="In flight"
            value={inFlight}
            tone="var(--color-brand)"
            live={inFlight > 0}
            story="US-O3"
          />
          <Stat
            label="Needs review"
            value={needsReview}
            tone="var(--color-flame)"
            live={needsReview > 0}
            story="US-O10"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-[10px] border-2 border-[var(--color-fail)] bg-[#ffece6] px-4 py-3 text-sm font-semibold text-[#8c2a14]">
            Couldn’t reach the backend ({error}). Start it with{" "}
            <span className="mono">npm run build && npm run api:start</span>.
          </div>
        )}

        {pocs === null && !error ? (
          <div className="grid place-items-center py-20">
            <Spinner label="Loading pipeline…" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {PHASES.map((phase) => (
              <div key={phase.id} className="flex min-w-0 flex-col">
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-[3px]"
                    style={{ background: phase.accent, outline: "1.5px solid var(--color-line)" }}
                  />
                  <h2 className="text-sm font-extrabold">{phase.label}</h2>
                  {phase.id === "intake" && <Story id="US-O1" side="bottom" />}
                  <span className="chip ml-auto" style={{ background: "#fff" }}>
                    {byPhase[phase.id].length}
                  </span>
                </div>
                <p className="mb-3 min-h-[2.1rem] text-[0.72rem] leading-snug text-[var(--color-muted)]">
                  {phase.blurb}
                </p>
                <div className="flex flex-1 flex-col gap-3">
                  {byPhase[phase.id].length === 0 ? (
                    <div className="pop-flat ticker grid h-20 place-items-center text-xs font-semibold text-[var(--color-muted)]">
                      Empty
                    </div>
                  ) : (
                    byPhase[phase.id].map((poc) => (
                      <PocCard
                        key={poc.pocId}
                        poc={poc}
                        flash={flashIds.has(poc.pocId)}
                        live={ACTIVE_PHASES.includes(phase.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone = "var(--color-ink)",
  live = false,
  story,
}: {
  label: string;
  value: number;
  tone?: string;
  live?: boolean;
  story?: string;
}) {
  return (
    <div className="pop flex items-center gap-3 px-4 py-3">
      <span
        className="grid h-9 w-9 place-items-center rounded-[8px] border-2 border-[var(--color-line)]"
        style={{ background: tone, color: "#fff" }}
      >
        {live ? <Dot color="#fff" live /> : <span className="text-sm font-black">{value}</span>}
      </span>
      <div className="min-w-0">
        <div className="text-xl font-extrabold leading-none">{value}</div>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[0.72rem] font-bold uppercase tracking-wide text-[var(--color-muted)]">
            {label}
          </span>
          {story && <Story id={story} side="bottom" />}
        </div>
      </div>
    </div>
  );
}

function PocCard({ poc, flash, live }: { poc: PocStatusSummary; flash: boolean; live: boolean }) {
  return (
    <Link
      to={`/poc/${encodeURIComponent(poc.pocId)}`}
      className={`pop-sm flex min-h-[13rem] flex-col p-3.5 transition hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_#151515] ${flash ? "rise" : ""}`}
      style={flash ? { outline: "3px solid var(--color-brand)" } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold">
            {poc.customerCompany ?? "Unknown company"}
          </div>
          <div className="mono mt-0.5 truncate text-[0.68rem] text-[var(--color-muted)]">
            {poc.pocId}
          </div>
        </div>
        {live && <Dot color="var(--color-brand)" live />}
      </div>
      {poc.objective && (
        <p className="mt-2 line-clamp-2 text-[0.8rem] leading-snug text-[var(--color-ink-soft)]">
          {poc.objective}
        </p>
      )}
      {/* Reserve a consistent two-row band for the status pills so 1-pill and
          2-pill cards stay the same height. */}
      <div className="mt-3 flex min-h-[3.25rem] content-start flex-wrap items-start gap-1.5">
        <StatusPill status={poc.status} />
        <ValidationBadge status={poc.validationStatus} />
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-[var(--color-hairline)] pt-2.5 text-[0.68rem] font-semibold text-[var(--color-muted)]">
        <span>v{poc.activePlanVersion ?? "—"}</span>
        <span>{timeAgo(poc.updatedAt)}</span>
      </div>
    </Link>
  );
}
