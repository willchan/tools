import Foundation
import UIKit
import WatchConnectivity
import os
import AppLogic

/// The phone's WCSession delegate: thin glue between WatchConnectivity and
/// AppLogic's WatchInbox (decode, disk queue, ack). See
/// docs/adr/0002-apple-watch-remote.md.
///
/// Activated from AppDelegate at launch rather than by the WatchBridge
/// plugin, so a tap that wakes the app in the background is written to the
/// disk queue even if no WebView (and so no plugin) ever loads. JS drains
/// the queue with getPendingEvents once it runs.
///
/// Also runs the background-tap experiment (ADR 0002, "Background taps"):
/// each newly queued tap goes through the reducer bundle in JavaScriptCore,
/// and the timings are logged for JS to copy into the app log. Nothing it
/// computes is sent: it measures whether the phone could answer natively.
final class WatchConnectivityCoordinator: NSObject, WCSessionDelegate {
    static let shared = WatchConnectivityCoordinator()

    let inbox: WatchInbox

    /// Called on the main queue for each tap newly on disk. Set by the
    /// WatchBridge plugin to emit `watchEvent` to JS.
    var onEvent: ((ReceivedWatchEvent) -> Void)?

    private let logger = Logger(subsystem: "com.willchan.workouttracker", category: "WatchBridge")
    private let lock = NSLock()
    /// The last snapshot JS pushed, resent once the session activates or the
    /// watch app gets installed. Only the latest one matters.
    private var latestContext: [String: Any]?

    private let probeLog: WatchProbeLog
    private let probeLock = NSLock()
    /// Created on the first tap and kept while the process lives.
    private var probeEngine: WorkoutLogicEngine?

    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }

    override init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let queue = WatchEventQueue(fileURL: support.appendingPathComponent("WatchBridge/pending-events.json"))
        inbox = WatchInbox(queue: queue)
        probeLog = WatchProbeLog(fileURL: support.appendingPathComponent("WatchBridge/probe-results.json"))
        super.init()
        if let setAside = queue.recoveredCorruptFileURL {
            logger.error("watch event queue was unreadable; moved to \(setAside.path, privacy: .public)")
        }
    }

    func activate() {
        guard let session else { return }
        session.delegate = self
        session.activate()
    }

    /// Whether there's a watch app to talk to right now.
    var watchAppAvailable: Bool {
        guard let session, session.activationState == .activated else { return false }
        return session.isPaired && session.isWatchAppInstalled
    }

    /// Send the watch the latest snapshot. Without a paired watch that has
    /// the app, it's kept for later rather than reported as an error: most
    /// launches of this app have no watch app to talk to.
    func push(_ snapshot: WatchSnapshot) throws {
        let context = try WatchMessage.snapshotContext(snapshot)
        lock.lock()
        latestContext = context
        lock.unlock()
        guard watchAppAvailable, let session else { return }
        try session.updateApplicationContext(context)
    }

    private func flushLatestContext() {
        lock.lock()
        let context = latestContext
        lock.unlock()
        guard let context, watchAppAvailable, let session else { return }
        do {
            try session.updateApplicationContext(context)
        } catch {
            logger.error("resending snapshot failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The experiment's measurements since the last call, oldest first.
    func drainProbeResults() throws -> [WatchProbeRecord] {
        try probeLog.drain()
    }

    /// Queue the tap on disk; the returned reply acks it only once it's there.
    /// A newly queued tap is also measured (see `probe`).
    private func handle(_ message: [String: Any], channel: String) -> (reply: [String: Any], probe: WatchProbeRecord?) {
        let receipt = inbox.receive(message, at: Date())
        var measured: WatchProbeRecord?
        switch receipt.outcome {
        case .queued(let event):
            DispatchQueue.main.async { self.onEvent?(event) }
            measured = probe(event, channel: channel)
        case .duplicate:
            break
        case .rejected(let reason):
            logger.error("watch message not queued: \(reason, privacy: .public)")
        }
        return (receipt.reply, measured)
    }

    // MARK: - Background-tap experiment

    /// Run a queued tap through the reducer bundle and time it. Only after
    /// the tap is on disk, and a failure is only recorded, so the tap's ack
    /// and the real workout are unaffected.
    private func probe(_ received: ReceivedWatchEvent, channel: String) -> WatchProbeRecord {
        probeLock.lock()
        defer { probeLock.unlock() }
        var coldStart = false
        var verdict: String?
        var failure: String?
        do {
            let eventJSON = String(decoding: try JSONEncoder().encode(received.event), as: UTF8.self)
            let engine: WorkoutLogicEngine
            if let existing = probeEngine {
                engine = existing
            } else {
                coldStart = true
                engine = try Self.loadProbeEngine()
                probeEngine = engine
            }
            let result = try engine.probe(eventJSON: eventJSON, now: Self.epochMilliseconds())
            let object = try JSONSerialization.jsonObject(with: Data(result.utf8)) as? [String: Any]
            verdict = object?["verdict"] as? String
        } catch {
            failure = "\(error)"
        }
        return WatchProbeRecord(
            eventId: received.event.id, channel: channel, tapAt: received.event.at,
            receivedAt: received.receivedAt, computedAt: Self.epochMilliseconds(), repliedAt: 0,
            coldStart: coldStart, verdict: verdict, error: failure)
    }

    /// Stamp the reply time and the app's state, and keep the record.
    private func keep(_ measured: WatchProbeRecord?) {
        guard var record = measured else { return }
        record.repliedAt = Self.epochMilliseconds()
        DispatchQueue.main.async {
            let app = UIApplication.shared
            switch app.applicationState {
            case .active: record.appState = "active"
            case .inactive: record.appState = "inactive"
            case .background: record.appState = "background"
            @unknown default: record.appState = "unknown"
            }
            // greatestFiniteMagnitude in the foreground: no limit.
            let remaining = app.backgroundTimeRemaining
            record.backgroundTimeRemaining = remaining < 86_400 ? remaining : nil
            do {
                try self.probeLog.append(record)
            } catch {
                self.logger.error("probe result not saved: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private enum ProbeError: Error {
        case bundleMissing
    }

    /// The reducer bundle shipped in the app binary (`bun run build` puts it
    /// in dist/native/, which `cap sync` copies into public/). OTA web
    /// updates don't replace it.
    private static func loadProbeEngine() throws -> WorkoutLogicEngine {
        guard let url = Bundle.main.url(forResource: "workout-logic", withExtension: "js", subdirectory: "public/native") else {
            throw ProbeError.bundleMissing
        }
        return try WorkoutLogicEngine(script: String(contentsOf: url, encoding: .utf8), sourceURL: url)
    }

    private static func epochMilliseconds() -> Double {
        (Date().timeIntervalSince1970 * 1000).rounded()
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        if let error {
            logger.error("WCSession activation failed: \(error.localizedDescription, privacy: .public)")
        }
        if state == .activated { flushLatestContext() }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    /// The user switched to another watch: activate again for the new one.
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        flushLatestContext()
    }

    /// transferUserInfo: the guaranteed-delivery path. The system treats the
    /// transfer as delivered once this returns, so the tap is written to disk
    /// before returning. (A disk failure here can only be logged; the
    /// sendMessage path below can tell the watch to retry.)
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        keep(handle(userInfo, channel: "userInfo").probe)
    }

    /// sendMessage, when the phone is reachable: the fast path. The reply
    /// acks the tap only once it's on disk.
    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let handled = handle(message, channel: "message")
        replyHandler(handled.reply)
        keep(handled.probe)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        keep(handle(message, channel: "message").probe)
    }
}
