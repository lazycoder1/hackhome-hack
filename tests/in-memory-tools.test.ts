import {
  InMemoryApprovalTool,
  InMemoryAuditTool,
  InMemoryEmailTool,
  InMemoryPostHogEventCaptureTool,
  InMemoryPostHogGateway,
  InMemorySecretsTool,
  ResourceValidationTool,
} from "../src/tools/in-memory-tools.js";

describe("in-memory tools", () => {
  it("records sent email and exposes inbox messages for local workflows", async () => {
    const email = new InMemoryEmailTool({
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const sent = await email.sendEmail({
      to: ["buyer@acme.test"],
      subject: "Please confirm",
      markdownBody: "Approved?",
    });
    email.addIncomingEmail({
      from: "buyer@acme.test",
      to: ["sales@example.test"],
      subject: "Re: Please confirm",
      textBody: "Approved",
      threadId: sent.threadId,
    });

    expect(sent).toMatchObject({ emailId: "email-1", threadId: "thread-1" });
    expect(email.sentEmails).toHaveLength(1);
    expect(await email.checkInbox({ threadId: sent.threadId })).toMatchObject({
      messages: [{ from: "buyer@acme.test", textBody: "Approved" }],
    });
  });

  it("creates approval waitpoints that can be completed once", async () => {
    const approval = new InMemoryApprovalTool({
      baseApprovalUrl: "https://approve.test",
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const waitpoint = await approval.createApprovalWaitpoint({
      pocId: "poc_123",
      timeout: "7d",
      approverEmails: ["buyer@acme.test"],
      idempotencyKey: "poc:poc_123:approval:v1",
    });

    expect(waitpoint.publicApprovalUrl).toBe("https://approve.test/approval-token-1");
    expect(
      await approval.completeApprovalWaitpoint({
        tokenId: waitpoint.tokenId,
        decision: "approved",
        decidedBy: "buyer@acme.test",
      }),
    ).toEqual({ success: true });
    expect(approval.getDecision(waitpoint.tokenId)?.decision).toBe("approved");
  });

  it("deduplicates approval waitpoints by idempotency key instead of PoC id", async () => {
    const approval = new InMemoryApprovalTool({
      baseApprovalUrl: "https://approve.test",
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const first = await approval.createApprovalWaitpoint({
      pocId: "poc_123",
      timeout: "7d",
      approverEmails: ["buyer@acme.test"],
      idempotencyKey: "poc:poc_123:approval:v1",
    });
    const duplicate = await approval.createApprovalWaitpoint({
      pocId: "poc_123",
      timeout: "7d",
      approverEmails: ["buyer@acme.test"],
      idempotencyKey: "poc:poc_123:approval:v1",
    });
    const revised = await approval.createApprovalWaitpoint({
      pocId: "poc_123",
      timeout: "7d",
      approverEmails: ["buyer@acme.test"],
      idempotencyKey: "poc:poc_123:approval:v2",
    });

    expect(duplicate.tokenId).toBe(first.tokenId);
    expect(revised.tokenId).toBe("approval-token-2");
    expect(revised.publicApprovalUrl).toBe("https://approve.test/approval-token-2");
  });

  it("stores secrets behind one-time links without putting raw values in the URL", async () => {
    const secrets = new InMemorySecretsTool({
      baseSecretUrl: "https://secrets.test",
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const secret = await secrets.createSecret({
      pocId: "poc_123",
      name: "posthog_project_access",
      value: "raw-secret-value",
      ttl: "7d",
    });
    const link = await secrets.createOneTimeSecretLink({
      secretRef: secret.secretRef,
      recipientEmail: "buyer@acme.test",
      expiresIn: "7d",
    });

    expect(link.url).not.toContain("raw-secret-value");
    const token = link.url.split("/").pop();
    expect(await secrets.consumeOneTimeSecretLink({ token: token ?? "" })).toMatchObject({
      status: "consumed",
      value: "raw-secret-value",
    });
    expect(await secrets.consumeOneTimeSecretLink({ token: token ?? "" })).toEqual({
      status: "used",
    });
  });

  it("creates local PostHog resource refs for demo runs", async () => {
    const posthog = new InMemoryPostHogGateway();

    const project = await posthog.getProject("project-1");
    await posthog.updateProjectSettings("project-1", { timezone: "UTC" });
    const action = await posthog.createAction({
      projectId: "project-1",
      name: "Completed Signup",
      description: "User completes signup",
      matchEvents: ["signup_completed"],
    });
    const dashboard = await posthog.createDashboard({
      projectId: "project-1",
      name: "PoC - Acme - poc_123",
    });
    const insight = await posthog.createInsight({
      projectId: "project-1",
      dashboardId: dashboard.id,
      name: "poc_123: Signup funnel",
      type: "funnel",
      sourceEvents: ["signup_completed"],
    });

    expect(project.url).toBe("https://posthog.example.test/project/project-1");
    expect(action).toMatchObject({ type: "action", name: "Completed Signup" });
    expect(insight).toMatchObject({ type: "insight", name: "poc_123: Signup funnel" });
    expect(posthog.getProjectState("project-1")?.settings).toEqual({ timezone: "UTC" });
  });

  it("validates required resource groups for setup handoff", async () => {
    const validation = new ResourceValidationTool({
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const report = await validation.validatePosthogSetup({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      expectedResources: {
        actions: [{ type: "action", id: "action-1", name: "Completed Signup" }],
        dashboards: [{ type: "dashboard", id: "dashboard-1", name: "PoC Dashboard" }],
        insights: [{ type: "insight", id: "insight-1", name: "Signup funnel" }],
      },
    });

    expect(report.status).toBe("pass");
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("records synthetic event capture and reports validation warnings when capture is skipped", async () => {
    const capture = new InMemoryPostHogEventCaptureTool({
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });
    const sent = await capture.captureSyntheticEvents({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      hostUrl: "https://us.i.posthog.com",
      events: [{ name: "signup_completed" }],
    });
    const validation = new ResourceValidationTool({
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const report = await validation.validatePosthogSetup({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      expectedResources: {
        actions: [{ type: "action", id: "action-1", name: "Completed Signup" }],
        dashboards: [{ type: "dashboard", id: "dashboard-1", name: "PoC Dashboard" }],
        insights: [{ type: "insight", id: "insight-1", name: "Signup funnel" }],
      },
      syntheticEventCapture: {
        ...sent,
        status: "skipped",
        eventsSent: 0,
        reason: "POSTHOG_PROJECT_API_KEY is not configured.",
      },
      syntheticEventVisibility: {
        status: "not_visible",
        requestedEventCount: 1,
        visibleEventCount: 0,
        missingEventNames: ["signup_completed"],
        visibleEventNames: [],
        attempts: 2,
        checkedAt: "2026-06-04T00:00:00.000Z",
      },
    });

    expect(capture.captures[0]).toMatchObject({
      pocId: "poc_123",
      eventNames: ["signup_completed"],
    });
    expect(report.status).toBe("warn");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "synthetic-events",
        status: "warn",
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "synthetic-event-visibility",
        status: "warn",
      }),
    );
  });

  it("records audit events", async () => {
    const audit = new InMemoryAuditTool({
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    await audit.writeAuditLog({
      pocId: "poc_123",
      actor: "orchestrator",
      action: "submit_requirements_blob",
      status: "succeeded",
    });

    expect(audit.events).toMatchObject([
      {
        auditEventId: "audit-1",
        pocId: "poc_123",
        actor: "orchestrator",
      },
    ]);
  });
});
