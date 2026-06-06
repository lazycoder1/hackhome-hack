import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/AppShell";
import {
  Banner,
  KeyVal,
  ResourceIcon,
  Section,
  Spinner,
  StatusPill,
  ValidationBadge,
} from "../components/ui";
import { Story } from "../components/Story";
import { LIFECYCLE_ORDER, STATUS_META, isAwaitingApproval, phaseOf, statusValidationTone, timeAgo } from "../lifecycle";
import { usePoc } from "../hooks";
import type {
  PocPlan,
  PocStatusDetail,
  PosthogResourceRef,
  SetupResult,
  ValidationReport,
} from "../types";

type Tab = "plan" | "setup" | "validation" | "handoff";
const TAB_IDS: Tab[] = ["plan", "setup", "validation", "handoff"];

export function PocDetailPage() {
  const { pocId } = useParams();
  const [params, setParams] = useSearchParams();
  const { poc, error, loading } = usePoc(pocId);
  const paramTab = params.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(paramTab && TAB_IDS.includes(paramTab) ? paramTab : "plan");

  // Honor ?tab= deep links (e.g. from the Story index) even without a remount.
  useEffect(() => {
    if (paramTab && TAB_IDS.includes(paramTab)) setTab(paramTab);
  }, [paramTab]);

  const selectTab = (next: Tab) => {
    setTab(next);
    setParams({ tab: next }, { replace: true });
  };

  if (loading && !poc) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner label="Loading PoC…" />
      </div>
    );
  }
  if (error || !poc) {
    return (
      <>
        <PageHeader title="PoC not found" />
        <div className="px-6 py-6 md:px-8">
          <Banner tone="danger">Couldn’t load {pocId}. {error}</Banner>
          <Link to="/" className="btn mt-4">← Back to pipeline</Link>
        </div>
      </>
    );
  }

  const phase = phaseOf(poc.status);
  const setup = poc.setupResult;
  const validation = setup?.validationReport;

  const tabs: { id: Tab; label: string; enabled: boolean; story: string }[] = [
    { id: "plan", label: "Plan", enabled: Boolean(poc.activePlan ?? poc.requirements), story: "US-O5" },
    { id: "setup", label: "Setup & Resources", enabled: Boolean(setup), story: "US-O6" },
    { id: "validation", label: "Validation", enabled: Boolean(validation), story: "US-O7" },
    { id: "handoff", label: "Handoff", enabled: Boolean(setup), story: "US-C4" },
  ];

  return (
    <>
      <PageHeader
        title={poc.customerCompany ?? poc.pocId}
        subtitle={poc.objective}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/" className="btn">← Pipeline</Link>
            {isAwaitingApproval(poc.status) && poc.approvalUrl && (
              <Story id="US-O9" side="bottom">
                <a className="btn btn-grass" href={poc.approvalUrl} target="_blank" rel="noreferrer">
                  Open approval page
                </a>
              </Story>
            )}
            {setup && (
              <Story id="US-C4" side="bottom">
                <Link className="btn btn-flame" to={`/handoff/${encodeURIComponent(poc.pocId)}`}>
                  Customer handoff →
                </Link>
              </Story>
            )}
          </div>
        }
      />

      <div className="px-6 py-5 md:px-8">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <StatusPill status={poc.status} />
          <ValidationBadge status={poc.validationStatus} />
          <span className="chip" style={{ background: "#fff" }}>{phase.label} phase</span>
          <Story id="US-O4" side="bottom" />
          <span className="mono ml-auto text-xs text-[var(--color-muted)]">
            {poc.pocId} · updated {timeAgo(poc.updatedAt)}
          </span>
        </div>

        {poc.status === "needs_human_review" && (
          <div className="mb-5 flex items-start gap-2">
            <Banner tone="warn">
              ⚠ This PoC is paused for human review. Validation did not meet the acceptance threshold —
              inspect the Validation tab and decide whether to override or rerun setup.
            </Banner>
            <Story id="US-O10" side="left" />
          </div>
        )}

        <div className="mb-6">
          <Stepper status={poc.status} />
        </div>

        <nav className="mb-5 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              disabled={!t.enabled}
              onClick={() => selectTab(t.id)}
              className={`btn ${tab === t.id ? "btn-ink" : ""}`}
              style={!t.enabled ? { opacity: 0.4 } : undefined}
            >
              {t.label}
              {t.enabled && <Story id={t.story} side="bottom" />}
            </button>
          ))}
        </nav>

        {tab === "plan" && <PlanView poc={poc} />}
        {tab === "setup" && setup && <SetupView setup={setup} />}
        {tab === "validation" && validation && <ValidationView report={validation} />}
        {tab === "handoff" && setup && <HandoffTabView poc={poc} setup={setup} />}
      </div>
    </>
  );
}

function Stepper({ status }: { status: PocStatusDetail["status"] }) {
  const failed = status === "failed" || status === "rejected" || status === "needs_human_review";
  // Find how far along the happy path we are.
  let activeIndex = LIFECYCLE_ORDER.findIndex((s) => s === status);
  if (activeIndex === -1) {
    // map off-path states onto their nearest milestone
    const fallback: Record<string, number> = {
      needs_clarification: 1,
      approved: 3,
      setup_queued: 4,
      setup_running: 4,
      needs_human_review: 5,
      handoff_ready: 6,
      handoff_sent_with_gaps: 6,
      completed: 7,
    };
    activeIndex = fallback[status] ?? 0;
  }

  return (
    <div className="pop flex items-stretch overflow-x-auto p-1.5">
      {LIFECYCLE_ORDER.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        const meta = STATUS_META[s];
        return (
          <div key={s} className="flex min-w-[120px] flex-1 items-center">
            <div
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-[8px] px-2 py-2.5 text-center ${active ? "shadow-[2px_2px_0_0_#151515]" : ""}`}
              style={{
                background: active ? (failed ? "var(--color-flame)" : meta.color) : done ? "#eef0ea" : "transparent",
                color: active ? (meta.fg === "#fff" || failed ? "#fff" : meta.fg) : "var(--color-ink)",
                border: active ? "2px solid var(--color-line)" : "2px solid transparent",
              }}
            >
              <span
                className="grid h-6 w-6 place-items-center rounded-full border-2 border-[var(--color-line)] text-xs font-black"
                style={{ background: done ? "var(--color-grass)" : active ? "#fff" : "#fff", color: "var(--color-ink)" }}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className="text-[0.68rem] font-bold leading-tight">{meta.label}</span>
            </div>
            {i < LIFECYCLE_ORDER.length - 1 && (
              <span className="px-1 text-[var(--color-muted)]">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- Plan ----------------------------- */

function PlanView({ poc }: { poc: PocStatusDetail }) {
  const plan = poc.activePlan;
  const req = poc.requirements;
  const objective = plan?.objective ?? req?.businessGoal;
  const successCriteria = plan?.successCriteria ?? req?.successCriteria ?? [];
  const assumptions = plan?.assumptions ?? req?.assumptions ?? [];
  const openQuestions = plan?.openQuestions ?? req?.openQuestions ?? [];
  const events = plan?.setup.events ?? req?.analyticsScope.events ?? [];
  const dashboards = plan?.setup.dashboards ?? req?.analyticsScope.dashboards ?? [];
  const flags = plan?.setup.featureFlags ?? req?.analyticsScope.featureFlags ?? [];
  const surveys = plan?.setup.surveys ?? req?.analyticsScope.surveys ?? [];
  const alerts = plan?.setup.alerts ?? req?.analyticsScope.alerts ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section title="Objective">
          <p className="text-[0.95rem] font-medium leading-relaxed">{objective ?? "—"}</p>
          {successCriteria.length > 0 && (
            <ul className="mt-4 space-y-2">
              {successCriteria.map((c, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-[var(--color-line)] bg-[var(--color-grass)] text-[0.6rem] font-black text-white">
                    ✓
                  </span>
                  <span className="font-medium">{c}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`Events & taxonomy · ${events.length}`}>
          {events.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">No events defined.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {events.map((e, i) => (
                <div key={i} className="pop-sm p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono text-sm font-bold text-[var(--color-brand)]">{e.name}</span>
                    {e.required && <span className="chip" style={{ background: "var(--color-gold)" }}>required</span>}
                  </div>
                  <p className="mt-1 text-[0.8rem] leading-snug text-[var(--color-ink-soft)]">{e.description}</p>
                  {e.properties && e.properties.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {e.properties.map((p) => (
                        <span key={p.name} className="mono rounded border border-[var(--color-hairline)] bg-[var(--color-cream)] px-1.5 py-0.5 text-[0.65rem]">
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {dashboards.length > 0 && (
          <Section title={`Dashboards · ${dashboards.length}`}>
            <div className="space-y-3">
              {dashboards.map((d, i) => (
                <div key={i} className="pop-sm p-3">
                  <div className="text-sm font-bold">{d.name}</div>
                  {d.description && <p className="text-[0.8rem] text-[var(--color-muted)]">{d.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {d.tiles.map((t, j) => (
                      <span key={j} className="chip" style={{ background: "#fff" }}>
                        {t.type} · {t.title}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {(flags.length > 0 || surveys.length > 0 || alerts.length > 0) && (
          <Section title="Optional assets">
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniList label="Feature flags" items={flags.map((f) => f.name)} icon="feature_flag" />
              <MiniList label="Surveys" items={surveys.map((s) => s.name)} icon="survey" />
              <MiniList label="Alerts" items={alerts.map((a) => a.name)} icon="alert" />
            </div>
          </Section>
        )}
      </div>

      <div className="space-y-4">
        {plan && (
          <Section title="PostHog target">
            <KeyVal k="Project">{plan.posthogTarget.projectName}</KeyVal>
            <KeyVal k="Region">{plan.posthogTarget.region ?? "—"}</KeyVal>
            <KeyVal k="Strategy">{plan.posthogTarget.projectStrategy.replaceAll("_", " ")}</KeyVal>
            <KeyVal k="Plan version">v{plan.version} · {plan.status.replaceAll("_", " ")}</KeyVal>
          </Section>
        )}

        {req?.customer && (
          <Section title="Customer">
            <KeyVal k="Company">{req.customer.companyName}</KeyVal>
            {req.customer.contacts.map((c) => (
              <KeyVal key={c.email} k={c.role ?? "Contact"}>
                <span className="mono text-[0.8rem]">{c.email}</span>
                {c.isPrimary && <span className="chip ml-2" style={{ background: "var(--color-gold)" }}>primary</span>}
              </KeyVal>
            ))}
          </Section>
        )}

        {assumptions.length > 0 && (
          <Section title="Assumptions">
            <ul className="space-y-1.5 text-sm">
              {assumptions.map((a, i) => (
                <li key={i} className="flex gap-2"><span className="text-[var(--color-muted)]">·</span>{a}</li>
              ))}
            </ul>
          </Section>
        )}

        {openQuestions.length > 0 && (
          <Section title="Open questions">
            <ul className="space-y-1.5 text-sm">
              {openQuestions.map((q, i) => (
                <li key={i} className="flex gap-2"><span className="text-[var(--color-warn)]">?</span>{q}</li>
              ))}
            </ul>
          </Section>
        )}

        {(plan?.securityConstraints ?? req?.securityConstraints) && (
          <Section title="Security">
            <SecurityBlock c={plan?.securityConstraints ?? req?.securityConstraints} />
          </Section>
        )}
      </div>
    </div>
  );
}

function SecurityBlock({ c }: { c?: PocPlan["securityConstraints"] }) {
  if (!c) return null;
  return (
    <div className="space-y-1.5 text-sm">
      {c.piiPolicy && <KeyVal k="PII policy">{c.piiPolicy}</KeyVal>}
      {typeof c.maskTextInputs === "boolean" && (
        <KeyVal k="Mask text inputs">{c.maskTextInputs ? "Yes" : "No"}</KeyVal>
      )}
      {c.credentialExpiry && <KeyVal k="Credential expiry">{c.credentialExpiry}</KeyVal>}
      {c.allowedDomains && c.allowedDomains.length > 0 && (
        <KeyVal k="Allowed domains">{c.allowedDomains.join(", ")}</KeyVal>
      )}
    </div>
  );
}

function MiniList({ label, items, icon }: { label: string; items: string[]; icon: string }) {
  return (
    <div className="pop-sm p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-[var(--color-muted)]">
        <ResourceIcon type={icon} /> {label} · {items.length}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">None</p>
      ) : (
        <ul className="space-y-1 text-[0.8rem] font-medium">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------- Setup ----------------------------- */

function SetupView({ setup }: { setup: SetupResult }) {
  const created = setup.createdResources;
  const grouped = created.reduce<Record<string, PosthogResourceRef[]>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section
          title={`Created in PostHog · ${created.length}`}
          right={
            <a className="btn btn-sm" href={setup.posthog.projectUrl} target="_blank" rel="noreferrer">
              Open project ↗
            </a>
          }
        >
          <div className="space-y-4">
            {Object.entries(grouped).map(([type, refs]) => (
              <div key={type}>
                <div className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-[var(--color-muted)]">
                  <ResourceIcon type={type} /> {type.replaceAll("_", " ")} · {refs.length}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {refs.map((r) => (
                    <a
                      key={r.id}
                      href={r.url ?? setup.posthog.projectUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="pop-sm flex items-center justify-between gap-2 p-2.5 transition hover:-translate-y-0.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{r.name}</span>
                        <span className="mono block truncate text-[0.65rem] text-[var(--color-muted)]">{r.id}</span>
                      </span>
                      <span className="text-[var(--color-brand)]">↗</span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {setup.skippedResources.length > 0 && (
          <Section title={`Skipped · ${setup.skippedResources.length}`}>
            <ul className="space-y-2 text-sm">
              {setup.skippedResources.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="chip" style={{ background: "var(--color-cream)" }}>{s.resource.type ?? "resource"}</span>
                  <span className="text-[var(--color-muted)]">{s.reason}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {setup.sdkInstructions.length > 0 && (
          <Section title="SDK instructions">
            {setup.sdkInstructions.map((s, i) => (
              <div key={i} className="mb-3">
                <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-[var(--color-muted)]">{s.platform}</div>
                <pre className="overflow-auto rounded-[8px] border-2 border-[var(--color-line)] bg-[var(--color-ink)] p-3 text-[0.75rem] leading-relaxed text-[#f5f5f0]">
                  {s.markdown}
                </pre>
              </div>
            ))}
          </Section>
        )}
      </div>

      <div className="space-y-4">
        <Section title="PostHog project">
          <KeyVal k="Project">{setup.posthog.projectName}</KeyVal>
          <KeyVal k="Project ID"><span className="mono">{setup.posthog.projectId}</span></KeyVal>
          <KeyVal k="Host"><span className="mono text-[0.78rem]">{setup.posthog.hostUrl}</span></KeyVal>
          <a className="btn btn-primary mt-3 w-full justify-center" href={setup.posthog.projectUrl} target="_blank" rel="noreferrer">
            Open in PostHog ↗
          </a>
        </Section>

        {setup.credentialRefs.length > 0 && (
          <Section title="Credentials">
            <p className="mb-3 text-xs text-[var(--color-muted)]">
              Delivered as one-time links — never raw secrets in email.
            </p>
            {setup.credentialRefs.map((c) => (
              <div key={c.secretRef} className="pop-sm mb-2 p-3">
                <div className="text-sm font-bold">{c.name}</div>
                <div className="mono mt-0.5 text-[0.65rem] text-[var(--color-muted)]">{c.secretRef}</div>
                {c.oneTimeLink && (
                  <a className="btn btn-flame mt-2 w-full justify-center" href={c.oneTimeLink} target="_blank" rel="noreferrer">
                    🔐 One-time link
                  </a>
                )}
                {c.expiresAt && <div className="mt-1.5 text-[0.7rem] font-semibold text-[var(--color-muted)]">Expires {c.expiresAt}</div>}
              </div>
            ))}
          </Section>
        )}

        {setup.knownGaps.length > 0 && (
          <Section title="Known gaps">
            <ul className="space-y-1.5 text-sm">
              {setup.knownGaps.map((g, i) => (
                <li key={i} className="flex gap-2"><span className="text-[var(--color-warn)]">▲</span>{g}</li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

/* --------------------------- Validation --------------------------- */

function ValidationView({ report }: { report: ValidationReport }) {
  const tone = statusValidationTone(report.status);
  const counts = report.checks.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Section
          title="Validation checks"
          right={
            <span className="chip" style={{ background: tone, color: "#fff" }}>
              {report.status.toUpperCase()}
            </span>
          }
        >
          <p className="mb-4 text-sm font-medium">{report.summary}</p>
          <div className="space-y-2">
            {report.checks.map((c) => {
              const ctone = statusValidationTone(c.status === "skipped" ? undefined : c.status);
              const icon = c.status === "pass" ? "✓" : c.status === "warn" ? "!" : c.status === "fail" ? "✕" : "–";
              return (
                <div key={c.id} className="pop-sm flex items-start gap-3 p-3">
                  <span
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[var(--color-line)] text-xs font-black text-white"
                    style={{ background: c.status === "skipped" ? "var(--color-muted)" : ctone }}
                  >
                    {icon}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold">{c.name}</div>
                    {c.evidence && <p className="text-[0.8rem] text-[var(--color-ink-soft)]">{c.evidence}</p>}
                    {c.error && <p className="text-[0.8rem] font-semibold text-[var(--color-fail)]">{c.error}</p>}
                    {c.resourceRef?.url && (
                      <a className="mono text-[0.7rem] text-[var(--color-brand)]" href={c.resourceRef.url} target="_blank" rel="noreferrer">
                        {c.resourceRef.name} ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Summary">
          <div className="grid grid-cols-3 gap-2 text-center">
            {(["pass", "warn", "fail"] as const).map((k) => (
              <div key={k} className="pop-sm py-3" style={{ borderColor: statusValidationTone(k) }}>
                <div className="text-xl font-extrabold" style={{ color: statusValidationTone(k) }}>{counts[k] ?? 0}</div>
                <div className="text-[0.65rem] font-bold uppercase">{k}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted)]">Checked {timeAgo(report.checkedAt)}</p>
        </Section>

        {report.knownGaps.length > 0 && (
          <Section title="Known gaps">
            <ul className="space-y-1.5 text-sm">
              {report.knownGaps.map((g, i) => (
                <li key={i} className="flex gap-2"><span className="text-[var(--color-warn)]">▲</span>{g}</li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

/* --------------------------- Handoff tab --------------------------- */

function HandoffTabView({ poc, setup }: { poc: PocStatusDetail; setup: SetupResult }) {
  const plan = poc.activePlan;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section title="What the customer receives">
          <p className="text-sm">
            The handoff package bundles project links, the configured taxonomy, a testing plan mapped to
            success criteria, validation status, and secure one-time credential links.
          </p>
          <Link to={`/handoff/${encodeURIComponent(poc.pocId)}`} className="btn btn-flame mt-4">
            Preview customer handoff page →
          </Link>
        </Section>

        <Section title="Links">
          <div className="grid gap-2 sm:grid-cols-2">
            <LinkRow label="PostHog project" url={setup.posthog.projectUrl} kind="posthog_project" />
            {setup.createdResources
              .filter((r) => r.type === "dashboard" && r.url)
              .map((r) => (
                <LinkRow key={r.id} label={r.name} url={r.url!} kind="dashboard" />
              ))}
            {setup.credentialRefs
              .filter((c) => c.oneTimeLink)
              .map((c) => (
                <LinkRow key={c.secretRef} label={`🔐 ${c.name}`} url={c.oneTimeLink!} kind="secret" />
              ))}
          </div>
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Delivery">
          {plan && (
            <>
              <KeyVal k="Recipients">{plan.handoffPlan.recipients.join(", ")}</KeyVal>
              <KeyVal k="Review date">{plan.handoffPlan.reviewDate ?? "—"}</KeyVal>
              <KeyVal k="Teardown date">{plan.handoffPlan.teardownDate ?? "—"}</KeyVal>
            </>
          )}
          <KeyVal k="Status"><StatusPill status={poc.status} /></KeyVal>
        </Section>
      </div>
    </div>
  );
}

function LinkRow({ label, url, kind }: { label: string; url: string; kind: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="pop-sm flex items-center justify-between gap-2 p-2.5 transition hover:-translate-y-0.5">
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{label}</span>
        <span className="mono block truncate text-[0.65rem] text-[var(--color-muted)]">{kind}</span>
      </span>
      <span className="text-[var(--color-brand)]">↗</span>
    </a>
  );
}
