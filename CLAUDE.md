# CLAUDE.md — Bridge

Project context for Claude Code working in this repository.

## What this is

Bridge is a single-user web app that drives Claude Code on a VPS, reachable only over
Tailscale. A Node/TypeScript backend (Fastify + the Claude Agent SDK + SQLite) serves a
React PWA. See `README.md` for the full picture.

## Layout

- `server/` — backend (TypeScript, run directly with `tsx`, no build step). Entry
  `server/src/index.ts`. Shared REST/WS types in `server/src/protocol.ts`.
- `web/` — React + Vite PWA, built to `web/dist` and served by the backend in production.
  The client mirrors the protocol types in `web/src/protocol.ts` — **keep the two in
  sync** when changing the wire format.
- npm workspaces; run commands from the repo root.

## Commands

- `npm run typecheck` — type-check server and web.
- `npm run dev:server` / `npm run dev:web` — hot-reloading dev (Vite proxies to :8787).
- `npm start` — build web, then run the server (production).

## Conventions & gotchas

- **Billing:** never set `ANTHROPIC_API_KEY` for subscription billing. `agentEnv()` in
  `server/src/agent/sessionManager.ts` deliberately deletes it when no key is configured.
  Don't "helpfully" pass it through.
- **Path safety:** every repo file/git operation must go through `safeResolve()` in
  `server/src/git/repo.ts`, which rejects paths escaping the repo root and anything under
  `.git`. Never pass a raw client path to `fs`/`git`.
- **Live events:** the backend fans out `ServerEvent`s via `server/src/bus.ts`
  (`emitSession` / `emitGlobal`). The WS hub forwards them to subscribers. Add new event
  types to `protocol.ts` (both copies) and handle them in the hub + client.
- **Do not commit** `config.json`, `.env`, or `data/` (the SQLite files) — they're
  git-ignored. Use `config.example.json` / `.env.example` for documentation.
- Strict TypeScript everywhere; the web build additionally enables `noUnusedLocals` /
  `noUnusedParameters`.
- Keep dependencies minimal and pinned to exact versions.
