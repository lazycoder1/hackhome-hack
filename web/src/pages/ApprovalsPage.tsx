import { Link } from "react-router-dom";
import { PageHeader } from "../components/AppShell";
import { EmptyState, Section, Spinner, StatusPill } from "../components/ui";
import { Story } from "../components/Story";
import { usePocs } from "../hooks";
import { timeAgo } from "../lifecycle";

export function ApprovalsPage() {
  const { pocs } = usePocs();
  const awaiting = (pocs ?? []).filter((p) => p.status === "confirmation_sent");
  const review = (pocs ?? []).filter((p) => p.status === "needs_human_review");

  return (
    <>
      <PageHeader
        title="Approvals & reviews"
        subtitle="Human-in-the-loop gates: customer sign-offs and escalated validations."
      />
      <div className="space-y-5 px-6 py-6 md:px-8">
        <Section
          title={
            <span className="inline-flex items-center gap-1.5">
              Awaiting customer approval · {awaiting.length} <Story id="US-O8" />
            </span>
          }
        >
          {pocs === null ? (
            <Spinner label="Loading…" />
          ) : awaiting.length === 0 ? (
            <EmptyState
              title="Nothing waiting on a customer"
              hint="Plans you send for confirmation appear here."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {awaiting.map((p) => (
                <div key={p.pocId} className="pop-sm flex flex-col gap-2 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold">{p.customerCompany}</span>
                    <StatusPill status={p.status} />
                  </div>
                  <p className="line-clamp-2 text-sm text-[var(--color-ink-soft)]">{p.objective}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Link className="btn btn-sm" to={`/poc/${encodeURIComponent(p.pocId)}`}>
                      View
                    </Link>
                    {p.approvalUrl && (
                      <a
                        className="btn btn-sm btn-grass"
                        href={p.approvalUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Approval page ↗
                      </a>
                    )}
                    <span className="ml-auto text-xs text-[var(--color-muted)]">
                      {timeAgo(p.updatedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title={
            <span className="inline-flex items-center gap-1.5">
              Escalated for human review · {review.length} <Story id="US-O10" />
            </span>
          }
        >
          {review.length === 0 ? (
            <EmptyState
              title="No escalations"
              hint="Validation failures that block handoff land here."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {review.map((p) => (
                <Link
                  key={p.pocId}
                  to={`/poc/${encodeURIComponent(p.pocId)}`}
                  className="pop-sm flex flex-col gap-2 border-[var(--color-flame)] p-4 transition hover:-translate-y-0.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold">{p.customerCompany}</span>
                    <StatusPill status={p.status} />
                  </div>
                  <p className="line-clamp-2 text-sm text-[var(--color-ink-soft)]">{p.objective}</p>
                  <span className="text-xs font-semibold text-[var(--color-flame)]">
                    Review validation →
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
