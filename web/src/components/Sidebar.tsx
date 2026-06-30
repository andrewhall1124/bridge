import type { Repo, SessionMeta, SessionStatus } from "../protocol";

// Aggregate a repo's status from its sessions. Attention states win:
// awaiting_input > error > running > idle.
function repoStatus(sessions: SessionMeta[], repoId: string): SessionStatus {
  let best: SessionStatus = "idle";
  const rank: Record<SessionStatus, number> = {
    idle: 0,
    running: 1,
    error: 2,
    awaiting_input: 3,
  };
  for (const s of sessions) {
    if (s.repoId === repoId && rank[s.status] > rank[best]) best = s.status;
  }
  return best;
}

const STATUS_TITLE: Record<SessionStatus, string> = {
  idle: "Idle",
  running: "Running",
  awaiting_input: "Needs input",
  error: "Error",
};

interface Props {
  repos: Repo[];
  sessions: SessionMeta[];
  selectedRepoId: string | null;
  selectedSessionId: string | null;
  onSelectRepo: (id: string) => void;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (id: string) => void;
  creating: boolean;
}

export function Sidebar({
  repos,
  sessions,
  selectedRepoId,
  selectedSessionId,
  onSelectRepo,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onAddRepo,
  onRemoveRepo,
  creating,
}: Props) {
  const repoSessions = sessions.filter((s) => s.repoId === selectedRepoId);

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-title">
          <span>Repos</span>
          <button className="btn btn-xs btn-primary" onClick={onAddRepo}>
            + Add
          </button>
        </div>
        {repos.length === 0 && (
          <div className="empty-state subtle">
            No repos yet. Use “+ Add” to add a new or existing git repo.
          </div>
        )}
        <ul className="repo-list">
          {repos.map((r) => {
            const status = repoStatus(sessions, r.id);
            return (
            <li key={r.id} className="session-row">
              <button
                className={`repo-item ${
                  r.id === selectedRepoId ? "selected" : ""
                }`}
                onClick={() => onSelectRepo(r.id)}
                title={r.path}
              >
                <span
                  className={`status-dot status-${status}`}
                  title={STATUS_TITLE[status]}
                />
                <span className="session-title">{r.name}</span>
              </button>
              <div className="session-actions">
                <button
                  className="icon-btn icon-btn-sm danger"
                  title="Remove repo (keeps files on disk)"
                  aria-label="Remove repo"
                  onClick={() => onRemoveRepo(r.id)}
                >
                  ✕
                </button>
              </div>
            </li>
            );
          })}
        </ul>
      </div>

      <div className="sidebar-section sessions-section">
        <div className="sidebar-title">
          <span>Sessions</span>
          <button
            className="btn btn-xs btn-primary"
            onClick={onNewSession}
            disabled={!selectedRepoId || creating}
          >
            {creating ? "…" : "+ New"}
          </button>
        </div>
        {!selectedRepoId && (
          <div className="empty-state subtle">Select a repo.</div>
        )}
        {selectedRepoId && repoSessions.length === 0 && (
          <div className="empty-state subtle">No sessions yet.</div>
        )}
        <ul className="session-list">
          {repoSessions.map((s) => (
            <li key={s.id} className="session-row">
              <button
                className={`session-item ${
                  s.id === selectedSessionId ? "selected" : ""
                }`}
                onClick={() => onSelectSession(s.id)}
              >
                <span
                  className={`status-dot status-${s.status}`}
                  title={STATUS_TITLE[s.status]}
                />
                <span className="session-title">{s.title || "Untitled"}</span>
              </button>
              <div className="session-actions">
                <button
                  className="icon-btn icon-btn-sm danger"
                  title="Delete session"
                  aria-label="Delete session"
                  onClick={() => onDeleteSession(s.id)}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
