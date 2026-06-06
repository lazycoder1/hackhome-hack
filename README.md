# HackHome: Agentic PoC Builder

HackHome is a hackathon project for an AI pre-sales agent that turns a buyer conversation into a working proof-of-concept workspace.

The first vertical is PostHog dashboard setup: a buyer describes what they want to measure, confirms the plan by email, and the agent inspects live PostHog data, asks business-language clarifications when needed, creates validated dashboards, and sends a handoff.

## Product Idea

Most B2B technical pilots fail before they prove value because setup work is scattered across calls, Slack threads, spreadsheets, dashboards, credentials, and follow-up emails. HackHome compresses that loop into an agentic workflow:

1. Ingest a transcript, call summary, or requirements note.
2. Extract a customer-readable PoC plan.
3. Ask for confirmation over email.
4. Interpret natural-language replies with an LLM.
5. Inspect live tool data through MCP/API connectors.
6. Generate a validated dashboard or workspace plan.
7. Run every query/tool call through guardrails before writing resources.
8. Send the buyer a handoff and continue monitoring the pilot.

## Initial Demo Scenario

**Buyer request:** "We have the Convinced widget deployed on Enmovil and Bizom landing pages. I want to understand adoption, email capture, and demo requests."

**Agent output:**

- A PostHog dashboard for PM/growth review.
- Charts for widget page views, email submissions, demo requests, conversion signals, and top landing pages.
- Titles that explain axes and table shape.
- Known caveats when live event volume is low.
- A handoff email with dashboard links and next steps.

## Repository Contents

- [`docs/PRD.md`](./docs/PRD.md) - detailed product requirements document.
- [`docs/prds/`](./docs/prds/) - focused PRD pack split by workstream:
  - [Product Vision and MVP](./docs/prds/01-product-vision-and-mvp.md)
  - [Agentic Workflow and Lifecycle](./docs/prds/02-agentic-workflow-and-lifecycle.md)
  - [PostHog Dashboard Builder](./docs/prds/03-posthog-dashboard-builder.md)
  - [Email-Native Buyer Loop](./docs/prds/04-email-native-buyer-loop.md)
  - [Operator Console](./docs/prds/05-operator-console.md)
  - [Demo, Validation, and Judging Plan](./docs/prds/06-demo-validation-and-judging-plan.md)

This repo is intentionally starting as a clean hackathon base. Implementation should proceed from the PRD rather than importing private credentials, local state, generated dashboard artifacts, or unrelated project history.

## MVP Scope

The hackathon MVP should prove one complete path:

- Transcript or text intake.
- LLM extraction into a structured PoC plan.
- Email confirmation and natural-language reply classification.
- PostHog live evidence discovery through MCP/API.
- Agentic dashboard spec generation.
- SQL/query validation before resource creation.
- Dashboard and insight creation.
- Handoff email.

## Non-Goals

- Rewriting git history or pretending prior work was authored later.
- Production-grade auth, billing, tenancy, or deployment hardening.
- A generic marketplace of all SaaS integrations.
- Letting an LLM freely mutate third-party tools without deterministic validation gates.

## Suggested Tech Stack

- TypeScript / Node.js for workflow and tool orchestration.
- React or Next.js for a lightweight operator UI.
- SQLite for local durable state during the hackathon.
- DeepSeek or another JSON-capable LLM for extraction, reply classification, and dashboard planning.
- PostHog MCP/API for dashboard creation and SQL validation.
- Gmail API/MCP for buyer-facing email loops.
- Trigger.dev or a simple in-process worker for durable workflow runs.

## Development Principles

- Treat customer text as untrusted input.
- Keep the LLM in a constrained planning harness.
- Validate SQL and tool payloads before writing to external services.
- Ask buyers only business questions, never implementation questions.
- Prefer one complete vertical over many shallow integrations.
- Make every created artifact auditable.
