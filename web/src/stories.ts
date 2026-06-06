// User-story registry surfaced as in-app tooltips ("Story mode").
// Mirrors docs/ux/01-personas-and-stories.md so the UI explains itself.
// `route`/`routeLabel` make each story a link to the surface it lives on.

export type StoryPersona = "Operator" | "Customer";

export type Story = {
  id: string; // e.g. "US-O1"
  persona: StoryPersona;
  title: string; // the "I want …" in a few words
  text: string; // the full story, plain language
  route: string; // where this story lives (deep-linked where useful)
  routeLabel: string; // human label for the destination
};

// Demo PoCs the stories link into (from scripts/seed-demo.mjs).
const APPROVAL_LINK =
  "/approval?tokenId=tok_northwind&publicAccessToken=pat_demo&pocId=poc_northwind";

export const STORIES: Record<string, Story> = {
  "US-O1": {
    id: "US-O1",
    persona: "Operator",
    title: "See the whole pipeline at a glance",
    text: "As an SE I want every PoC grouped by the phase it's in, so I can see the whole funnel at once. 18 lifecycle states collapse into 6 human phases.",
    route: "/",
    routeLabel: "Pipeline board",
  },
  "US-O2": {
    id: "US-O2",
    persona: "Operator",
    title: "Know where to look first",
    text: "As an SE I want top-line counts (total, awaiting approval, in flight, needs review) so I know where to spend attention first.",
    route: "/",
    routeLabel: "Pipeline board",
  },
  "US-O3": {
    id: "US-O3",
    persona: "Operator",
    title: "Trust the board is live",
    text: "As an SE I want the board to refresh itself and pulse in-flight work, so I trust it reflects reality without a manual reload.",
    route: "/",
    routeLabel: "Pipeline board",
  },
  "US-O4": {
    id: "US-O4",
    persona: "Operator",
    title: "See progress and what's next",
    text: "As an SE I want a lifecycle stepper on each PoC so I can see how far it's progressed and what's next. Failed/review states show in the flame accent.",
    route: "/poc/poc_acme",
    routeLabel: "PoC detail · stepper",
  },
  "US-O5": {
    id: "US-O5",
    persona: "Operator",
    title: "Sanity-check the agent's plan",
    text: "As an SE I want to read the agent's extracted plan (objective, success criteria, event taxonomy, dashboards, security) before it reaches the customer.",
    route: "/poc/poc_acme?tab=plan",
    routeLabel: "PoC detail · Plan",
  },
  "US-O6": {
    id: "US-O6",
    persona: "Operator",
    title: "Verify what was built in PostHog",
    text: "As an SE I want to see exactly what was created in PostHog, with deep links, so I verify the setup rather than take the agent's word.",
    route: "/poc/poc_acme?tab=setup",
    routeLabel: "PoC detail · Setup",
  },
  "US-O7": {
    id: "US-O7",
    persona: "Operator",
    title: "Prove it works before promising it",
    text: "As an SE I want a per-check validation report so I can defend 'it's ready' to the customer. Failures block the handoff.",
    route: "/poc/poc_acme?tab=validation",
    routeLabel: "PoC detail · Validation",
  },
  "US-O8": {
    id: "US-O8",
    persona: "Operator",
    title: "Nothing stalls silently",
    text: "As an SE I want one place that lists PoCs waiting on a customer and PoCs escalated to me, so nothing stalls without me noticing.",
    route: "/approvals",
    routeLabel: "Approvals & reviews",
  },
  "US-O9": {
    id: "US-O9",
    persona: "Operator",
    title: "Preview the customer's approval page",
    text: "As an SE I want to open the exact page the customer sees, so I can preview or nudge the approval. This link opens the customer-facing /approval page with this PoC's tokens.",
    route: "/poc/poc_northwind",
    routeLabel: "PoC awaiting approval",
  },
  "US-O10": {
    id: "US-O10",
    persona: "Operator",
    title: "Never ship a broken PoC",
    text: "As an SE, when validation fails I want the PoC held for human review before handoff, so a broken PoC never reaches a customer.",
    route: "/poc/poc_stark?tab=validation",
    routeLabel: "Escalated PoC",
  },
  "US-O11": {
    id: "US-O11",
    persona: "Operator",
    title: "Turn a call into a plan",
    text: "As an SE I want to paste a discovery-call summary and have a structured plan extracted, so I skip manual data entry. Posts to the orchestrator agent.",
    route: "/intake",
    routeLabel: "New PoC intake",
  },
  "US-O12": {
    id: "US-O12",
    persona: "Operator",
    title: "Customer text is untrusted",
    text: "As an SE I want a reminder that customer text shapes the plan but never executes tools, and setup only starts after approval — so I trust the safety model.",
    route: "/intake",
    routeLabel: "New PoC intake",
  },
  "US-C1": {
    id: "US-C1",
    persona: "Customer",
    title: "See the plan on one screen",
    text: "As a buyer I want to see the plan (goal, success criteria, events, open questions) on one screen, so I can confirm it's right.",
    route: APPROVAL_LINK,
    routeLabel: "Customer approval",
  },
  "US-C2": {
    id: "US-C2",
    persona: "Customer",
    title: "Decide in one click",
    text: "As a buyer I want to approve, request changes, or decline in one click, so I'm not stuck writing an email.",
    route: APPROVAL_LINK,
    routeLabel: "Customer approval",
  },
  "US-C3": {
    id: "US-C3",
    persona: "Customer",
    title: "Stay in control",
    text: "As a buyer I want reassurance that nothing is built until I approve, so I feel in control of my own environment.",
    route: APPROVAL_LINK,
    routeLabel: "Customer approval",
  },
  "US-C4": {
    id: "US-C4",
    persona: "Customer",
    title: "Everything to start, in one place",
    text: "As a buyer I want a single handoff page with project links, what was configured, a testing plan tied to my goals, and validation status. This link previews exactly that page.",
    route: "/handoff/poc_umbrella",
    routeLabel: "Customer handoff",
  },
  "US-C5": {
    id: "US-C5",
    persona: "Customer",
    title: "Credentials handled safely",
    text: "As a buyer I want credentials delivered as one-time links, never raw secrets in email, so security is respected.",
    route: "/handoff/poc_umbrella",
    routeLabel: "Customer handoff",
  },
  "US-C6": {
    id: "US-C6",
    persona: "Customer",
    title: "Prove my case, not generic usage",
    text: "As a buyer I want my testing plan to map to the exact success criteria I asked for, so the PoC proves my case.",
    route: "/handoff/poc_umbrella",
    routeLabel: "Customer handoff",
  },
};
