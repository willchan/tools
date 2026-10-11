import XCTest
@testable import AppLogic

/// The watch keeps only the newest snapshot: application context and
/// messages can arrive out of order, and an older one must never overwrite
/// what the watch shows.
final class WatchSnapshotGateTests: XCTestCase {
    private func snapshot(seq: Int64) -> WatchSnapshot {
        WatchSnapshot(seq: seq, status: .idle, workout: nil)
    }

    func testTheFirstSnapshotIsAccepted() {
        var gate = WatchSnapshotGate()
        XCTAssertNil(gate.lastSeq)
        XCTAssertTrue(gate.accept(snapshot(seq: 5)))
        XCTAssertEqual(gate.lastSeq, 5)
    }

    func testOnlyAStrictlyHigherSeqIsAccepted() {
        var gate = WatchSnapshotGate()
        XCTAssertTrue(gate.accept(snapshot(seq: 5)))
        XCTAssertFalse(gate.accept(snapshot(seq: 5)), "same seq")
        XCTAssertFalse(gate.accept(snapshot(seq: 4)), "older seq")
        XCTAssertEqual(gate.lastSeq, 5)
        XCTAssertTrue(gate.accept(snapshot(seq: 6)))
        XCTAssertEqual(gate.lastSeq, 6)
    }

    /// Seeded from the snapshot the watch already had (e.g. WCSession's
    /// receivedApplicationContext on relaunch).
    func testCanBeSeededWithTheLastSeqSeen() {
        var gate = WatchSnapshotGate(lastSeq: 10)
        XCTAssertFalse(gate.accept(snapshot(seq: 9)))
        XCTAssertTrue(gate.accept(snapshot(seq: 11)))
    }

    /// Phone seqs are wall-clock based (src/native/watch.ts nextSeq), far
    /// beyond Int32.
    func testHandlesEpochMillisecondSeqs() {
        var gate = WatchSnapshotGate(lastSeq: 1_759_100_000_001)
        XCTAssertTrue(gate.accept(snapshot(seq: 1_759_100_000_002)))
    }
}
