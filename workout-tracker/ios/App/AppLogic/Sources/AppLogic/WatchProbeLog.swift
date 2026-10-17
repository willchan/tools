import Foundation

/// One measurement from the background-tap experiment: how quickly the
/// phone could answer a watch tap natively, by running it through the
/// reducer bundle (`WorkoutLogicEngine`). Times are epoch milliseconds.
/// See docs/adr/0002-apple-watch-remote.md, "Background taps".
public struct WatchProbeRecord: Codable, Equatable, Sendable {
    public var eventId: String
    /// The WatchConnectivity channel that brought the tap first:
    /// "message" (sendMessage) or "userInfo" (transferUserInfo).
    public var channel: String
    /// When the tap was made, on the watch's clock.
    public var tapAt: Double
    public var receivedAt: Double
    /// When the reducer's answer was ready.
    public var computedAt: Double
    /// When the tap's delegate callback returned (for "message", after
    /// handing back the reply).
    public var repliedAt: Double
    /// The script was loaded and evaluated for this tap.
    public var coldStart: Bool
    /// The reducer's verdict, when it ran.
    public var verdict: String?
    /// Why it didn't, otherwise.
    public var error: String?
    /// UIApplication state at reply time: active, inactive or background.
    public var appState: String?
    /// UIApplication.backgroundTimeRemaining in seconds; nil in the foreground.
    public var backgroundTimeRemaining: Double?

    public init(
        eventId: String, channel: String, tapAt: Double, receivedAt: Double, computedAt: Double, repliedAt: Double,
        coldStart: Bool, verdict: String?, error: String?,
        appState: String? = nil, backgroundTimeRemaining: Double? = nil
    ) {
        self.eventId = eventId
        self.channel = channel
        self.tapAt = tapAt
        self.receivedAt = receivedAt
        self.computedAt = computedAt
        self.repliedAt = repliedAt
        self.coldStart = coldStart
        self.verdict = verdict
        self.error = error
        self.appState = appState
        self.backgroundTimeRemaining = backgroundTimeRemaining
    }

    /// Plain JSON types for a Capacitor plugin result.
    public func jsObject() throws -> [String: Any] {
        try jsonObject(of: self)
    }
}

/// The experiment's measurements, on disk until JS copies them into the app
/// log (which is what the user exports). Keeps the newest `limit`. A file
/// that can't be read is replaced: these are diagnostics, not workout data.
///
/// Thread-safe.
public final class WatchProbeLog {
    public static let defaultLimit = 500

    private let fileURL: URL
    private let limit: Int
    private let lock = NSLock()

    public init(fileURL: URL, limit: Int = WatchProbeLog.defaultLimit) {
        self.fileURL = fileURL
        self.limit = limit
    }

    public func append(_ record: WatchProbeRecord) throws {
        lock.lock()
        defer { lock.unlock() }
        var records = read()
        records.append(record)
        if records.count > limit { records.removeFirst(records.count - limit) }
        try write(records)
    }

    /// Every record, oldest first, and an empty log.
    public func drain() throws -> [WatchProbeRecord] {
        lock.lock()
        defer { lock.unlock() }
        let records = read()
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try FileManager.default.removeItem(at: fileURL)
        }
        return records
    }

    private func read() -> [WatchProbeRecord] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([WatchProbeRecord].self, from: data)) ?? []
    }

    private func write(_ records: [WatchProbeRecord]) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var options: Data.WritingOptions = [.atomic]
        #if os(iOS) || os(watchOS)
        // Written while the phone is locked, like the tap queue.
        options.insert(.completeFileProtectionUntilFirstUserAuthentication)
        #endif
        try JSONEncoder().encode(records).write(to: fileURL, options: options)
    }
}
