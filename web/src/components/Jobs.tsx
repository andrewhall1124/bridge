import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ws } from "../ws";
import type {
  AnyServerEvent,
  Job,
  Repo,
  TranscriptItem,
} from "../protocol";
import { Transcript } from "./Transcript";

interface Props {
  repos: Repo[];
  selectedRepoId: string | null;
}

export function Jobs({ repos, selectedRepoId }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoId, setRepoId] = useState<string>(selectedRepoId ?? "");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [openTranscript, setOpenTranscript] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await api.getJobs();
      setJobs(res.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const off = ws.onEvent((ev: AnyServerEvent) => {
      if (ev.type === "jobs_changed") void reload();
    });
    return off;
  }, [reload]);

  useEffect(() => {
    if (selectedRepoId && !repoId) setRepoId(selectedRepoId);
  }, [selectedRepoId, repoId]);

  async function submit() {
    if (!repoId || !prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createJob(repoId, prompt.trim());
      setPrompt("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function open(job: Job) {
    setOpenJob(job);
    setOpenTranscript([]);
    try {
      const res = await api.getJob(job.id);
      setOpenJob(res.job);
      setOpenTranscript(res.transcript);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (openJob) {
    return (
      <div className="pane jobs-pane">
        <div className="job-detail-head">
          <button className="btn btn-sm" onClick={() => setOpenJob(null)}>
            ← Back
          </button>
          <span className={`status-badge ${openJob.status}`}>
            {openJob.status}
          </span>
        </div>
        <div className="job-prompt">{openJob.prompt}</div>
        {openJob.error && (
          <div className="system-line error">⚠ {openJob.error}</div>
        )}
        {openJob.resultSummary && (
          <div className="job-summary">{openJob.resultSummary}</div>
        )}
        {openJob.changedFiles && openJob.changedFiles.length > 0 && (
          <div className="changed-files">
            <div className="subtle">Changed files:</div>
            <ul>
              {openJob.changedFiles.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="job-transcript">
          <Transcript items={openTranscript} />
        </div>
      </div>
    );
  }

  return (
    <div className="pane jobs-pane">
      <div className="job-form">
        <select value={repoId} onChange={(e) => setRepoId(e.target.value)}>
          <option value="">Select repo…</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <textarea
          placeholder="Job prompt…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />
        <button
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={submitting || !repoId || !prompt.trim()}
        >
          {submitting ? "Submitting…" : "New job"}
        </button>
      </div>

      {error && <div className="system-line error">⚠ {error}</div>}

      <div className="jobs-list">
        {loading && <div className="subtle">Loading…</div>}
        {!loading && jobs.length === 0 && (
          <div className="empty-state subtle">No jobs yet.</div>
        )}
        {jobs.map((job) => {
          const repo = repos.find((r) => r.id === job.repoId);
          return (
            <button
              key={job.id}
              className="job-row"
              onClick={() => void open(job)}
            >
              <span className={`status-badge ${job.status}`}>{job.status}</span>
              <span className="job-row-prompt">{job.prompt}</span>
              <span className="job-row-repo subtle">{repo?.name ?? ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
