import { useState } from "react";
import { formatResult } from "../hooks";
import type {
  AssistantBlock,
  ErrorContent,
  ResultContent,
  ToolResultBlock,
  TranscriptItem,
  UserTextContent,
} from "../protocol";
import { RichText } from "./RichText";

function ToolUseChip({
  name,
  input,
}: {
  name: string;
  input: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-chip">
      <button className="tool-chip-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-icon">🔧</span>
        <span className="tool-name">{name}</span>
        <span className="tool-toggle">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <pre className="tool-input">{JSON.stringify(input, null, 2)}</pre>
      )}
    </div>
  );
}

function toolResultText(
  content: string | Array<{ type: string; text?: string }>
): string {
  if (typeof content === "string") return content;
  return content
    .map((b) => (typeof b.text === "string" ? b.text : JSON.stringify(b)))
    .join("\n");
}

function ToolResultBlockView({ block }: { block: ToolResultBlock }) {
  const [open, setOpen] = useState(false);
  const text = toolResultText(block.content);
  const firstLine = text.split("\n")[0] ?? "";
  return (
    <div className={`tool-result ${block.is_error ? "is-error" : ""}`}>
      <button className="tool-result-head" onClick={() => setOpen((o) => !o)}>
        <span>{block.is_error ? "⚠ tool error" : "↩ tool result"}</span>
        <span className="tool-result-preview">{firstLine.slice(0, 80)}</span>
        <span className="tool-toggle">{open ? "▾" : "▸"}</span>
      </button>
      {open && <pre className="tool-result-body">{text}</pre>}
    </div>
  );
}

function AssistantView({ blocks }: { blocks: AssistantBlock[] }) {
  return (
    <div className="bubble assistant">
      {blocks.map((b, i) => {
        if (b.type === "text") return <RichText key={i} text={b.text} />;
        if (b.type === "thinking")
          return (
            <details key={i} className="thinking">
              <summary>thinking</summary>
              <pre>{b.thinking}</pre>
            </details>
          );
        if (b.type === "tool_use")
          return <ToolUseChip key={i} name={b.name} input={b.input} />;
        return null;
      })}
    </div>
  );
}

export function MessageItem({ item }: { item: TranscriptItem }) {
  switch (item.type) {
    case "user_text": {
      const c = item.content as UserTextContent;
      return (
        <div className="msg-row user-row">
          <div className="bubble user">
            <RichText text={c?.text ?? ""} />
          </div>
        </div>
      );
    }
    case "assistant": {
      const blocks = (item.content as AssistantBlock[]) ?? [];
      return (
        <div className="msg-row assistant-row">
          <AssistantView blocks={blocks} />
        </div>
      );
    }
    case "tool_result": {
      const blocks = (item.content as ToolResultBlock[]) ?? [];
      return (
        <div className="msg-row tool-row">
          {blocks.map((b, i) => (
            <ToolResultBlockView key={i} block={b} />
          ))}
        </div>
      );
    }
    case "result": {
      const r = item.content as ResultContent;
      return <div className="system-line">{r ? formatResult(r) : "done"}</div>;
    }
    case "system": {
      return <div className="system-line subtle">system</div>;
    }
    case "error": {
      const e = item.content as ErrorContent;
      return <div className="system-line error">⚠ {e?.message ?? "error"}</div>;
    }
    default:
      return null;
  }
}
