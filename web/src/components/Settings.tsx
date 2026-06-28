import { useEffect, useState } from "react";
import { api } from "../api";
import type { PermissionMode, Repo, Settings as SettingsType } from "../protocol";

const MODEL_SUGGESTIONS = ["opus", "sonnet", "haiku"];
const MODES: PermissionMode[] = ["default", "acceptEdits", "plan"];

export function Settings({ repos }: { repos: Repo[] }) {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const updated = await api.putSettings(settings);
      setSettings(updated);
      setStatus("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="pane subtle">Loading settings…</div>;
  if (!settings)
    return (
      <div className="pane system-line error">⚠ {error ?? "No settings."}</div>
    );

  return (
    <div className="pane settings-pane">
      <h2>Settings</h2>

      <label className="field">
        <span>Default system prompt</span>
        <textarea
          rows={6}
          value={settings.defaultSystemPrompt}
          onChange={(e) =>
            setSettings({ ...settings, defaultSystemPrompt: e.target.value })
          }
        />
      </label>

      <label className="field">
        <span>Default model</span>
        <input
          type="text"
          list="model-suggestions"
          value={settings.defaultModel}
          onChange={(e) =>
            setSettings({ ...settings, defaultModel: e.target.value })
          }
        />
        <datalist id="model-suggestions">
          {MODEL_SUGGESTIONS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span>Default permission mode</span>
        <select
          value={settings.defaultPermissionMode}
          onChange={(e) =>
            setSettings({
              ...settings,
              defaultPermissionMode: e.target.value as PermissionMode,
            })
          }
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-actions">
        <button
          className="btn btn-primary"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {status && <span className="subtle">{status}</span>}
        {error && <span className="system-line error">⚠ {error}</span>}
      </div>

      <h3>Configured repos</h3>
      {repos.length === 0 && (
        <div className="empty-state subtle">No repos configured.</div>
      )}
      <ul className="repo-config-list">
        {repos.map((r) => (
          <li key={r.id}>
            <span className="repo-config-name">{r.name}</span>
            <span className="repo-config-path subtle">{r.path}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
