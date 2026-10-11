import XCTest
@testable import AppLogic

/// The Codable mirrors of src/logic/watchProtocol.ts. Every fixture must
/// decode and re-encode to exactly the same JSON, nulls included, so what
/// the phone's TypeScript sends and what the watch decodes can't drift.
final class WatchProtocolTests: XCTestCase {
    func testProtocolVersionMatchesTypeScript() {
        XCTAssertEqual(WatchProtocol.version, 1)
    }

    func testEventTypesMatchTypeScript() {
        XCTAssertEqual(
            WatchEventType.allCases.map(\.rawValue),
            ["start", "completeSet", "skipRest", "adjustRest", "finish"])
    }

    func testSnapshotStatusValuesMatchTypeScript() {
        XCTAssertEqual(WatchSnapshot.Status.allCases.map(\.rawValue), ["idle", "active"])
    }

    func testEventFixturesRoundTripExactly() throws {
        for name in Fixture.eventNames {
            let event = try JSONDecoder().decode(WatchEvent.self, from: Fixture.data(name))
            let reencoded = try jsonDictionary(JSONEncoder().encode(event))
            XCTAssertEqual(reencoded, try Fixture.object(name), name)
        }
    }

    func testDecodesCompleteSetFields() throws {
        let event = try JSONDecoder().decode(WatchEvent.self, from: Fixture.data("event-complete-set.json"))
        XCTAssertEqual(event.v, 1)
        XCTAssertEqual(event.id, "6F1C2A4E-0B7D-4E43-9C55-1A2B3C4D5E02")
        XCTAssertEqual(event.at, 1_759_100_050_000)
        XCTAssertEqual(event.type, .completeSet)
        XCTAssertEqual(event.setId, "1759100000000/0/squat:0.65:5::")
        XCTAssertEqual(event.reps, 4)
        XCTAssertNil(event.deltaSeconds)
    }

    func testDecodesAdjustRestDelta() throws {
        let event = try JSONDecoder().decode(WatchEvent.self, from: Fixture.data("event-adjust-rest.json"))
        XCTAssertEqual(event.type, .adjustRest)
        XCTAssertEqual(event.deltaSeconds, -15)
        XCTAssertNil(event.reps)
    }

    /// TS optional fields (`setId?`, `reps?`, `deltaSeconds?`) are absent
    /// keys, not nulls.
    func testAbsentOptionalEventFieldsAreOmittedNotNull() throws {
        let start = WatchEvent(id: "a", at: 1, type: .start)
        let keys = try jsonDictionary(JSONEncoder().encode(start)).allKeys as? [String]
        XCTAssertEqual(Set(keys ?? []), ["v", "id", "at", "type"])
    }

    func testNewEventsCarryTheCurrentProtocolVersion() {
        XCTAssertEqual(WatchEvent(id: "a", at: 1, type: .skipRest, setId: "s").v, WatchProtocol.version)
    }

    func testUnknownEventTypeFailsToDecode() {
        let json = Data(#"{"v":1,"id":"a","at":1,"type":"dance"}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(WatchEvent.self, from: json))
    }

    func testEventMissingARequiredFieldFailsToDecode() {
        let json = Data(#"{"v":1,"at":1,"type":"skipRest"}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(WatchEvent.self, from: json))
    }

    /// A version mismatch is the TS side's call (checkWatchEvent answers it
    /// as invalid and acks it), so decoding doesn't reject it.
    func testOtherProtocolVersionsStillDecode() throws {
        let json = Data(#"{"v":2,"id":"a","at":1,"type":"skipRest","setId":"s"}"#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(WatchEvent.self, from: json).v, 2)
    }

    func testSnapshotFixturesRoundTripExactlyWithNulls() throws {
        for name in Fixture.snapshotNames {
            let snapshot = try JSONDecoder().decode(WatchSnapshot.self, from: Fixture.data(name))
            let reencoded = try jsonDictionary(JSONEncoder().encode(snapshot))
            XCTAssertEqual(reencoded, try Fixture.object(name), name)
        }
    }

    func testDecodesActiveSnapshot() throws {
        let snapshot = try JSONDecoder().decode(WatchSnapshot.self, from: Fixture.data("snapshot-active-first-set.json"))
        XCTAssertEqual(snapshot.v, 1)
        XCTAssertEqual(snapshot.seq, 1_759_100_000_001)
        XCTAssertEqual(snapshot.status, .active)
        let workout = try XCTUnwrap(snapshot.workout)
        XCTAssertEqual(workout.dayName, "Squat Day")
        XCTAssertEqual(workout.setId, "1759100000000/0/squat:0.65:5::")
        XCTAssertEqual(workout.setNumber, 1)
        XCTAssertEqual(workout.setTotal, 14)
        XCTAssertFalse(workout.allSetsDone)
        XCTAssertEqual(workout.exerciseName, "Barbell Squat")
        XCTAssertEqual(workout.weightLabel, "145 lbs")
        XCTAssertEqual(workout.plateLabel, "45 + 5 per side")
        XCTAssertEqual(workout.reps, 5)
        XCTAssertEqual(workout.maxReps, 5)
        XCTAssertFalse(workout.isAmrap)
        XCTAssertFalse(workout.isBonus)
        XCTAssertNil(workout.restEndTime)
        XCTAssertFalse(workout.restLocksDone)
        XCTAssertEqual(workout.restAfterSetSeconds, 120)
    }

    func testDecodesRestingSnapshot() throws {
        let snapshot = try JSONDecoder().decode(WatchSnapshot.self, from: Fixture.data("snapshot-active-resting.json"))
        let workout = try XCTUnwrap(snapshot.workout)
        XCTAssertEqual(workout.restEndTime, 1_759_100_180_000)
        XCTAssertNil(workout.plateLabel)
        XCTAssertNil(workout.restAfterSetSeconds)
    }

    func testDecodesIdleSnapshot() throws {
        let snapshot = try JSONDecoder().decode(WatchSnapshot.self, from: Fixture.data("snapshot-idle.json"))
        XCTAssertEqual(snapshot.status, .idle)
        XCTAssertNil(snapshot.workout)
    }

    func testUnknownSnapshotStatusFailsToDecode() {
        let json = Data(#"{"v":1,"seq":1,"status":"paused","workout":null}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(WatchSnapshot.self, from: json))
    }

    func testReceivedEventIsTheEventPlusReceivedAt() throws {
        let received = try JSONDecoder().decode(
            ReceivedWatchEvent.self, from: Fixture.data("received-event-complete-set.json"))
        let event = try JSONDecoder().decode(WatchEvent.self, from: Fixture.data("event-complete-set.json"))
        XCTAssertEqual(received.event, event)
        XCTAssertEqual(received.receivedAt, 1_759_100_050_321)

        let reencoded = try jsonDictionary(JSONEncoder().encode(received))
        XCTAssertEqual(reencoded, try Fixture.object("received-event-complete-set.json"))
    }

    // MARK: - Capacitor bridge shapes

    /// What the plugin hands to JS for a `watchEvent` or `getPendingEvents`.
    func testReceivedEventAsJSObjectMatchesTheFixture() throws {
        let received = ReceivedWatchEvent(
            event: try JSONDecoder().decode(WatchEvent.self, from: Fixture.data("event-complete-set.json")),
            receivedAt: 1_759_100_050_321)
        XCTAssertEqual(try received.jsObject() as NSDictionary, try Fixture.object("received-event-complete-set.json"))
    }

    /// What the plugin gets from JS in `pushSnapshot`: an already-parsed
    /// object, with NSNull for null.
    func testSnapshotFromJSObject() throws {
        for name in Fixture.snapshotNames {
            let object = try Fixture.object(name)
            let fromObject = try WatchSnapshot(jsObject: object)
            let fromData = try JSONDecoder().decode(WatchSnapshot.self, from: Fixture.data(name))
            XCTAssertEqual(fromObject, fromData, name)
        }
    }

    func testSnapshotFromAMalformedJSObjectThrows() {
        XCTAssertThrowsError(try WatchSnapshot(jsObject: ["v": 1, "seq": "soon"]))
        XCTAssertThrowsError(try WatchSnapshot(jsObject: "not an object"))
    }

    // MARK: - WatchConnectivity payloads

    func testEventMessageRoundTrips() throws {
        let event = try JSONDecoder().decode(WatchEvent.self, from: Fixture.data("event-adjust-rest.json"))
        let message = try WatchMessage.eventMessage(event)
        XCTAssertNoThrow(try PropertyListSerialization.data(fromPropertyList: message, format: .binary, options: 0),
                         "WCSession payloads must be property-list types")
        XCTAssertEqual(try WatchMessage.event(from: message), event)
    }

    func testSnapshotContextRoundTrips() throws {
        for name in Fixture.snapshotNames {
            let snapshot = try JSONDecoder().decode(WatchSnapshot.self, from: Fixture.data(name))
            let context = try WatchMessage.snapshotContext(snapshot)
            XCTAssertNoThrow(try PropertyListSerialization.data(fromPropertyList: context, format: .binary, options: 0),
                             "application context must be property-list types (\(name))")
            XCTAssertEqual(try WatchMessage.snapshot(from: context), snapshot, name)
        }
    }

    func testMessageWithoutAnEventThrows() {
        XCTAssertThrowsError(try WatchMessage.event(from: [:]))
        XCTAssertThrowsError(try WatchMessage.event(from: [WatchMessage.eventKey: "not data"]))
        XCTAssertThrowsError(try WatchMessage.event(from: [WatchMessage.eventKey: Data("{}".utf8)]))
    }

    func testContextWithoutASnapshotIsNil() throws {
        XCTAssertNil(try WatchMessage.snapshot(from: [:]))
    }

    func testReplies() {
        XCTAssertEqual(WatchMessage.ackReply(id: "abc") as NSDictionary, [WatchMessage.ackKey: "abc"])
        XCTAssertEqual(WatchMessage.ackedID(in: WatchMessage.ackReply(id: "abc")), "abc")
        XCTAssertNil(WatchMessage.ackedID(in: WatchMessage.errorReply("nope")))
        XCTAssertEqual(WatchMessage.errorReply("nope")[WatchMessage.errorKey] as? String, "nope")
    }
}
