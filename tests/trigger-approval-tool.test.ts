import { TriggerApprovalTool } from "../src/tools/trigger-approval-tool.js";

describe("TriggerApprovalTool", () => {
  it("creates waitpoint tokens with tags and returns an approval URL", async () => {
    const calls: unknown[] = [];
    const tool = new TriggerApprovalTool({
      baseApprovalUrl: "https://app.example.test/approve",
      waitApi: {
        async createToken(input) {
          calls.push(input);
          return {
            id: "waitpoint_123",
            url: "https://api.trigger.dev/api/v1/waitpoints/tokens/waitpoint_123/complete",
            publicAccessToken: "public-token",
          };
        },
        async completeToken() {
          return { success: true };
        },
      },
    });

    const result = await tool.createApprovalWaitpoint({
      pocId: "poc_123",
      timeout: "7d",
      approverEmails: ["buyer@acme.test"],
      idempotencyKey: "poc:poc_123:approval:v1",
    });

    expect(calls[0]).toEqual({
      timeout: "7d",
      idempotencyKey: "poc:poc_123:approval:v1",
      tags: ["poc:poc_123", "product:posthog", "stage:approval"],
    });
    expect(result).toEqual({
      tokenId: "waitpoint_123",
      publicApprovalUrl:
        "https://app.example.test/approve?tokenId=waitpoint_123&publicAccessToken=public-token",
      expiresAt: "",
    });
  });

  it("completes approval waitpoint tokens through Trigger", async () => {
    const completed: unknown[] = [];
    const tool = new TriggerApprovalTool({
      waitApi: {
        async createToken() {
          throw new Error("not used");
        },
        async completeToken(tokenId, output) {
          completed.push({ tokenId, output });
          return { success: true };
        },
      },
    });

    const result = await tool.completeApprovalWaitpoint({
      tokenId: "waitpoint_123",
      decision: "approved",
      decidedBy: "buyer@acme.test",
      notes: "Looks good",
    });

    expect(result).toEqual({ success: true });
    expect(completed).toEqual([
      {
        tokenId: "waitpoint_123",
        output: {
          decision: "approved",
          decidedBy: "buyer@acme.test",
          notes: "Looks good",
          changes: undefined,
        },
      },
    ]);
  });
});
