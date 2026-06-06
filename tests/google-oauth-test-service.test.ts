import { GoogleOAuthTestService } from "../src/integrations/google-oauth-test-service.js";

describe("GoogleOAuthTestService", () => {
  it("builds an authorization URL and stores the exchanged token in memory", async () => {
    let now = new Date("2026-06-05T10:00:00.000Z").getTime();
    const requests: unknown[] = [];
    const service = new GoogleOAuthTestService({
      clientId: "client-123",
      clientSecret: "secret-123",
      authUrl: "https://accounts.example.test/oauth",
      tokenUrl: "https://oauth.example.test/token",
      userinfoUrl: "https://oauth.example.test/userinfo",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.compose"],
      tokenStorePath: "",
      clock: () => new Date(now),
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        if (String(url).endsWith("/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ya29.memory",
              refresh_token: "refresh.memory",
              expires_in: 3600,
              scope: "openid email https://www.googleapis.com/auth/gmail.compose",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ email: "tester@example.test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const authUrl = new URL(
      service.createAuthorizationUrl({
        origin: "http://localhost:5173",
        returnTo: "/settings",
      }),
    );
    const state = authUrl.searchParams.get("state");

    expect(authUrl.origin + authUrl.pathname).toBe("https://accounts.example.test/oauth");
    expect(authUrl.searchParams.get("client_id")).toBe("client-123");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/integrations/google/oauth/callback",
    );
    expect(authUrl.searchParams.get("scope")).toContain("gmail.compose");
    expect(state).toBeTruthy();

    const result = await service.handleCallback({ code: "code-123", state });

    expect(result).toEqual({
      returnTo: "http://localhost:5173/settings",
      email: "tester@example.test",
      expiresAt: "2026-06-05T11:00:00.000Z",
    });
    expect(service.accessToken()).toBe("ya29.memory");
    expect(service.status()).toMatchObject({
      configured: true,
      connected: true,
      email: "tester@example.test",
      memoryOnly: true,
      storage: "memory",
    });

    const tokenRequest = requests[0] as { url: string; init: RequestInit };
    expect(tokenRequest.url).toBe("https://oauth.example.test/token");
    expect(String(tokenRequest.init.body)).toContain("grant_type=authorization_code");

    now = new Date("2026-06-05T11:00:00.000Z").getTime();
    expect(service.accessToken()).toBeUndefined();
    expect(service.status().connected).toBe(false);

    const refreshed = await service.freshAccessToken();
    expect(refreshed).toBe("ya29.memory");
  });

  it("refreshes an expired token with the stored refresh token", async () => {
    let now = new Date("2026-06-05T10:00:00.000Z").getTime();
    const requests: unknown[] = [];
    const service = new GoogleOAuthTestService({
      clientId: "client-123",
      clientSecret: "secret-123",
      tokenUrl: "https://oauth.example.test/token",
      userinfoUrl: "https://oauth.example.test/userinfo",
      tokenStorePath: "",
      clock: () => new Date(now),
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        const body = String(init?.body);
        if (body.includes("grant_type=authorization_code")) {
          return new Response(
            JSON.stringify({
              access_token: "ya29.initial",
              refresh_token: "refresh.initial",
              expires_in: 60,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.includes("grant_type=refresh_token")) {
          return new Response(
            JSON.stringify({
              access_token: "ya29.refreshed",
              expires_in: 3600,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ email: "tester@example.test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const authUrl = new URL(service.createAuthorizationUrl({ origin: "http://localhost:5173" }));
    await service.handleCallback({ code: "code-123", state: authUrl.searchParams.get("state") });
    now = new Date("2026-06-05T10:02:00.000Z").getTime();

    await expect(service.freshAccessToken()).resolves.toBe("ya29.refreshed");
    expect(String((requests.at(-1) as { init: RequestInit }).init.body)).toContain(
      "grant_type=refresh_token",
    );
    expect(service.accessToken()).toBe("ya29.refreshed");
  });

  it("rejects expired OAuth state and never stores a token", async () => {
    let now = new Date("2026-06-05T10:00:00.000Z").getTime();
    const service = new GoogleOAuthTestService({
      clientId: "client-123",
      clientSecret: "secret-123",
      authUrl: "https://accounts.example.test/oauth",
      tokenStorePath: "",
      clock: () => new Date(now),
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      },
    });
    const authUrl = new URL(
      service.createAuthorizationUrl({
        origin: "http://localhost:5173",
        returnTo: "https://evil.example.test/callback",
      }),
    );
    now += 11 * 60 * 1000;

    await expect(
      service.handleCallback({ code: "code-123", state: authUrl.searchParams.get("state") }),
    ).rejects.toThrow(/state is expired or invalid/);
    expect(service.accessToken()).toBeUndefined();
  });

  it("clears the in-memory token and reports missing client configuration", () => {
    const service = new GoogleOAuthTestService({ env: {}, tokenStorePath: "" });

    expect(service.status()).toMatchObject({
      configured: false,
      connected: false,
      memoryOnly: true,
      storage: "memory",
    });
    expect(() =>
      service.createAuthorizationUrl({ origin: "http://localhost:5173", returnTo: "/settings" }),
    ).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
    expect(service.forget()).toMatchObject({ connected: false });
  });
});
