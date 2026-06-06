import type { EventRequirement } from "../contracts.js";
import type { PostHogEventCaptureTool, SyntheticEventCaptureResult } from "../tools/types.js";

export type PostHogEventCaptureToolOptions = {
  projectApiKey?: string;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
};

export class HttpPostHogEventCaptureTool implements PostHogEventCaptureTool {
  private readonly projectApiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;

  constructor(options: PostHogEventCaptureToolOptions = {}) {
    this.projectApiKey = options.projectApiKey ?? process.env.POSTHOG_PROJECT_API_KEY;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
  }

  async captureSyntheticEvents(input: {
    pocId: string;
    posthogProjectId: string;
    hostUrl: string;
    events: EventRequirement[];
  }): Promise<SyntheticEventCaptureResult> {
    const eventNames = input.events.map((event) => event.name);
    const capturedAt = this.clock().toISOString();

    if (!input.events.length) {
      return {
        status: "skipped",
        requestedEventCount: 0,
        eventsSent: 0,
        eventNames,
        capturedAt,
        reason: "No synthetic events were requested.",
      };
    }

    if (!this.projectApiKey) {
      return {
        status: "skipped",
        requestedEventCount: input.events.length,
        eventsSent: 0,
        eventNames,
        capturedAt,
        reason: "POSTHOG_PROJECT_API_KEY is not configured.",
      };
    }

    try {
      let eventsSent = 0;
      for (const event of input.events) {
        const response = await this.fetchImpl(new URL("/capture/", input.hostUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            api_key: this.projectApiKey,
            event: event.name,
            distinct_id: `${input.pocId}:synthetic-user`,
            timestamp: capturedAt,
            properties: {
              ...(event.testValues ?? {}),
              poc_id: input.pocId,
              posthog_project_id: input.posthogProjectId,
              source: "poc-automation",
              synthetic: true,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`PostHog capture failed for ${event.name}: ${response.status}`);
        }
        eventsSent += 1;
      }

      return {
        status: "sent",
        requestedEventCount: input.events.length,
        eventsSent,
        eventNames,
        capturedAt,
      };
    } catch (error) {
      return {
        status: "failed",
        requestedEventCount: input.events.length,
        eventsSent: 0,
        eventNames,
        capturedAt,
        error: (error as Error).message,
      };
    }
  }
}
