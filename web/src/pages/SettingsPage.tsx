import { useEffect, useState } from "react";
import { PageHeader } from "../components/AppShell";
import { Banner, Dot, KeyVal, Section, Spinner } from "../components/ui";
import { api } from "../api";
import type { GoogleIntegrationStatus } from "../types";

export function SettingsPage() {
  const [status, setStatus] = useState<GoogleIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectedParam = new URLSearchParams(window.location.search).get("gmail") === "connected";

  const load = async () => {
    try {
      setError(null);
      setStatus(await api.googleStatus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const connect = () => {
    const params = new URLSearchParams({
      returnTo: "/settings",
      origin: window.location.origin,
    });
    window.location.href = `/integrations/google/oauth/start?${params.toString()}`;
  };

  const forget = async () => {
    setBusy(true);
    try {
      setStatus(await api.forgetGoogleOAuth());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Test-only connectors for local PoC runs." />
      <div className="mx-auto max-w-3xl space-y-5 px-6 py-6 md:px-8">
        {connectedParam && <Banner tone="success">Gmail connected for this server session.</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}

        <Section
          title="Gmail OAuth"
          right={
            status && (
              <span className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-[var(--color-muted)]">
                <Dot
                  color={
                    status.connected
                      ? "var(--color-grass)"
                      : status.configured
                        ? "var(--color-warn)"
                        : "var(--color-fail)"
                  }
                  live={status.connected}
                />
                {status.connected ? "Connected" : status.configured ? "Ready" : "Missing env"}
              </span>
            )
          }
        >
          {loading ? (
            <Spinner label="Loading connector…" />
          ) : !status ? (
            <Banner tone="danger">Unable to load Google OAuth status.</Banner>
          ) : (
            <div className="grid gap-5">
              {!status.configured && (
                <Banner tone="warn">
                  Set <span className="mono">GOOGLE_OAUTH_CLIENT_ID</span> and{" "}
                  <span className="mono">GOOGLE_OAUTH_CLIENT_SECRET</span>, then restart the API.
                </Banner>
              )}

              <dl className="grid gap-x-6 sm:grid-cols-2">
                <KeyVal k="Account">{status.email ?? "Not connected"}</KeyVal>
                <KeyVal k="Token">{status.connected ? status.storage : "None"}</KeyVal>
                <KeyVal k="Delivery">{status.deliveryMode === "send" ? "Send" : "Draft"}</KeyVal>
                <KeyVal k="Provider">{status.provider}</KeyVal>
                <KeyVal k="Expires">
                  {status.expiresAt ? new Date(status.expiresAt).toLocaleString() : "n/a"}
                </KeyVal>
                <KeyVal k="Scopes">{status.scopes.length ? status.scopes.join(" ") : "n/a"}</KeyVal>
              </dl>

              <div className="flex flex-wrap items-center gap-3">
                <button className="btn btn-primary" disabled={!status.configured} onClick={connect}>
                  Connect Gmail
                </button>
                <button className="btn" disabled={!status.connected || busy} onClick={forget}>
                  {busy ? "Clearing…" : "Forget token"}
                </button>
                <span className="text-xs font-semibold text-[var(--color-muted)]">
                  Stored locally for test runs.
                </span>
              </div>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
