import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Logo } from "../components/ui";
import { Story } from "../components/Story";
import { api } from "../api";
import type { PocStatusDetail } from "../types";

type Decision = "approved" | "needs_changes" | "rejected";

export function ApprovalPage() {
  const [params] = useSearchParams();
  const tokenId = params.get("tokenId") ?? "";
  const publicAccessToken = params.get("publicAccessToken") ?? "";
  const pocId = params.get("pocId") ?? "";

  const [poc, setPoc] = useState<PocStatusDetail | null>(null);
  const [email, setEmail] = useState("");
  const [changes, setChanges] = useState("");
  const [done, setDone] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pocId)
      api
        .getPoc(pocId)
        .then(setPoc)
        .catch(() => undefined);
  }, [pocId]);

  const missing = !tokenId || !publicAccessToken;
  const plan = poc?.activePlan;
  const objective = plan?.objective ?? poc?.objective;
  const successCriteria = plan?.successCriteria ?? poc?.requirements?.successCriteria ?? [];
  const events = plan?.setup.events ?? poc?.requirements?.analyticsScope.events ?? [];
  const openQuestions = plan?.openQuestions ?? poc?.requirements?.openQuestions ?? [];

  const submit = async (decision: Decision) => {
    setBusy(true);
    setError(null);
    try {
      await api.completeApproval({
        tokenId,
        publicAccessToken,
        decision,
        decidedBy: email,
        changes: changes
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      });
      setDone(decision);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <span className="chip" style={{ background: "var(--color-gold)" }}>
            Plan confirmation
          </span>
        </div>

        <div className="pop overflow-hidden p-0">
          <div className="border-b-2 border-[var(--color-line)] bg-[var(--color-cream)] px-6 py-5">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">
              {poc?.customerCompany ? `For ${poc.customerCompany}` : "Your PostHog PoC"}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold">Confirm your PostHog PoC plan</h1>
            <p className="mt-2 text-sm font-medium text-[var(--color-ink-soft)]">
              Here’s what we’ll configure. Approve to start setup, or tell us what to change —
              nothing is built until you say go.
            </p>
          </div>

          <div className="space-y-5 px-6 py-5">
            {missing && (
              <div className="rounded-[10px] border-2 border-[var(--color-fail)] bg-[#ffece6] px-4 py-3 text-sm font-semibold text-[#8c2a14]">
                This approval link is missing its token parameters. Please reply to the confirmation
                email instead.
              </div>
            )}

            {objective && (
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wide text-[var(--color-muted)]">
                  Goal <Story id="US-C1" side="bottom" />
                </h2>
                <p className="mt-1 font-medium">{objective}</p>
              </div>
            )}

            {successCriteria.length > 0 && (
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-[var(--color-muted)]">
                  Success criteria
                </h2>
                <ul className="mt-2 space-y-1.5">
                  {successCriteria.map((c, i) => (
                    <li key={i} className="flex gap-2 text-sm font-medium">
                      <span className="text-[var(--color-grass)]">✓</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {events.length > 0 && (
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-[var(--color-muted)]">
                  Events we’ll track
                </h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {events.map((e) => (
                    <span key={e.name} className="mono chip" style={{ background: "#fff" }}>
                      {e.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {openQuestions.length > 0 && (
              <div className="rounded-[10px] border-2 border-[var(--color-gold)] bg-[#fff8e3] px-4 py-3">
                <h2 className="text-sm font-extrabold">A couple of open questions</h2>
                <ul className="mt-1.5 space-y-1 text-sm font-medium">
                  {openQuestions.map((q, i) => (
                    <li key={i} className="flex gap-2">
                      <span>?</span>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {done ? (
              <div
                className="rounded-[10px] border-2 px-4 py-4 text-sm font-bold"
                style={
                  done === "approved"
                    ? {
                        background: "#e6f6ec",
                        borderColor: "var(--color-grass)",
                        color: "var(--color-grass-ink)",
                      }
                    : { background: "#fff8e3", borderColor: "var(--color-gold)", color: "#7a5200" }
                }
              >
                {done === "approved"
                  ? "✓ Approved — your PostHog PoC setup is starting now. You’ll get a handoff email shortly."
                  : done === "needs_changes"
                    ? "Got it — your requested changes are on their way back to the team."
                    : "Understood — we’ve recorded that this plan was declined."}
              </div>
            ) : (
              <div className="border-t-2 border-[var(--color-hairline)] pt-5">
                <label className="block text-sm font-bold">
                  Your email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={missing}
                    placeholder="you@company.com"
                    className="mt-1 w-full rounded-[10px] border-2 border-[var(--color-line)] bg-white p-2.5 font-medium outline-none focus:shadow-[2px_2px_0_0_#151515]"
                  />
                </label>
                <label className="mt-3 block text-sm font-bold">
                  Requested changes{" "}
                  <span className="font-normal text-[var(--color-muted)]">
                    (optional, one per line)
                  </span>
                  <textarea
                    value={changes}
                    onChange={(e) => setChanges(e.target.value)}
                    disabled={missing}
                    className="mt-1 min-h-[80px] w-full rounded-[10px] border-2 border-[var(--color-line)] bg-white p-2.5 font-medium outline-none focus:shadow-[2px_2px_0_0_#151515]"
                  />
                </label>

                {error && (
                  <p className="mt-3 text-sm font-semibold text-[var(--color-fail)]">
                    Couldn’t submit — please reply to the confirmation email. ({error})
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="btn btn-grass"
                    disabled={missing || busy || !email}
                    onClick={() => submit("approved")}
                  >
                    ✓ Approve & start setup
                  </button>
                  <button
                    className="btn"
                    disabled={missing || busy}
                    onClick={() => submit("needs_changes")}
                  >
                    Request changes
                  </button>
                  <button
                    className="btn btn-flame"
                    disabled={missing || busy}
                    onClick={() => submit("rejected")}
                  >
                    Decline
                  </button>
                  <span className="ml-auto inline-flex items-center">
                    <Story id="US-C2" side="top" />
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-[var(--color-muted)]">
          Powered by PoC Pilot · Setup only begins after your approval.{" "}
          <Story id="US-C3" side="top" />
        </p>
      </div>
    </div>
  );
}
