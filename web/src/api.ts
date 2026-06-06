import type { GoogleIntegrationStatus, PocStatusDetail, PocStatusSummary } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${path}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listPocs: (limit = 50) =>
    getJson<{ pocs: PocStatusSummary[] }>(`/pocs?limit=${limit}`).then((r) => r.pocs),
  getPoc: (pocId: string) => getJson<PocStatusDetail>(`/pocs/${encodeURIComponent(pocId)}`),
  health: () => getJson<{ ok: boolean }>("/health"),
  submitRequirements: (payload: {
    source: string;
    text: string;
    participants?: { email: string; company?: string }[];
    sourceMetadata?: Record<string, unknown>;
  }) => postJson<{ pocId?: string; runId?: string; status?: string }>("/requirements", payload),
  completeApproval: (payload: {
    tokenId: string;
    publicAccessToken: string;
    decision: "approved" | "needs_changes" | "rejected";
    decidedBy: string;
    notes?: string;
    changes?: string[];
  }) => postJson<{ ok?: boolean; status?: string }>("/approval/complete", payload),
  googleStatus: () => getJson<GoogleIntegrationStatus>("/integrations/google/status"),
  forgetGoogleOAuth: () =>
    postJson<GoogleIntegrationStatus>("/integrations/google/oauth/forget", {}),
};
