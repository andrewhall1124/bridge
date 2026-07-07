// Claude subscription usage — proxies the same OAuth endpoint Claude Code's
// /usage screen reads, authenticated with the subscription credentials from
// `claude login` (~/.claude/.credentials.json). Read-only: we never refresh or
// rewrite the token (Claude Code owns that file and refreshes it whenever a
// session runs).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeUsage, ClaudeUsageLimit } from "./protocol.js";

const CREDENTIALS_JSON = join(homedir(), ".claude", ".credentials.json");
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

// Short cache so opening the Usage tab repeatedly doesn't hammer Anthropic.
const CACHE_MS = 60_000;
let cache: { at: number; usage: ClaudeUsage } | null = null;

function readCredentials(): { token: string; subscriptionType: string | null } {
  if (!existsSync(CREDENTIALS_JSON)) {
    throw new Error(
      "No Claude subscription credentials found — run `claude login` on the server.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(CREDENTIALS_JSON, "utf8"));
  } catch {
    throw new Error("Claude credentials file is not valid JSON.");
  }
  const oauth = (parsed as { claudeAiOauth?: Record<string, unknown> }).claudeAiOauth;
  const token = typeof oauth?.accessToken === "string" ? oauth.accessToken : "";
  if (!token) throw new Error("Claude credentials file has no access token.");
  return {
    token,
    subscriptionType:
      typeof oauth?.subscriptionType === "string" ? oauth.subscriptionType : null,
  };
}

// The endpoint's `limits` entries look like:
//   { kind: "session" | "weekly_all" | "weekly_scoped" | ..., percent, resets_at,
//     scope: { model: { display_name } } | null }
function normalizeLimits(body: unknown): ClaudeUsageLimit[] {
  const raw = (body as { limits?: unknown }).limits;
  if (!Array.isArray(raw)) return [];
  const out: ClaudeUsageLimit[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.kind !== "string" || typeof e.percent !== "number") continue;
    const scope = e.scope as { model?: { display_name?: unknown } } | null | undefined;
    out.push({
      kind: e.kind,
      percent: e.percent,
      resetsAt: typeof e.resets_at === "string" ? e.resets_at : null,
      model:
        typeof scope?.model?.display_name === "string" ? scope.model.display_name : null,
    });
  }
  return out;
}

export async function getUsage(): Promise<ClaudeUsage> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.usage;

  const { token, subscriptionType } = readCredentials();
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Claude credentials are expired — they refresh automatically the next time a session runs.",
    );
  }
  if (!res.ok) {
    throw new Error(`Usage endpoint returned HTTP ${res.status}.`);
  }
  const body: unknown = await res.json();

  const usage: ClaudeUsage = {
    subscriptionType,
    limits: normalizeLimits(body),
    fetchedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), usage };
  return usage;
}
