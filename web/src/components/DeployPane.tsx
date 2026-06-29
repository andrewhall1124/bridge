import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { RailwayConfig, RailwayProject, RailwayStatus } from "../protocol";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Map Railway deployment status to a color class (phosphor palette + red).
function statusClass(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "dep-ok";
    case "BUILDING":
    case "DEPLOYING":
    case "INITIALIZING":
    case "QUEUED":
    case "WAITING":
    case "NEEDS_APPROVAL":
      return "dep-active";
    case "FAILED":
    case "CRASHED":
      return "dep-bad";
    default:
      return "dep-idle";
  }
}

export function DeployPane() {
  const [config, setConfig] = useState<RailwayConfig | null>(null);
  const [projects, setProjects] = useState<RailwayProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [env, setEnv] = useState<string | null>(null);
  const [status, setStatus] = useState<RailwayStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Initial config + (best-effort) project list.
  useEffect(() => {
    let alive = true;
    api
      .getRailwayConfig()
      .then((c) => {
        if (!alive) return;
        setConfig(c);
        setProjectId(c.projectId);
        setEnv(c.environment);
        if (c.configured) {
          api
            .getRailwayProjects()
            .then((r) => alive && setProjects(r.projects))
            .catch(() => {});
        }
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, []);

  const loadStatus = useCallback(async () => {
    if (!config?.configured) return;
    if (!projectId && !config.projectId) return;
    setLoading(true);
    try {
      const s = await api.getRailwayStatus(projectId ?? undefined, env ?? undefined);
      setStatus(s);
      setProjectId((prev) => prev ?? s.projectId);
      setEnv((prev) => prev ?? s.environment.name);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [config, projectId, env]);

  // Load on selection change + auto-refresh every 10s.
  useEffect(() => {
    if (!config?.configured) return;
    if (!projectId && !config.projectId) return;
    void loadStatus();
    const t = setInterval(() => void loadStatus(), 10000);
    return () => clearInterval(t);
  }, [config, loadStatus, projectId]);

  if (!config) {
    return <div className="empty-state subtle">Loading…</div>;
  }

  if (!config.configured) {
    return (
      <div className="deploy-setup">
        <h3>Railway not configured</h3>
        <p className="subtle">
          Set a Railway API token to see your deployments. Add to{" "}
          <code>config.json</code> or the environment:
        </p>
        <pre className="deploy-code">{`RAILWAY_API_TOKEN=your-token
RAILWAY_PROJECT_ID=optional-default-project
RAILWAY_ENVIRONMENT=production`}</pre>
        <p className="subtle">
          Get a token at{" "}
          <a
            href="https://railway.com/account/tokens"
            target="_blank"
            rel="noopener noreferrer"
          >
            railway.com/account/tokens
          </a>
          , then restart the server.
        </p>
      </div>
    );
  }

  const needProject = !projectId && !config.projectId;
  const envList = status?.environments ?? [];

  return (
    <div className="deploy-pane">
      <div className="deploy-toolbar">
        <label className="deploy-field">
          <span className="subtle">Project</span>
          <select
            value={projectId ?? ""}
            onChange={(e) => {
              setProjectId(e.target.value || null);
              setEnv(config.environment);
              setStatus(null);
            }}
          >
            {needProject && <option value="">Select a project…</option>}
            {projects.length === 0 && projectId && (
              <option value={projectId}>{status?.projectName ?? projectId}</option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="deploy-field">
          <span className="subtle">Environment</span>
          <select
            value={env ?? ""}
            onChange={(e) => {
              setEnv(e.target.value);
              setStatus(null);
            }}
          >
            {envList.length === 0 && env && <option value={env}>{env}</option>}
            {envList.map((e) => (
              <option key={e.id} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </label>

        <span className="spacer" />
        {updatedAt && (
          <span className="subtle deploy-updated">
            updated {relTime(new Date(updatedAt).toISOString())}
          </span>
        )}
        <button
          className="btn btn-sm"
          onClick={() => void loadStatus()}
          disabled={loading}
        >
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {error && <div className="system-line error deploy-error">⚠ {error}</div>}

      {needProject && !error && (
        <div className="empty-state subtle">Select a project to see its services.</div>
      )}

      {status && (
        <div className="deploy-table">
          <div className="dep-row dep-head">
            <span className="dep-svc">Service</span>
            <span className="dep-badge-col">Status</span>
            <span className="dep-commit">Latest deployment</span>
            <span className="dep-time">When</span>
            <span className="dep-link-col" />
          </div>
          {status.services.length === 0 && (
            <div className="empty-state subtle">No services in this environment.</div>
          )}
          {status.services.map((s) => {
            const d = s.latest;
            const subject = d?.commitMessage?.split("\n")[0] ?? null;
            const link = d?.staticUrl
              ? `https://${d.staticUrl.replace(/^https?:\/\//, "")}`
              : d?.url ?? null;
            return (
              <div className="dep-row" key={s.id}>
                <span className="dep-svc" title={s.name}>
                  {s.name}
                </span>
                <span className="dep-badge-col">
                  {d ? (
                    <span className={`dep-badge ${statusClass(d.status)}`}>
                      {d.status}
                    </span>
                  ) : (
                    <span className="dep-badge dep-idle">NONE</span>
                  )}
                </span>
                <span className="dep-commit">
                  {subject ? (
                    <>
                      <span className="dep-subject" title={d?.commitMessage ?? ""}>
                        {subject}
                      </span>
                      {d?.commitHash && (
                        <span className="dep-sha">{d.commitHash.slice(0, 7)}</span>
                      )}
                    </>
                  ) : (
                    <span className="subtle">—</span>
                  )}
                </span>
                <span className="dep-time subtle">{relTime(d?.createdAt ?? null)}</span>
                <span className="dep-link-col">
                  {link && (
                    <a
                      className="dep-link"
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open"
                    >
                      ↗
                    </a>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
