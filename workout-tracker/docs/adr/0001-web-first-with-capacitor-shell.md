# 0001. Web-first, with a Capacitor iOS shell

- **Status:** Accepted (reconstructed 2026-09 from git history; the shell landed 2026-08-03 in `5cd62d5`)
- **Related:** [0002](0002-apple-watch-remote.md)

## Context

The workout tracker started as a vanilla-TypeScript PWA under this repo's
monorepo standards: IndexedDB, offline-first, Playwright TDD, readable Vite
builds, no frameworks. All workout logic lives in TypeScript: 5/3/1 math,
progression state machine, volume groups and bonus sets, rest timer.

The user runs it on an iPhone, and two problems came up that a PWA can't fix:

- **Background timers.** iOS Safari throttles and suspends a backgrounded
  PWA's service worker, so the rest-timer notification could fire minutes late
  or not at all. A native local notification scheduled at an absolute time
  (`UNUserNotificationCenter`, via `@capacitor/local-notifications`) fires on
  time.
- **Live Activities.** Lock-screen and Dynamic Island rest countdowns need
  ActivityKit, which only native code can reach.

Smaller WKWebView gaps followed: `navigator.vibrate` does nothing in WebKit
(replaced with `@capacitor/haptics`), and a `<a download>` blob can't produce
a file (export uses Filesystem plus the share sheet).

There is one developer, working mostly from cloud sessions without a Mac.

## Decision

Keep the PWA as the only implementation of the app and wrap it in a thin
[Capacitor](https://capacitorjs.com/) iOS shell (`ios/`), rather than writing
a native app.

- **One implementation of the logic.** `src/` is the only place workout rules
  exist. Native code paths in `src/native/*` are additive and do nothing unless
  `Capacitor.isNativePlatform()` is true, so the web PWA behaves the same
  whether or not the shell exists.
- **Playwright TDD covers native wiring too.** `e2e/native-platform.spec.ts`
  forces the native platform with `window.CapacitorCustomPlatform` and drives
  each plugin's real web fallback, so the TS side of every native integration
  is TDD'd in a normal browser.
- **Over-the-air updates.** Capacitor bakes `dist/` into the binary, so
  `src/native/otaUpdate.ts` uses `@capgo/capacitor-updater` to download new web
  bundles that `deploy.yml` publishes to GitHub Pages. Most changes reach the
  phone without a new TestFlight build.
- **No Mac needed.** `ios.yml` compiles the project, runs `AppLogic` XCTests,
  runs a Simulator smoke test and runs `AppUITests` on GitHub-hosted macOS
  runners. `ios-testflight.yml` signs and uploads to TestFlight
  (`ios/TESTFLIGHT_SETUP.md`, `ios/DEPLOY.md`). Xcode-only steps were
  avoided or scripted: file-system synchronized groups for target folders,
  and the `xcodeproj` gem for adding targets.
- **Swift stays thin.** Logic that has to be native goes into
  `ios/App/AppLogic`, a local Swift package with its own XCTest suite, so it is
  tested without an Xcode test target.

## Consequences

- Features ship once, in TS, and are tested by the same Playwright suite on
  Chromium, mobile Chrome and iPhone WebKit.
- Native-only behavior (ActivityKit rendering, real notification delivery) can
  only be checked on a device via TestFlight. `ios/MANUAL_SETUP.md` lists the
  test layers and what each one can't see.
- The WKWebView is still subject to iOS process and JS suspension. Anything
  that has to happen while the app is backgrounded has to be handed to the OS
  ahead of time, such as an absolute-time notification or a Live Activity with
  its own countdown.
- Capacitor, plugin and Xcode upgrades are an ongoing cost, and CI has hit
  several bugs specific to them (scheme resolution, simulator log capture,
  icon sizing).

## Revisit when

- The native surface grows so that most new work is Swift rather than TS.
- JS suspension in the WKWebView blocks a core feature and handing work to
  the OS ahead of time can't fix it.
- The app leaves this web-first monorepo. A native rewrite in its own repo is
  then a reasonable option.
