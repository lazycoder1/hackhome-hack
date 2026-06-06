import type { HandoffPackage, PocPlan, PosthogResourceRef, SetupResult } from "../contracts.js";

export type HandoffGeneratorInput = {
  plan: PocPlan;
  setupResult: SetupResult;
  forbiddenSecrets?: string[];
  extraNotes?: string;
};

export class HandoffGenerator {
  generate(input: HandoffGeneratorInput): HandoffPackage {
    const { plan, setupResult } = input;
    const projectLink = {
      label: "PostHog project",
      url: setupResult.posthog.projectUrl,
      kind: "posthog_project" as const,
    };
    const dashboardLinks = setupResult.createdResources
      .filter((resource) => resource.type === "dashboard" && resource.url)
      .map((resource) => ({
        label: resource.name,
        url: resource.url as string,
        kind: "dashboard" as const,
      }));
    const secretLinks = setupResult.credentialRefs
      .filter((credential) => credential.oneTimeLink)
      .map((credential) => ({
        label: credential.name,
        url: credential.oneTimeLink as string,
        kind: "secret" as const,
      }));
    const links = [projectLink, ...dashboardLinks, ...secretLinks];

    const markdownBody = [
      `Hi ${plan.customer.contacts[0]?.name ?? plan.customer.companyName},`,
      "",
      "Your PostHog PoC is ready for testing.",
      "",
      "## Access",
      "",
      `- PostHog project: ${setupResult.posthog.projectUrl}`,
      ...dashboardLinks.map((link) => `- ${link.label}: ${link.url}`),
      ...secretLinks.map((link) => `- Temporary credential link: ${link.url}`),
      `- Credential link expiry: ${firstCredentialExpiry(setupResult) ?? "Not set"}`,
      "",
      "For security, credentials are delivered through one-time links and are not included directly in this email.",
      "",
      "## What was configured",
      "",
      ...resourceSummary(setupResult.createdResources),
      "",
      "## Event taxonomy",
      "",
      ...eventTaxonomy(plan),
      "",
      "## SDK setup",
      "",
      ...sdkInstructions(setupResult),
      "",
      "## Testing plan",
      "",
      testingPlan(plan),
      "",
      "## Validation status",
      "",
      `Status: ${setupResult.validationReport?.status ?? "not_run"}`,
      "",
      setupResult.validationReport?.summary ?? "Validation was not run.",
      "",
      "## Known gaps",
      "",
      ...knownGaps(setupResult),
      "",
      "## Next steps",
      "",
      "1. Open the PostHog project and confirm access.",
      "2. Install or verify the PostHog SDK in your test environment.",
      "3. Send the listed test events.",
      "4. Confirm the dashboard updates.",
      `5. Review results${plan.handoffPlan.reviewDate ? ` on ${plan.handoffPlan.reviewDate}` : ""}.`,
      "",
      `PoC teardown or access review date: ${plan.handoffPlan.teardownDate ?? "Not set"}`,
      input.extraNotes ? ["", "## Notes", "", input.extraNotes].join("\n") : "",
    ]
      .filter((line) => line !== undefined)
      .join("\n");

    const containsRawSecrets = containsForbiddenSecret(markdownBody, input.forbiddenSecrets ?? []);
    if (containsRawSecrets) {
      throw new Error("Handoff body contains a raw secret value");
    }

    return {
      pocId: plan.pocId,
      recipients: plan.handoffPlan.recipients,
      subject: "Your PostHog PoC is ready: testing plan and access details",
      markdownBody,
      links,
      securityReview: {
        containsRawSecrets,
        credentialLinksExpireAt: firstCredentialExpiry(setupResult),
        piiNotes: plan.securityConstraints?.piiPolicy ? [plan.securityConstraints.piiPolicy] : [],
      },
    };
  }
}

function firstCredentialExpiry(setupResult: SetupResult): string | undefined {
  return setupResult.credentialRefs.find((credential) => credential.expiresAt)?.expiresAt;
}

function resourceSummary(resources: PosthogResourceRef[]): string[] {
  if (!resources.length) {
    return ["- No resources were created."];
  }

  return resources.map((resource) => {
    const link = resource.url ? ` (${resource.url})` : "";
    return `- ${resource.type}: ${resource.name}${link}`;
  });
}

function eventTaxonomy(plan: PocPlan): string[] {
  if (!plan.setup.events.length) {
    return ["- No explicit events were configured in the plan."];
  }

  return plan.setup.events.map((event) => `- \`${event.name}\`: ${event.description}`);
}

function sdkInstructions(setupResult: SetupResult): string[] {
  if (!setupResult.sdkInstructions.length) {
    return ["No SDK instructions were generated."];
  }

  return setupResult.sdkInstructions.map(
    (instruction) => `### ${instruction.platform}\n\n${instruction.markdown}`,
  );
}

function knownGaps(setupResult: SetupResult): string[] {
  const gaps = [...setupResult.knownGaps, ...(setupResult.validationReport?.knownGaps ?? [])];
  return gaps.length ? gaps.map((gap) => `- ${gap}`) : ["- None"];
}

function testingPlan(plan: PocPlan): string {
  const primaryEvent = plan.setup.events[0]?.name ?? "test_event";
  const coreAction = plan.setup.actions[0]?.name ?? "the core product action";

  return [
    "### Test 1: SDK initialization",
    "",
    "Goal: Confirm the app can send events to the correct PostHog project.",
    "",
    "Steps:",
    "",
    "1. Install the PostHog SDK for the test platform.",
    "2. Initialize with the provided host URL and project API key.",
    "3. Load the app in the test environment.",
    "4. Confirm a `$pageview` or equivalent event appears in PostHog.",
    "",
    "Expected result: the event appears in PostHog with environment and test-user identifiers.",
    "",
    "### Test 2: Identity capture",
    "",
    "Goal: Confirm users can be identified consistently.",
    "",
    `Capture \`${primaryEvent}\` after identifying a test user.`,
    "",
    "### Test 3: Funnel validation",
    "",
    `Trigger the planned events and confirm the dashboard reflects ${plan.successCriteria[0] ?? "the PoC success criterion"}.`,
    "",
    "### Test 4: Core feature usage",
    "",
    `Perform ${coreAction} and confirm the related event appears in PostHog.`,
  ].join("\n");
}

function containsForbiddenSecret(body: string, forbiddenSecrets: string[]): boolean {
  return forbiddenSecrets.some((secret) => secret.length > 0 && body.includes(secret));
}
