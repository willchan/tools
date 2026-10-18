import Foundation
import WatchConnectivity
import os
import AppLogic

private let log = Logger(subsystem: "com.willchan.workouttracker.watchkitapp", category: "PhoneLink")

/// The watch's WCSession delegate: snapshots in, taps out. Payload encoding
/// is AppLogic's WatchMessage, shared with the phone.
final class PhoneLink: NSObject, WCSessionDelegate {
    /// Called on the main queue with every snapshot the phone sends,
    /// including the one the system kept from before this launch.
    var onSnapshot: ((WatchSnapshot) -> Void)?

    private let lock = NSLock()
    /// Taps made before the session finished activating.
    private var unsent: [[String: Any]] = []

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Send a tap. transferUserInfo is the guaranteed path (the system queues
    /// it until the phone takes it, across relaunches); sendMessage is the
    /// fast path when the phone is reachable. The phone dedupes by id, so a
    /// tap arriving both ways is applied once.
    func send(_ event: WatchEvent) {
        let message: [String: Any]
        do {
            message = try WatchMessage.eventMessage(event)
        } catch {
            log.error("could not encode tap \(event.id, privacy: .public): \(error.localizedDescription, privacy: .public)")
            return
        }
        let session = WCSession.default
        guard session.activationState == .activated else {
            lock.lock()
            unsent.append(message)
            lock.unlock()
            return
        }
        deliver(message, on: session)
    }

    private func deliver(_ message: [String: Any], on session: WCSession) {
        session.transferUserInfo(message)
        guard session.isReachable else { return }
        session.sendMessage(message, replyHandler: { [weak self] reply in
            if WatchMessage.ackedID(in: reply) == nil {
                log.error("phone did not queue a tap; the transfer will retry it")
            }
            // The phone answers the tap itself when it can (ADR 0002,
            // "Background taps"); the reply then carries the snapshot.
            self?.forward(reply)
        }, errorHandler: { error in
            log.info("sendMessage failed, relying on the transfer: \(error.localizedDescription, privacy: .public)")
        })
    }

    private func forward(_ context: [String: Any]) {
        do {
            guard let snapshot = try WatchMessage.snapshot(from: context) else { return }
            DispatchQueue.main.async { self.onSnapshot?(snapshot) }
        } catch {
            log.error("undecodable snapshot: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        if let error {
            log.error("WCSession activation failed: \(error.localizedDescription, privacy: .public)")
        }
        guard state == .activated else { return }
        forward(session.receivedApplicationContext)
        lock.lock()
        let queued = unsent
        unsent = []
        lock.unlock()
        for message in queued { deliver(message, on: session) }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        forward(applicationContext)
    }

    /// The phone also sends each snapshot as a message while this app is in
    /// front: it arrives sooner than the context. Older ones are dropped by
    /// WatchRemoteState's seq check, whichever way they came.
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        forward(message)
    }

    func session(
        _ session: WCSession, didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        forward(message)
        replyHandler([:])
    }
}
