import Foundation

/// The watch's rule for incoming snapshots: keep only one with a `seq`
/// strictly greater than the last one accepted. Application context updates
/// and messages can arrive late or out of order, and an older snapshot must
/// never replace a newer one on screen.
public struct WatchSnapshotGate: Sendable {
    public private(set) var lastSeq: Int64?

    /// `lastSeq`: the seq of the snapshot already on screen, if any (e.g.
    /// from WCSession's receivedApplicationContext at launch).
    public init(lastSeq: Int64? = nil) {
        self.lastSeq = lastSeq
    }

    /// Whether to show `snapshot`. Records its seq when it's accepted.
    public mutating func accept(_ snapshot: WatchSnapshot) -> Bool {
        if let last = lastSeq, snapshot.seq <= last { return false }
        lastSeq = snapshot.seq
        return true
    }
}
