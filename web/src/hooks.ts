import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { PocStatusDetail, PocStatusSummary } from "./types";

export function usePocs(pollMs = 4000) {
  const [pocs, setPocs] = useState<PocStatusSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const next = await api.listPocs();
      setError(null);
      // detect newly-appeared pocs so the board can flash them
      const fresh = new Set<string>();
      for (const p of next) {
        if (seen.current.size && !seen.current.has(p.pocId)) fresh.add(p.pocId);
        seen.current.add(p.pocId);
      }
      if (fresh.size) {
        setFlashIds(fresh);
        setTimeout(() => setFlashIds(new Set()), 2500);
      }
      setPocs(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  return { pocs, error, flashIds, reload: load };
}

export function usePoc(pocId: string | undefined, pollMs = 4000) {
  const [poc, setPoc] = useState<PocStatusDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!pocId) return;
    try {
      const next = await api.getPoc(pocId);
      setPoc(next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [pocId]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  return { poc, error, loading, reload: load };
}
