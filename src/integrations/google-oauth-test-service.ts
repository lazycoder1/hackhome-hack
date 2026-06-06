import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DEFAULT_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
];
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_SKEW_MS = 30 * 1000;

export type GoogleOAuthStatus = {
  configured: boolean;
  connected: boolean;
  email?: string;
  expiresAt?: string;
  scopes: string[];
  provider: string;
  deliveryMode: "draft" | "send";
  memoryOnly: boolean;
  storage: "memory" | "file";
};

export type GoogleOAuthTestServiceOptions = {
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  provider?: string;
  deliveryMode?: "draft" | "send";
  authUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  tokenStorePath?: string;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  env?: NodeJS.ProcessEnv;
};

type PendingState = {
  redirectUri: string;
  returnTo: string;
  createdAt: number;
};

type StoredToken = {
  accessToken: string;
  refreshToken?: string;
  email?: string;
  expiresAt: string;
  scopes: string[];
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export class GoogleOAuthTestService {
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly scopes: string[];
  private readonly provider: string;
  private readonly deliveryMode: "draft" | "send";
  private readonly authUrl: string;
  private readonly tokenUrl: string;
  private readonly userinfoUrl: string;
  private readonly tokenStorePath?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;
  private readonly states = new Map<string, PendingState>();
  private token?: StoredToken;

  constructor(options: GoogleOAuthTestServiceOptions = {}) {
    const env = options.env ?? process.env;
    this.clientId = options.clientId ?? env.GOOGLE_OAUTH_CLIENT_ID;
    this.clientSecret = options.clientSecret ?? env.GOOGLE_OAUTH_CLIENT_SECRET;
    this.scopes = options.scopes ?? scopesFromEnv(env.GOOGLE_OAUTH_SCOPES) ?? DEFAULT_SCOPES;
    this.provider = options.provider ?? env.GMAIL_MCP_PROVIDER ?? "workspace";
    this.deliveryMode =
      options.deliveryMode ??
      (env.GMAIL_MCP_DELIVERY_MODE?.toLowerCase() === "send" ? "send" : "draft");
    this.authUrl = options.authUrl ?? DEFAULT_GOOGLE_AUTH_URL;
    this.tokenUrl = options.tokenUrl ?? DEFAULT_GOOGLE_TOKEN_URL;
    this.userinfoUrl = options.userinfoUrl ?? DEFAULT_GOOGLE_USERINFO_URL;
    this.tokenStorePath =
      options.tokenStorePath ??
      env.GOOGLE_OAUTH_TOKEN_STORE_PATH ??
      ".data/google-oauth-token.json";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.token = this.loadToken();
  }

  status(): GoogleOAuthStatus {
    const connected = Boolean(this.accessToken());
    return {
      configured: this.configured,
      connected,
      email: connected ? this.token?.email : undefined,
      expiresAt: connected ? this.token?.expiresAt : undefined,
      scopes: this.scopes,
      provider: this.provider,
      deliveryMode: this.deliveryMode,
      memoryOnly: !this.tokenStorePath,
      storage: this.tokenStorePath ? "file" : "memory",
    };
  }

  accessToken(): string | undefined {
    if (!this.token) {
      return undefined;
    }
    const expiresAtMs = Date.parse(this.token.expiresAt);
    if (
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= this.clock().getTime() + TOKEN_EXPIRY_SKEW_MS
    ) {
      return undefined;
    }
    return this.token.accessToken;
  }

  async freshAccessToken(): Promise<string | undefined> {
    const currentToken = this.accessToken();
    if (currentToken) {
      return currentToken;
    }
    if (!this.token?.refreshToken || !this.configured) {
      return undefined;
    }

    const refreshed = await this.refreshToken(this.token.refreshToken);
    this.token = {
      ...this.token,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? this.token.refreshToken,
      expiresAt: new Date(
        this.clock().getTime() + Math.max(1, refreshed.expires_in ?? 3600) * 1000,
      ).toISOString(),
      scopes: refreshed.scope ? refreshed.scope.split(/\s+/).filter(Boolean) : this.token.scopes,
    };
    this.saveToken();
    return this.token.accessToken;
  }

  createAuthorizationUrl(input: { origin: string; returnTo?: string }): string {
    this.assertConfigured();
    this.pruneExpiredStates();

    const state = randomBytes(24).toString("base64url");
    const redirectUri = new URL("/integrations/google/oauth/callback", input.origin).toString();
    this.states.set(state, {
      redirectUri,
      returnTo: new URL(safeReturnTo(input.returnTo), input.origin).toString(),
      createdAt: this.clock().getTime(),
    });

    const url = new URL(this.authUrl);
    url.searchParams.set("client_id", this.clientId!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }

  async handleCallback(input: { code?: string | null; state?: string | null }): Promise<{
    returnTo: string;
    email?: string;
    expiresAt: string;
  }> {
    this.assertConfigured();
    if (!input.code || !input.state) {
      throw new Error("Google OAuth callback is missing code or state");
    }

    const pending = this.states.get(input.state);
    this.states.delete(input.state);
    if (!pending || this.isExpiredState(pending)) {
      throw new Error("Google OAuth state is expired or invalid");
    }

    const token = await this.exchangeCode(input.code, pending.redirectUri);
    const email = await this.fetchEmail(token.access_token);
    const expiresAt = new Date(
      this.clock().getTime() + Math.max(1, token.expires_in ?? 3600) * 1000,
    ).toISOString();
    const scopes = token.scope ? token.scope.split(/\s+/).filter(Boolean) : this.scopes;

    this.token = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      email,
      expiresAt,
      scopes,
    };
    this.saveToken();

    return { returnTo: pending.returnTo, email, expiresAt };
  }

  forget(): GoogleOAuthStatus {
    this.token = undefined;
    this.states.clear();
    this.deleteSavedToken();
    return this.status();
  }

  private get configured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required");
    }
  }

  private async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<Required<Pick<TokenResponse, "access_token">> & TokenResponse> {
    const response = await this.fetchImpl(this.tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId!,
        client_secret: this.clientSecret!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Google OAuth token exchange failed with ${response.status}: ${await response.text()}`,
      );
    }

    const token = (await response.json()) as TokenResponse;
    if (!token.access_token) {
      throw new Error("Google OAuth token exchange did not return an access token");
    }
    return token as Required<Pick<TokenResponse, "access_token">> & TokenResponse;
  }

  private async refreshToken(
    refreshToken: string,
  ): Promise<Required<Pick<TokenResponse, "access_token">> & TokenResponse> {
    const response = await this.fetchImpl(this.tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId!,
        client_secret: this.clientSecret!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Google OAuth token refresh failed with ${response.status}: ${await response.text()}`,
      );
    }

    const token = (await response.json()) as TokenResponse;
    if (!token.access_token) {
      throw new Error("Google OAuth token refresh did not return an access token");
    }
    return token as Required<Pick<TokenResponse, "access_token">> & TokenResponse;
  }

  private async fetchEmail(accessToken: string): Promise<string | undefined> {
    const response = await this.fetchImpl(this.userinfoUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as { email?: unknown };
    return typeof body.email === "string" ? body.email : undefined;
  }

  private pruneExpiredStates(): void {
    for (const [state, pending] of this.states) {
      if (this.isExpiredState(pending)) {
        this.states.delete(state);
      }
    }
  }

  private isExpiredState(pending: PendingState): boolean {
    return this.clock().getTime() - pending.createdAt > STATE_TTL_MS;
  }

  private loadToken(): StoredToken | undefined {
    if (!this.tokenStorePath) {
      return undefined;
    }
    try {
      const token = JSON.parse(readFileSync(this.tokenStorePath, "utf8")) as StoredToken;
      return token && typeof token.accessToken === "string" ? token : undefined;
    } catch {
      return undefined;
    }
  }

  private saveToken(): void {
    if (!this.tokenStorePath || !this.token) {
      return;
    }
    mkdirSync(dirname(this.tokenStorePath), { recursive: true });
    writeFileSync(this.tokenStorePath, `${JSON.stringify(this.token, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  private deleteSavedToken(): void {
    if (!this.tokenStorePath) {
      return;
    }
    try {
      rmSync(this.tokenStorePath);
    } catch {
      // Token storage is best-effort test plumbing.
    }
  }
}

function scopesFromEnv(value: string | undefined): string[] | undefined {
  const scopes = value?.split(/\s+/).filter(Boolean);
  return scopes?.length ? scopes : undefined;
}

function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/settings";
  }
  return value;
}
