import Foundation

/// The phone's disk queue of watch taps (ADR 0002, safeguard 1).
///
/// - `append` writes the file atomically before it returns, so a caller
///   that acks the watch only after `append` returns never acks a tap that
///   isn't on disk. If the write fails it throws and changes nothing.
/// - One entry per event `id`. Ids JS has acked are remembered (the most
///   recent `ackedIDLimit`), so the same tap redelivered over a second
///   WatchConnectivity channel isn't queued again.
/// - An entry leaves only on `ack(id:)`, i.e. once JS has committed the tap
///   to IndexedDB (or rejected it for good).
/// - `pending()` lists entries oldest-received first.
/// - A file that can't be read is moved aside (see `recoveredCorruptFileURL`)
///   and the queue starts empty rather than failing every later write.
///
/// Thread-safe: WCSession delegate callbacks and plugin calls arrive on
/// different queues.
public final class WatchEventQueue {
    public enum AppendResult: Equatable, Sendable {
        /// Newly queued: hand it to JS.
        case queued(ReceivedWatchEvent)
        /// Already waiting for JS; the original receipt is kept.
        case alreadyQueued(ReceivedWatchEvent)
        /// JS already committed this id.
        case alreadyAcked
    }

    /// Matches MAX_APPLIED_EVENT_IDS in watchProtocol.ts: far more taps than
    /// one workout has.
    public static let defaultAckedIDLimit = 500

    /// Where an unreadable queue file found at init was moved, if any.
    public let recoveredCorruptFileURL: URL?

    private static let formatVersion = 1

    private struct Contents: Codable {
        var version: Int
        var pending: [ReceivedWatchEvent]
        var acked: [String]
    }

    private let fileURL: URL
    private let ackedIDLimit: Int
    private let lock = NSLock()
    private var contents: Contents

    public init(fileURL: URL, ackedIDLimit: Int = WatchEventQueue.defaultAckedIDLimit) {
        self.fileURL = fileURL
        self.ackedIDLimit = ackedIDLimit
        let empty = Contents(version: WatchEventQueue.formatVersion, pending: [], acked: [])

        guard let data = try? Data(contentsOf: fileURL) else {
            // Missing (the usual first run) or unreadable as a file at all.
            contents = empty
            recoveredCorruptFileURL = nil
            return
        }
        if let decoded = try? JSONDecoder().decode(Contents.self, from: data),
           decoded.version == WatchEventQueue.formatVersion {
            contents = decoded
            recoveredCorruptFileURL = nil
        } else {
            contents = empty
            recoveredCorruptFileURL = WatchEventQueue.setAside(fileURL)
        }
    }

    /// Queue a tap received at `receivedAt` (epoch ms), durably.
    @discardableResult
    public func append(_ event: WatchEvent, receivedAt: Double) throws -> AppendResult {
        lock.lock()
        defer { lock.unlock() }
        if let existing = contents.pending.first(where: { $0.event.id == event.id }) {
            return .alreadyQueued(existing)
        }
        if contents.acked.contains(event.id) {
            return .alreadyAcked
        }
        let received = ReceivedWatchEvent(event: event, receivedAt: receivedAt)
        var next = contents
        next.pending.append(received)
        try write(next)
        contents = next
        return .queued(received)
    }

    /// JS has committed (or permanently rejected) this tap: drop it.
    public func ack(id: String) throws {
        lock.lock()
        defer { lock.unlock() }
        var next = contents
        next.pending.removeAll { $0.event.id == id }
        next.acked.removeAll { $0 == id }
        next.acked.append(id)
        if next.acked.count > ackedIDLimit {
            next.acked.removeFirst(next.acked.count - ackedIDLimit)
        }
        try write(next)
        contents = next
    }

    /// Taps JS hasn't acked yet, oldest-received first.
    public func pending() -> [ReceivedWatchEvent] {
        lock.lock()
        defer { lock.unlock() }
        return contents.pending
    }

    private func write(_ next: Contents) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var options: Data.WritingOptions = [.atomic]
        #if os(iOS) || os(watchOS)
        // Taps can arrive while the phone is locked (a background wake from
        // the watch); the default .complete protection would make the file
        // unwritable then.
        options.insert(.completeFileProtectionUntilFirstUserAuthentication)
        #endif
        try JSONEncoder().encode(next).write(to: fileURL, options: options)
    }

    private static func setAside(_ url: URL) -> URL? {
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let destination = url.deletingPathExtension()
            .appendingPathExtension("corrupt-\(stamp)")
            .appendingPathExtension(url.pathExtension.isEmpty ? "json" : url.pathExtension)
        do {
            try FileManager.default.moveItem(at: url, to: destination)
            return destination
        } catch {
            // Couldn't move it: the next atomic write replaces it anyway.
            return url
        }
    }
}
