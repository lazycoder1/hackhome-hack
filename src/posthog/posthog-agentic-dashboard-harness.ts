import type { PocPlan } from "../contracts.js";
import type { LlmJsonClient } from "../llm/types.js";

export const MAX_AGENT_RECONNAISSANCE_STEPS = 50;
export const MAX_AGENT_DASHBOARD_REPAIR_ATTEMPTS = 5;

const CHART_DISPLAYS = new Set([
  "ActionsLineGraph",
  "ActionsBar",
  "ActionsStackedBar",
  "ActionsAreaGraph",
]);

const ALLOWED_SQL_DISPLAYS = new Set([
  ...CHART_DISPLAYS,
  "ActionsTable",
  "BoldNumber",
  "TwoDimensionalHeatmap",
]);

export type AgenticDashboardTile = {
  title: string;
  description?: string;
  validationSql: string;
  insightQuery: Record<string, unknown>;
};

export type AgenticDashboardSpec = {
  dashboardName?: string;
  dashboardDescription?: string;
  clarificationRequired: boolean;
  clarificationQuestions: string[];
  dataAssessment: string[];
  tiles: AgenticDashboardTile[];
  notes: string[];
};

export type AgenticEvidence = {
  schema?: unknown;
  topEvents?: unknown;
  conversionSignalCandidates?: unknown;
  scopedPageActivity?: unknown;
  candidatePages?: unknown;
  errors: string[];
};

export type DashboardHarnessResult =
  | {
      status: "validated";
      spec: AgenticDashboardSpec;
      attempts: number;
      repairFeedback: string[];
    }
  | {
      status: "needs_clarification";
      spec: AgenticDashboardSpec;
      attempts: number;
      repairFeedback: string[];
    }
  | {
      status: "failed";
      attempts: number;
      repairFeedback: string[];
    };

export type PostHogAgenticDashboardHarnessOptions = {
  llm: LlmJsonClient;
  model: string;
  executeSql(input: { projectId: string; query: string }): Promise<unknown>;
};

export class PostHogAgenticDashboardHarness {
  private readonly llm: LlmJsonClient;
  private readonly model: string;
  private readonly executeSql: (input: { projectId: string; query: string }) => Promise<unknown>;

  constructor(options: PostHogAgenticDashboardHarnessOptions) {
    this.llm = options.llm;
    this.model = options.model;
    this.executeSql = options.executeSql;
  }

  async plan(input: {
    plan: PocPlan;
    dashboard: PocPlan["setup"]["dashboards"][number];
    projectId: string;
    evidence: AgenticEvidence;
  }): Promise<DashboardHarnessResult> {
    let repairFeedback: string[] = [];

    for (let attempt = 1; attempt <= MAX_AGENT_DASHBOARD_REPAIR_ATTEMPTS; attempt += 1) {
      let raw: unknown;
      try {
        raw = await this.llm.completeJson({
          model: this.model,
          system: agenticDashboardSystemPrompt(),
          user: JSON.stringify({
            harness: {
              mode: "constrained_dashboard_spec_workspace",
              maxAgentSteps: MAX_AGENT_RECONNAISSANCE_STEPS,
              attempt,
              allowedActions: [
                "inspect provided transcript-derived plan and PostHog evidence",
                "draft dashboard JSON",
                "draft HogQL/SQL strings for validation",
                "revise dashboard JSON from repair feedback",
              ],
              forbiddenActions: [
                "edit repository files",
                "call PostHog mutation tools",
                "invent event names not supported by live evidence",
                "ask technical implementation questions to the buyer",
              ],
              repairFeedback,
            },
            poc: {
              pocId: input.plan.pocId,
              customer: input.plan.customer,
              objective: input.plan.objective,
              customerSummaryMarkdown: input.plan.customerSummaryMarkdown,
              successCriteria: input.plan.successCriteria,
              assumptions: input.plan.assumptions,
              openQuestions: input.plan.openQuestions,
              appContext: {
                projectName: input.plan.posthogTarget.projectName,
                projectId: input.projectId,
              },
              requestedDashboard: input.dashboard,
              plannedEvents: input.plan.setup.events,
            },
            evidence: input.evidence,
            expectedOutput: {
              dashboardName: "string",
              dashboardDescription: "string",
              clarificationRequired: "boolean",
              clarificationQuestions: ["business question"],
              dataAssessment: [
                "available live signals, scoped pages/companies, metric definitions, and caveats discovered before planning",
              ],
              notes: ["business or data caveat"],
              tiles: [
                {
                  title: "business metric title with axis/row meaning",
                  description: "what this tile tells a PM, including x/y or row/column meaning",
                  validationSql: "SELECT ...",
                  insightQuery: {
                    kind: "DataVisualizationNode",
                    source: { kind: "HogQLQuery", query: "same or equivalent SQL" },
                    display:
                      "ActionsLineGraph | ActionsBar | ActionsStackedBar | ActionsAreaGraph | ActionsTable | BoldNumber",
                  },
                },
              ],
            },
          }),
        });
      } catch (error) {
        // A malformed-JSON or transient transport failure on one attempt should not
        // abort the whole harness — treat it as a repairable attempt and retry.
        repairFeedback = [
          `The previous attempt did not return usable JSON (${(error as Error).message}). Return exactly one valid JSON object, with no trailing commas, comments, or extra text.`,
        ];
        continue;
      }

      const spec = normalizeAgenticDashboardSpec(raw);
      if (!spec) {
        repairFeedback = [
          "Return a valid JSON dashboard specification with dashboardName, dataAssessment, notes, and tiles.",
        ];
        continue;
      }
      if (spec.clarificationRequired) {
        return { status: "needs_clarification", spec, attempts: attempt, repairFeedback };
      }

      const qualityIssues = agenticDashboardSpecIssues(spec);
      if (qualityIssues.length) {
        repairFeedback = qualityIssues;
        continue;
      }

      const tileValidation = await this.validateTiles(input.projectId, spec.tiles);
      if (tileValidation.issues.length) {
        // On the final attempt, ship the tiles that validated rather than failing the
        // whole dashboard, as long as the surviving subset still meets the quality bar.
        const lastAttempt = attempt === MAX_AGENT_DASHBOARD_REPAIR_ATTEMPTS;
        const droppedCount = spec.tiles.length - tileValidation.tiles.length;
        const subset = { ...spec, tiles: tileValidation.tiles };
        if (
          lastAttempt &&
          tileValidation.tiles.length &&
          !agenticDashboardSpecIssues(subset).length
        ) {
          return {
            status: "validated",
            spec: {
              ...subset,
              notes: [
                ...subset.notes,
                `Dropped ${droppedCount} tile(s) that did not pass PostHog SQL validation.`,
              ],
            },
            attempts: attempt,
            repairFeedback: tileValidation.issues,
          };
        }
        repairFeedback = tileValidation.issues;
        continue;
      }

      return {
        status: "validated",
        spec: { ...spec, tiles: tileValidation.tiles },
        attempts: attempt,
        repairFeedback,
      };
    }

    return {
      status: "failed",
      attempts: MAX_AGENT_DASHBOARD_REPAIR_ATTEMPTS,
      repairFeedback,
    };
  }

  private async validateTiles(
    projectId: string,
    candidateTiles: AgenticDashboardTile[],
  ): Promise<{ tiles: AgenticDashboardTile[]; issues: string[] }> {
    const issues: string[] = [];
    const tiles: AgenticDashboardTile[] = [];
    for (const tile of candidateTiles) {
      try {
        await this.executeSql({
          projectId,
          query: tile.validationSql,
        });
        tiles.push(tile);
      } catch (error) {
        issues.push(
          `Query for "${tile.title}" failed PostHog validation: ${(error as Error).message}`,
        );
      }
    }
    return { tiles, issues };
  }
}

export function evidenceSummary(evidence: AgenticEvidence): string {
  const sections = [
    evidence.schema ? "schema" : undefined,
    evidence.topEvents ? "top events" : undefined,
    evidence.conversionSignalCandidates ? "conversion signals" : undefined,
    evidence.scopedPageActivity ? "scoped page activity" : undefined,
    evidence.candidatePages ? "candidate pages" : undefined,
  ].filter(Boolean);
  const suffix = evidence.errors.length
    ? `; ${evidence.errors.length} evidence query issue(s)`
    : "";
  return `Collected ${sections.join(", ") || "no live evidence"}${suffix}.`;
}

function agenticDashboardSystemPrompt(): string {
  return [
    "You are operating inside a constrained dashboard-spec harness, not a code editor.",
    "You design PostHog PoC dashboards for pre-sales pilots.",
    "Return JSON only. Do not hardcode guessed event names when live evidence is provided.",
    "Use the buyer's transcript-derived business goal, success criteria, open questions, and PostHog evidence.",
    `You may use up to ${MAX_AGENT_RECONNAISSANCE_STEPS} internal reconnaissance and planning steps before returning JSON.`,
    "First make sense of the available data: identify live events, URL/company/page scope, conversion signals, gaps, and caveats.",
    "Only propose dashboard tiles that follow from that data assessment. Do not use planned events unless live evidence confirms them.",
    "Strongly prefer to proceed over asking. Default to building the dashboard.",
    "Only set clarificationRequired true when a tile cannot be defined at all from the transcript, success criteria, assumptions, and live evidence together — that is, when no defensible default exists or a blocking input such as the target project is missing.",
    "When a metric is merely ambiguous but a reasonable default exists (for example absolute counts versus percentage of pageviews, or an engaged-session threshold), choose the most standard PM default, build the tile, and record the exact definition you chose as a caveat in notes and in the tile description. Do not ask the buyer to choose between equivalent reasonable options.",
    "If the provided assumptions authorize sensible defaults or say to prefer visible caveats over blocking, honor that and do not ask.",
    "When you do ask, keep clarificationQuestions to genuinely blocking business definitions only.",
    "Do not ask technical questions about SQL, MCP, schemas, implementation, or dashboard widget types.",
    "Choose a distinct dashboardName that can coexist with earlier generic or synthetic setup dashboards. Make the name PM/business-oriented and do not include raw PoC ids or UUIDs in buyer-visible dashboard or tile names.",
    "Every tile must include validationSql and insightQuery.",
    "validationSql must be a PostHog HogQL/SQL query that can be run with execute-sql.",
    "Write robust, simple HogQL. Prefer aggregations like count(), countIf(), uniq() and GROUP BY over clever string parsing.",
    "To bucket landing pages, companies, or campaigns from a URL, use case-insensitive substring matching on properties.$current_url, for example multiIf(properties.$current_url ILIKE '%enmovil%', 'Enmovil', properties.$current_url ILIKE '%bizom%', 'Bizom', 'Other').",
    "Do not use extractAllGroups, regex capture groups, or array indexing like [1] on URL columns; on PostHog they can raise 'Nested type Array(Array(String)) cannot be inside Nullable type'. Do not wrap a column in nullIf when it feeds an array or extraction function.",
    "If a tile's query keeps failing validation, simplify or drop that tile and ship the dashboard with the tiles that do validate, noting the omission, rather than blocking the whole dashboard.",
    "For SQL-style tiles, insightQuery must use kind DataVisualizationNode with a HogQLQuery source and an explicit display.",
    "Prefer chart displays such as ActionsLineGraph, ActionsBar, ActionsStackedBar, or ActionsAreaGraph for PM dashboards; use ActionsTable only when the row details are the point.",
    "Include at least one real graph tile, not only tables or KPI numbers, when live data supports it.",
    "Make each tile title self-describing about axes, e.g. 'Demo requests by day (x = day, y = requests)' or 'Widget sessions by company (x = company, y = sessions)', because SQL visualizations may not show axis titles.",
    "For table tiles, make the title describe rows or columns, e.g. '(rows = landing page)' or '(columns = sessions, captures, demos)'.",
    "Exclude synthetic PoC validation or smoke-test events from PM dashboards unless they are the only available data and clearly mark that as a note.",
  ].join(" ");
}

function normalizeAgenticDashboardSpec(value: unknown): AgenticDashboardSpec | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const tiles = Array.isArray(value.tiles)
    ? value.tiles
        .map(normalizeAgenticDashboardTile)
        .filter((tile): tile is AgenticDashboardTile => Boolean(tile))
    : [];

  return {
    dashboardName: optionalString(value.dashboardName),
    dashboardDescription: optionalString(value.dashboardDescription),
    clarificationRequired: Boolean(value.clarificationRequired),
    clarificationQuestions: stringArray(value.clarificationQuestions),
    dataAssessment: stringArray(value.dataAssessment),
    tiles,
    notes: stringArray(value.notes),
  };
}

function normalizeAgenticDashboardTile(value: unknown): AgenticDashboardTile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const title = optionalString(value.title);
  const validationSql = optionalString(value.validationSql);
  const insightQuery = value.insightQuery;
  if (!title || !validationSql || !isRecord(insightQuery)) {
    return undefined;
  }

  return {
    title,
    description: optionalString(value.description),
    validationSql,
    insightQuery,
  };
}

function agenticDashboardSpecIssues(spec: AgenticDashboardSpec): string[] {
  const issues: string[] = [];
  if (!spec.dataAssessment.length) {
    issues.push("Add dataAssessment explaining which live data is usable before planning tiles.");
  }
  if (containsUuid(spec.dashboardName)) {
    issues.push("Remove raw PoC ids or UUIDs from the buyer-visible dashboardName.");
  }
  if (!spec.tiles.length) {
    issues.push("Add at least one dashboard tile.");
    return issues;
  }

  let chartCount = 0;
  for (const tile of spec.tiles) {
    if (containsUuid(tile.title)) {
      issues.push(`Remove raw PoC ids or UUIDs from tile title "${tile.title}".`);
    }
    const display = insightDisplay(tile.insightQuery);
    if (!display) {
      issues.push(`Tile "${tile.title}" must set insightQuery.display explicitly.`);
      continue;
    }
    if (!ALLOWED_SQL_DISPLAYS.has(display)) {
      issues.push(
        `Tile "${tile.title}" uses unsupported display "${display}". Use ${[...ALLOWED_SQL_DISPLAYS].join(", ")}.`,
      );
      continue;
    }
    if (CHART_DISPLAYS.has(display)) {
      chartCount += 1;
      if (!titleDescribesChartAxis(tile.title)) {
        issues.push(
          `Chart tile "${tile.title}" must describe axes in the title, such as "x = day, y = sessions".`,
        );
      }
    }
    if (display === "ActionsTable" && !titleDescribesTableShape(tile.title)) {
      issues.push(`Table tile "${tile.title}" must describe rows or columns in the title.`);
    }
    if (!isDataVisualizationHogQlQuery(tile.insightQuery)) {
      issues.push(`Tile "${tile.title}" must use a DataVisualizationNode with HogQLQuery source.`);
    }
  }
  if (chartCount === 0) {
    issues.push(
      "Include at least one real chart display such as ActionsLineGraph, ActionsBar, ActionsStackedBar, or ActionsAreaGraph.",
    );
  }

  return issues;
}

function insightDisplay(query: Record<string, unknown>): string | undefined {
  return typeof query.display === "string" ? query.display : undefined;
}

function isDataVisualizationHogQlQuery(query: Record<string, unknown>): boolean {
  if (query.kind !== "DataVisualizationNode" || !isRecord(query.source)) {
    return false;
  }
  return query.source.kind === "HogQLQuery" && typeof query.source.query === "string";
}

function titleDescribesChartAxis(title: string): boolean {
  const lower = title.toLowerCase();
  return lower.includes("x =") || lower.includes("y =") || lower.includes(" by ");
}

function titleDescribesTableShape(title: string): boolean {
  const lower = title.toLowerCase();
  return lower.includes("rows =") || lower.includes("columns =") || lower.includes(" by ");
}

function containsUuid(value: string | undefined): boolean {
  return Boolean(
    value && /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(value),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}
