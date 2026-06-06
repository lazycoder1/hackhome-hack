# PRD 01: Product Vision and MVP

Status: Hackathon baseline  
Owner: Product / founding team  
Primary audience: whole team

## Summary

HackHome is an AI implementation agent for B2B proof-of-concepts. It turns a buyer conversation into a configured, validated pilot workspace.

The first MVP focuses on PostHog dashboards because dashboard setup is easy to judge visually, has clear validation gates, and exposes the core product loop: understand buyer intent, inspect live data, build the right workspace, and continue the pilot over email.

## Problem

Pre-sales teams lose time and quality after discovery calls. A buyer describes an outcome, but the path to a working PoC requires manual interpretation, tool setup, dashboard creation, credential handling, validation, and follow-up. That work is usually spread across email, Slack, notebooks, and half-finished dashboards.

The buyer wants a business outcome. The sales engineer has to translate that outcome into implementation details. HackHome should automate most of that translation while keeping the human-visible loop understandable and safe.

## Product Promise

Give HackHome a buyer transcript. It will:

1. Extract the business goal.
2. Draft a customer-readable plan.
3. Confirm the plan over email.
4. Inspect live tool data.
5. Create a validated workspace.
6. Send a handoff.
7. Monitor whether the pilot is being used.

## Target Users

### Sales Engineer

Needs to ship credible pilots quickly without guessing what the buyer meant.

### Product/Growth Buyer

Needs a working dashboard or workspace that answers business questions without learning implementation details.

### Founder/GTM Lead

Needs more pilots delivered with consistent quality and less engineering drag.

## MVP Persona

The MVP is optimized for a sales engineer running a live hackathon demo. The buyer can be simulated, but the created dashboard should be real.

## MVP Scenario

Input transcript:

> We have the Convinced widget deployed on Enmovil and Bizom landing pages. As a PM, I want to understand adoption, email captures, and demo requests.

Expected output:

- A customer-readable plan.
- A natural email confirmation flow.
- A PostHog dashboard with real charts.
- A handoff email with dashboard links and caveats.

## Goals

- Prove transcript-to-dashboard automation.
- Show that the agent uses live evidence instead of guessing event names.
- Create at least one real PostHog dashboard.
- Keep buyer communication in normal business language.
- Demonstrate validation gates before tool mutation.

## Non-Goals

- Multi-product support beyond PostHog.
- Full production auth and multi-tenancy.
- Billing.
- CRM integration.
- Destructive cleanup automation.
- A perfect UI before the workflow works.

## Success Criteria

The MVP is successful if:

- A transcript can be submitted.
- A plan is generated.
- A natural-language approval starts setup.
- PostHog data is inspected.
- Dashboard SQL is validated.
- A dashboard with usable charts is created.
- A handoff is generated.

## Product Differentiators

- Email-native approval instead of form-only approval.
- Live data reconnaissance before dashboard creation.
- LLM operates in a constrained spec harness.
- Business-language clarification loop.
- SQL validation before writing dashboards.
- Pilot monitoring after handoff.

## MVP Deliverables

- README and setup instructions.
- Transcript sample.
- Requirements extraction.
- Plan generation.
- Local state store.
- Email approval simulator or Gmail integration.
- PostHog evidence collector.
- Dashboard planning harness.
- PostHog dashboard writer.
- Handoff generator.
- Demo script.

## Out-of-Scope Later Bets

- Salesforce/HubSpot workspace setup.
- Multi-step tool marketplace.
- Automatic SDK code changes in customer repos.
- Slack-native control plane.
- Full customer-facing portal.

