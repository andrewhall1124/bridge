import { useEffect, useRef, useState } from "react";
import { ws } from "../ws";
import type { SessionMeta } from "../protocol";
import type { SessionStream } from "../hooks";
import { Approval } from "./Approval";
import { MessageItem } from "./MessageItem";
import { RichText } from "./RichText";

interface Props {
  session: SessionMeta | null;
  stream: SessionStream;
  autoApprove: boolean;
  onToggleAutoApprove: (on: boolean) => void;
}

export function ChatPane({
  session,
  stream,
  autoApprove,
  onToggleAutoApprove,
}: Props) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stream.transcript, stream.streamingText, stream.approvals]);

  if (!session) {
    return (
      <div className="pane empty-state">
        <p>No session selected.</p>
        <p className="subtle">Pick a repo and create a session to start.</p>
      </div>
    );
  }

  const running = stream.status === "running";

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
      <div className="chat-scroll" ref={scrollRef}>
        {stream.loading && <div className="subtle">Loading transcript…</div>}
        {!stream.loading && stream.transcript.length === 0 && (
          <div className="empty-state subtle">
            No messages yet. Say something below.
          </div>
        )}
        {stream.transcript.map((item) => (
          <MessageItem key={item.id} item={item} />
        ))}

        {stream.streaming && stream.streamingText && (
          <div className="msg-row assistant-row">
            <div className="bubble assistant streaming">
              <RichText text={stream.streamingText} />
              <span className="cursor">▋</span>
            </div>
          </div>
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
      </div>

      <div className="chat-input">
        <div className="chat-input-controls">
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => onToggleAutoApprove(e.target.checked)}
            />
            Auto-approve edits
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
