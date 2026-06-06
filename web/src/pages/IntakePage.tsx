import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/AppShell";
import { Banner, Section } from "../components/ui";
import { Story } from "../components/Story";
import { api } from "../api";

const SAMPLE = `Discovery call — Northwind Logistics (Tue).

Northwind runs a B2B freight-booking web app (React + Node) and wants to evaluate
PostHog to understand why shippers drop off during the quote-to-booking flow.

Key goals they mentioned:
- See the funnel: viewed_quote -> requested_booking -> booking_confirmed
- Know which carriers customers pick most (event: carrier_selected with carrier prop)
- A dashboard the ops team can watch weekly
- They care about PII — mask any text inputs, EU data region.

Primary contact: Dana Office (dana@northwind.test), Head of Product.
They'd like to start next week and review in 2 weeks.`;

export function IntakePage() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ pocId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.submitRequirements({
        source: "api",
        text,
        participants: email ? [{ email, company: company || undefined }] : undefined,
        sourceMetadata: { sourceId: `ui-${Date.now()}` },
      });
      setResult(res);
      if (res.pocId) {
        setTimeout(() => navigate(`/poc/${encodeURIComponent(res.pocId!)}`), 1200);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New PoC from a call"
        subtitle="Drop in the discovery-call summary. The orchestrator agent extracts a structured plan."
      />
      <div className="mx-auto max-w-3xl px-6 py-6 md:px-8">
        <div className="grid gap-4">
          <Section
            title={<span className="inline-flex items-center gap-1.5">Requirements blob <Story id="US-O11" /></span>}
            right={
              <button className="btn" onClick={() => setText(SAMPLE)} type="button">
                Use sample call
              </button>
            }
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the call summary, notes, or transcript…"
              className="min-h-[220px] w-full rounded-[10px] border-2 border-[var(--color-line)] bg-white p-3 font-medium leading-relaxed outline-none focus:shadow-[2px_2px_0_0_#151515]"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-bold">
                Customer company
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Northwind Logistics"
                  className="mt-1 w-full rounded-[10px] border-2 border-[var(--color-line)] bg-white p-2.5 font-medium outline-none focus:shadow-[2px_2px_0_0_#151515]"
                />
              </label>
              <label className="text-sm font-bold">
                Primary contact email
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dana@northwind.test"
                  className="mt-1 w-full rounded-[10px] border-2 border-[var(--color-line)] bg-white p-2.5 font-medium outline-none focus:shadow-[2px_2px_0_0_#151515]"
                />
              </label>
            </div>
          </Section>

          {error && (
            <Banner tone="danger">
              {error.includes("DEEPSEEK") || error.includes("500")
                ? "The orchestrator needs DEEPSEEK_API_KEY set on the backend to extract a plan. Add it to .env and restart api:start."
                : error}
            </Banner>
          )}

          {result?.pocId && (
            <Banner tone="success">
              ✓ Created <span className="mono">{result.pocId}</span> — opening the PoC…
            </Banner>
          )}

          <div className="flex items-center justify-between">
            <p className="flex max-w-md items-start gap-1.5 text-xs text-[var(--color-muted)]">
              <span>
                Customer text is treated as untrusted: it shapes the plan but never executes tool calls.
                Setup only starts after explicit approval.
              </span>
              <Story id="US-O12" />
            </p>
            <button className="btn btn-primary" disabled={!text.trim() || submitting} onClick={submit}>
              {submitting ? "Extracting plan…" : "Extract plan →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
