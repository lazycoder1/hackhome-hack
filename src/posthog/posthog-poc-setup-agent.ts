import type { PocPlan, PosthogResourceRef, SetupResult } from "../contracts.js";
import type { LlmJsonClient } from "../llm/types.js";
import {
  evidenceSummary,
  type AgenticDashboardSpec,
  type AgenticDashboardTile,
  type AgenticEvidence,
  PostHogAgenticDashboardHarness,
} from "./posthog-agentic-dashboard-harness.js";
import type {
  AuditTool,
  PostHogEventCaptureTool,
  PostHogSyntheticEventVerifier,
  PostHogToolGateway,
  SecretsTool,
  ValidationTool,
} from "../tools/types.js";

export type PostHogPocSetupAgentOptions = {
  posthog: PostHogToolGateway;
  secrets: SecretsTool;
  validation: ValidationTool;
  eventCapture?: PostHogEventCaptureTool;
  syntheticEventVerifier?: PostHogSyntheticEventVerifier;
  llm?: LlmJsonClient;
  agenticDashboardModel?: string;
  audit: AuditTool;
  clock?: () => Date;
};

type DashboardTileForCreation = PocPlan["setup"]["dashboards"][number]["tiles"][number] & {
  description?: string;
  insightQuery?: Record<string, unknown>;
};

export class PostHogPocSetupAgent {
  private readonly posthog: PostHogToolGateway;
  private readonly secrets: SecretsTool;
  private readonly validation: ValidationTool;
  private readonly eventCapture?: PostHogEventCaptureTool;
  private readonly syntheticEventVerifier?: PostHogSyntheticEventVerifier;
  private readonly llm?: LlmJsonClient;
  private readonly agenticDashboardModel: string;
  private readonly audit: AuditTool;
  private readonly clock: () => Date;

  constructor(options: PostHogPocSetupAgentOptions) {
    this.posthog = options.posthog;
    this.secrets = options.secrets;
    this.validation = options.validation;
    this.eventCapture = options.eventCapture;
    this.syntheticEventVerifier = options.syntheticEventVerifier;
    this.llm = options.llm;
    this.agenticDashboardModel = options.agenticDashboardModel ?? "deepseek-v4-flash";
    this.audit = options.audit;
    this.clock = options.clock ?? (() => new Date());
  }

  async setup(plan: PocPlan): Promise<SetupResult> {
    if (plan.status !== "approved") {
      throw new Error(`Cannot set up a PoC plan with status ${plan.status}`);
    }
    if (!plan.posthogTarget.projectId) {
      throw new Error("PostHog projectId is required for setup");
    }

    const createdResources: PosthogResourceRef[] = [];
    const updatedResources: PosthogResourceRef[] = [];
    const skippedResources: SetupResult["skippedResources"] = [];
    const auditEventIds: string[] = [];
    const knownGaps: string[] = [];
    const projectId = plan.posthogTarget.projectId;
    const now = this.clock().toISOString();

    auditEventIds.push(
      (
        await this.audit.writeAuditLog({
          pocId: plan.pocId,
          actor: "posthog_setup_agent",
          action: "setup_started",
          target: projectId,
          status: "succeeded",
          createdAt: now,
        })
      ).auditEventId,
    );

    try {
      const project = await this.posthog.getProject(projectId);
      await this.posthog.updateProjectSettings(projectId, plan.setup.projectSettings);

      for (const action of plan.setup.actions) {
        const actionRef = await createOrUseExistingResource({
          type: "action",
          name: action.name,
          create: () =>
            this.posthog.createAction({
              projectId,
              name: action.name,
              description: action.description,
              matchEvents: action.matchEvents,
              tags: [`poc:${plan.pocId}`, "source:poc-automation"],
            }),
          skippedResources,
        });
        createdResources.push(actionRef);
      }

      const dashboards: PosthogResourceRef[] = [];
      const insights: PosthogResourceRef[] = [];

      for (const dashboard of plan.setup.dashboards) {
        const agenticSpec = await this.tryPlanAgenticDashboard({
          plan,
          dashboard,
          projectId,
          knownGaps,
        });
        if (agenticSpec?.clarificationRequired) {
          const questions = agenticSpec.clarificationQuestions.join("; ");
          knownGaps.push(
            `DeepSeek requested business clarification before dashboard creation: ${questions}`,
          );
          skippedResources.push({
            reason: `DeepSeek requested business clarification before dashboard creation: ${questions}`,
            resource: { type: "dashboard", name: dashboard.name },
          });
          continue;
        }

        const validatedTiles = agenticSpec
          ? await this.validateAgenticTiles({
              projectId,
              tiles: agenticSpec.tiles,
              knownGaps,
              skippedResources,
            })
          : undefined;

        if (agenticSpec && validatedTiles?.issues.length) {
          const reason = [
            `DeepSeek dashboard "${agenticSpec.dashboardName ?? dashboard.name}" was not created because one or more generated chart queries failed final PostHog validation.`,
            ...validatedTiles.issues,
          ].join(" ");
          knownGaps.push(reason);
          skippedResources.push({
            reason,
            resource: { type: "dashboard", name: agenticSpec.dashboardName ?? dashboard.name },
          });
          continue;
        }

        if (agenticSpec && !validatedTiles?.tiles.length) {
          knownGaps.push(
            `DeepSeek did not produce any PostHog queries that validated for dashboard "${dashboard.name}".`,
          );
          skippedResources.push({
            reason: "No DeepSeek-generated dashboard tile queries validated.",
            resource: { type: "dashboard", name: dashboard.name },
          });
          continue;
        }

        const dashboardRef = await createOrUseExistingResource({
          type: "dashboard",
          name: agenticSpec?.dashboardName ?? dashboard.name,
          create: () =>
            this.posthog.createDashboard({
              projectId,
              name: agenticSpec?.dashboardName ?? dashboard.name,
              description: agenticSpec?.dashboardDescription ?? dashboard.description,
              tags: [`poc:${plan.pocId}`, "source:poc-automation"],
            }),
          skippedResources,
        });
        dashboards.push(dashboardRef);
        createdResources.push(dashboardRef);

        const tiles =
          validatedTiles?.tiles.map(agenticTileForCreation) ??
          dashboardTiles(dashboard.tiles, plan.setup.events);
        for (const tile of tiles) {
          const insight = await createOrUseExistingResource({
            type: "insight",
            name: tile.title,
            create: () =>
              this.posthog.createInsight({
                projectId,
                dashboardId: dashboardRef.id,
                name: tile.title,
                description: tile.description ?? tile.successCriterion,
                type: tile.type,
                sourceEvents: tile.sourceEvents,
                query: "insightQuery" in tile ? tile.insightQuery : undefined,
                tags: [`poc:${plan.pocId}`, "source:poc-automation"],
              }),
            skippedResources,
          });
          insights.push(insight);
          createdResources.push(insight);
        }
      }

      for (const cohort of plan.setup.cohorts) {
        if (!this.posthog.createCohort) {
          skippedResources.push({
            reason: "PostHog gateway does not support cohort creation.",
            resource: { type: "cohort", name: cohort.name },
          });
          continue;
        }
        createdResources.push(
          await this.posthog.createCohort({
            projectId,
            name: cohort.name,
            description: cohort.description,
            criteria: cohort.criteria,
            tags: [`poc:${plan.pocId}`, "source:poc-automation"],
          }),
        );
      }

      for (const flag of plan.setup.featureFlags) {
        if (!this.posthog.createFeatureFlag) {
          skippedResources.push({
            reason: "PostHog gateway does not support feature flag creation.",
            resource: { type: "feature_flag", name: flag.name },
          });
          continue;
        }
        createdResources.push(
          await this.posthog.createFeatureFlag({
            projectId,
            key: flag.key,
            name: flag.name,
            description: flag.description,
            rollout: flag.rollout,
            testUsers: flag.testUsers,
            tags: [`poc:${plan.pocId}`, "source:poc-automation"],
          }),
        );
      }

      for (const experiment of plan.setup.experiments) {
        if (!this.posthog.createExperiment) {
          skippedResources.push({
            reason: "PostHog gateway does not support experiment creation.",
            resource: { type: "experiment", name: experiment.name },
          });
          continue;
        }
        createdResources.push(
          await this.posthog.createExperiment({
            projectId,
            name: experiment.name,
            hypothesis: experiment.hypothesis,
            variants: experiment.variants,
            primaryMetric: experiment.primaryMetric,
            launchDuringPoC: experiment.launchDuringPoC,
            tags: [`poc:${plan.pocId}`, "source:poc-automation"],
          }),
        );
      }

      for (const survey of plan.setup.surveys) {
        if (!this.posthog.createSurvey) {
          skippedResources.push({
            reason: "PostHog gateway does not support survey creation.",
            resource: { type: "survey", name: survey.name },
          });
          continue;
        }
        createdResources.push(
          await this.posthog.createSurvey({
            projectId,
            name: survey.name,
            questions: survey.questions,
            launchDuringPoC: survey.launchDuringPoC,
            tags: [`poc:${plan.pocId}`, "source:poc-automation"],
          }),
        );
      }

      for (const alert of plan.setup.alerts) {
        skippedResources.push({
          reason:
            "Alert creation requires a concrete PostHog insight, subscribed users, and threshold configuration. The plan currently contains a human-readable alert condition.",
          resource: { type: "alert", name: alert.name },
        });
      }

      const secret = await this.secrets.createSecret({
        pocId: plan.pocId,
        name: "posthog_project_access",
        value: JSON.stringify({
          projectUrl: project.url,
          projectId,
          note: "Use customer-owned login or invite flow. Do not email raw credentials.",
        }),
        ttl: "7d",
        tags: [`poc:${plan.pocId}`, "product:posthog"],
      });

      const firstRecipient = plan.handoffPlan.recipients[0] ?? plan.customer.contacts[0]?.email;
      const oneTimeLink = firstRecipient
        ? await this.secrets.createOneTimeSecretLink({
            secretRef: secret.secretRef,
            recipientEmail: firstRecipient,
            expiresIn: "7d",
          })
        : undefined;

      const syntheticEventCapture = this.eventCapture
        ? await this.eventCapture.captureSyntheticEvents({
            pocId: plan.pocId,
            posthogProjectId: projectId,
            hostUrl: project.hostUrl,
            events: plan.validationPlan.syntheticEvents,
          })
        : undefined;

      if (syntheticEventCapture) {
        auditEventIds.push(
          (
            await this.audit.writeAuditLog({
              pocId: plan.pocId,
              actor: "posthog_setup_agent",
              action: "capture_synthetic_events",
              target: projectId,
              outputSummary: `${syntheticEventCapture.eventsSent}/${syntheticEventCapture.requestedEventCount} synthetic event(s) sent`,
              status:
                syntheticEventCapture.status === "sent"
                  ? "succeeded"
                  : syntheticEventCapture.status === "skipped"
                    ? "skipped"
                    : "failed",
              error: syntheticEventCapture.error,
              createdAt: now,
            })
          ).auditEventId,
        );
      }

      const syntheticEventVisibility =
        syntheticEventCapture?.status === "sent" && this.syntheticEventVerifier
          ? await this.syntheticEventVerifier.verifySyntheticEvents({
              pocId: plan.pocId,
              posthogProjectId: projectId,
              eventNames: syntheticEventCapture.eventNames,
            })
          : undefined;

      if (syntheticEventVisibility) {
        auditEventIds.push(
          (
            await this.audit.writeAuditLog({
              pocId: plan.pocId,
              actor: "posthog_setup_agent",
              action: "verify_synthetic_event_visibility",
              target: projectId,
              outputSummary: `${syntheticEventVisibility.visibleEventCount}/${syntheticEventVisibility.requestedEventCount} synthetic event type(s) visible`,
              status: syntheticEventVisibility.status === "visible" ? "succeeded" : "skipped",
              error: syntheticEventVisibility.error,
              createdAt: now,
            })
          ).auditEventId,
        );
      }

      const validationReport = await this.validation.validatePosthogSetup({
        pocId: plan.pocId,
        posthogProjectId: projectId,
        expectedResources: {
          actions: createdResources.filter((resource) => resource.type === "action"),
          dashboards,
          insights,
        },
        expectedEvents: plan.setup.events
          .filter((event) => event.required)
          .map((event) => event.name),
        syntheticEventCapture,
        syntheticEventVisibility,
      });

      const setupStatus =
        validationReport.status === "pass"
          ? "succeeded"
          : validationReport.status === "warn"
            ? "succeeded_with_warnings"
            : "failed";

      auditEventIds.push(
        (
          await this.audit.writeAuditLog({
            pocId: plan.pocId,
            actor: "posthog_setup_agent",
            action: "setup_completed",
            target: projectId,
            outputSummary: setupStatus,
            status: setupStatus === "failed" ? "failed" : "succeeded",
            createdAt: now,
          })
        ).auditEventId,
      );

      return {
        pocId: plan.pocId,
        status: setupStatus,
        posthog: {
          organizationId: project.organizationId ?? plan.posthogTarget.organizationId,
          projectId,
          projectName: project.name,
          projectUrl: project.url,
          hostUrl: project.hostUrl,
        },
        createdResources,
        updatedResources,
        skippedResources,
        credentialRefs: [
          {
            name: "posthog_project_access",
            secretRef: secret.secretRef,
            oneTimeLink: oneTimeLink?.url,
            expiresAt: oneTimeLink?.expiresAt ?? secret.expiresAt,
          },
        ],
        sdkInstructions: buildSdkInstructions(plan, project.hostUrl),
        knownGaps: dedupe([...validationReport.knownGaps, ...knownGaps]),
        validationReport,
        auditEventIds,
      };
    } catch (error) {
      const message = (error as Error).message;
      auditEventIds.push(
        (
          await this.audit.writeAuditLog({
            pocId: plan.pocId,
            actor: "posthog_setup_agent",
            action: "setup_failed",
            target: projectId,
            status: "failed",
            error: message,
            createdAt: now,
          })
        ).auditEventId,
      );
      return failedSetupResult({
        plan,
        projectId,
        createdResources,
        updatedResources,
        skippedResources,
        auditEventIds,
        checkedAt: now,
        error: message,
      });
    }
  }

  private async tryPlanAgenticDashboard(input: {
    plan: PocPlan;
    dashboard: PocPlan["setup"]["dashboards"][number];
    projectId: string;
    knownGaps: string[];
  }): Promise<AgenticDashboardSpec | undefined> {
    if (!this.llm || !this.posthog.executeSql) {
      return undefined;
    }

    try {
      const evidence = await this.collectAgenticEvidence(input.projectId);
      await this.audit.writeAuditLog({
        pocId: input.plan.pocId,
        actor: "posthog_setup_agent",
        action: "data_reconnaissance_completed",
        target: input.projectId,
        outputSummary: evidenceSummary(evidence),
        status: evidence.errors.length ? "skipped" : "succeeded",
        error: evidence.errors.length ? evidence.errors.join("; ") : undefined,
        createdAt: this.clock().toISOString(),
      });

      const harness = new PostHogAgenticDashboardHarness({
        llm: this.llm,
        model: this.agenticDashboardModel,
        executeSql: (queryInput) =>
          this.posthog.executeSql?.(queryInput) ?? Promise.resolve(undefined),
      });
      const result = await harness.plan({
        plan: input.plan,
        dashboard: input.dashboard,
        projectId: input.projectId,
        evidence,
      });

      await this.audit.writeAuditLog({
        pocId: input.plan.pocId,
        actor: "posthog_setup_agent",
        action: "dashboard_harness_completed",
        target: input.projectId,
        outputSummary: `${result.status} after ${result.attempts} attempt(s)`,
        status:
          result.status === "validated" || result.status === "needs_clarification"
            ? "succeeded"
            : "failed",
        error: result.status === "failed" ? result.repairFeedback.join("; ") : undefined,
        createdAt: this.clock().toISOString(),
      });

      if (result.status === "validated" || result.status === "needs_clarification") {
        const caveats = agenticDashboardCaveats(result.spec);
        if (caveats.length) {
          await this.audit.writeAuditLog({
            pocId: input.plan.pocId,
            actor: "posthog_setup_agent",
            action: "dashboard_caveats_recorded",
            target: input.projectId,
            outputSummary: caveats.join(" | "),
            status: "succeeded",
            createdAt: this.clock().toISOString(),
          });
        }
        return result.spec;
      }

      input.knownGaps.push(
        `DeepSeek did not produce a dashboard spec that passed quality and SQL validation: ${result.repairFeedback.join("; ")}`,
      );
      return undefined;
    } catch (error) {
      input.knownGaps.push(`DeepSeek dashboard planning failed: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async collectAgenticEvidence(projectId: string): Promise<AgenticEvidence> {
    const evidence: AgenticEvidence = { errors: [] };

    if (this.posthog.readDataSchema) {
      try {
        evidence.schema = await this.posthog.readDataSchema({ projectId });
      } catch (error) {
        evidence.errors.push(`readDataSchema failed: ${(error as Error).message}`);
      }
    }

    evidence.topEvents = await this.safeExecuteSql(
      projectId,
      `
SELECT event, count() AS event_count, uniq(person_id) AS unique_people, min(timestamp) AS first_seen, max(timestamp) AS last_seen
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
GROUP BY event
ORDER BY event_count DESC
LIMIT 50
`.trim(),
      evidence.errors,
    );

    evidence.conversionSignalCandidates = await this.safeExecuteSql(
      projectId,
      `
SELECT event, count() AS event_count, uniq(person_id) AS unique_people, min(timestamp) AS first_seen, max(timestamp) AS last_seen
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
  AND event NOT IN ('$pageview', '$pageleave', '$web_vitals', '$autocapture')
GROUP BY event
ORDER BY event_count DESC
LIMIT 75
`.trim(),
      evidence.errors,
    );

    evidence.scopedPageActivity = await this.safeExecuteSql(
      projectId,
      `
SELECT event, url, count() AS event_count, uniqExact(session_id) AS sessions
FROM (
  SELECT
    event,
    lower(toString(coalesce(properties['$current_url'], properties['$session_entry_url'], properties['$referrer'], ''))) AS url,
    properties['$session_id'] AS session_id
  FROM events
  WHERE timestamp >= now() - INTERVAL 30 DAY
)
WHERE url != ''
  AND url NOT LIKE '%localhost%'
  AND url NOT LIKE '%127.0.0.1%'
GROUP BY event, url
ORDER BY event_count DESC
LIMIT 100
`.trim(),
      evidence.errors,
    );

    evidence.candidatePages = await this.safeExecuteSql(
      projectId,
      `
SELECT url, count() AS event_count, uniqExact(session_id) AS sessions
FROM (
  SELECT
    lower(toString(coalesce(properties['$current_url'], properties['$session_entry_url'], properties['$referrer'], ''))) AS url,
    properties['$session_id'] AS session_id
  FROM events
  WHERE timestamp >= now() - INTERVAL 30 DAY
)
WHERE url != ''
  AND url NOT LIKE '%localhost%'
  AND url NOT LIKE '%127.0.0.1%'
GROUP BY url
ORDER BY event_count DESC
LIMIT 100
`.trim(),
      evidence.errors,
    );

    return evidence;
  }

  private async safeExecuteSql(
    projectId: string,
    query: string,
    errors: string[],
  ): Promise<unknown> {
    if (!this.posthog.executeSql) {
      return undefined;
    }
    try {
      return await this.posthog.executeSql({ projectId, query });
    } catch (error) {
      errors.push(`executeSql failed: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async validateAgenticTiles(input: {
    projectId: string;
    tiles: AgenticDashboardTile[];
    knownGaps: string[];
    skippedResources: SetupResult["skippedResources"];
  }): Promise<{ tiles: AgenticDashboardTile[]; issues: string[] }> {
    if (!this.posthog.executeSql) {
      return { tiles: [], issues: ["PostHog SQL validation is unavailable."] };
    }

    const validated: AgenticDashboardTile[] = [];
    const issues: string[] = [];
    for (const tile of input.tiles) {
      try {
        await this.posthog.executeSql({
          projectId: input.projectId,
          query: tile.validationSql,
        });
        validated.push(tile);
      } catch (error) {
        const reason = `DeepSeek-generated query did not validate for "${tile.title}": ${(error as Error).message}`;
        issues.push(reason);
        input.knownGaps.push(reason);
        input.skippedResources.push({
          reason,
          resource: { type: "insight", name: tile.title },
        });
      }
    }

    return { tiles: validated, issues };
  }
}

function dashboardTiles(
  tiles: PocPlan["setup"]["dashboards"][number]["tiles"] | undefined,
  events: PocPlan["setup"]["events"],
): DashboardTileForCreation[] {
  if (tiles?.length) {
    return tiles;
  }
  return events.map((event) => ({
    title: humanizeEventName(event.name),
    type: "trend",
    sourceEvents: [event.name],
  }));
}

function agenticDashboardCaveats(spec: AgenticDashboardSpec): string[] {
  const tileCaveats = spec.tiles
    .filter((tile) => tile.description)
    .map((tile) => `${tile.title}: ${tile.description}`);
  return [...spec.notes, ...tileCaveats];
}

function agenticTileForCreation(tile: AgenticDashboardTile): DashboardTileForCreation {
  return {
    title: tile.title,
    description: tile.description,
    type: "other",
    sourceEvents: [],
    insightQuery: tile.insightQuery,
  };
}

async function createOrUseExistingResource(input: {
  type: PosthogResourceRef["type"];
  name: string;
  create: () => Promise<PosthogResourceRef>;
  skippedResources: SetupResult["skippedResources"];
}): Promise<PosthogResourceRef> {
  try {
    return await input.create();
  } catch (error) {
    const message = (error as Error).message;
    const existingId = existingResourceId(message);
    if (!existingId) {
      throw error;
    }

    input.skippedResources.push({
      reason: `Using existing PostHog ${input.type}: ${message}`,
      resource: {
        type: input.type,
        id: existingId,
        name: input.name,
      },
    });
    return {
      type: input.type,
      id: existingId,
      name: input.name,
    };
  }
}

function existingResourceId(message: string): string | undefined {
  return /\bID\s+([A-Za-z0-9_-]+)/i.exec(message)?.[1];
}

function humanizeEventName(value: string): string {
  return value
    .replace(/^[$_]+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function failedSetupResult(input: {
  plan: PocPlan;
  projectId: string;
  createdResources: PosthogResourceRef[];
  updatedResources: PosthogResourceRef[];
  skippedResources: SetupResult["skippedResources"];
  auditEventIds: string[];
  checkedAt: string;
  error: string;
}): SetupResult {
  const knownGap = `PostHog setup failed: ${input.error}`;
  return {
    pocId: input.plan.pocId,
    status: "failed",
    posthog: {
      organizationId: input.plan.posthogTarget.organizationId,
      projectId: input.projectId,
      projectName: input.plan.posthogTarget.projectName,
      projectUrl: input.plan.posthogTarget.projectUrl ?? "",
      hostUrl: "",
    },
    createdResources: input.createdResources,
    updatedResources: input.updatedResources,
    skippedResources: input.skippedResources,
    credentialRefs: [],
    sdkInstructions: [],
    knownGaps: [knownGap],
    validationReport: {
      pocId: input.plan.pocId,
      status: "fail",
      checkedAt: input.checkedAt,
      checks: [
        {
          id: "setup-exception",
          name: "PostHog setup failed",
          status: "fail",
          error: input.error,
        },
      ],
      summary: "PostHog setup failed before validation could complete.",
      knownGaps: [knownGap],
    },
    auditEventIds: input.auditEventIds,
  };
}

function buildSdkInstructions(plan: PocPlan, hostUrl: string): SetupResult["sdkInstructions"] {
  const platforms = new Set(
    plan.setup.events.length ? plan.handoffPlan.recipients.map(() => "web") : ["web"],
  );

  return [...platforms].map((platform) => ({
    platform,
    markdown: [
      `Install the PostHog SDK for ${platform}.`,
      `Initialize it with host URL \`${hostUrl}\` and the project API key from the secure handoff link.`,
      "Capture the PoC test events listed in the handoff testing plan.",
    ].join("\n"),
  }));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
