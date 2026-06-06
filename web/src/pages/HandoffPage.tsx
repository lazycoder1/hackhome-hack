import { Link, useParams } from "react-router-dom";
import { Logo, Spinner } from "../components/ui";
import { Story } from "../components/Story";
import { usePoc } from "../hooks";
import { statusValidationTone } from "../lifecycle";

export function HandoffPage() {
  const { pocId } = useParams();
  const { poc, loading } = usePoc(pocId, 0);

  if (loading && !poc) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading handoff…" />
      </div>
    );
  }

  const setup = poc?.setupResult;
  const plan = poc?.activePlan;
  const validation = setup?.validationReport;

  if (!poc || !setup) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <Logo />
        <p className="mt-6 font-bold">This PoC isn’t ready for handoff yet.</p>
        <Link to="/" className="btn mt-4">← Back to console</Link>
      </div>
    );
  }

  const vtone = statusValidationTone(validation?.status);
  const successCriteria = plan?.successCriteria ?? poc.requirements?.successCriteria ?? [];
  const dashboards = setup.createdResources.filter((r) => r.type === "dashboard");

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <span className="inline-flex items-center gap-1.5">
            <span className="chip" style={{ background: "var(--color-grass)", color: "#fff" }}>
              🎉 Your PoC is ready
            </span>
            <Story id="US-C4" side="bottom" />
          </span>
        </div>

        <div className="pop overflow-hidden p-0">
          <div className="border-b-2 border-[var(--color-line)] bg-[var(--color-cream)] px-6 py-6">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">
              {poc.customerCompany}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold">Your PostHog PoC is live</h1>
            <p className="mt-2 text-sm font-medium text-[var(--color-ink-soft)]">
              Everything below is configured and validated. Use the links to start sending events and
              watching your funnels.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a className="btn btn-primary" href={setup.posthog.projectUrl} target="_blank" rel="noreferrer">
                Open PostHog project ↗
              </a>
              {dashboards[0]?.url && (
                <a className="btn" href={dashboards[0].url} target="_blank" rel="noreferrer">
                  Main dashboard ↗
                </a>
              )}
            </div>
          </div>

          <div className="space-y-6 px-6 py-6">
            {validation && (
              <div
                className="flex items-center gap-3 rounded-[10px] border-2 px-4 py-3"
                style={{ borderColor: vtone, background: "#fff" }}
              >
                <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-line)] text-lg font-black text-white" style={{ background: vtone }}>
                  {validation.status === "pass" ? "✓" : validation.status === "warn" ? "!" : "✕"}
                </span>
                <div>
                  <div className="text-sm font-extrabold">Validation {validation.status}</div>
                  <div className="text-xs text-[var(--color-muted)]">{validation.summary}</div>
                </div>
              </div>
            )}

            <Block title="What we configured">
              <div className="flex flex-wrap gap-1.5">
                {summarize(setup.createdResources).map((s) => (
                  <span key={s} className="chip" style={{ background: "#fff" }}>{s}</span>
                ))}
              </div>
            </Block>

            {successCriteria.length > 0 && (
              <Block title={<span className="inline-flex items-center gap-1.5">Your testing plan <Story id="US-C6" side="bottom" /></span>}>
                <p className="mb-2 text-sm text-[var(--color-muted)]">
                  Each step maps to a success criterion you asked for:
                </p>
                <ol className="space-y-2">
                  {successCriteria.map((c, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[var(--color-line)] bg-[var(--color-gold)] text-xs font-black">
                        {i + 1}
                      </span>
                      <span className="font-medium">{c}</span>
                    </li>
                  ))}
                </ol>
              </Block>
            )}

            {setup.sdkInstructions[0] && (
              <Block title={`SDK setup · ${setup.sdkInstructions[0].platform}`}>
                <pre className="overflow-auto rounded-[8px] border-2 border-[var(--color-line)] bg-[var(--color-ink)] p-3 text-[0.75rem] leading-relaxed text-[#f5f5f0]">
                  {setup.sdkInstructions[0].markdown}
                </pre>
              </Block>
            )}

            {setup.credentialRefs.some((c) => c.oneTimeLink) && (
              <Block title={<span className="inline-flex items-center gap-1.5">Secure credentials <Story id="US-C5" side="top" /></span>}>
                <p className="mb-2 text-sm text-[var(--color-muted)]">
                  One-time links — open once, then store in your password manager. We never email raw secrets.
                </p>
                <div className="space-y-2">
                  {setup.credentialRefs
                    .filter((c) => c.oneTimeLink)
                    .map((c) => (
                      <a
                        key={c.secretRef}
                        href={c.oneTimeLink}
                        target="_blank"
                        rel="noreferrer"
                        className="pop-sm flex items-center justify-between p-3 transition hover:-translate-y-0.5"
                      >
                        <span className="font-bold">🔐 {c.name}</span>
                        <span className="text-xs font-semibold text-[var(--color-muted)]">
                          {c.expiresAt ? `expires ${c.expiresAt}` : "one-time"} ↗
                        </span>
                      </a>
                    ))}
                </div>
              </Block>
            )}

            {setup.knownGaps.length > 0 && (
              <Block title="Good to know">
                <ul className="space-y-1 text-sm">
                  {setup.knownGaps.map((g, i) => (
                    <li key={i} className="flex gap-2"><span className="text-[var(--color-warn)]">▲</span>{g}</li>
                  ))}
                </ul>
              </Block>
            )}

            {plan && (
              <div className="grid grid-cols-2 gap-3 border-t-2 border-[var(--color-hairline)] pt-5 text-sm">
                <div>
                  <div className="text-xs font-bold uppercase text-[var(--color-muted)]">Review date</div>
                  <div className="font-bold">{plan.handoffPlan.reviewDate ?? "TBD"}</div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase text-[var(--color-muted)]">Teardown date</div>
                  <div className="font-bold">{plan.handoffPlan.teardownDate ?? "TBD"}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
          Questions? Reply to your handoff email and the team will jump in. · Powered by PoC Pilot
        </p>
        <div className="mt-3 text-center">
          <Link to={`/poc/${encodeURIComponent(poc.pocId)}`} className="text-xs font-semibold text-[var(--color-brand)]">
            ← Operator view
          </Link>
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-[var(--color-muted)]">{title}</h2>
      {children}
    </div>
  );
}

function summarize(resources: { type: string }[]): string[] {
  const counts = resources.reduce<Record<string, number>>((acc, r) => {
    acc[r.type] = (acc[r.type] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([type, n]) => `${n} ${type.replaceAll("_", " ")}${n > 1 ? "s" : ""}`);
}
