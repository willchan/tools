# Workout Tracker

A resistance training tracker PWA built with Vanilla TypeScript, Vite, and IndexedDB. Designed for the 5/3/1 Boring But Big (BBB) program with support for custom templates.

## Architecture

```
workout-tracker/
├── src/
│   ├── main.ts              # App entry point, router setup, SW registration
│   ├── style.css             # Mobile-first responsive CSS (dark theme)
│   ├── db/
│   │   ├── types.ts          # Full data model (exportable as JSON)
│   │   ├── database.ts       # IndexedDB wrapper using `idb` package
│   │   └── defaults.ts       # Default exercises and 5/3/1 BBB template
│   ├── logic/
│   │   ├── calculator.ts     # Weight calculation, plate calculator, TM math
│   │   ├── progression.ts    # State machine for day/week/cycle advancement
│   │   └── timer.ts          # Resilient rest timer (survives tab suspension)
│   └── ui/
│       ├── router.ts         # Hash-based SPA router
│       ├── home.ts           # Home screen with "Start Next Workout" flow
│       ├── workout.ts        # Active workout screen with sets, timer, AMRAP
│       ├── templates.ts      # Template list and editor
│       ├── history.ts        # Completed workout history
│       ├── settings.ts       # Training maxes, export/import, notifications
│       ├── wakelock.ts       # Screen Wake Lock API wrapper
│       └── notifications.ts  # Push notification permission and firing
├── public/
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service worker (network-first caching)
│   └── icons/                # PWA icons
├── e2e/                      # Playwright E2E tests
│   ├── calculator.spec.ts    # 5/3/1 math and plate calculator tests
│   ├── progression.spec.ts   # State progression tests
│   ├── timer.spec.ts         # Resilient timer tests
│   ├── home.spec.ts          # Home screen E2E tests
│   ├── workout.spec.ts       # Workout flow E2E tests
│   ├── templates.spec.ts     # Template editor E2E tests
│   ├── history.spec.ts       # History screen tests
│   ├── settings.spec.ts      # Settings screen tests
│   └── pwa.spec.ts           # PWA capability tests
├── index.html
├── vite.config.ts            # Vite config (no minification, sourcemaps)
├── playwright.config.ts      # Playwright config (runs against Vite dev server)
├── tsconfig.json
└── package.json
```

## Key Design Decisions

### Offline-First
All data is stored in IndexedDB using the `idb` wrapper. The app functions fully offline. A service worker caches the app shell with a network-first strategy.

### Resilient Rest Timer
Instead of using `setTimeout` (which browsers can throttle/suspend), the timer stores `expectedEndTime = Date.now() + durationMs` in IndexedDB. On each tick, remaining time is calculated from the wall clock. This ensures accuracy even when the mobile OS suspends the browser tab.

### State Machine Progression
The app uses a sequential state machine (`cycle`, `weekIndex`, `dayIndex`) rather than a calendar. Completing a workout advances to the next day automatically. After completing all days in a cycle, training maxes are bumped (+10 lbs lower body, +5 lbs upper body).

### Exportable Data Model
The entire database can be exported as a single JSON object via `exportAll()`. This prepares for future Dropbox/iCloud sync.

## PWA Mechanics

- **Service Worker**: `public/sw.js` uses network-first caching with cache fallback for offline support.
- **Manifest**: `public/manifest.json` enables installation as a standalone app.
- **Wake Lock**: `navigator.wakeLock.request('screen')` keeps the screen on during active workouts.
- **Push Notifications**: Service worker fires local notifications when the rest timer completes.

## TDD Setup

All development follows strict Test-Driven Development:

1. Tests are written in `e2e/` using Playwright
2. Tests run against the Vite dev server (configured in `playwright.config.ts`)
3. Core logic tests evaluate TypeScript modules directly in the browser context
4. UI tests verify E2E flows (navigation, workout completion, template editing)
5. Visual regression uses `expect(page).toHaveScreenshot()`

## CI/CD Pipeline

### CI (`ci.yml`)
Runs on PRs and pushes to `main`:
- Installs deps with Bun
- Runs TypeScript typechecking (`tsc --noEmit`)
- Runs Playwright E2E tests
- Uploads Playwright report as artifact

### Deploy (`deploy.yml`)
Runs on pushes to `main`:
- Builds the Vite app with Bun
- Deploys `dist/` to GitHub Pages

## Running Locally

```bash
# Install dependencies
cd workout-tracker
bun install

# Start dev server
bun run dev

# TypeScript typecheck
bun run typecheck

# Run Playwright tests (requires Playwright browsers)
bunx playwright install chromium
bunx playwright test

# Production build
bun run build

# Preview production build
bun run preview
```

## Default 5/3/1 BBB Template

### Wave Structure
| Week | Set 1 | Set 2 | Set 3 (AMRAP) |
|------|-------|-------|---------------|
| 1 (5s) | 65% × 5 | 75% × 5 | 85% × 5+ |
| 2 (3s) | 70% × 3 | 80% × 3 | 90% × 3+ |
| 3 (5/3/1) | 75% × 5 | 85% × 3 | 95% × 1+ |

### Each Day
- 3 main working sets (percentages above)
- 5 × 10 BBB sets @ 50% TM
- 3 × 10-15 accessory sets

### Four Training Days
1. Squat Day (+ Leg Curl, Hanging Leg Raise)
2. Bench Day (+ Dumbbell Row, Face Pull)
3. Deadlift Day (+ Hanging Leg Raise, Dumbbell Curl)
4. OHP Day (+ Pull-ups, Dips)

### TM Progression Per Cycle
- Upper body lifts: +5 lbs
- Lower body lifts: +10 lbs
