# PRD 04: Email-Native Buyer Loop

Status: Hackathon baseline  
Owner: email / orchestration engineering  
Primary audience: engineers implementing customer communication

## Summary

HackHome should feel like a pre-sales teammate, not a technical form. The buyer controls the PoC through natural email replies. The system sends a confirmation plan, classifies replies, revises plans, asks business-language clarification, and sends final handoff emails.

## Product Principle

Email is the customer control plane.

The buyer should not need to:

- Click an approval link.
- Fill out a technical setup form.
- Choose SQL or event properties.
- Understand MCP tool names.

Links can exist for convenience, but email replies must be first-class.

## Email Types

### Confirmation Email

Purpose:

- Summarize captured plan.
- Ask buyer to confirm or correct.

Must include:

- Goal.
- Success criteria.
- Scope.
- Assumptions.
- Open questions.
- Clear instruction to reply naturally.

### Clarification Email

Purpose:

- Ask for missing business definitions.

Must include:

- Why the clarification matters.
- Short numbered questions.
- No technical implementation details.

### Revised Plan Email

Purpose:

- Send updated plan after buyer changes scope.

Must include:

- What changed.
- New plan summary.
- Ask for confirmation.

### Handoff Email

Purpose:

- Tell buyer the PoC workspace is ready.

Must include:

- Dashboard link.
- Summary of what was built.
- Validation status.
- Known caveats.
- Next review steps.

### Monitoring Follow-Up Email

Purpose:

- Keep the pilot active after handoff.

May include:

- "We are seeing data flowing."
- "We have not seen activity yet."
- "The dashboard is ready for review."
- "Should we adjust the success criteria?"

## Reply Classification

Intents:

- `approved`
- `needs_changes`
- `question`
- `rejected`
- `unclear`

The LLM classifier must use lifecycle context.

Examples:

| Reply | Expected intent |
|---|---|
| "Confirmed, go ahead." | approved |
| "Looks good, but make it 90 days." | needs_changes |
| "Can we include Bizom separately?" | needs_changes or question |
| "Not now, let's pause." | rejected |
| "Sounds interesting." | unclear |

## Natural-Language Approval

Approval should not require exact wording.

Accepted approval phrasing:

- "Confirmed."
- "This is good."
- "Go ahead."
- "Looks right to me."
- "Yes, proceed."

## Plan Revision

When reply intent is `needs_changes`:

1. Extract changes.
2. Supersede prior plan.
3. Create new plan version.
4. Send revised confirmation email.
5. Wait for approval again.

## Clarification Quality Bar

Good:

- "Should demo intent include opened demo forms, submitted demo forms, or both?"
- "Should this dashboard focus on PM adoption or sales pipeline?"
- "Which brands or pages are in scope?"

Bad:

- "Should I query `voice_only.demo_request_submitted`?"
- "Which PostHog property contains the URL?"
- "Should I use `ActionsBar`?"

## Gmail Integration Options

### Local Email Mode

Use for tests and offline demos.

### Gmail API

Use for reliable send/read during hackathon.

Required OAuth scopes may include:

- Gmail send.
- Gmail compose.
- Gmail readonly.

### Gmail MCP

Use as optional connector if project permissions are configured.

Expected tools:

- Create draft.
- Search threads.
- Get thread.
- Label processed thread.

## Safety Requirements

- Do not email raw API keys.
- Do not leak OAuth tokens in logs.
- Redact secrets from generated text.
- Default to draft mode when possible.
- Only process replies from expected customer contacts or known thread IDs.

## Acceptance Criteria

- Confirmation email is generated from a plan.
- Natural-language approval triggers setup.
- Natural-language change request creates v2 plan.
- Clarification email uses business language.
- Handoff email includes dashboard link and warnings.
- Local email mode works without credentials.
- Gmail API or MCP path can be smoke-tested.

