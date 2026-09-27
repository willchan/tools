# Claude Code — Monorepo Standards

This repo holds multiple small web apps, each in its own top-level directory.
The standards below apply to every app. An app may document deviations or
additions (e.g. a native shell) in its own `<app>/CLAUDE.md`; when one exists,
read it too — it takes precedence for that app.

## Tech Stack
- **Language:** Vanilla TypeScript only. No frontend frameworks (React, Vue, Svelte, Angular, etc.).
- **Package Manager & Runtime:** Bun. Use `bun install`, `bun run`, `bun test` for all operations.
- **Build:** Vite with zero-config Vanilla TS template. Production builds must have `minify: false` and `sourcemap: true`.
- **Testing:** Playwright for E2E and visual regression, TDD-first.
- **Database:** IndexedDB via the `idb` npm package. Offline-first architecture is mandatory.

## Development Rules
1. **TDD is mandatory.** Every feature starts with a failing Playwright test. No implementation code before a test exists.
2. **Offline-first.** All data lives in IndexedDB. The app must function without network connectivity.
3. **PWA required.** Service worker for caching and push notifications. Manifest for installability.
4. **Mobile-first CSS.** Design for phones first, then scale up with media queries.
5. **No frameworks.** Use vanilla DOM APIs, TypeScript, and CSS. Web Components are acceptable.
6. **Readable builds.** Never enable minification. Always generate sourcemaps.

## Project Layout
```
<app>/              # One directory per app, e.g. workout-tracker/
  CLAUDE.md         # Optional: app-specific rules and deviations
  src/              # TypeScript source
  public/           # Static assets and PWA manifest
  e2e/              # Playwright E2E tests
  vite.config.ts
  playwright.config.ts
```

Current apps:
- `workout-tracker/` — resistance training tracker PWA, with an optional iOS
  shell and Apple Watch companion. See `workout-tracker/CLAUDE.md`.

## Commands (run inside an app directory)
```bash
bun install            # Install deps
bun run dev            # Dev server
bun run build          # Production build
bun run typecheck      # TypeScript checking
bun run lint           # ESLint
bunx playwright test   # Run E2E tests
```
