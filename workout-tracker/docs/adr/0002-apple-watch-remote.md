# 0002. Apple Watch companion as a thin remote

- **Status:** Accepted, 2026-09. Steps 1 (TS), 2 (native `WatchBridge`,
  `AppLogic` on iOS + watchOS) and 3 (the watch app) are implemented. Step 4
  (real workouts) confirmed JS suspension, so the phone answers watch taps
  natively with the same reducer in JavaScriptCore (see "Background
  taps").
- **Related:** [0001](0001-web-first-with-capacitor-shell.md)

## Context

The user only uses the app on their iPhone. Today they start a workout twice:
once in the phone app, and once as "Traditional Strength Training" in the
watch Fitness app (for heart rate, calories and Activity rings). They want:

- **The watch as a simple remote** for the current workout: complete a set,
  skip or adjust rest, finish.
- **No divergence.** Pulling out the phone at any time shows exactly the same
  state as the watch.
- **Start once.** Starting on either device starts the other, and the watch
  app's own `HKWorkoutSession` replaces the Fitness app workout.

All workout rules live in TypeScript and IndexedDB inside the Capacitor
WKWebView (ADR 0001). While the phone is locked, workout mirroring may keep the
native process alive while WKWebView's JavaScript is suspended. Nobody has
measured this yet.

## Decision

**One brain: the phone's existing TypeScript and IndexedDB.** The watch is a
thin SwiftUI remote that ports no workout rules (e.g. bonus sets from
`src/logic/volume.ts`). It only registers the tap, runs a rest countdown from a
phone-supplied duration, and plays its own haptic when rest ends.

- **Phone → watch:** a numbered, display-ready snapshot sent with
  `updateApplicationContext`. The watch drops any snapshot older than the one
  it has.
- **Watch → phone:** tap events `{v, id, at, type, setId, ...}` where `type` is
  `completeSet` (with reps), `skipRest`, `adjustRest`, `start` or `finish`.
- **Start from either device:** a watch start calls
  `startMirroringToCompanionDevice` (iOS 17 / watchOS 10), which wakes the
  phone app in the background. A phone start calls
  `HKHealthStore.startWatchApp(with:)`.
- **One reducer.** Every in-workout action, whether from a phone tap or a
  watch event, goes through one pure, DOM-free TS function
  (`src/logic/workoutSession.ts`). A parity test checks that a watch
  `completeSet` leaves IndexedDB identical to the same UI tap.

Required safeguards:

1. The native plugin writes each tap to a disk queue *before* acking the
   watch. A tap leaves the queue only after TS has committed it to IndexedDB.
2. Each tap has an idempotency id, recorded in the same IndexedDB transaction
   as the set, so a redelivered tap is a no-op.
3. `setId` guard: a tap for a set the phone has already moved past is
   rejected, and a fresh snapshot is pushed.
4. Taps are applied using the watch's `at` timestamp, not arrival time, so
   delivery delay doesn't shift set times or rest end times.
5. Finish goes through the same queue.
6. Latency instrumentation: native-received vs. JS-applied times are logged
   with `log()` (`src/logic/logger.ts`). One real workout with the phone
   locked will show whether JS is being suspended.

**The JS-suspension risk is tested, not designed around.** If JS is
suspended, the watch shows "Waiting for iPhone…" and stops advancing until the
phone wakes. Because of the queue and idempotency ids, no taps are lost. The
fallback, if needed, is to run the same TS reducer natively in JavaScriptCore,
not to port it to Swift. The queue, protocol, ids and guards above are all
reused by that fallback.

### Build order

1. TS (Playwright TDD): the reducer, id/`setId`/timestamp rules,
   `src/native/watch.ts`, and a web implementation of our `WatchBridge`
   Capacitor plugin that records pushes and has a test-only `emit`. Plus the
   parity test.
2. Native `WatchBridge` (`WCSession` + disk queue). Codable protocol types and
   queue logic go in `ios/App/AppLogic`, made multi-platform (iOS + watchOS),
   with XCTests on both simulators in `ios.yml`.
3. Watch target, added by a checked-in `xcodeproj` gem script as a file-system
   synchronized group: HealthKit and mirroring, start-from-either-device,
   minimal remote UI, HealthKit entitlements, the `workout-processing`
   background mode, iOS deployment target raised to 17, a new watch bundle ID,
   and signing in `ios-testflight.yml`.
4. TestFlight build, then one real workout to read the latency logs.

### Step 2 notes, for step 3

What the phone side now expects from the watch app:

- **Sending taps.** Build a `WatchEvent` (AppLogic), wrap it with
  `WatchMessage.eventMessage`, and send it with `transferUserInfo` (guaranteed,
  queued by the system). When `isReachable`, also `sendMessage` it for
  latency: a reply with `WatchMessage.ackedID` means it's on the phone's disk;
  an `error` reply or failure means rely on (or redo) the transfer. The phone
  dedupes by `id`, so sending both is safe.
- **Receiving snapshots.** Read `WatchMessage.snapshot(from:)` from
  `didReceiveApplicationContext` and `receivedApplicationContext` at launch,
  and pass each through a `WatchSnapshotGate` seeded with what's on screen.
- **`startWatchApp` from the phone** reaches the watch app's
  `handle(_ workoutConfiguration:)`, including while a watch workout is
  already running (e.g. the watch started it). That handler must do nothing
  when an `HKWorkoutSession` exists.
- **HealthKit on the phone.** `WatchBridgePlugin.startWatchApp` calls
  `HKHealthStore.startWatchApp` for real, but only when a paired watch has
  the app installed, which can't happen before step 3. It builds and links
  now (HealthKit autolinks), with no entitlement. Step 3 must add the
  HealthKit entitlement (and usage strings) to `App` at the same time as the
  watch target, or `startWatchApp` fails at runtime.
- **Background wakes.** `WatchConnectivityCoordinator` activates `WCSession`
  in `AppDelegate`, so taps are queued even when mirroring wakes the app
  without a WebView. The queue file is written with
  `completeUntilFirstUserAuthentication` protection so a locked phone can
  write it.
- **Native logging.** Rejected or undecodable taps and queue-file recovery
  go to the unified log (subsystem `com.willchan.workouttracker`, category
  `WatchBridge`), not the in-app `log()`.

## Alternatives considered

- **All-native rewrite (Swift on phone and watch).** Rejected. It throws away
  the tested TS logic and Playwright TDD workflow and gives up OTA updates, for
  a problem (JS suspension) that hasn't been observed yet. See ADR 0001.
- **The watch runs its own Swift copy of the rules** (bonus sets, progression)
  so it can advance on its own. Rejected. Two implementations would drift, and
  phone/watch divergence is exactly what the user ruled out. Reconciling two
  sets of state is harder than using one brain.
- **Keep everything in TS until evidence, adding no native safeguards up
  front.** Rejected. The disk queue, idempotency ids and `setId` guard are what
  make a suspended WebView lose no data, and the JavaScriptCore fallback needs
  them anyway. Deferring them risks losing sets in the one real-workout test
  that would produce the evidence.

## Consequences

- The watch can only advance as fast as phone JS applies taps. If JS is
  suspended while locked, the watch waits.
- The TS reducer is now the one entry point for in-workout actions, so the
  phone UI and watch have to change together.
- The iOS deployment target goes up to 17 (for workout mirroring).
- The watch target adds a signing identity, bundle ID and HealthKit
  entitlements to CI and TestFlight setup.

## Revisit when

- **JS suspension is confirmed** by the latency logs: move the same TS reducer
  into JavaScriptCore on the native side, fed by the existing queue.
- **The watch needs more than remote features** (browsing history, editing
  templates, working without the phone): the thin-remote model no longer fits.
- **The app leaves the web-first repo:** consider going native in its own
  repo, which removes the WebView as the brain.

### Step 3 notes, for step 4

- **Before the first TestFlight build with the watch app**, do the portal
  steps in `ios/TESTFLIGHT_SETUP.md` ("4b"): register the watch App ID,
  enable HealthKit on both App IDs, regenerate the profiles. Until then the
  TestFlight archive fails at signing.
- **What the watch decides locally**, all from the snapshot: after Done it
  counts down `restAfterSetSeconds` from the tap time, skip and ±15s move
  the rest it shows, and every action is disabled until the phone answers.
  After 5 s unanswered it shows "Waiting for iPhone…" (`WatchRemoteState`).
- **Start from the watch**: Start begins the watch's `HKWorkoutSession`,
  mirrors it to the phone (which wakes the app through `WorkoutMirroring`)
  and sends a `start` tap. **Start from the phone**: `startWatchApp` lands
  in the watch app's `handle(_:)`, which starts the session unless one is
  running. The watch session ends when the phone's snapshot goes idle;
  "End Watch Workout" ends it alone if the phone can't.
- **First run asks for Health access twice**: on the phone the first time a
  workout opens with the watch app installed, and on the watch at its first
  workout.
- **What to look at in step 4**: the per-tap `watch event` log lines
  (`queueMs`, `tapToApplyMs`) with the phone locked, how often the watch
  shows "Waiting for iPhone…", and whether a watch-started workout opens on
  the phone without unlocking it.

## Background taps

Step 4's workouts confirmed the JS-suspension risk. In the 2026-10-17 Squat
Day log, every tap reached the phone's native code 114–228 ms after it was
made, locked or not, but of 8 taps made with the phone app in the
background only 3 were applied there (in about 30 ms). Two started and had
their IndexedDB transaction cut off by the next suspension; three waited
for the app to be opened. `WKPreferences.inactiveSchedulingPolicy` doesn't
change this (it's for web views outside a window), and a mirrored workout
doesn't keep the iPhone app running.

So the fallback above goes ahead: the native side answers taps itself by
running the same TS reducer in JavaScriptCore, while IndexedDB stays the
source of truth and the WebView applies the queued taps when it runs.

**Measured first.** A build that ran each tap through the bundle without
sending the result (2026-10-18, OHP Day: 21 taps, 18 with the app in the
background) could have answered in 94–181 ms from the tap, the reducer
itself taking 4–16 ms, plus ~150 ms the first time the bundle loads. Each
background wake had ~30 s of runtime. Nearly every background tap reached
the phone over `transferUserInfo`, which has no reply, so answers are
pushed rather than returned.

**How it works.** `src/native/workoutLogicBundle.ts` is built by
`vite.logic.config.ts` into `dist/native/workout-logic.js`, an IIFE that
runs with no DOM (checked in `e2e/workout-logic-bundle.spec.ts`), and ships
in the app binary via `cap sync`; OTA web updates don't replace it, so a
change to the shadow or the reducer reaches background answers only with a
TestFlight build.

- With every snapshot, the WebView pushes a *shadow* of its session
  (`encodeWatchShadow`: the `WatchSnapshotSource` as plain JSON, null when
  idle).
- When a tap is queued, AppLogic's `WatchAnswerer` runs
  `answerWatchEvents` (via `WorkoutLogicEngine`, JavaScriptCore) over the
  shadow and every tap still in the native queue, and
  `WatchConnectivityCoordinator` sends the snapshot: application context,
  a message when the watch app is in front, and the `sendMessage` reply
  when there is one. Taps the WebView already applied are duplicates, and
  `start` is left to the WebView.
- A WebView push while taps are still queued is replaced by the answer
  over them, so a WebView that hasn't applied them yet can't take the
  watch back. `WatchAnswerer` also keeps `seq` strictly increasing across
  its answers and the WebView's pushes.
- IndexedDB stays the source of truth. The WebView applies the same taps
  through the same reducer when it runs, gets the same state, and acks
  them. `e2e/watch-protocol.spec.ts` checks an answer equals what the
  WebView computes.
- Timings go to `WatchProbeLog`; JS copies them into the app log as
  `watch probe` lines.

**Known gap:** the shadow lives in memory, so after the app process is
killed the first tap waits for the WebView to push one.
