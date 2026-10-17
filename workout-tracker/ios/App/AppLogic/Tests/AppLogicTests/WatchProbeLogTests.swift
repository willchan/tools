import XCTest
@testable import AppLogic

/// The background-tap experiment's measurements, kept on disk until JS
/// copies them into the app log.
final class WatchProbeLogTests: XCTestCase {
    private var directory: URL!
    private var fileURL: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("WatchProbeLogTests-\(UUID().uuidString)", isDirectory: true)
        fileURL = directory.appendingPathComponent("probe.json")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func record(_ id: String) -> WatchProbeRecord {
        WatchProbeRecord(eventId: id, channel: "message", tapAt: 1_000, receivedAt: 1_150, computedAt: 1_170, repliedAt: 1_171,
                         coldStart: true, verdict: "apply", error: nil,
                         appState: "background", backgroundTimeRemaining: 29.5)
    }

    func testDrainReturnsRecordsInOrderAndEmptiesTheLog() throws {
        let log = WatchProbeLog(fileURL: fileURL)
        try log.append(record("a"))
        try log.append(record("b"))
        XCTAssertEqual(try log.drain().map(\.eventId), ["a", "b"])
        XCTAssertEqual(try log.drain(), [])
    }

    func testRecordsSurviveARelaunch() throws {
        try WatchProbeLog(fileURL: fileURL).append(record("a"))
        XCTAssertEqual(try WatchProbeLog(fileURL: fileURL).drain(), [record("a")])
    }

    func testKeepsOnlyTheNewestRecords() throws {
        let log = WatchProbeLog(fileURL: fileURL, limit: 2)
        for id in ["a", "b", "c"] { try log.append(record(id)) }
        XCTAssertEqual(try log.drain().map(\.eventId), ["b", "c"])
    }

    func testAnUnreadableFileStartsAFreshLog() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: fileURL)
        let log = WatchProbeLog(fileURL: fileURL)
        try log.append(record("a"))
        XCTAssertEqual(try log.drain().map(\.eventId), ["a"])
    }

    func testJSObjectHasTheTimingsAndLeavesOutMissingFields() throws {
        var failed = record("a")
        failed.verdict = nil
        failed.error = "boom"
        failed.backgroundTimeRemaining = nil
        let object = try failed.jsObject()
        XCTAssertEqual(object["eventId"] as? String, "a")
        XCTAssertEqual(object["channel"] as? String, "message")
        XCTAssertEqual(object["tapAt"] as? Double, 1_000)
        XCTAssertEqual(object["repliedAt"] as? Double, 1_171)
        XCTAssertEqual(object["coldStart"] as? Bool, true)
        XCTAssertEqual(object["error"] as? String, "boom")
        XCTAssertNil(object["verdict"])
        XCTAssertNil(object["backgroundTimeRemaining"])
    }
}
