import { Capacitor } from '@capacitor/core';
import { isNativePlatform } from './platform';
import { WatchBridge } from './watchBridge';
import type { ReceivedWatchEvent } from './watchBridge';
import { log } from '../logic/logger';
import { buildWatchSnapshot } from '../logic/watchProtocol';
import type { WatchSnapshotSource } from '../logic/watchProtocol';
import { getActiveWorkout } from '../db/database';
import { navigate, parseHash } from '../ui/router';

/**
 * Wires the Apple Watch remote to the phone's workout screen. See
 * docs/adr/0002-apple-watch-remote.md.
 *
 * The watch only reports taps. Each one is handed to the mounted workout
 * screen (the "host"), which runs it through the same reducer and commit
 * path as a phone tap. It's acked back to the native queue only after
 * that commit, so a tap that arrives while JS is suspended, or that fails
 * midway, stays queued natively and is retried on the next drain.
 *
 * Every function here does nothing on the web PWA, or in an iOS build
 * without the native WatchBridge plugin.
 */

/** What handling one in-workout tap came to. */
export type WatchEventOutcome = 'applied' | 'duplicate' | 'stale' | 'invalid';

/** The mounted workout screen, as seen from here. */
export interface WatchSessionHost {
  /** False once the screen has been left or its workout finished. */
  isAlive(): boolean;
  /** Validate, apply and commit one tap. Resolves after the commit. */
  handleEvent(event: ReceivedWatchEvent): Promise<WatchEventOutcome>;
  snapshotSource(): WatchSnapshotSource;
}

let host: WatchSessionHost | null = null;
/** Taps waiting for the workout screen to mount, keyed by id. */
const heldForHost = new Map<string, ReceivedWatchEvent>();
let lastSeq = 0;
/** Set when the watch opened the workout screen, so it isn't launched back. */
let openedByWatch = false;
/** A workout screen was mounted and has since been left or finished. */
let hostEnded = false;
let initialized = false;

/**
 * Whether there's a watch to talk to. Needs the native WatchBridge plugin,
 * so an app binary built before it existed (still reachable by OTA web
 * updates) doesn't reject, and log, every call. Under a custom platform
 * (Playwright's CapacitorCustomPlatform) Capacitor serves the plugin's web
 * implementation instead, which isPluginAvailable() doesn't account for.
 */
function bridgeAvailable(): boolean {
  if (!isNativePlatform()) return false;
  const customPlatform = (window as unknown as { CapacitorCustomPlatform?: unknown }).CapacitorCustomPlatform;
  return Capacitor.isPluginAvailable('WatchBridge') || customPlatform != null;
}

function liveHost(): WatchSessionHost | null {
  return host && host.isAlive() ? host : null;
}

/**
 * Snapshot numbers only ever go up, across app restarts too (the watch keeps
 * the highest it has seen), hence the wall clock rather than a counter
 * starting from zero.
 */
function nextSeq(): number {
  lastSeq = Math.max(lastSeq + 1, Date.now());
  return lastSeq;
}

/** Listen for watch taps and drain any the native side queued while JS was away. */
export function initWatchBridge(): void {
  if (!bridgeAvailable() || initialized) return;
  initialized = true;
  void WatchBridge.addListener('watchEvent', (event) => {
    void receive(event);
  }).catch((err) => warn('watch listener registration failed', err));
  void drainPending();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void drainPending();
  });
  // The workout screen pushes its own snapshot once it mounts; anywhere
  // else, tell the watch there's nothing running.
  if (parseHash().route !== 'workout') void pushWatchSnapshot();
}

async function drainPending(): Promise<void> {
  try {
    const { events } = await WatchBridge.getPendingEvents();
    for (const event of events) await receive(event);
  } catch (err) {
    warn('watch queue drain failed', err);
  }
}

async function receive(event: ReceivedWatchEvent): Promise<void> {
  try {
    if (event.type === 'start') {
      const opening = openWorkoutScreen();
      await finish(event, 'applied');
      // The mounting screen pushes its own snapshot; pushing one now would
      // briefly tell the watch nothing is running.
      if (!opening) await pushWatchSnapshot();
      return;
    }

    let current = liveHost();
    if (!current) {
      const hasWorkout = !!(await getActiveWorkout());
      // The screen may have mounted while that read was in flight.
      current = liveHost();
      if (!current && !hasWorkout) {
        // Nothing to apply it to. The watch is behind: tell it so.
        await finish(event, 'stale');
        return;
      }
      if (!current) {
        // A workout is in progress but its screen isn't mounted: open it,
        // and apply the tap once it's there. Not acked until then.
        heldForHost.set(event.id, event);
        openWorkoutScreen();
        return;
      }
    }

    await finish(event, await current.handleEvent(event));
  } catch (err) {
    // Not acked: it stays in the native queue for the next drain.
    warn(`watch event ${event.id} failed`, err);
  }
}

/** Log, ack, and (unless the host already did) answer with a fresh snapshot. */
async function finish(event: ReceivedWatchEvent, outcome: WatchEventOutcome): Promise<void> {
  const appliedAt = Date.now();
  await log(
    outcome === 'applied' || outcome === 'duplicate' ? 'info' : 'warn',
    'watch event',
    `type=${event.type} id=${event.id} outcome=${outcome} ` +
      `tapAt=${event.at} nativeReceivedAt=${event.receivedAt} jsAppliedAt=${appliedAt} ` +
      `queueMs=${Math.max(0, appliedAt - event.receivedAt)} tapToApplyMs=${Math.max(0, appliedAt - event.at)}`,
  );
  await WatchBridge.ackEvent({ id: event.id });
  if (outcome !== 'applied') await pushWatchSnapshot();
}

/**
 * Show the workout screen for the watch, unless it's already up. Returns
 * whether a screen is on its way to mounting (and will push a snapshot).
 */
function openWorkoutScreen(): boolean {
  if (liveHost()) return false;
  openedByWatch = true;
  if (parseHash().route !== 'workout') {
    navigate('workout');
  } else if (hostEnded) {
    // Still on a finished workout's screen (e.g. its missed-reps sheet):
    // render the route again. Otherwise it's mid-render and will mount.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  return true;
}

/**
 * Called by the workout screen once it's rendered. Pushes its state to the
 * watch and applies any taps that were waiting for it.
 */
export function attachWorkoutHost(next: WatchSessionHost): void {
  if (!bridgeAvailable()) return;
  host = next;
  hostEnded = false;
  void pushWatchSnapshot();
  const held = [...heldForHost.values()];
  heldForHost.clear();
  for (const event of held) void receive(event);
}

/** Called when the workout screen is left or its workout ends. */
export function detachWorkoutHost(prev: WatchSessionHost): void {
  if (!bridgeAvailable()) return;
  if (host === prev) {
    host = null;
    hostEnded = true;
  }
  void pushWatchSnapshot();
}

/** Send the watch the current state: the mounted workout, or idle. */
export async function pushWatchSnapshot(): Promise<void> {
  if (!bridgeAvailable()) return;
  try {
    const source = liveHost()?.snapshotSource() ?? null;
    await WatchBridge.pushSnapshot({ snapshot: buildWatchSnapshot(nextSeq(), source) });
  } catch (err) {
    warn('watch snapshot push failed', err);
  }
}

/**
 * A workout was opened on the phone: launch the watch app into it, unless
 * the watch is what opened it. Starting a workout on either device starts
 * the other.
 */
export async function startWatchWorkout(): Promise<void> {
  if (!bridgeAvailable()) return;
  if (openedByWatch) {
    openedByWatch = false;
    return;
  }
  try {
    await WatchBridge.startWatchApp();
  } catch (err) {
    warn('watch app start failed', err);
  }
}

function warn(message: string, err: unknown): void {
  void log('warn', `${message}: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
}
