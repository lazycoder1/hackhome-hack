import type { PocLifecycleStatus } from "./types";

export type PhaseId = "intake" | "confirm" | "setup" | "validate" | "handoff" | "live";

export type PhaseMeta = {
  id: PhaseId;
  label: string;
  blurb: string;
  accent: string; // css var color
  statuses: PocLifecycleStatus[];
};

// Six human phases the operator thinks in, mapping the backend's 18 lifecycle states.
export const PHASES: PhaseMeta[] = [
  {
    id: "intake",
    label: "Intake",
    blurb: "Requirements arriving & being structured",
    accent: "var(--color-sky)",
    statuses: ["intake_received", "requirements_extracted", "needs_clarification"],
  },
  {
    id: "confirm",
    label: "Confirmation",
    blurb: "Plan sent — awaiting customer sign-off",
    accent: "var(--color-gold)",
    statuses: ["confirmation_sent", "approved", "rejected"],
  },
  {
    id: "setup",
    label: "Setup",
    blurb: "Agent configuring PostHog",
    accent: "var(--color-brand)",
    statuses: ["setup_queued", "setup_running"],
  },
  {
    id: "validate",
    label: "Validation",
    blurb: "Proving the PoC works",
    accent: "var(--color-berry)",
    statuses: ["validation_running", "needs_human_review"],
  },
  {
    id: "handoff",
    label: "Handoff",
    blurb: "Delivering links & testing plan",
    accent: "var(--color-flame)",
    statuses: ["handoff_ready", "handoff_sent", "handoff_sent_with_gaps"],
  },
  {
    id: "live",
    label: "Live & Done",
    blurb: "Customer running the PoC",
    accent: "var(--color-grass)",
    statuses: [
      "active_poc",
      "completed",
      "failed",
      "teardown_queued",
      "teardown_complete",
    ],
  },
];

export const PHASE_BY_STATUS: Record<PocLifecycleStatus, PhaseId> = PHASES.reduce(
  (acc, phase) => {
    for (const status of phase.statuses) acc[status] = phase.id;
    return acc;
  },
  {} as Record<PocLifecycleStatus, PhaseId>,
);

export function phaseOf(status: PocLifecycleStatus): PhaseMeta {
  const id = PHASE_BY_STATUS[status];
  return PHASES.find((p) => p.id === id) ?? PHASES[0];
}

type StatusStyle = { label: string; color: string; fg: string };

export const STATUS_META: Record<PocLifecycleStatus, StatusStyle> = {
  intake_received: { label: "Intake received", color: "var(--color-sky)", fg: "#06343f" },
  requirements_extracted: {
    label: "Requirements extracted",
    color: "var(--color-sky)",
    fg: "#06343f",
  },
  needs_clarification: { label: "Needs clarification", color: "var(--color-gold)", fg: "#3d2c00" },
  confirmation_sent: { label: "Awaiting approval", color: "var(--color-gold)", fg: "#3d2c00" },
  approved: { label: "Approved", color: "var(--color-grass)", fg: "#fff" },
  rejected: { label: "Rejected", color: "var(--color-fail)", fg: "#fff" },
  setup_queued: { label: "Setup queued", color: "var(--color-brand)", fg: "#fff" },
  setup_running: { label: "Setting up", color: "var(--color-brand)", fg: "#fff" },
  validation_running: { label: "Validating", color: "var(--color-berry)", fg: "#fff" },
  needs_human_review: { label: "Needs review", color: "var(--color-flame)", fg: "#fff" },
  handoff_ready: { label: "Handoff ready", color: "var(--color-flame)", fg: "#fff" },
  handoff_sent: { label: "Handoff sent", color: "var(--color-grass)", fg: "#fff" },
  handoff_sent_with_gaps: { label: "Sent with gaps", color: "var(--color-warn)", fg: "#3d2c00" },
  active_poc: { label: "Active PoC", color: "var(--color-grass)", fg: "#fff" },
  failed: { label: "Failed", color: "var(--color-fail)", fg: "#fff" },
  completed: { label: "Completed", color: "var(--color-ink)", fg: "#fff" },
  teardown_queued: { label: "Teardown queued", color: "var(--color-muted)", fg: "#fff" },
  teardown_complete: { label: "Torn down", color: "var(--color-muted)", fg: "#fff" },
};

// Ordered lifecycle for the detail-page stepper (the happy path).
export const LIFECYCLE_ORDER: PocLifecycleStatus[] = [
  "intake_received",
  "requirements_extracted",
  "confirmation_sent",
  "approved",
  "setup_running",
  "validation_running",
  "handoff_sent",
  "active_poc",
];

export function statusValidationTone(s?: "pass" | "warn" | "fail"): string {
  if (s === "pass") return "var(--color-pass)";
  if (s === "warn") return "var(--color-warn)";
  if (s === "fail") return "var(--color-fail)";
  return "var(--color-muted)";
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
