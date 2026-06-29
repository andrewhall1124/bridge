import { useEffect, useState } from "react";
import { api } from "./api";
import { ws, type ConnState } from "./ws";
import type {
  AnyServerEvent,
  PermissionMode,
  QuestionItem,
  ResultContent,
  SessionStatus,
  TranscriptItem,
} from "./protocol";

export function useConnState(): ConnState {
  const [state, setState] = useState<ConnState>(ws.getState());
  useEffect(() => ws.onConn(setState), []);
  return state;
}

export interface PendingApproval {
  requestId: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
}

export interface PendingQuestion {
  requestId: string;
  toolUseId: string;
  questions: QuestionItem[];
}

export interface SessionStream {
  transcript: TranscriptItem[];
  streamingText: string;
  streamingThinking: string;
  streaming: boolean;
  status: SessionStatus;
  permissionMode: PermissionMode | null;
  approvals: PendingApproval[];
  questions: PendingQuestion[];
  loading: boolean;
  error: string | null;
}

const EMPTY: SessionStream = {
  transcript: [],
  streamingText: "",
  streamingThinking: "",
  streaming: false,
  status: "idle",
  permissionMode: null,
  approvals: [],
  questions: [],
  loading: false,
  error: null,
};

export function useSessionStream(sessionId: string | null): SessionStream {
  const [state, setState] = useState<SessionStream>(EMPTY);

  useEffect(() => {
    if (!sessionId) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ ...EMPTY, loading: true });

    api
      .getSession(sessionId)
      .then((res) => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          transcript: res.transcript,
          status: res.session.status,
          permissionMode: res.session.permissionMode,
          loading: false,
        }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      });

    const off = ws.onEvent((ev: AnyServerEvent) => {
      if (!("sessionId" in ev) || ev.sessionId !== sessionId) return;
      switch (ev.type) {
        case "hello":
          setState((p) => ({ ...p, status: ev.status, permissionMode: ev.mode }));
          break;
        case "permission_mode":
          setState((p) => ({ ...p, permissionMode: ev.mode }));
          break;
        case "delta":
          if (ev.blockType === "text") {
            setState((p) => ({
              ...p,
              streaming: true,
              streamingText: p.streamingText + ev.text,
            }));
          } else if (ev.blockType === "thinking") {
            setState((p) => ({
              ...p,
              streamingThinking: p.streamingThinking + ev.text,
            }));
          }
          break;
        case "message":
          setState((p) => {
            const isAssistant = ev.item.type === "assistant";
            return {
              ...p,
              transcript: [...p.transcript, ev.item],
              // final blocks now live in the transcript; clear the provisional
              // streaming buffers for this segment.
              streamingText: isAssistant ? "" : p.streamingText,
              streamingThinking: isAssistant ? "" : p.streamingThinking,
              streaming: isAssistant ? false : p.streaming,
            };
          });
          break;
        case "approval_request":
          setState((p) => ({
            ...p,
            approvals: [
              ...p.approvals,
              {
                requestId: ev.requestId,
                toolName: ev.toolName,
                toolUseId: ev.toolUseId,
                input: ev.input,
              },
            ],
          }));
          break;
        case "question_request":
          setState((p) => ({
            ...p,
            questions: [
              ...p.questions,
              {
                requestId: ev.requestId,
                toolUseId: ev.toolUseId,
                questions: ev.questions,
              },
            ],
          }));
          break;
        case "approval_resolved":
          setState((p) => ({
            ...p,
            approvals: p.approvals.filter((a) => a.requestId !== ev.requestId),
            questions: p.questions.filter((q) => q.requestId !== ev.requestId),
          }));
          break;
        case "status":
          setState((p) => ({
            ...p,
            status: ev.status,
            // new turn starting -> reset streaming buffers
            streamingText: ev.status === "running" ? "" : p.streamingText,
            streamingThinking: ev.status === "running" ? "" : p.streamingThinking,
            streaming: ev.status === "running" ? false : p.streaming,
          }));
          break;
        case "done":
          setState((p) => ({
            ...p,
            streaming: false,
            streamingText: "",
            streamingThinking: "",
          }));
          break;
        default:
          break;
      }
    });

    ws.subscribe(sessionId);

    return () => {
      cancelled = true;
      off();
      ws.unsubscribe(sessionId);
    };
  }, [sessionId]);

  return state;
}

export function formatResult(r: ResultContent): string {
  const parts: string[] = [];
  parts.push(r.subtype === "success" ? "done" : r.subtype);
  if (r.numTurns != null) parts.push(`${r.numTurns} turns`);
  if (r.durationMs != null) parts.push(`${(r.durationMs / 1000).toFixed(1)}s`);
  if (r.totalCostUsd != null) parts.push(`$${r.totalCostUsd.toFixed(4)}`);
  return parts.join(" · ");
}
