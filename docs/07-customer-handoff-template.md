# Customer Handoff and Email Templates

This file defines customer-facing templates for confirmation and final handoff.

Do not include raw passwords, project API keys, personal API keys, or admin credentials in email bodies. Use one-time secret links with expiry.

## Confirmation Email Template

Subject:

```text
Please confirm your PostHog PoC plan
```

Body:

```md
Hi {customerName},

Thanks for walking us through your goals. Here is the PostHog PoC plan we captured from the call.

## Goal

{businessGoal}

## Success criteria

{successCriteriaList}

## Scope we will configure

- PostHog project: {projectStrategy}
- Platforms: {platforms}
- Environment: {environments}
- Dashboards: {dashboardSummary}
- Events/actions: {eventSummary}
- Funnels: {funnelSummary}
- Feature flags: {featureFlagSummary}
- Surveys: {surveySummary}
- Session replay: {sessionReplaySummary}
- Alerts/subscriptions: {alertSummary}

## Assumptions

{assumptionsList}

## Open questions

{openQuestionsList}

## Testing plan preview

{testingPlanPreview}

Please reply with "Approved" if this looks right, or send corrections in this thread.

Approval link: {approvalLink}

Thanks,
{senderName}
```

## Final Handoff Email Template

Subject:

```text
Your PostHog PoC is ready: testing plan and access details
```

Body:

```md
Hi {customerName},

Your PostHog PoC is ready for testing.

## Access

- PostHog project: {posthogProjectUrl}
- Main PoC dashboard: {dashboardUrl}
- Temporary credential link: {oneTimeSecretLink}
- Credential link expiry: {secretExpiry}

For security, credentials are delivered through the one-time link above and are not included directly in this email.

## What was configured

{configuredResourcesList}

## Event taxonomy

{eventTaxonomyTable}

## Testing plan

{testingPlan}

## Validation status

Status: {validationStatus}

{validationSummary}

## Known gaps

{knownGapsList}

## Next steps

1. Open the PostHog project and confirm access.
2. Install or verify the PostHog SDK in your test environment.
3. Send the listed test events.
4. Confirm the dashboard updates.
5. Review results with us on {reviewDate}.

## Support

Owner: {ownerName}
Email: {ownerEmail}

PoC teardown or access review date: {teardownDate}

Thanks,
{senderName}
```

## Testing Plan Template

```md
### Test 1: SDK initialization

Goal: Confirm the app can send events to the correct PostHog project.

Steps:

1. Install the PostHog SDK for {platform}.
2. Initialize with the provided host URL and project API key.
3. Load the app in the test environment.
4. Confirm a `$pageview` or equivalent event appears in PostHog.

Expected result:

- Event appears in PostHog within the expected ingestion window.
- Event includes environment and user/test identifiers.

### Test 2: Identity capture

Goal: Confirm users can be identified consistently.

Steps:

1. Log in as a test user.
2. Call identify with the test user's stable ID.
3. Capture `{identityTestEvent}`.

Expected result:

- The person profile contains the expected distinct ID and properties.

### Test 3: Funnel validation

Goal: Confirm the main PoC funnel works.

Steps:

1. Trigger each event in this order: {funnelSteps}.
2. Open the PoC dashboard.
3. Review the funnel tile.

Expected result:

- The test user appears in the funnel.
- Conversion count increases.

### Test 4: Core feature usage

Goal: Confirm the primary success metric is visible.

Steps:

1. Perform the core product action: {coreAction}.
2. Capture `{coreFeatureEvent}`.
3. Open `{coreFeatureInsightName}`.

Expected result:

- The event count increases.
- Required properties are populated.

### Test 5: Optional features

Use only if configured:

- Feature flag evaluation: {featureFlagTest}
- Survey display: {surveyTest}
- Session replay visibility: {sessionReplayTest}
- Alert/subscription delivery: {alertTest}
```

## Handoff Checklist

Before sending:

- Project link is present.
- Dashboard links are present.
- Secret links are present and expire.
- No raw secrets are in the body.
- SDK instructions match customer platform.
- Testing plan maps to success criteria.
- Validation result is included.
- Known gaps are clearly labeled.
- Review and teardown dates are included.
- Owner/contact is included.

## Details Often Missed

Include these when available:

- PostHog region and host URL.
- Project API key delivery method.
- Personal API key or invite status, if needed.
- Which environment should send test events.
- Event naming convention.
- Required event properties.
- Distinct ID strategy.
- Group/account analytics strategy.
- PII masking and session replay privacy settings.
- Dashboard refresh/ingestion delay expectations.
- Who owns SDK installation on the customer side.
- PoC success review date.
- Temporary access expiry and cleanup date.
- Known limitations and manual steps.

