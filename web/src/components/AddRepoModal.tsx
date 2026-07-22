import { useState } from "react";
import { api } from "../api";
import type { AddRepoMode, Repo } from "../protocol";

interface Props {
  onClose: () => void;
  /** Called after the repo is created. `seedPrompt` is set when the repo was
   *  created from a prompt and a chat session should be started with it. */
  onAdded: (repo: Repo, seedPrompt?: string) => void;
}

const MODES: { value: AddRepoMode; label: string; hint: string }[] = [
  {
    value: "init",
    label: "New",
    hint: "Create a new repo on the server — give it a name, or describe what you want to build.",
  },
  {
    value: "clone",
    label: "Clone",
    hint: "git clone a remote repo. Just paste the URL; it's cloned into the repos folder.",
  },
];

type NewKind = "name" | "prompt";

export function AddRepoModal({ onClose, onAdded }: Props) {
  const [mode, setMode] = useState<AddRepoMode>("init");
  const [newKind, setNewKind] = useState<NewKind>("name");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hint = MODES.find((m) => m.value === mode)!.hint;

  async function submit() {
    setError(null);
    let req;
    let seedPrompt: string | undefined;
    if (mode === "clone") {
      if (!url.trim()) return setError("Repository URL is required.");
      req = { mode, url: url.trim() };
    } else if (newKind === "prompt") {
      if (!prompt.trim()) return setError("A prompt is required.");
      seedPrompt = prompt.trim();
      req = { mode, prompt: seedPrompt };
    } else {
      if (!name.trim()) return setError("A name is required.");
      req = { mode, name: name.trim() };
    }
    setBusy(true);
    try {
      const res = await api.addRepo(req);
      onAdded(res.repo, seedPrompt);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add repository"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Add repository</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-tabs">
          {MODES.map((m) => (
            <button
              key={m.value}
              className={`modal-tab ${mode === m.value ? "active" : ""}`}
              onClick={() => setMode(m.value)}
              disabled={busy}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="subtle modal-hint">{hint}</p>

        {mode === "clone" ? (
          <label className="field">
            <span>Repository URL</span>
            <input
              type="text"
              value={url}
              placeholder="https://github.com/owner/repo.git  or  git@github.com:owner/repo.git"
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
        ) : (
          <>
            <div className="modal-tabs">
              <button
                className={`modal-tab ${newKind === "name" ? "active" : ""}`}
                onClick={() => setNewKind("name")}
                disabled={busy}
              >
                Name
              </button>
              <button
                className={`modal-tab ${newKind === "prompt" ? "active" : ""}`}
                onClick={() => setNewKind("prompt")}
                disabled={busy}
              >
                Prompt
              </button>
            </div>
            {newKind === "name" ? (
              <label className="field">
                <span>Repo name</span>
                <input
                  type="text"
                  value={name}
                  placeholder="my-project"
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
              </label>
            ) : (
              <label className="field">
                <span>What do you want to build?</span>
                <textarea
                  value={prompt}
                  rows={4}
                  placeholder="A CLI that converts Markdown to nicely-formatted PDFs…"
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
                <span className="subtle modal-hint">
                  A repo name is derived from this, then a chat session starts with your prompt.
                </span>
              </label>
            )}
          </>
        )}

        {error && <div className="system-line error modal-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Adding…" : "Add repo"}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
