import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { ClaudeUsage, ClaudeUsageLimit } from "../../protocol";

export function UsageSettings() {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const u = await api.getUsage();
      if (alive.current) setUsage(u);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }

  if (loading && !usage) return <div className="subtle">Loading…</div>;

  return (
    <>
      <p className="subtle">
        Claude subscription rate-limit windows
        {usage?.subscriptionType && (
          <>
            {" "}
            on the <strong>{planLabel(usage.subscriptionType)}</strong> plan
          </>
        )}
        . These are the same numbers Claude Code's <code>/usage</code> screen shows.
      </p>

      {usage && usage.limits.length === 0 && (
        <p className="subtle">No limit data returned.</p>
      )}

      {usage && (
        <div className="usage-limits">
          {usage.limits.map((limit, i) => (
            <UsageBar key={`${limit.kind}-${limit.model ?? i}`} limit={limit} />
          ))}
        </div>
      )}

      <div className="settings-actions">
        <button className="btn btn-sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        {usage && (
          <span className="subtle">Updated {new Date(usage.fetchedAt).toLocaleTimeString()}</span>
        )}
      </div>

      {error && <span className="system-line error">⚠ {error}</span>}
    </>
  );
}

function UsageBar({ limit }: { limit: ClaudeUsageLimit }) {
  const pct = Math.max(0, Math.min(100, limit.percent));
  const level = pct >= 95 ? "critical" : pct >= 80 ? "warn" : "ok";
  return (
    <div className="usage-limit">
      <div className="usage-limit-head">
        <span>{limitLabel(limit)}</span>
        <span className="usage-limit-pct">{Math.round(pct)}%</span>
      </div>
      <div className="usage-bar">
        <div className={`usage-bar-fill ${level}`} style={{ width: `${pct}%` }} />
      </div>
      {limit.resetsAt && (
        <div className="subtle usage-limit-reset">Resets {formatReset(limit.resetsAt)}</div>
      )}
    </div>
  );
}

function limitLabel(limit: ClaudeUsageLimit): string {
  switch (limit.kind) {
    case "session":
      return "Current session (5-hour window)";
    case "weekly_all":
      return "Weekly — all models";
    case "weekly_scoped":
      return limit.model ? `Weekly — ${limit.model}` : "Weekly — model-scoped";
    default:
      return limit.model ? `${limit.kind} — ${limit.model}` : limit.kind;
  }
}

function planLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function formatReset(iso: string): string {
  const resetMs = Date.parse(iso);
  if (Number.isNaN(resetMs)) return iso;
  const deltaMin = Math.round((resetMs - Date.now()) / 60_000);
  const abs = new Date(resetMs).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  if (deltaMin <= 0) return abs;
  if (deltaMin < 60) return `in ${deltaMin} min (${abs})`;
  const hours = Math.round(deltaMin / 60);
  if (hours < 48) return `in ${hours} h (${abs})`;
  return `in ${Math.round(hours / 24)} days (${abs})`;
}
