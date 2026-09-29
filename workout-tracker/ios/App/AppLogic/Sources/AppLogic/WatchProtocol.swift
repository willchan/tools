import Foundation

// Codable mirrors of the phone ↔ Apple Watch protocol in
// src/logic/watchProtocol.ts, which is the source of truth. Field names,
// optionality and enum values match it exactly; the JSON fixtures in
// Tests/AppLogicTests/Fixtures are checked against both sides (XCTest here,
// e2e/watch-protocol.spec.ts there). See docs/adr/0002-apple-watch-remote.md.
//
// These types only carry data. The watch applies no workout rules of its
// own; the phone's TypeScript decides what every tap does.

public enum WatchProtocol {
    /// `WATCH_PROTOCOL_VERSION` in watchProtocol.ts. Bump both together.
    public static let version = 1
}

/// `WatchEventType` in watchProtocol.ts.
public enum WatchEventType: String, Codable, CaseIterable, Sendable {
    case start
    case completeSet
    case skipRest
    case adjustRest
    case finish
}

/// A tap on the watch (`WatchEvent` in watchProtocol.ts).
public struct WatchEvent: Codable, Equatable, Sendable {
    public var v: Int
    /// Idempotency id, unique per tap.
    public var id: String
    /// Epoch ms of the tap, on the watch's clock.
    public var at: Double
    public var type: WatchEventType
    /// The snapshot's setId the tap was made against. Required except for start.
    public var setId: String?
    /// completeSet: reps done. Absent means the prescription.
    public var reps: Int?
    /// adjustRest: seconds to add (negative to shorten).
    public var deltaSeconds: Double?

    public init(
        v: Int = WatchProtocol.version,
        id: String,
        at: Double,
        type: WatchEventType,
        setId: String? = nil,
        reps: Int? = nil,
        deltaSeconds: Double? = nil
    ) {
        self.v = v
        self.id = id
        self.at = at
        self.type = type
        self.setId = setId
        self.reps = reps
        self.deltaSeconds = deltaSeconds
    }

    // Synthesized Codable already matches TS here: optional fields are
    // absent keys (encodeIfPresent), never null.
}

/// A tap as the phone hands it to JS (`ReceivedWatchEvent` in
/// src/native/watchBridge.ts): the event's own fields plus `receivedAt`,
/// flattened into one object.
public struct ReceivedWatchEvent: Codable, Equatable, Sendable {
    public var event: WatchEvent
    /// Epoch ms the phone received (and queued) the tap.
    public var receivedAt: Double

    public init(event: WatchEvent, receivedAt: Double) {
        self.event = event
        self.receivedAt = receivedAt
    }

    private enum CodingKeys: String, CodingKey {
        case receivedAt
    }

    public init(from decoder: Decoder) throws {
        event = try WatchEvent(from: decoder)
        receivedAt = try decoder.container(keyedBy: CodingKeys.self).decode(Double.self, forKey: .receivedAt)
    }

    public func encode(to encoder: Encoder) throws {
        try event.encode(to: encoder)
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(receivedAt, forKey: .receivedAt)
    }

    /// The object Capacitor passes to JS (`watchEvent`, `getPendingEvents`).
    public func jsObject() throws -> [String: Any] {
        try jsonObject(of: self)
    }
}

/// `WatchWorkoutView` in watchProtocol.ts: everything the watch shows,
/// already computed by the phone.
public struct WatchWorkoutView: Codable, Equatable, Sendable {
    public var dayName: String
    /// Echo back in every tap made against this snapshot.
    public var setId: String
    /// 1-based position of the current set, capped at setTotal.
    public var setNumber: Int
    public var setTotal: Int
    /// Every set is done: show Finish instead of Done.
    public var allSetsDone: Bool
    public var exerciseName: String
    public var weightLabel: String
    public var plateLabel: String?
    /// Prescribed reps (default for the rep picker).
    public var reps: Int
    /// Upper bound for the rep picker.
    public var maxReps: Int
    public var isAmrap: Bool
    public var isBonus: Bool
    /// Epoch ms the current rest ends, or nil when not resting.
    public var restEndTime: Double?
    /// Whether Done stays disabled until restEndTime.
    public var restLocksDone: Bool
    /// Rest to count down locally right after Done, before the phone's next
    /// snapshot arrives. Nil means completing this set starts no rest.
    public var restAfterSetSeconds: Double?

    public init(
        dayName: String,
        setId: String,
        setNumber: Int,
        setTotal: Int,
        allSetsDone: Bool,
        exerciseName: String,
        weightLabel: String,
        plateLabel: String?,
        reps: Int,
        maxReps: Int,
        isAmrap: Bool,
        isBonus: Bool,
        restEndTime: Double?,
        restLocksDone: Bool,
        restAfterSetSeconds: Double?
    ) {
        self.dayName = dayName
        self.setId = setId
        self.setNumber = setNumber
        self.setTotal = setTotal
        self.allSetsDone = allSetsDone
        self.exerciseName = exerciseName
        self.weightLabel = weightLabel
        self.plateLabel = plateLabel
        self.reps = reps
        self.maxReps = maxReps
        self.isAmrap = isAmrap
        self.isBonus = isBonus
        self.restEndTime = restEndTime
        self.restLocksDone = restLocksDone
        self.restAfterSetSeconds = restAfterSetSeconds
    }

    private enum CodingKeys: String, CodingKey {
        case dayName, setId, setNumber, setTotal, allSetsDone, exerciseName, weightLabel, plateLabel
        case reps, maxReps, isAmrap, isBonus, restEndTime, restLocksDone, restAfterSetSeconds
    }

    // Decoding is synthesized. Encoding is spelled out only so nil is
    // written as null, as TS's `string | null` fields are, rather than
    // dropped.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(dayName, forKey: .dayName)
        try c.encode(setId, forKey: .setId)
        try c.encode(setNumber, forKey: .setNumber)
        try c.encode(setTotal, forKey: .setTotal)
        try c.encode(allSetsDone, forKey: .allSetsDone)
        try c.encode(exerciseName, forKey: .exerciseName)
        try c.encode(weightLabel, forKey: .weightLabel)
        try c.encode(plateLabel, forKey: .plateLabel)
        try c.encode(reps, forKey: .reps)
        try c.encode(maxReps, forKey: .maxReps)
        try c.encode(isAmrap, forKey: .isAmrap)
        try c.encode(isBonus, forKey: .isBonus)
        try c.encode(restEndTime, forKey: .restEndTime)
        try c.encode(restLocksDone, forKey: .restLocksDone)
        try c.encode(restAfterSetSeconds, forKey: .restAfterSetSeconds)
    }
}

/// `WatchSnapshot` in watchProtocol.ts: phone → watch state.
public struct WatchSnapshot: Codable, Equatable, Sendable {
    public enum Status: String, Codable, CaseIterable, Sendable {
        case idle
        case active
    }

    public var v: Int
    /// Increases with every snapshot; see WatchSnapshotGate.
    public var seq: Int64
    public var status: Status
    public var workout: WatchWorkoutView?

    public init(v: Int = WatchProtocol.version, seq: Int64, status: Status, workout: WatchWorkoutView?) {
        self.v = v
        self.seq = seq
        self.status = status
        self.workout = workout
    }

    /// From the already-parsed object Capacitor hands the plugin in
    /// `pushSnapshot` (NSNull for null).
    public init(jsObject: Any) throws {
        guard JSONSerialization.isValidJSONObject(jsObject) else {
            throw WatchMessage.Error.malformed("snapshot is not a JSON object")
        }
        let data = try JSONSerialization.data(withJSONObject: jsObject)
        self = try JSONDecoder().decode(WatchSnapshot.self, from: data)
    }

    private enum CodingKeys: String, CodingKey {
        case v, seq, status, workout
    }

    // As for WatchWorkoutView: an idle snapshot's workout is null, not absent.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(v, forKey: .v)
        try c.encode(seq, forKey: .seq)
        try c.encode(status, forKey: .status)
        try c.encode(workout, forKey: .workout)
    }
}

/// How protocol values travel over WatchConnectivity. Each is JSON-encoded
/// into a `Data` value under one key, which keeps the payload a valid
/// property list (WCSession's requirement) and the JSON identical to what
/// TS sees.
public enum WatchMessage {
    public enum Error: Swift.Error, Equatable {
        case malformed(String)
    }

    /// Watch → phone, in `sendMessage` and `transferUserInfo` payloads.
    public static let eventKey = "watchEvent"
    /// Phone → watch, in the application context.
    public static let snapshotKey = "watchSnapshot"
    /// Phone → watch `sendMessage` reply: the tap is on the phone's disk.
    public static let ackKey = "ack"
    /// Phone → watch `sendMessage` reply: not queued; the watch should retry.
    public static let errorKey = "error"

    public static func eventMessage(_ event: WatchEvent) throws -> [String: Any] {
        [eventKey: try JSONEncoder().encode(event)]
    }

    public static func event(from message: [String: Any]) throws -> WatchEvent {
        guard let data = message[eventKey] as? Data else {
            throw Error.malformed("no \(eventKey) data in message")
        }
        return try JSONDecoder().decode(WatchEvent.self, from: data)
    }

    public static func snapshotContext(_ snapshot: WatchSnapshot) throws -> [String: Any] {
        [snapshotKey: try JSONEncoder().encode(snapshot)]
    }

    /// Nil when the context carries no snapshot (e.g. it's still empty).
    public static func snapshot(from context: [String: Any]) throws -> WatchSnapshot? {
        guard let value = context[snapshotKey] else { return nil }
        guard let data = value as? Data else { throw Error.malformed("\(snapshotKey) is not data") }
        return try JSONDecoder().decode(WatchSnapshot.self, from: data)
    }

    public static func ackReply(id: String) -> [String: Any] {
        [ackKey: id]
    }

    public static func errorReply(_ reason: String) -> [String: Any] {
        [errorKey: reason]
    }

    /// The id the phone acked in a reply, or nil if it didn't.
    public static func ackedID(in reply: [String: Any]) -> String? {
        reply[ackKey] as? String
    }
}

func jsonObject<T: Encodable>(of value: T) throws -> [String: Any] {
    let data = try JSONEncoder().encode(value)
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw WatchMessage.Error.malformed("\(T.self) did not encode to an object")
    }
    return object
}
