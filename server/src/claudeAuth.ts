// Claude Code authentication, driven from the Settings UI.
//
// Bridge runs Claude Code under the owner's own subscription, so when those
// credentials lapse every session fails until someone SSHes into the box and
// runs `claude auth login`. This module removes that requirement: it drives the
// real CLI, hands the authorize URL to whichever device you're holding, and
// feeds the pasted code back to the CLI's stdin.
//
// We drive the CLI rather than reimplementing the OAuth exchange on purpose:
// the client id, PKCE parameters and on-disk credential format stay Anthropic's
// concern, so an upstream change can't leave us writing a malformed
// ~/.claude/.credentials.json. The cost is that `claude auth login` insists on
// a terminal, which is why it runs under `script` (see runLogin).
//
// Nothing here returns a token to the browser — status exposes the account
// email and subscription tier only.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { log } from "./logger.js";
import { agentEnv } from "./agent/sessionManager.js";
import { resetUsageCache } from "./usage.js";
import type {
  ClaudeAuthStatus,
  ClaudeLoginResult,
  ClaudeLoginStart,
} from "./protocol.js";

const execFileAsync = promisify(execFile);

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const CLAUDE_JSON = join(homedir(), ".claude.json");
const CREDENTIALS_JSON = join(homedir(), ".claude", ".credentials.json");

/** How long to wait for the CLI to print its authorize URL. */
const URL_TIMEOUT_MS = 30_000;
/** How long a started login may sit waiting for the user to paste a code. */
const LOGIN_TTL_MS = 10 * 60_000;
/** How long to wait for the CLI to finish once it has been given a code. */
const EXCHANGE_TIMEOUT_MS = 45_000;
/** Guard against a paste that clearly isn't an auth code. */
const MAX_CODE_LENGTH = 512;

// The CLI prints `https://claude.com/cai/oauth/authorize?...`. Match on the
// path rather than the host so a change of domain doesn't break the scrape.
const AUTHORIZE_URL_RE = /https:\/\/[^\s'"]+\/oauth\/authorize\?[^\s'"]+/;

interface PendingLogin {
  child: ChildProcess;
  /** ANSI-stripped output so far, used to scrape the URL and report failures. */
  output: string;
  url: string | null;
  exited: boolean;
  exitCode: number | null;
  expiresAt: number;
  ttlTimer: NodeJS.Timeout;
  /** Resolved whenever output arrives or the child exits. */
  waiters: (() => void)[];
}

let pending: PendingLogin | null = null;

// ---- public API -----------------------------------------------------------

export async function getStatus(): Promise<ClaudeAuthStatus> {
  const cli = await readCliStatus();
  return {
    loggedIn: cli.loggedIn,
    authMethod: cli.authMethod,
    email: readAccountEmail() ?? undefined,
    subscriptionType: readSubscriptionType() ?? undefined,
    loginPending: pending !== null && !pending.exited,
  };
}

/**
 * Start `claude auth login` and return the URL to authorize at. Any login
 * already in flight is abandoned — one at a time keeps the state trivial, and
 * a stale flow is worthless anyway.
 */
export async function startLogin(): Promise<ClaudeLoginStart> {
  cancelLogin();

  const p = runLogin();
  pending = p;

  await waitFor(p, () => p.url !== null || p.exited, URL_TIMEOUT_MS);

  if (!p.url) {
    const detail = p.exited
      ? lastMeaningfulLine(p.output) || `the CLI exited with code ${p.exitCode}`
      : "timed out waiting for the sign-in URL";
    cancelLogin();
    throw new Error(`Could not start Claude sign-in: ${detail}`);
  }

  log.info("Claude sign-in started; waiting for an authorization code");
  return {
    url: p.url,
    expiresIn: Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000)),
  };
}

/** Hand the code pasted from the browser to the waiting CLI. */
export async function submitCode(rawCode: string): Promise<ClaudeLoginResult> {
  const p = pending;
  if (!p || p.exited) {
    return { status: "error", error: "No sign-in is in progress. Start again." };
  }

  const code = rawCode.trim();
  if (!code) return { status: "error", error: "Paste the code from the browser." };
  if (/[\r\n]/.test(code)) {
    return { status: "error", error: "The code must be a single line." };
  }
  if (code.length > MAX_CODE_LENGTH) {
    return { status: "error", error: "That doesn't look like an authorization code." };
  }

  p.child.stdin?.write(`${code}\n`);

  // The CLI exits once it has exchanged the code (either way). We don't try to
  // detect a rejected code from its re-rendered output — a PTY redraw repeats
  // the prompt text, which would produce false failures — so a bad code costs
  // one timeout and a restart.
  await waitFor(p, () => p.exited, EXCHANGE_TIMEOUT_MS);

  const status = await getStatus();
  if (status.loggedIn) {
    cancelLogin();
    resetUsageCache(); // the cached usage response was fetched with the old token
    log.info(`Claude sign-in complete${status.email ? ` for ${status.email}` : ""}`);
    return { status: "complete", auth: { ...status, loginPending: false } };
  }

  const detail = p.exited
    ? lastMeaningfulLine(p.output) || `the CLI exited with code ${p.exitCode}`
    : "the CLI did not finish in time";
  cancelLogin();
  return { status: "error", error: `Sign-in did not complete: ${detail}` };
}

export function cancelLogin(): void {
  const p = pending;
  if (!p) return;
  pending = null;
  clearTimeout(p.ttlTimer);
  if (!p.exited) {
    p.child.kill("SIGTERM");
    // The CLI is holding a PTY; make sure it can't outlive us if it ignores TERM.
    const child = p.child;
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 2_000).unref();
  }
  p.waiters.splice(0).forEach((w) => w());
}

export async function signOut(): Promise<void> {
  cancelLogin();
  await execFileAsync(CLAUDE_BIN, ["auth", "logout"], {
    env: agentEnv(),
    timeout: 15_000,
  });
  resetUsageCache();
}

// ---- running the CLI ------------------------------------------------------

function runLogin(): PendingLogin {
  // `claude auth login` is interactive and refuses to run without a terminal.
  // `script` allocates a PTY for it, which avoids adding a native pty
  // dependency for a flow that runs a handful of times a year. Widening the
  // terminal first stops the CLI hard-wrapping the authorize URL across lines,
  // which would defeat the scrape below.
  const command =
    'stty cols 4096 rows 200 2>/dev/null; exec "$BRIDGE_CLAUDE_BIN" auth login';

  const child = spawn("script", ["-qec", command, "/dev/null"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...agentEnv(),
      BRIDGE_CLAUDE_BIN: CLAUDE_BIN, // passed via env so nothing is interpolated into the shell
      TERM: "xterm-256color", // systemd services have no TERM; the CLI wants one
    },
  });

  const p: PendingLogin = {
    child,
    output: "",
    url: null,
    exited: false,
    exitCode: null,
    expiresAt: Date.now() + LOGIN_TTL_MS,
    ttlTimer: setTimeout(() => {
      if (pending === p) {
        log.info("Claude sign-in expired before a code was submitted");
        cancelLogin();
      }
    }, LOGIN_TTL_MS),
    waiters: [],
  };
  p.ttlTimer.unref();

  const onChunk = (buf: Buffer) => {
    p.output += stripAnsi(buf.toString("utf8"));
    if (p.output.length > 64_000) p.output = p.output.slice(-32_000);
    if (!p.url) {
      const m = AUTHORIZE_URL_RE.exec(p.output);
      if (m) p.url = m[0];
    }
    notify(p);
  };

  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);

  child.on("error", (err) => {
    p.output += `\n${err instanceof Error ? err.message : String(err)}`;
    p.exited = true;
    notify(p);
  });

  child.on("exit", (code) => {
    p.exited = true;
    p.exitCode = code;
    notify(p);
  });

  return p;
}

function notify(p: PendingLogin): void {
  p.waiters.splice(0).forEach((w) => w());
}

/** Resolve once `done()` holds, the child exits, or the timeout elapses. */
function waitFor(p: PendingLogin, done: () => boolean, timeoutMs: number): Promise<void> {
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timer);
      const i = p.waiters.indexOf(check);
      if (i >= 0) p.waiters.splice(i, 1);
      resolve();
    }
    function check() {
      if (done()) finish();
      else p.waiters.push(check);
    }
    p.waiters.push(check);
  });
}

// ---- reading current state ------------------------------------------------

interface CliStatus {
  loggedIn: boolean;
  authMethod: string;
}

async function readCliStatus(): Promise<CliStatus> {
  try {
    const { stdout } = await execFileAsync(CLAUDE_BIN, ["auth", "status", "--json"], {
      env: agentEnv(),
      timeout: 15_000,
    });
    const start = stdout.indexOf("{");
    if (start < 0) throw new Error("no JSON in output");
    const parsed = JSON.parse(stdout.slice(start)) as {
      loggedIn?: unknown;
      authMethod?: unknown;
    };
    return {
      loggedIn: parsed.loggedIn === true,
      authMethod: typeof parsed.authMethod === "string" ? parsed.authMethod : "unknown",
    };
  } catch (err) {
    // A missing/broken CLI is reported as "signed out" rather than as a failed
    // request, so the Settings panel still renders and offers a sign-in.
    log.warn("Could not read Claude auth status:", err);
    return { loggedIn: false, authMethod: "unknown" };
  }
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readAccountEmail(): string | null {
  const account = readJsonFile(CLAUDE_JSON)?.oauthAccount as
    | { emailAddress?: unknown }
    | undefined;
  return typeof account?.emailAddress === "string" ? account.emailAddress : null;
}

function readSubscriptionType(): string | null {
  const oauth = readJsonFile(CREDENTIALS_JSON)?.claudeAiOauth as
    | { subscriptionType?: unknown }
    | undefined;
  return typeof oauth?.subscriptionType === "string" ? oauth.subscriptionType : null;
}

// ---- text helpers ---------------------------------------------------------

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "") // OSC
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/\x1b[@-Z\\-_]/g, "") // two-character escapes
    .replace(/\r/g, "\n"); // PTY redraws
}

/** The last non-empty line, for surfacing why a flow failed. */
function lastMeaningfulLine(output: string): string {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1)?.slice(0, 300) ?? "";
}
