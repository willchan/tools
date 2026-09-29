import XCTest
@testable import AppLogic

/// The phone's receive path for a WatchConnectivity message: decode, queue
/// on disk, and only then build the ack reply for the watch.
final class WatchInboxTests: XCTestCase {
    private var directory: URL!
    private var fileURL: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("WatchInboxTests-\(UUID().uuidString)", isDirectory: true)
        fileURL = directory.appendingPathComponent("queue.json")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private let received = Date(timeIntervalSince1970: 1_759_100_050.321)

    private func completeSet(_ id: String = "tap-1") -> WatchEvent {
        WatchEvent(id: id, at: 1_759_100_050_000, type: .completeSet, setId: "s", reps: 5)
    }

    func testAValidTapIsQueuedThenAcked() throws {
        let inbox = WatchInbox(queue: WatchEventQueue(fileURL: fileURL))
        let receipt = inbox.receive(try WatchMessage.eventMessage(completeSet()), at: received)

        let expected = ReceivedWatchEvent(event: completeSet(), receivedAt: 1_759_100_050_321)
        XCTAssertEqual(receipt.outcome, .queued(expected))
        XCTAssertEqual(WatchMessage.ackedID(in: receipt.reply), "tap-1")
        // On disk by the time the reply exists.
        XCTAssertEqual(WatchEventQueue(fileURL: fileURL).pending(), [expected])
    }

    func testReceivedAtIsWholeEpochMilliseconds() throws {
        let inbox = WatchInbox(queue: WatchEventQueue(fileURL: fileURL))
        let receipt = inbox.receive(try WatchMessage.eventMessage(completeSet()),
                                    at: Date(timeIntervalSince1970: 1.2346))
        guard case .queued(let event) = receipt.outcome else { return XCTFail("\(receipt.outcome)") }
        XCTAssertEqual(event.receivedAt, 1_235)
    }

    /// Acked again so the watch stops resending, but not handed to JS twice.
    func testADuplicateIsAckedButNotQueuedAgain() throws {
        let inbox = WatchInbox(queue: WatchEventQueue(fileURL: fileURL))
        _ = inbox.receive(try WatchMessage.eventMessage(completeSet()), at: received)
        let again = inbox.receive(try WatchMessage.eventMessage(completeSet()), at: received)
        XCTAssertEqual(again.outcome, .duplicate(id: "tap-1"))
        XCTAssertEqual(WatchMessage.ackedID(in: again.reply), "tap-1")
    }

    func testARedeliveryAfterJSAckedIsADuplicate() throws {
        let queue = WatchEventQueue(fileURL: fileURL)
        let inbox = WatchInbox(queue: queue)
        _ = inbox.receive(try WatchMessage.eventMessage(completeSet()), at: received)
        try queue.ack(id: "tap-1")
        let again = inbox.receive(try WatchMessage.eventMessage(completeSet()), at: received)
        XCTAssertEqual(again.outcome, .duplicate(id: "tap-1"))
        XCTAssertEqual(WatchMessage.ackedID(in: again.reply), "tap-1")
        XCTAssertEqual(queue.pending(), [])
    }

    func testAMalformedMessageIsRejectedAndNotQueued() {
        let inbox = WatchInbox(queue: WatchEventQueue(fileURL: fileURL))
        let receipt = inbox.receive([WatchMessage.eventKey: Data("nope".utf8)], at: received)
        guard case .rejected = receipt.outcome else { return XCTFail("\(receipt.outcome)") }
        XCTAssertNil(WatchMessage.ackedID(in: receipt.reply))
        XCTAssertNotNil(receipt.reply[WatchMessage.errorKey])
        XCTAssertEqual(WatchEventQueue(fileURL: fileURL).pending(), [])
    }

    /// Not acked, so the watch keeps the tap and retries.
    func testADiskFailureIsNotAcked() throws {
        let inbox = WatchInbox(queue: WatchEventQueue(fileURL: fileURL))
        try FileManager.default.createDirectory(at: fileURL, withIntermediateDirectories: true)
        let receipt = inbox.receive(try WatchMessage.eventMessage(completeSet()), at: received)
        guard case .rejected = receipt.outcome else { return XCTFail("\(receipt.outcome)") }
        XCTAssertNil(WatchMessage.ackedID(in: receipt.reply))
    }

    func testPendingEventsForJSAreOldestFirstJSObjects() throws {
        let inbox = WatchInbox(queue: WatchEventQueue(fileURL: fileURL))
        _ = inbox.receive(try WatchMessage.eventMessage(completeSet("a")), at: received)
        _ = inbox.receive(try WatchMessage.eventMessage(completeSet("b")), at: received.addingTimeInterval(1))
        let objects = try inbox.pendingJSObjects()
        XCTAssertEqual(objects.map { $0["id"] as? String }, ["a", "b"])
        XCTAssertEqual(objects.first?["receivedAt"] as? Double, 1_759_100_050_321)
        XCTAssertEqual(objects.first?["type"] as? String, "completeSet")
    }
}
