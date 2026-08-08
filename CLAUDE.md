# Claude Code — Monorepo Standards

## Tech Stack
- **Language:** Vanilla TypeScript only. No frontend frameworks (React, Vue, Svelte, Angular, etc.).
- **Package Manager & Runtime:** Bun. Use `bun install`, `bun run`, `bun test` for all operations.
- **Build:** Vite with zero-config Vanilla TS template. Production builds must have `minify: false` and `sourcemap: true`.
- **Testing:** Playwright for E2E and visual regression, TDD-first, for all TypeScript/web code — including the native-bridge wiring in `src/native/*`. This is the default for everything in `src/`. See "iOS native shell" below for the one carve-out.
- **Database:** IndexedDB via the `idb` npm package. Offline-first architecture is mandatory.
- **iOS:** An optional native shell (`workout-tracker/ios/`, Swift/SwiftUI, built via Capacitor) wraps the same `src/` web app in a WKWebView. It exists only because iOS throttles background service workers and gates Live Activities behind native ActivityKit — it is not a second UI implementation. Keep Swift code thin (view controller glue, `AppDelegate`/`SceneDelegate` boilerplate, the Live Activity widget's SwiftUI layout); any real logic belongs in `src/native/*` TypeScript, where it's covered by TDD.

## Development Rules
1. **TDD is mandatory for TypeScript.** Every `src/` feature starts with a failing Playwright test. No implementation code before a test exists. This includes `src/native/*` — its plugin-call wiring is TDD'd against Capacitor's own web fallbacks via `e2e/native-platform.spec.ts`, no Mac required.
2. **Offline-first.** All data lives in IndexedDB. The app must function without network connectivity.
3. **PWA required.** Service worker for caching and push notifications. Manifest for installability.
4. **Mobile-first CSS.** Design for phones first, then scale up with media queries.
5. **No frameworks.** Use vanilla DOM APIs, TypeScript, and CSS for `src/`. Web Components are acceptable. (Swift/SwiftUI in `ios/` is a separate, native shell and isn't covered by this rule.)
6. **Readable builds.** Never enable minification. Always generate sourcemaps.
7. **iOS native shell has no unit/UI test target.** `ios/` has no XCTest or XCUITest target — see `ios/MANUAL_SETUP.md`'s "Test coverage layers". Coverage instead comes from three layers: (a) `e2e/native-platform.spec.ts` TDD's the TS side of every native call site, (b) `.github/workflows/ios.yml` builds the Xcode project and boots a real Simulator on every push, asserting the WKWebView actually loads the bundle, (c) Live Activity rendering and notification delivery are verified manually on-device, since Live Activities don't render in the Simulator. Don't add Swift logic that only this manual layer would catch — push it into `src/native/*` instead, or add real Swift test coverage (XCTest is available even without a UI test target) if it truly can't move.

## Project Layout
```
workout-tracker/    # Resistance training tracker PWA
  src/              # TypeScript source (includes src/native/, the iOS bridge code)
  public/           # Static assets and PWA manifest
  e2e/              # Playwright E2E tests (includes native-platform.spec.ts)
  ios/              # Native Xcode project (Capacitor + Swift/SwiftUI), see README.md's "iOS App (Capacitor)"
  vite.config.ts    # Vite config
  playwright.config.ts
  capacitor.config.ts
```

## Commands
```bash
cd workout-tracker && bun install            # Install deps
cd workout-tracker && bun run dev            # Dev server
cd workout-tracker && bun run build          # Production build
cd workout-tracker && bun run typecheck      # TypeScript checking
cd workout-tracker && bunx playwright test   # Run E2E tests (incl. native wiring tests)
cd workout-tracker && bun run cap:sync       # Build + sync web bundle into the iOS project
cd workout-tracker && bun run cap:open:ios   # Open the Xcode project (needs a Mac)
```
