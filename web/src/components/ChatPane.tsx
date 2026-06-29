import { useEffect, useMemo, useRef, useState } from "react";
import { ws } from "../ws";
import type { PermissionMode, SessionMeta } from "../protocol";
import type { SessionStream } from "../hooks";
import { Approval } from "./Approval";
import { Question } from "./Question";
import { Transcript, pendingToolName } from "./Transcript";
import { Markdown } from "./Markdown";

const MODE_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: "default", label: "default — ask before edits/commands" },
  { value: "acceptEdits", label: "acceptEdits — auto-approve file edits" },
  { value: "plan", label: "plan — explore only, no changes" },
  { value: "bypassPermissions", label: "bypass — run everything unprompted ⚠" },
];

const MODE_BADGE: Record<PermissionMode, string> = {
  default: "default",
  acceptEdits: "accept edits",
  plan: "plan",
  bypassPermissions: "BYPASS ⚠",
};

interface Props {
  session: SessionMeta | null;
  stream: SessionStream;
  onSetMode: (mode: PermissionMode) => void;
}

export function ChatPane({
  session,
  stream,
  onSetMode,
}: Props) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [
    stream.transcript,
    stream.streamingText,
    stream.streamingThinking,
    stream.status,
    stream.approvals,
    stream.questions,
  ]);

  // The tool currently awaiting a result, for the live progress label. Must run
  // before any early return — hooks can't be conditional.
  const pendingTool = useMemo(
    () => pendingToolName(stream.transcript),
    [stream.transcript],
  );

  if (!session) {
    return (
      <div className="pane empty-state">
        <p>No session selected.</p>
        <p className="subtle">Pick a repo and create a session to start.</p>
      </div>
    );
  }

  const running = stream.status === "running";
  const mode: PermissionMode = stream.permissionMode ?? session.permissionMode;

  function send() {
    const t = text.trim();
    if (!t || !session) return;
    ws.sendText(session.id, t);
    setText("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="pane chat-pane">
      <div className="chat-modebar">
        <span className="subtle">{session.title || "session"}</span>
        <span className="spacer" />
        <span className={`mode-badge mode-${mode}`} title={`Permission mode: ${mode}`}>
          {MODE_BADGE[mode]}
        </span>
        <span className={`status-badge status-${stream.status}`}>{stream.status}</span>
      </div>
      <div className="chat-scroll" ref={scrollRef}>
        {stream.loading && <div className="subtle">Loading transcript…</div>}
        {!stream.loading && stream.transcript.length === 0 && (
          <div className="empty-state subtle">
            No messages yet. Say something below.
          </div>
        )}
        <Transcript items={stream.transcript} />

        {stream.streaming && stream.streamingText && (
          <div className="msg-row assistant-row">
            <div className="bubble assistant streaming">
              <Markdown text={stream.streamingText} />
              <span className="cursor">▋</span>
            </div>
          </div>
        )}

        {running && !(stream.streaming && stream.streamingText) && (
          <WorkingNote
            label={
              stream.streamingThinking
                ? "Thinking"
                : pendingTool
                  ? `Running ${pendingTool}`
                  : "Working"
            }
            preview={
              stream.streamingThinking
                ? stream.streamingThinking.replace(/\s+/g, " ").trim().slice(-180)
                : undefined
            }
          />
        )}

        {stream.approvals.map((a) => (
          <Approval
            key={a.requestId}
            approval={a}
            onRespond={(rid, decision, msg) =>
              ws.respondApproval(session.id, rid, decision, msg)
            }
          />
        ))}

        {stream.questions.map((q) => (
          <Question
            key={q.requestId}
            pending={q}
            onRespond={(rid, answers, cancelled) =>
              ws.respondQuestion(session.id, rid, answers, cancelled)
            }
          />
        ))}
      </div>

      <div className="chat-input">
        <div className="chat-input-controls">
          <label className="mode-select">
            <span className="subtle">Mode</span>
            <select
              value={mode}
              onChange={(e) => onSetMode(e.target.value as PermissionMode)}
            >
              {MODE_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {running && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => ws.interrupt(session.id)}
            >
              Stop
            </button>
          )}
        </div>
        <div className="chat-input-row">
          <textarea
            value={text}
            placeholder="Message Claude… (Enter to send, Shift+Enter for newline)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
          />
          <button className="btn btn-primary send-btn" onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkingNote({ label, preview }: { label: string; preview?: string }) {
  return (
    <div className="working-note">
      <div className="working-head">
        <span className="spinner" />
        <span className="working-label">{label}</span>
        <span className="working-dots">
          <i />
          <i />
          <i />
        </span>
      </div>
      {preview && <div className="working-preview">{preview}</div>}
    </div>
  );
}
