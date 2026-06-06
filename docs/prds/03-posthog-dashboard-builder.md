# PRD 03: PostHog Dashboard Builder

Status: Hackathon baseline  
Owner: PostHog integration / agent engineering  
Primary audience: engineers implementing the live dashboard creation path

## Summary

The PostHog dashboard builder is the first proof that HackHome can create real customer value. It converts a confirmed business goal into a validated PostHog dashboard using live evidence and strict guardrails.

## Core Requirement

The agent must not create dashboards from guessed event names. It must inspect live PostHog data, produce a data assessment, generate dashboard tiles, validate SQL, and only then create resources.

## Live Evidence Collection

The setup agent must collect:

- Project metadata.
- Event schema.
- Top events in the last 30 days.
- Non-noise conversion candidates.
- URL/page activity.
- Candidate landing pages.
- Evidence query errors.

Noise events to treat carefully:

- `$pageview`
- `$pageleave`
- `$web_vitals`
- `$autocapture`

These can still be useful for pageview denominator charts, but should not be mistaken for conversion signals.

## Evidence Rules

- Do not start by hardcoding buyer names such as Enmovil or Bizom.
- Do not filter only to planned event names.
- Collect broad evidence first.
- Let the LLM map transcript terms to observed data.
- Exclude localhost and test URLs where possible.
- Record evidence errors.

## Dashboard Harness

The LLM receives:

- Confirmed PoC plan.
- Customer summary.
- Success criteria.
- Assumptions and open questions.
- Requested dashboard.
- Planned events.
- Live evidence.
- Repair feedback from prior attempts.

The LLM returns:

- `dashboardName`
- `dashboardDescription`
- `clarificationRequired`
- `clarificationQuestions`
- `dataAssessment`
- `notes`
- `tiles`

## Tile Contract

Each tile must include:

- `title`
- `description`
- `validationSql`
- `insightQuery`

`insightQuery` must use:

```json
{
  "kind": "DataVisualizationNode",
  "source": {
    "kind": "HogQLQuery",
    "query": "SELECT ..."
  },
  "display": "ActionsLineGraph"
}
```

Allowed displays:

- `ActionsLineGraph`
- `ActionsBar`
- `ActionsStackedBar`
- `ActionsAreaGraph`
- `ActionsTable`
- `BoldNumber`
- `TwoDimensionalHeatmap`

## Quality Gates

Reject the spec if:

- `dataAssessment` is missing.
- No tile exists.
- No chart exists when graphable data exists.
- Any tile lacks explicit display.
- Any tile lacks `DataVisualizationNode` + `HogQLQuery`.
- Chart title does not explain axes.
- Table title does not explain rows/columns.
- Buyer-visible names contain raw UUIDs.
- SQL validation fails after repair attempts.

## Chart Title Rules

Good:

- `Email submissions by day (x = day, y = submissions)`
- `Demo requests by company (x = company, y = requests)`
- `Top landing pages by widget pageviews (rows = landing page, columns = pageviews)`

Bad:

- `Sessions`
- `Chart 1`
- `95d983e2-... Widget Demo Requested`

## Clarification Behavior

The LLM should ask clarification only for business ambiguity.

Good questions:

- "Should demo intent include opened demo forms, submitted demo forms, or both?"
- "Which audience should this dashboard support: PM, growth, sales, or executive review?"
- "Which pages or brands are in scope?"

Bad questions:

- "Which SQL query should I use?"
- "Which PostHog event property contains company?"
- "Should I use ActionsLineGraph?"

## All-or-Nothing Write Rule

For an agentic dashboard spec:

- If any tile fails final SQL validation, do not create the dashboard.
- Do not create partial dashboards.
- Record skipped resources and known gaps.
- Feed validation feedback back to the LLM for repair before write.

## Created Resources

Minimum:

- Dashboard.
- Insights attached to dashboard.

Optional:

- Actions.
- Cohorts.
- Feature flags.
- Experiments.
- Surveys.
- Alerts.

## Validation After Write

Validation should confirm:

- Project is readable.
- Dashboard resource exists.
- Insight resources exist.
- SQL smoke query runs.
- Schema is readable.

If `dashboard-widgets-run` or equivalent render validation is unavailable, warn but do not mark SQL-validated dashboard creation as failed.

## Demo Dashboard Requirements

For the widget adoption scenario, the dashboard should ideally contain:

- Widget page views by company.
- Email submissions by day.
- Demo requests by day.
- Conversion signals by step/event.
- Top landing pages by widget usage.

## Acceptance Criteria

- A dashboard is created in a real PostHog project.
- At least three insights are attached to it.
- At least two insights are real graph displays.
- Every generated SQL query validates before write.
- Dashboard and insight URLs are stored.
- Known caveats are preserved.

