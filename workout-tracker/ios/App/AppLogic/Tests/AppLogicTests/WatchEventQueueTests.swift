import XCTest
@testable import AppLogic

/// The phone's disk queue of watch taps (ADR 0002, safeguard 1): a tap is
/// on disk before the watch is acked, and leaves only when JS acks it.
final class WatchEventQueueTests: XCTestCase {
    private var directory: URL!
    private var fileURL: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("WatchEventQueueTests-\(UUID().uuidString)", isDirectory: true)
        fileURL = directory.appendingPathComponent("queue.json")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func event(_ id: String, at: Double = 1_000, type: WatchEventType = .completeSet) -> WatchEvent {
        WatchEvent(id: id, at: at, type: type, setId: "set", reps: type == .completeSet ? 5 : nil)
    }

    func testAMissingFileIsAnEmptyQueue() {
        let queue = WatchEventQueue(fileURL: fileURL)
        XCTAssertEqual(queue.pending(), [])
        XCTAssertNil(queue.recoveredCorruptFileURL)
    }

    func testAppendReturnsTheReceivedEvent() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        let result = try queue.append(event("a"), receivedAt: 5_000)
        XCTAssertEqual(result, .queued(ReceivedWatchEvent(event: event("a"), receivedAt: 5_000)))
    }

    func testPendingIsOldestFirst() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        try queue.append(event("a"), receivedAt: 1)
        try queue.append(event("b"), receivedAt: 2)
        try queue.append(event("c"), receivedAt: 3)
        XCTAssertEqual(queue.pending().map(\.event.id), ["a", "b", "c"])
    }

    /// The append is on disk by the time it returns, i.e. before the caller
    /// acks the watch: a fresh queue on the same file (a relaunched app)
    /// sees it.
    func testAppendIsPersistedBeforeItReturns() throws {
        try WatchEventQueue(fileURL: fileURL).append(event("a"), receivedAt: 7)
        let reloaded = WatchEventQueue(fileURL: fileURL)
        XCTAssertEqual(reloaded.pending(), [ReceivedWatchEvent(event: event("a"), receivedAt: 7)])
        XCTAssertNil(reloaded.recoveredCorruptFileURL)
    }

    func testTheSameIdIsQueuedOnceAndKeepsItsFirstReceipt() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        try queue.append(event("a"), receivedAt: 1)
        let again = try queue.append(event("a"), receivedAt: 99)
        XCTAssertEqual(again, .alreadyQueued(ReceivedWatchEvent(event: event("a"), receivedAt: 1)))
        XCTAssertEqual(queue.pending().count, 1)
        XCTAssertEqual(WatchEventQueue(fileURL: fileURL).pending().count, 1)
    }

    func testAckRemovesOnlyThatEvent() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        try queue.append(event("a"), receivedAt: 1)
        try queue.append(event("b"), receivedAt: 2)
        try queue.ack(id: "a")
        XCTAssertEqual(queue.pending().map(\.event.id), ["b"])
        XCTAssertEqual(WatchEventQueue(fileURL: fileURL).pending().map(\.event.id), ["b"])
    }

    func testNothingLeavesTheQueueWithoutAnAck() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        try queue.append(event("a"), receivedAt: 1)
        _ = queue.pending()
        _ = queue.pending()
        XCTAssertEqual(WatchEventQueue(fileURL: fileURL).pending().map(\.event.id), ["a"])
    }

    func testAckingAnUnknownIdIsHarmless() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        try queue.append(event("a"), receivedAt: 1)
        XCTAssertNoThrow(try queue.ack(id: "nope"))
        XCTAssertEqual(queue.pending().map(\.event.id), ["a"])
    }

    /// The watch may deliver one tap twice (sendMessage, then the
    /// transferUserInfo backup). Once JS has committed and acked it, the
    /// second copy isn't queued or handed to JS again.
    func testARedeliveryAfterAckIsNotQueuedAgain() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        try queue.append(event("a"), receivedAt: 1)
        try queue.ack(id: "a")
        XCTAssertEqual(try queue.append(event("a"), receivedAt: 2), .alreadyAcked)
        XCTAssertEqual(queue.pending(), [])
        // Remembered across relaunches too.
        XCTAssertEqual(try WatchEventQueue(fileURL: fileURL).append(event("a"), receivedAt: 3), .alreadyAcked)
    }

    func testRememberedAcksAreBounded() throws {
        let queue = WatchEventQueue(fileURL: fileURL, ackedIDLimit: 3)
        for id in ["a", "b", "c", "d"] {
            try queue.append(event(id), receivedAt: 1)
            try queue.ack(id: id)
        }
        // "a" was forgotten; the TS idempotency ids still catch it.
        XCTAssertEqual(try queue.append(event("a"), receivedAt: 2),
                       .queued(ReceivedWatchEvent(event: event("a"), receivedAt: 2)))
        XCTAssertEqual(try queue.append(event("d"), receivedAt: 2), .alreadyAcked)
    }

    /// If the write fails, the append throws (so the watch isn't acked and
    /// retries) and nothing is half-queued in memory.
    func testAFailedWriteThrowsAndQueuesNothing() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        // A directory where the file should be makes every write fail.
        try FileManager.default.createDirectory(at: fileURL, withIntermediateDirectories: true)
        XCTAssertThrowsError(try queue.append(event("a"), receivedAt: 1))
        XCTAssertEqual(queue.pending(), [])
    }

    func testAFailedAckWriteThrowsAndKeepsTheEvent() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        try queue.append(event("a"), receivedAt: 1)
        try FileManager.default.removeItem(at: fileURL)
        try FileManager.default.createDirectory(at: fileURL, withIntermediateDirectories: true)
        XCTAssertThrowsError(try queue.ack(id: "a"))
        XCTAssertEqual(queue.pending().map(\.event.id), ["a"])
    }

    func testACorruptFileIsSetAsideAndTheQueueStartsEmpty() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let garbage = Data("{\"version\":1,\"pending\":[{\"v\":1,\"id\"".utf8) // truncated
        try garbage.write(to: fileURL)

        let queue = WatchEventQueue(fileURL: fileURL)
        XCTAssertEqual(queue.pending(), [])
        // Kept for a human to look at, not silently deleted.
        let setAside = try XCTUnwrap(queue.recoveredCorruptFileURL)
        XCTAssertNotEqual(setAside, fileURL)
        XCTAssertEqual(try Data(contentsOf: setAside), garbage)

        // And the queue works normally from there, on the original path.
        try queue.append(event("a"), receivedAt: 1)
        let reloaded = WatchEventQueue(fileURL: fileURL)
        XCTAssertEqual(reloaded.pending().map(\.event.id), ["a"])
        XCTAssertNil(reloaded.recoveredCorruptFileURL)
    }

    func testAnEmptyFileIsTreatedAsCorrupt() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data().write(to: fileURL)
        let queue = WatchEventQueue(fileURL: fileURL)
        XCTAssertEqual(queue.pending(), [])
        XCTAssertNotNil(queue.recoveredCorruptFileURL)
    }

    func testAFileFromANewerFormatIsSetAsideRatherThanMisread() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data(#"{"version":99,"pending":[],"acked":[]}"#.utf8).write(to: fileURL)
        let queue = WatchEventQueue(fileURL: fileURL)
        XCTAssertEqual(queue.pending(), [])
        XCTAssertNotNil(queue.recoveredCorruptFileURL)
    }

    func testCreatesMissingParentDirectories() throws {
        let nested = directory.appendingPathComponent("a/b/queue.json")
        let queue = WatchEventQueue(fileURL: nested)
        try queue.append(event("a"), receivedAt: 1)
        XCTAssertEqual(WatchEventQueue(fileURL: nested).pending().count, 1)
    }

    /// WCSession delegate callbacks and plugin calls arrive on different
    /// threads.
    func testConcurrentAppendsAndAcksAreAllApplied() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        DispatchQueue.concurrentPerform(iterations: 40) { i in
            do {
                try queue.append(self.event("e\(i)"), receivedAt: Double(i))
            } catch {
                XCTFail("append e\(i): \(error)")
            }
        }
        DispatchQueue.concurrentPerform(iterations: 20) { i in
            do {
                try queue.ack(id: "e\(i * 2)")
            } catch {
                XCTFail("ack e\(i * 2): \(error)")
            }
        }
        let expected = Set((0..<20).map { "e\($0 * 2 + 1)" })
        XCTAssertEqual(Set(queue.pending().map(\.event.id)), expected)
        XCTAssertEqual(Set(WatchEventQueue(fileURL: fileURL).pending().map(\.event.id)), expected)
    }
}
