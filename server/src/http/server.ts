import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, basename } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { log } from "../logger.js";
import * as dbm from "../db.js";
import { emitGlobal } from "../bus.js";
import { getVapidPublicKey } from "../push.js";
import { closeSession } from "../agent/sessionManager.js";
import * as git from "../git/repo.js";
import * as railway from "../railway/client.js";
import { getConfig } from "../config.js";
import * as userClaude from "../userClaude.js";
import * as github from "../github.js";
import * as usage from "../usage.js";
import { randomSessionName } from "../names.js";
import type { PermissionMode, Repo, Settings } from "../protocol.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repo"
  );
}

function uniqueRepoId(base: string): string {
  let id = base;
  let n = 2;
  while (dbm.getRepo(id)) id = `${base}-${n++}`;
  return id;
}

// Pick a directory under `baseDir` named `name`, adding a -2/-3 suffix until it
// doesn't already exist on disk. Keeps every repo in the same parent folder.
function uniqueDir(baseDir: string, name: string): string {
  let candidate = join(baseDir, name);
  let n = 2;
  while (existsSync(candidate)) candidate = join(baseDir, `${name}-${n++}`);
  return candidate;
}

// Derive a repo folder name from a clone URL: last path segment, minus ".git".
function nameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const seg = cleaned.split(/[/:]/).filter(Boolean).pop() ?? "repo";
  return slugify(seg);
}

// Deterministic placeholder name for a prompt-created repo: new-app-1, -2, …
// (the agent renames it later via the rename_repo tool). Skips names already
// taken on disk or in the repo registry.
function nextNewAppName(reposDir: string): string {
  let n = 1;
  while (existsSync(join(reposDir, `new-app-${n}`)) || dbm.getRepo(`new-app-${n}`)) n++;
  return `new-app-${n}`;
}

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(process.env.WEB_DIST ?? resolve(here, "../../../web/dist"));

function requireRepo(id: string) {
  const repo = dbm.getRepo(id);
  if (!repo) {
    const err = new Error(`Unknown repo: ${id}`) as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return repo;
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });

  // Tolerate an empty body on application/json requests (e.g. a DELETE that a
  // client sends with a JSON content-type but no payload) instead of 400ing.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const text = typeof body === "string" ? body.trim() : "";
      if (!text) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  // File uploads (chat attachments). 25 MB/file, up to 10 files per request.
  await app.register(fastifyMultipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  });

  // ---- REST API ----------------------------------------------------------
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/repos", async () => ({ repos: dbm.listRepos() }));

  // Add a repo to the picker. Two modes, both creating the repo under the
  // shared `reposDir` — the caller never supplies a file path:
  //   init  — create a new directory (from a name or a prompt) and `git init`
  //   clone — `git clone <url>` into a folder named after the URL
  app.post<{
    Body: { mode?: "init" | "clone"; name?: string; prompt?: string; url?: string };
  }>("/api/repos", async (req, reply) => {
    const body = req.body ?? {};
    const mode = body.mode ?? "init";
    const reposDir = getConfig().reposDir;

    try {
      let absPath: string;
      if (mode === "clone") {
        const url = body.url?.trim();
        if (!url) return reply.code(400).send({ error: "Repository URL is required." });
        absPath = uniqueDir(reposDir, nameFromUrl(url));
        await git.gitClone(url, absPath);
      } else {
        const name = body.name?.trim();
        const prompt = body.prompt?.trim();
        let base: string;
        if (name) {
          base = slugify(name);
        } else if (prompt) {
          // Placeholder name; the agent renames the repo once it knows the goal.
          base = nextNewAppName(reposDir);
        } else {
          return reply.code(400).send({ error: "A name or prompt is required." });
        }
        absPath = uniqueDir(reposDir, base);
        await git.gitInit(absPath);
      }

      const name = basename(absPath);
      const repo: Repo = { id: uniqueRepoId(slugify(name)), name, path: absPath };
      dbm.addRepo(repo);
      emitGlobal({ type: "repos_changed" });
      const isGit = await git.isGitRepo(absPath);
      return { repo, isGit };
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  // Update a repo: set its linked Railway project.
  app.patch<{
    Params: { id: string };
    Body: { railwayProjectId?: string | null };
  }>("/api/repos/:id", async (req, reply) => {
    const repo = dbm.getRepo(req.params.id);
    if (!repo) return reply.code(404).send({ error: "Unknown repo" });
    const body = req.body ?? {};
    if (body.railwayProjectId === undefined)
      return reply.code(400).send({ error: "Nothing to update" });
    const pid = body.railwayProjectId?.trim() || null;
    dbm.setRepoRailway(repo.id, pid);
    emitGlobal({ type: "repos_changed" });
    return { repo: dbm.getRepo(repo.id) };
  });

  // Unregister a repo (files on disk are left untouched).
  app.delete<{ Params: { id: string } }>("/api/repos/:id", async (req, reply) => {
    const repo = dbm.getRepo(req.params.id);
    if (!repo) return reply.code(404).send({ error: "Unknown repo" });
    dbm.deleteRepo(repo.id);
    emitGlobal({ type: "repos_changed" });
    return { ok: true };
  });

  app.get("/api/settings", async () => dbm.getSettings());

  app.put<{ Body: Partial<Settings> }>("/api/settings", async (req) => {
    const body = req.body ?? {};
    const patch: Partial<Settings> = {};
    if (typeof body.defaultSystemPrompt === "string")
      patch.defaultSystemPrompt = body.defaultSystemPrompt;
    if (typeof body.defaultModel === "string") patch.defaultModel = body.defaultModel;
    if (
      body.defaultPermissionMode &&
      ["default", "acceptEdits", "plan", "bypassPermissions"].includes(
        body.defaultPermissionMode,
      )
    )
      patch.defaultPermissionMode = body.defaultPermissionMode as PermissionMode;
    return dbm.updateSettings(patch);
  });

  // ---- User-level Claude config (MCP servers, CLAUDE.md, hooks) ----------
  // These read/write the real ~/.claude files shared with the `claude` CLI.
  app.get("/api/user/mcp", async () => ({ servers: userClaude.readUserMcpServers() }));

  app.put<{ Body: { servers?: unknown } }>("/api/user/mcp", async (req, reply) => {
    try {
      const servers = userClaude.validateMcpServers(req.body?.servers ?? {});
      userClaude.writeUserMcpServers(servers);
      return { servers };
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.get("/api/user/claude-md", async () => ({ content: userClaude.readClaudeMd() }));

  app.put<{ Body: { content?: string } }>("/api/user/claude-md", async (req, reply) => {
    const content = req.body?.content;
    if (typeof content !== "string")
      return reply.code(400).send({ error: "content must be a string" });
    try {
      userClaude.writeClaudeMd(content);
      return { content };
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.get("/api/user/hooks", async () => ({ hooks: userClaude.readHooks() }));

  app.put<{ Body: { hooks?: unknown } }>("/api/user/hooks", async (req, reply) => {
    const hooks = req.body?.hooks;
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
      return reply.code(400).send({ error: "hooks must be a JSON object" });
    try {
      userClaude.writeHooks(hooks as Record<string, unknown>);
      return { hooks: userClaude.readHooks() };
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  // ---- Claude subscription usage ------------------------------------------
  app.get("/api/usage", async (_req, reply) => {
    try {
      return await usage.getUsage();
    } catch (err) {
      return reply.code(502).send({ error: errMsg(err) });
    }
  });

  // ---- GitHub auth (device flow) -----------------------------------------
  app.get("/api/github/status", async () => github.getStatus());

  app.post("/api/github/device", async (_req, reply) => {
    try {
      return await github.startDeviceFlow();
    } catch (err) {
      return reply.code(502).send({ error: errMsg(err) });
    }
  });

  app.post("/api/github/device/poll", async (_req, reply) => {
    try {
      return await github.pollDeviceFlow();
    } catch (err) {
      return reply.code(502).send({ error: errMsg(err) });
    }
  });

  app.post("/api/github/signout", async () => {
    github.signOut();
    return { ok: true };
  });

  // Sessions
  app.get("/api/sessions", async () => ({ sessions: dbm.listSessions() }));

  app.post<{
    Body: { repoId?: string; title?: string; permissionMode?: PermissionMode };
  }>("/api/sessions", async (req, reply) => {
    const { repoId, title, permissionMode } = req.body ?? {};
    if (!repoId) return reply.code(400).send({ error: "repoId is required" });
    requireRepo(repoId);
    const mode =
      permissionMode &&
      ["default", "acceptEdits", "plan", "bypassPermissions"].includes(permissionMode)
        ? permissionMode
        : undefined;
    const session = dbm.createSession(
      repoId,
      title?.trim() || randomSessionName(),
      mode,
    );
    return { session };
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    const session = dbm.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    return { session, transcript: dbm.getTranscript(session.id) };
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    const session = dbm.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    closeSession(session.id);
    dbm.deleteSession(session.id);
    emitGlobal({ type: "sessions_changed" });
    return { ok: true };
  });

  // Web Push notifications
  app.get("/api/push/vapid", async () => ({ publicKey: getVapidPublicKey() }));

  app.post<{ Body: dbm.StoredPushSubscription }>(
    "/api/push/subscribe",
    async (req, reply) => {
      const sub = req.body;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        return reply.code(400).send({ error: "Invalid push subscription" });
      }
      dbm.addPushSubscription({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      });
      return { ok: true };
    },
  );

  app.post<{ Body: { endpoint?: string } }>(
    "/api/push/unsubscribe",
    async (req, reply) => {
      const endpoint = req.body?.endpoint;
      if (!endpoint) return reply.code(400).send({ error: "endpoint is required" });
      dbm.removePushSubscription(endpoint);
      return { ok: true };
    },
  );

  // Find usages (whole-word, repo-wide textual search)
  app.get<{ Params: { id: string }; Querystring: { symbol?: string } }>(
    "/api/repos/:id/references",
    async (req, reply) => {
      const repo = requireRepo(req.params.id);
      const symbol = (req.query.symbol ?? "").trim();
      if (!symbol) return reply.code(400).send({ error: "symbol is required" });
      try {
        if (!(await git.isGitRepo(repo.path)))
          return { symbol, matches: [], truncated: false, notGit: true };
        const res = await git.findReferences(repo.path, symbol);
        return { symbol, ...res };
      } catch (err) {
        return reply.code(400).send({ error: errMsg(err) });
      }
    },
  );

  // Upload chat attachments. Saved outside the repo (Bridge data dir) so they
  // don't pollute the working tree; the agent reads them by absolute path.
  app.post<{ Params: { id: string } }>(
    "/api/repos/:id/upload",
    async (req, reply) => {
      const repo = requireRepo(req.params.id);
      const destDir = join(
        dirname(getConfig().dbPath),
        "uploads",
        repo.id,
      );
      await mkdir(destDir, { recursive: true });
      const saved: { name: string; path: string; size: number }[] = [];
      try {
        for await (const part of req.files()) {
          const original = basename(part.filename || "file");
          const safe = original.replace(/[^A-Za-z0-9._-]/g, "_") || "file";
          const dest = join(destDir, `${randomUUID().slice(0, 8)}-${safe}`);
          const buf = await part.toBuffer(); // enforces the fileSize limit
          await writeFile(dest, buf);
          saved.push({ name: original, path: dest, size: buf.length });
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "FST_REQ_FILE_TOO_LARGE")
          return reply.code(413).send({ error: "File too large (max 25 MB)" });
        return reply.code(400).send({ error: errMsg(err) });
      }
      if (saved.length === 0)
        return reply.code(400).send({ error: "No files uploaded" });
      return { files: saved };
    },
  );

  // Repo file browsing
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    "/api/repos/:id/files",
    async (req, reply) => {
      const repo = requireRepo(req.params.id);
      try {
        const entries = await git.listDir(repo.path, req.query.path ?? "");
        return { path: req.query.path ?? "", entries };
      } catch (err) {
        return reply.code(400).send({ error: errMsg(err) });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    "/api/repos/:id/file",
    async (req, reply) => {
      const repo = requireRepo(req.params.id);
      if (!req.query.path) return reply.code(400).send({ error: "path is required" });
      try {
        return await git.readFile(repo.path, req.query.path);
      } catch (err) {
        return reply.code(400).send({ error: errMsg(err) });
      }
    },
  );

  // ---- Railway (Deploy page) ---------------------------------------------
  // Token + environment resolve DB-first (set via the UI) then fall back to
  // env/config. The token stays server-side and is never returned to the client.
  function resolvedRailway(): { token: string | null; environment: string } {
    const cfg = getConfig();
    return {
      token: dbm.getSetting("railwayApiToken") ?? cfg.railwayApiToken,
      environment: dbm.getSetting("railwayEnvironment") ?? cfg.railwayEnvironment,
    };
  }

  app.get("/api/railway/config", async () => {
    const r = resolvedRailway();
    return { configured: Boolean(r.token), environment: r.environment };
  });

  // Set the Railway token / environment from the UI. Omit apiToken to keep the
  // current one; pass an empty string to remove it.
  app.put<{ Body: { apiToken?: string | null; environment?: string } }>(
    "/api/railway/config",
    async (req) => {
      const body = req.body ?? {};
      if (body.apiToken !== undefined) {
        const t = (body.apiToken ?? "").trim();
        if (t) dbm.setSetting("railwayApiToken", t);
        else dbm.deleteSetting("railwayApiToken");
      }
      if (typeof body.environment === "string")
        dbm.setSetting("railwayEnvironment", body.environment.trim() || "production");
      const r = resolvedRailway();
      return { configured: Boolean(r.token), environment: r.environment };
    },
  );

  app.get("/api/railway/workspaces", async (_req, reply) => {
    const { token } = resolvedRailway();
    if (!token) return reply.code(400).send({ error: "Railway is not configured" });
    try {
      return await railway.listWorkspaces(token);
    } catch (err) {
      return reply.code(502).send({ error: errMsg(err) });
    }
  });

  app.get<{ Querystring: { workspace?: string } }>(
    "/api/railway/projects",
    async (req, reply) => {
      const { token } = resolvedRailway();
      if (!token) return reply.code(400).send({ error: "Railway is not configured" });
      try {
        return { projects: await railway.listProjects(token, req.query.workspace) };
      } catch (err) {
        return reply.code(502).send({ error: errMsg(err) });
      }
    },
  );

  app.get<{ Querystring: { project?: string; env?: string } }>(
    "/api/railway/status",
    async (req, reply) => {
      const { token, environment } = resolvedRailway();
      if (!token) return reply.code(400).send({ error: "Railway is not configured" });
      const projectId = req.query.project;
      if (!projectId)
        return reply
          .code(400)
          .send({ error: "No project specified (link the repo to a Railway project)" });
      try {
        return await railway.getProjectStatus(
          token,
          projectId,
          req.query.env ?? environment,
        );
      } catch (err) {
        return reply.code(502).send({ error: errMsg(err) });
      }
    },
  );

  // ---- Static PWA --------------------------------------------------------
  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
    // SPA fallback: anything that isn't /api or /ws and isn't a real file
    // returns index.html so client-side routing works.
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && (req.raw.url.startsWith("/api") || req.raw.url.startsWith("/ws"))) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
    log.info(`Serving PWA from ${WEB_DIST}`);
  } else {
    log.warn(
      `Web build not found at ${WEB_DIST}. Run "npm run build" (or use the Vite dev server).`,
    );
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && (req.raw.url.startsWith("/api") || req.raw.url.startsWith("/ws"))) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply
        .code(503)
        .type("text/html")
        .send(
          "<h1>Bridge</h1><p>Web build not found. Run <code>npm run build</code> or start the Vite dev server (<code>npm run dev:web</code>).</p>",
        );
    });
  }

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) log.error("Request error:", err);
    reply.code(status).send({ error: errMsg(err) });
  });

  return app;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
