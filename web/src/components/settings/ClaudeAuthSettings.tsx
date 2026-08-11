import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { ClaudeAuthStatus, ClaudeLoginStart } from "../../protocol";

// Sign in to Claude Code without SSHing into the VPS. The server drives the
// real `claude auth login`; this panel just shows the URL it produced and posts
// back the code you paste from the browser.
export function ClaudeAuthSettings() {
  const [status, setStatus] = useState<ClaudeAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState<ClaudeLoginStart | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cleared on unmount so a slow request can't set state afterwards.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, []);

  async function refresh() {
    try {
      const s = await api.getClaudeAuth();
      if (alive.current) setStatus(s);
    } catch (err) {
      if (alive.current) setError(msg(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }

  async function startLogin() {
    setError(null);
    setNote(null);
    setCode("");
    setBusy(true);
    try {
      const start = await api.startClaudeLogin();
      if (alive.current) setFlow(start);
    } catch (err) {
      if (alive.current) setError(msg(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function finishLogin() {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const result = await api.submitClaudeCode(code);
      if (!alive.current) return;
      if (result.status === "complete") {
        setFlow(null);
        setCode("");
        setStatus(result.auth ?? null);
        setNote("Signed in. New sessions will use these credentials.");
        if (!result.auth) void refresh();
      } else {
        setError(result.error ?? "Sign-in failed.");
      }
    } catch (err) {
      if (alive.current) setError(msg(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.cancelClaudeLogin();
    } catch {
      /* nothing useful to say — the flow is being abandoned either way */
    } finally {
      if (alive.current) {
        setFlow(null);
        setCode("");
        setBusy(false);
        void refresh();
      }
    }
  }

  async function signOut() {
    if (
      !window.confirm(
        "Sign out of Claude Code? Sessions will fail until you sign in again.",
      )
    )
      return;
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await api.signOutClaude();
      await refresh();
      if (alive.current) setNote("Signed out.");
    } catch (err) {
      if (alive.current) setError(msg(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  if (loading) return <div className="subtle">Loading…</div>;

  return (
    <>
      <p className="subtle settings-hint">
        The Claude subscription Bridge runs sessions under. When these
        credentials lapse every session fails, so you can renew them here from
        whichever device you're holding instead of SSHing into the server.
      </p>

      {status?.loggedIn && !flow ? (
        <div className="auth-status">
          <span className="auth-badge">●</span>
          <span>
            Signed in
            {status.email ? (
              <>
                {" as "}
                <strong>{status.email}</strong>
              </>
            ) : null}
            {status.subscriptionType ? ` (${status.subscriptionType})` : ""}
          </span>
          <button className="btn btn-sm" onClick={() => void signOut()} disabled={busy}>
            Sign out
          </button>
        </div>
      ) : flow ? (
        <div className="auth-flow">
          <div className="auth-step">
            <span className="auth-step-label">Step 1 — authorize</span>
            <a
              className="auth-url"
              href={flow.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {flow.url}
            </a>
          </div>

          <div className="auth-step">
            <span className="auth-step-label">Step 2 — paste the code back</span>
            <div className="auth-paste">
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={code}
                placeholder="Paste the authorization code"
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.trim() && !busy) void finishLogin();
                }}
              />
              <button
                className="btn btn-primary"
                onClick={() => void finishLogin()}
                disabled={busy || !code.trim()}
              >
                {busy ? "Signing in…" : "Finish"}
              </button>
              <button className="btn btn-sm" onClick={() => void cancel()} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>

          <p className="subtle">
            This sign-in expires in about {Math.round(flow.expiresIn / 60)} minutes.
          </p>
        </div>
      ) : (
        <div className="settings-actions">
          <button
            className="btn btn-primary"
            onClick={() => void startLogin()}
            disabled={busy}
          >
            {busy ? "Starting…" : "Sign in to Claude"}
          </button>
          {status && !status.loggedIn && (
            <span className="subtle">
              Not signed in — sessions will fail until you do.
            </span>
          )}
          {status?.loginPending && (
            <span className="subtle">
              A sign-in started elsewhere is still waiting; starting again replaces it.
            </span>
          )}
        </div>
      )}

      {note && <span className="subtle">{note}</span>}
      {error && <span className="system-line error">⚠ {error}</span>}
    </>
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
