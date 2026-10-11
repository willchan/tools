import Foundation

/// The phone's receive path for a watch tap arriving over WatchConnectivity
/// (`sendMessage` or `transferUserInfo`): decode it, put it on disk, and only
/// then produce the reply that acks it. The App target's WCSession delegate
/// and the WatchBridge plugin are thin glue around this.
public final class WatchInbox {
    public enum Outcome: Equatable, Sendable {
        /// Newly on disk: emit it to JS as `watchEvent`.
        case queued(ReceivedWatchEvent)
        /// Seen before (still queued, or already acked by JS). Ack it again
        /// so the watch stops resending, but don't hand it to JS twice.
        case duplicate(id: String)
        /// Not queued, so not acked: the watch keeps it and retries.
        case rejected(String)
    }

    public struct Receipt {
        public let outcome: Outcome
        /// The `sendMessage` reply for the watch.
        public let reply: [String: Any]
    }

    public let queue: WatchEventQueue

    public init(queue: WatchEventQueue) {
        self.queue = queue
    }

    public func receive(_ message: [String: Any], at date: Date) -> Receipt {
        let event: WatchEvent
        do {
            event = try WatchMessage.event(from: message)
        } catch {
            return Receipt(outcome: .rejected("undecodable: \(error)"), reply: WatchMessage.errorReply("undecodable"))
        }
        do {
            switch try queue.append(event, receivedAt: Self.epochMilliseconds(date)) {
            case .queued(let received):
                return Receipt(outcome: .queued(received), reply: WatchMessage.ackReply(id: event.id))
            case .alreadyQueued, .alreadyAcked:
                return Receipt(outcome: .duplicate(id: event.id), reply: WatchMessage.ackReply(id: event.id))
            }
        } catch {
            return Receipt(outcome: .rejected("not queued: \(error)"), reply: WatchMessage.errorReply("not queued"))
        }
    }

    /// `getPendingEvents` for JS, oldest first.
    public func pendingJSObjects() throws -> [[String: Any]] {
        try queue.pending().map { try $0.jsObject() }
    }

    static func epochMilliseconds(_ date: Date) -> Double {
        (date.timeIntervalSince1970 * 1000).rounded()
    }
}
