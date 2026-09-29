import Foundation
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

    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }

    override init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let queue = WatchEventQueue(fileURL: support.appendingPathComponent("WatchBridge/pending-events.json"))
        inbox = WatchInbox(queue: queue)
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

    /// Queue the tap on disk; the returned reply acks it only once it's there.
    private func handle(_ message: [String: Any]) -> [String: Any] {
        let receipt = inbox.receive(message, at: Date())
        switch receipt.outcome {
        case .queued(let event):
            DispatchQueue.main.async { self.onEvent?(event) }
        case .duplicate:
            break
        case .rejected(let reason):
            logger.error("watch message not queued: \(reason, privacy: .public)")
        }
        return receipt.reply
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
        _ = handle(userInfo)
    }

    /// sendMessage, when the phone is reachable: the fast path. The reply
    /// acks the tap only once it's on disk.
    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        replyHandler(handle(message))
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        _ = handle(message)
    }
}
