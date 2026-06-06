import { z } from "zod";

/**
 * Signals a client-side error (bad request body) that the server renders as a JSON
 * response with the carried `status`. Thrown by {@link parseBody}; caught centrally
 * in the request handler so endpoints don't each repeat 400-handling.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super("http_error");
    this.name = "HttpError";
  }
}

const participantSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  role: z.string().optional(),
  company: z.string().optional(),
});

/** Body for `POST /requirements` — mirrors SubmitRequirementsBlobInput. */
export const requirementsBlobSchema = z.object({
  source: z.enum(["api", "file"]),
  text: z.string(),
  filename: z.string().optional(),
  participants: z.array(participantSchema),
  structuredHints: z.record(z.unknown()).optional(),
  sourceMetadata: z.object({
    sourceId: z.string().optional(),
    receivedAt: z.string().optional(),
  }),
});

/** Body for `POST /approval/complete` — mirrors ApprovalCompletionInput. */
export const approvalCompletionSchema = z.object({
  tokenId: z.string(),
  publicAccessToken: z.string(),
  decision: z.enum(["approved", "rejected", "needs_changes"]),
  decidedBy: z.string(),
  notes: z.string().optional(),
  changes: z.array(z.string()).optional(),
});

const inboundEmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  textBody: z.string(),
  receivedAt: z.string(),
});

/** Body for `POST /email/inbound` — mirrors the processEmailReply input. */
export const emailReplySchema = z.object({
  pocId: z.string(),
  message: inboundEmailMessageSchema,
});

export const monitoringRunSchema = z.object({
  window: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .optional(),
});

/** Body for `POST /pocs/:pocId/retry` — restarts a persisted workflow stage. */
export const retryPocStageSchema = z.object({
  stage: z.enum(["setup", "handoff"]),
  requestedBy: z.string().optional(),
});

const pocLifecycleStatusSchema = z.enum([
  "intake_received",
  "requirements_extracted",
  "needs_clarification",
  "confirmation_sent",
  "approved",
  "rejected",
  "setup_queued",
  "setup_running",
  "validation_running",
  "handoff_ready",
  "handoff_sent",
  "handoff_sent_with_gaps",
  "dashboard_revision_requested",
  "active_poc",
  "monitoring_running",
  "monitoring_at_risk",
  "monitoring_criteria_met",
  "needs_human_review",
  "failed",
  "completed",
  "teardown_queued",
  "teardown_complete",
]);

/** Body for `POST /pocs/:pocId/status` — manually updates the visible PoC stage. */
export const updatePocStatusSchema = z.object({
  status: pocLifecycleStatusSchema,
  requestedBy: z.string().optional(),
  note: z.string().optional(),
});

/** Body for `POST /email/inbound/gmail-mcp` — accepts a Gmail MCP read-email result. */
export const gmailMcpInboundSchema = z.object({
  pocId: z.string().optional(),
  email: z.record(z.unknown()),
});

/** Body for `POST /integrations/google/test-draft` — local OAuth/Gmail smoke test. */
export const googleTestDraftSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

/**
 * Parse a raw request body as JSON and validate it against `schema`.
 *
 * @returns the validated, typed value.
 * @throws HttpError 400 (`invalid_json`) when the body is not JSON, or
 *   400 (`invalid_request`) with per-field issues when it fails the schema.
 */
export function parseBody<T>(raw: string, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : undefined;
  } catch {
    throw new HttpError(400, { error: "invalid_json" });
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new HttpError(400, {
      error: "invalid_request",
      details: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
