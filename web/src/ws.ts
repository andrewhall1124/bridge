// Singleton WebSocket manager.
// - one socket for the whole app
// - auto-reconnect with exponential backoff
// - re-subscribes active sessions on reconnect
// - lets components register handlers for ServerEvent / global events

import type {
  AnyServerEvent,
  ClientCommand,
  PermissionMode,
} from "./protocol";

export type ConnState = "connecting" | "connected" | "reconnecting" | "closed";

type EventHandler = (ev: AnyServerEvent) => void;
type ConnHandler = (state: ConnState) => void;

class WsManager {
  private socket: WebSocket | null = null;
  private state: ConnState = "closed";
  private eventHandlers = new Set<EventHandler>();
  private connHandlers = new Set<ConnHandler>();
  private subscriptions = new Set<string>();
  private backoff = 500;
  private readonly maxBackoff = 15000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private outbox: ClientCommand[] = [];
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  private url(): string {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }

  private connect(): void {
    this.setState(this.backoff === 500 ? "connecting" : "reconnecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.backoff = 500;
      this.setState("connected");
      // re-subscribe everything
      for (const id of this.subscriptions) {
        this.rawSend({ type: "subscribe", sessionId: id });
      }
      // flush queued commands
      const queued = this.outbox;
      this.outbox = [];
      for (const cmd of queued) this.rawSend(cmd);
    };

    socket.onmessage = (msg) => {
      let parsed: AnyServerEvent;
      try {
        parsed = JSON.parse(msg.data as string) as AnyServerEvent;
      } catch {
        return;
      }
      for (const h of this.eventHandlers) {
        try {
          h(parsed);
        } catch (err) {
          console.error("ws handler error", err);
        }
      }
    };

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (this.started) this.scheduleReconnect();
      else this.setState("closed");
    };

    socket.onerror = () => {
      // onclose will follow; close explicitly to be safe
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    };
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    if (this.reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    this.state = s;
    for (const h of this.connHandlers) h(s);
  }

  getState(): ConnState {
    return this.state;
  }

  private rawSend(cmd: ClientCommand): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(cmd));
    } else {
      this.outbox.push(cmd);
    }
  }

  // ---- public command API ----

  subscribe(sessionId: string): void {
    this.subscriptions.add(sessionId);
    this.rawSend({ type: "subscribe", sessionId });
  }

  unsubscribe(sessionId: string): void {
    this.subscriptions.delete(sessionId);
    this.rawSend({ type: "unsubscribe", sessionId });
  }

  sendText(sessionId: string, text: string): void {
    this.rawSend({ type: "send", sessionId, text });
  }

  respondApproval(
    sessionId: string,
    requestId: string,
    decision: "allow" | "deny",
    message?: string
  ): void {
    this.rawSend({
      type: "approval_response",
      sessionId,
      requestId,
      decision,
      message,
    });
  }

  interrupt(sessionId: string): void {
    this.rawSend({ type: "interrupt", sessionId });
  }

  setPermissionMode(sessionId: string, mode: PermissionMode): void {
    this.rawSend({ type: "set_permission_mode", sessionId, mode });
  }

  // ---- listeners ----

  onEvent(h: EventHandler): () => void {
    this.eventHandlers.add(h);
    return () => this.eventHandlers.delete(h);
  }

  onConn(h: ConnHandler): () => void {
    this.connHandlers.add(h);
    h(this.state);
    return () => this.connHandlers.delete(h);
  }
}

export const ws = new WsManager();
