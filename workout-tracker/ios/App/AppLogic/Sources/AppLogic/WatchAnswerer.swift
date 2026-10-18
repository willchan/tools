import Foundation

/// Runs the workout reducer over the WebView's shadow and the taps queued
/// natively (`answerWatchEvents` in src/logic/watchProtocol.ts, built into
/// workout-logic.js). `WorkoutLogicEngine` is the JavaScriptCore one.
public protocol WatchAnswerEngine: AnyObject {
    /// Returns `{snapshot, verdicts}` as JSON.
    func answer(shadowJSON: String, eventsJSON: String, seq: Int64, now: Double) throws -> String
}

/// The phone's own answer to watch taps while its WebView is suspended
/// (ADR 0002, "Background taps"). The WebView pushes a shadow of its session
/// with every snapshot; when a tap is queued, the snapshot sent to the watch
/// is the reducer run over that shadow and every tap still in the native
/// queue. IndexedDB stays the source of truth: the WebView applies the same
/// taps through the same reducer when it next runs, and gets the same
/// result. Taps it has already applied are duplicates, so the whole queue
/// can be passed.
///
/// Also keeps snapshot `seq`s strictly increasing across its answers and
/// the WebView's pushes, since the watch drops any snapshot not newer than
/// the one it shows.
///
/// Thread-safe; the engine is only used under the lock.
public final class WatchAnswerer {
    public struct Answer: Equatable, Sendable {
        public let snapshot: WatchSnapshot
        /// What became of each event passed, in order (see WatchAnswerVerdict).
        public let verdicts: [String]
        /// The engine was created (the bundle loaded) for this answer.
        public let coldStart: Bool
    }

    public enum Error: Swift.Error, Equatable {
        case malformedAnswer(String)
    }

    private struct EngineOutput: Decodable {
        let snapshot: WatchSnapshot
        let verdicts: [String]
    }

    private let lock = NSLock()
    private let makeEngine: () throws -> WatchAnswerEngine
    private var engine: WatchAnswerEngine?
    private var shadowJSON: String?
    private var lastSeq: Int64 = 0

    public init(makeEngine: @escaping () throws -> WatchAnswerEngine) {
        self.makeEngine = makeEngine
    }

    /// The WebView pushed `snapshot`, built from `shadowJSON` (nil when no
    /// workout is showing). Returns what to send the watch: that snapshot,
    /// or, while taps are queued, the answer over them, so a push from a
    /// WebView that hasn't applied them yet can't take the watch back. On an
    /// engine failure it falls back to the WebView's snapshot and returns
    /// the error for logging.
    public func webViewPushed(
        _ snapshot: WatchSnapshot, shadowJSON: String?, pending: [WatchEvent], now: Double
    ) -> (snapshot: WatchSnapshot, answer: Answer?, error: Swift.Error?) {
        lock.lock()
        defer { lock.unlock() }
        self.shadowJSON = shadowJSON
        if shadowJSON != nil, !pending.isEmpty {
            do {
                if let answer = try answerLocked(pending: pending, now: now) {
                    return (answer.snapshot, answer, nil)
                }
            } catch {
                return (sequenced(snapshot), nil, error)
            }
        }
        return (sequenced(snapshot), nil, nil)
    }

    /// Taps are queued (`pending`, oldest first): the snapshot answering
    /// them, or nil when there's no workout shadow to answer from (nothing
    /// pushed yet, or idle: a start tap is the WebView's to handle).
    public func answer(pending: [WatchEvent], now: Double) throws -> Answer? {
        lock.lock()
        defer { lock.unlock() }
        return try answerLocked(pending: pending, now: now)
    }

    private func answerLocked(pending: [WatchEvent], now: Double) throws -> Answer? {
        guard let shadowJSON, !pending.isEmpty else { return nil }
        var coldStart = false
        let engine: WatchAnswerEngine
        if let existing = self.engine {
            engine = existing
        } else {
            engine = try makeEngine()
            self.engine = engine
            coldStart = true
        }
        let eventsJSON = String(decoding: try JSONEncoder().encode(pending), as: UTF8.self)
        let seq = max(lastSeq + 1, Int64(now))
        let output: EngineOutput
        do {
            let json = try engine.answer(shadowJSON: shadowJSON, eventsJSON: eventsJSON, seq: seq, now: now)
            output = try JSONDecoder().decode(EngineOutput.self, from: Data(json.utf8))
        } catch let error as DecodingError {
            throw Error.malformedAnswer("\(error)")
        }
        lastSeq = max(lastSeq, output.snapshot.seq)
        return Answer(snapshot: output.snapshot, verdicts: output.verdicts, coldStart: coldStart)
    }

    private func sequenced(_ snapshot: WatchSnapshot) -> WatchSnapshot {
        var next = snapshot
        if next.seq <= lastSeq { next.seq = lastSeq + 1 }
        lastSeq = next.seq
        return next
    }
}
