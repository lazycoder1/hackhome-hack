import { HttpMcpToolClient } from "../mcp/http-mcp-tool-client.js";
import type { McpToolClient } from "../mcp/types.js";
import type {
  PostHogSyntheticEventVerifier,
  SyntheticEventVisibilityResult,
} from "../tools/types.js";
import { posthogMcpEndpoint } from "./posthog-mcp-gateway.js";

export type PostHogMcpSyntheticEventVerifierOptions = {
  toolClient?: McpToolClient;
  endpoint?: string;
  apiKey?: string;
  organizationId?: string;
  projectId?: string;
  maxAttempts?: number;
  delayMs?: number;
  clock?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export class PostHogMcpSyntheticEventVerifier implements PostHogSyntheticEventVerifier {
  private readonly toolClient: McpToolClient;
  private readonly maxAttempts: number;
  private readonly delayMs: number;
  private readonly clock: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: PostHogMcpSyntheticEventVerifierOptions = {}) {
    this.toolClient =
      options.toolClient ??
      new HttpMcpToolClient({
        endpoint: options.endpoint ?? posthogMcpEndpoint(),
        apiKey: options.apiKey ?? process.env.POSTHOG_MCP_API_KEY,
        organizationId: options.organizationId ?? process.env.POSTHOG_ORGANIZATION_ID,
        projectId: options.projectId ?? process.env.POSTHOG_PROJECT_ID,
      });
    this.maxAttempts = options.maxAttempts ?? numberEnv("POSTHOG_SYNTHETIC_VERIFY_ATTEMPTS", 5);
    this.delayMs = options.delayMs ?? numberEnv("POSTHOG_SYNTHETIC_VERIFY_DELAY_MS", 2000);
    this.clock = options.clock ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async verifySyntheticEvents(input: {
    pocId: string;
    posthogProjectId: string;
    eventNames: string[];
  }): Promise<SyntheticEventVisibilityResult> {
    const eventNames = unique(input.eventNames);
    const checkedAt = this.clock().toISOString();

    if (!eventNames.length) {
      return {
        status: "skipped",
        requestedEventCount: 0,
        visibleEventCount: 0,
        missingEventNames: [],
        visibleEventNames: [],
        attempts: 0,
        checkedAt,
        reason: "No synthetic event names were provided.",
      };
    }

    const query = syntheticEventVisibilityQuery(input.pocId, eventNames);
    let lastError: string | undefined;
    let lastVisibleEventNames: string[] = [];

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const result = await this.toolClient.callTool("execute-sql", {
          projectId: input.posthogProjectId,
          query,
        });
        lastVisibleEventNames = visibleEventNamesFromQueryResult(result);
        const missingEventNames = eventNames.filter(
          (eventName) => !lastVisibleEventNames.includes(eventName),
        );
        if (!missingEventNames.length) {
          return {
            status: "visible",
            requestedEventCount: eventNames.length,
            visibleEventCount: lastVisibleEventNames.length,
            missingEventNames,
            visibleEventNames: lastVisibleEventNames,
            attempts: attempt,
            checkedAt: this.clock().toISOString(),
            query,
          };
        }
      } catch (error) {
        lastError = (error as Error).message;
      }

      if (attempt < this.maxAttempts) {
        await this.sleep(this.delayMs);
      }
    }

    const missingEventNames = eventNames.filter(
      (eventName) => !lastVisibleEventNames.includes(eventName),
    );
    return {
      status: lastError ? "failed" : "not_visible",
      requestedEventCount: eventNames.length,
      visibleEventCount: lastVisibleEventNames.length,
      missingEventNames,
      visibleEventNames: lastVisibleEventNames,
      attempts: this.maxAttempts,
      checkedAt: this.clock().toISOString(),
      query,
      reason: lastError
        ? undefined
        : "Synthetic events were not visible before retry attempts were exhausted.",
      error: lastError,
    };
  }
}

export function syntheticEventVisibilityQuery(pocId: string, eventNames: string[]): string {
  return [
    "SELECT event, count() AS count",
    "FROM events",
    `WHERE timestamp >= now() - INTERVAL 1 DAY`,
    `AND properties.poc_id = ${sqlString(pocId)}`,
    `AND event IN (${unique(eventNames).map(sqlString).join(", ")})`,
    "GROUP BY event",
    "LIMIT 100",
  ].join("\n");
}

export function visibleEventNamesFromQueryResult(result: unknown): string[] {
  return unique(
    extractRows(result)
      .flatMap(eventNameFromRow)
      .filter((eventName): eventName is string => Boolean(eventName)),
  );
}

function eventNameFromRow(row: unknown): string | undefined {
  if (Array.isArray(row)) {
    return typeof row[0] === "string" && Number(row[1] ?? 1) > 0 ? row[0] : undefined;
  }

  if (row && typeof row === "object") {
    const record = row as Record<string, unknown>;
    const eventName = typeof record.event === "string" ? record.event : undefined;
    const count = Number(record.count ?? record.count_ ?? record["count()"] ?? 1);
    return eventName && count > 0 ? eventName : undefined;
  }

  return undefined;
}

function extractRows(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return rowsFromTextTable(value);
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  for (const key of ["rows", "results", "data", "result"]) {
    const child = record[key];
    if (Array.isArray(child)) {
      return child;
    }
    const nested = extractRows(child);
    if (nested.length) {
      return nested;
    }
  }

  return [];
}

function rowsFromTextTable(value: string): Record<string, string>[] {
  const tables = [...value.matchAll(/```(?:[^\n]*)\n([\s\S]*?)```/g)].map((match) =>
    match[1]?.trim(),
  );

  for (const table of tables) {
    if (!table) {
      continue;
    }
    const lines = table
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2 || !lines[0]?.includes("|")) {
      continue;
    }

    const headers = splitTableLine(lines[0]);
    const eventIndex = headers.indexOf("event");
    if (eventIndex < 0) {
      continue;
    }

    return lines.slice(1).map((line) => {
      const values = splitTableLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
  }

  return [];
}

function splitTableLine(line: string): string[] {
  return line.split("|").map((value) => value.trim());
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
