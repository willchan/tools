import Foundation
import UIKit
import WatchConnectivity
import os
import AppLogic

/// The phone's WCSession delegate: thin glue between WatchConnectivity and
/// AppLogic's WatchInbox (decode, disk queue, ack) and WatchAnswerer. See
/// docs/adr/0002-apple-watch-remote.md.
///
/// Activated from AppDelegate at launch rather than by the WatchBridge
/// plugin, so a tap that wakes the app in the background is written to the
/// disk queue even if no WebView (and so no plugin) ever loads. JS drains
/// the queue with getPendingEvents once it runs.
///
/// Each newly queued tap is also answered natively (ADR 0002, "Background
/// taps"): the reducer bundle runs in JavaScriptCore over the WebView's
/// latest shadow and the queue, and the resulting snapshot goes straight to
/// the watch, so it doesn't wait for a suspended WebView. Timings are logged
/// for JS to copy into the app log.
final class WatchConnectivityCoordinator: NSObject, WCSessionDelegate {
    static let shared = WatchConnectivityCoordinator()

    let inbox: WatchInbox

    /// Called on the main queue for each tap newly on disk. Set by the
    /// WatchBridge plugin to emit `watchEvent` to JS.
    var onEvent: ((ReceivedWatchEvent) -> Void)?

    private let logger = Logger(subsystem: "com.willchan.workouttracker", category: "WatchBridge")
    private let lock = NSLock()
    /// The newest snapshot sent, resent once the session activates or the
    /// watch app gets installed. Only the latest one matters.
    private var latestContext: [String: Any]?
    private var latestSeq: Int64 = 0

    private let answerer = WatchAnswerer(makeEngine: WatchConnectivityCoordinator.loadEngine)
    private let answerLog: WatchProbeLog

    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }

    override init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let queue = WatchEventQueue(fileURL: support.appendingPathComponent("WatchBridge/pending-events.json"))
        inbox = WatchInbox(queue: queue)
        answerLog = WatchProbeLog(fileURL: support.appendingPathComponent("WatchBridge/probe-results.json"))
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

    /// The WebView's latest snapshot and the shadow it was built from (nil
    /// when idle). With taps still queued, the watch gets the native answer
    /// over them instead, so a WebView that hasn't applied them yet can't
    /// take it back.
    func push(_ snapshot: WatchSnapshot, shadowJSON: String?) throws {
        let pending = inbox.queue.pending().map(\.event)
        let result = answerer.webViewPushed(
            snapshot, shadowJSON: shadowJSON, pending: pending, now: Self.epochMilliseconds())
        if let error = result.error {
            logger.error("answering queued taps failed: \(String(describing: error), privacy: .public)")
        }
        try send(result.snapshot)
    }

    /// Send the watch a snapshot: as the application context, which the
    /// watch reads whenever it next runs, and as a message too when the
    /// watch app is in front, which arrives sooner. Without a paired watch
    /// that has the app, it's kept for later rather than reported as an
    /// error: most launches of this app have no watch app to talk to. A
    /// snapshot older than one already sent (two threads racing) is dropped.
    @discardableResult
    private func send(_ snapshot: WatchSnapshot) throws -> [String: Any] {
        let context = try WatchMessage.snapshotContext(snapshot)
        lock.lock()
        let isNewest = snapshot.seq >= latestSeq
        if isNewest {
            latestContext = context
            latestSeq = snapshot.seq
        }
        lock.unlock()
        guard isNewest, watchAppAvailable, let session else { return context }
        try session.updateApplicationContext(context)
        if session.isReachable {
            session.sendMessage(context, replyHandler: nil) { [logger] error in
                logger.info("snapshot message failed, the context still has it: \(error.localizedDescription, privacy: .public)")
            }
        }
        return context
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

    /// Answer timings since the last call, oldest first.
    func drainProbeResults() throws -> [WatchProbeRecord] {
        try answerLog.drain()
    }

    /// Queue the tap on disk; the returned reply acks it only once it's there.
    /// A newly queued tap is then answered (see `answer`), and the reply
    /// carries that snapshot too.
    private func handle(_ message: [String: Any], channel: String) -> (reply: [String: Any], record: WatchProbeRecord?) {
        let receipt = inbox.receive(message, at: Date())
        switch receipt.outcome {
        case .queued(let event):
            DispatchQueue.main.async { self.onEvent?(event) }
            let (context, record) = answer(event, channel: channel)
            let reply = context.map { receipt.reply.merging($0) { ack, _ in ack } } ?? receipt.reply
            return (reply, record)
        case .duplicate:
            return (receipt.reply, nil)
        case .rejected(let reason):
            logger.error("watch message not queued: \(reason, privacy: .public)")
            return (receipt.reply, nil)
        }
    }

    // MARK: - Answering taps natively

    /// Answer the queue (this tap included) from the WebView's shadow and
    /// send the snapshot. Only after the tap is on disk, and a failure is
    /// only logged: the WebView still applies the tap when it runs. Returns
    /// the context sent, if any, and the timing record.
    private func answer(_ received: ReceivedWatchEvent, channel: String) -> ([String: Any]?, WatchProbeRecord) {
        let pending = inbox.queue.pending().map(\.event)
        var context: [String: Any]?
        var coldStart = false
        var verdict: String?
        var failure: String?
        do {
            if let answer = try answerer.answer(pending: pending, now: Self.epochMilliseconds()) {
                coldStart = answer.coldStart
                if let index = pending.firstIndex(where: { $0.id == received.event.id }), index < answer.verdicts.count {
                    verdict = answer.verdicts[index]
                }
                context = try send(answer.snapshot)
            } else {
                failure = "noShadow"
            }
        } catch {
            failure = "\(error)"
        }
        let record = WatchProbeRecord(
            eventId: received.event.id, channel: channel, tapAt: received.event.at,
            receivedAt: received.receivedAt, computedAt: Self.epochMilliseconds(), repliedAt: 0,
            coldStart: coldStart, verdict: verdict, error: failure)
        return (context, record)
    }

    /// Stamp the reply time and the app's state, and keep the record.
    private func keep(_ record: WatchProbeRecord?) {
        guard var record else { return }
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
                try self.answerLog.append(record)
            } catch {
                self.logger.error("answer timing not saved: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private enum EngineError: Error {
        case bundleMissing
    }

    /// The reducer bundle shipped in the app binary (`bun run build` puts it
    /// in dist/native/, which `cap sync` copies into public/). OTA web
    /// updates don't replace it, so a protocol change to the shadow needs a
    /// TestFlight build too.
    private static func loadEngine() throws -> WatchAnswerEngine {
        guard let url = Bundle.main.url(forResource: "workout-logic", withExtension: "js", subdirectory: "public/native") else {
            throw EngineError.bundleMissing
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
        keep(handle(userInfo, channel: "userInfo").record)
    }

    /// sendMessage, when the phone is reachable: the fast path. The reply
    /// acks the tap only once it's on disk, and carries the answer.
    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let handled = handle(message, channel: "message")
        replyHandler(handled.reply)
        keep(handled.record)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        keep(handle(message, channel: "message").record)
    }
}
