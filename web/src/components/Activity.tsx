import type { SessionStream } from "../hooks";
import type {
  AssistantBlock,
  SessionMeta,
  ToolResultBlock,
  ToolUseBlock,
} from "../protocol";

interface Props {
  session: SessionMeta | null;
  stream: SessionStream;
}

interface Row {
  id: string;
  icon: string;
  label: string;
  detail: string;
  at: string;
  error?: boolean;
}

function summarizeInput(input: Record<string, unknown>): string {
  // Pick the most useful single-line summary.
  const keys = ["command", "file_path", "path", "pattern", "url", "query"];
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string") return v.replace(/\s+/g, " ").slice(0, 100);
  }
  const json = JSON.stringify(input);
  return json.length > 100 ? json.slice(0, 100) + "…" : json;
}

export function Activity({ session, stream }: Props) {
  if (!session) {
    return (
      <div className="pane empty-state subtle">
        Select a session to watch its activity.
      </div>
    );
  }

  const rows: Row[] = [];

  for (const item of stream.transcript) {
    if (item.type === "assistant") {
      const blocks = (item.content as AssistantBlock[]) ?? [];
      for (const b of blocks) {
        if (b.type === "tool_use") {
          const tb = b as ToolUseBlock;
          rows.push({
            id: `${item.id}-${tb.id}`,
            icon: "🔧",
            label: tb.name,
            detail: summarizeInput(tb.input),
            at: item.createdAt,
          });
        }
      }
    } else if (item.type === "tool_result") {
      const blocks = (item.content as ToolResultBlock[]) ?? [];
      for (const b of blocks) {
        rows.push({
          id: `${item.id}-${b.tool_use_id}`,
          icon: b.is_error ? "⚠" : "↩",
          label: b.is_error ? "tool error" : "tool result",
          detail: "",
          at: item.createdAt,
          error: b.is_error,
        });
      }
    }
  }

  for (const a of stream.activity) {
    rows.push({
      id: a.id,
      icon: a.kind === "done" ? "✓" : "•",
      label: a.text,
      detail: "",
      at: a.at,
    });
  }

  rows.sort((x, y) => x.at.localeCompare(y.at));

  return (
    <div className="pane activity-pane">
      <div className="activity-head">
        <span>Live activity</span>
        <span className={`status-badge ${stream.status}`}>{stream.status}</span>
      </div>
      <div className="activity-list">
        {rows.length === 0 && (
          <div className="empty-state subtle">No activity yet.</div>
        )}
        {rows.map((r) => (
          <div key={r.id} className={`activity-row ${r.error ? "error" : ""}`}>
            <span className="activity-icon">{r.icon}</span>
            <span className="activity-label">{r.label}</span>
            {r.detail && <span className="activity-detail">{r.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
