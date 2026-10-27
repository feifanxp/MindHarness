import Foundation

enum MindRoomDiagnosticStatus: String, Codable {
    case available
    case unavailable
    case corrupt
}

enum MindRoomDiagnosticEventName: String, Codable {
    case appLaunch = "app.launch"
    case sceneForeground = "scene.foreground"
    case sceneActive = "scene.active"
    case sceneInactive = "scene.inactive"
    case sceneBackground = "scene.background"
    case sceneDisconnected = "scene.disconnected"
    case memoryWarning = "memory.warning"
    case navigationStarted = "navigation.started"
    case navigationFinished = "navigation.finished"
    case navigationFailed = "navigation.failed"
    case navigationProvisionalFailed = "navigation.provisional_failed"
    case webViewTerminated = "webview.terminated"
}

enum MindRoomDiagnosticErrorDomain: String, Codable {
    case url
    case webkit
    case cocoa
    case other
}

struct MindRoomDiagnosticState: Codable, Equatable {
    var applicationState: Int?
    var sceneState: Int?
    var loading: Bool?
    var progress: Double?
    var attached: Bool?
    var hidden: Bool?
    var opaque: Bool?
    var transparent: Bool?
    var emptyBounds: Bool?
    var errorDomain: MindRoomDiagnosticErrorDomain?
    var errorCode: Int?

    init(
        applicationState: Int? = nil,
        sceneState: Int? = nil,
        loading: Bool? = nil,
        progress: Double? = nil,
        attached: Bool? = nil,
        hidden: Bool? = nil,
        opaque: Bool? = nil,
        transparent: Bool? = nil,
        emptyBounds: Bool? = nil,
        errorDomain: MindRoomDiagnosticErrorDomain? = nil,
        errorCode: Int? = nil
    ) {
        self.applicationState = applicationState
        self.sceneState = sceneState
        self.loading = loading
        self.progress = progress
        self.attached = attached
        self.hidden = hidden
        self.opaque = opaque
        self.transparent = transparent
        self.emptyBounds = emptyBounds
        self.errorDomain = errorDomain
        self.errorCode = errorCode
    }

    init(error: Error) {
        let nativeError = error as NSError
        switch nativeError.domain {
        case NSURLErrorDomain:
            errorDomain = .url
        case "WKErrorDomain":
            errorDomain = .webkit
        case NSCocoaErrorDomain:
            errorDomain = .cocoa
        default:
            errorDomain = .other
        }
        errorCode = nativeError.code
    }

    var isEmpty: Bool {
        applicationState == nil && sceneState == nil && loading == nil && progress == nil &&
            attached == nil && hidden == nil && opaque == nil && transparent == nil &&
            emptyBounds == nil && errorDomain == nil && errorCode == nil
    }

    var isValid: Bool {
        progress?.isFinite ?? true
    }
}

struct MindRoomDiagnosticEvent: Codable, Equatable {
    let at: Double
    let monotonicMs: Double
    let sequence: Int
    let sessionId: UUID
    let name: MindRoomDiagnosticEventName
    let data: MindRoomDiagnosticState?

    var isValid: Bool {
        at.isFinite && at >= 0 && monotonicMs.isFinite && monotonicMs >= 0 && sequence >= 0 &&
            sequence <= MindRoomDiagnosticsStore.maximumSafeInteger &&
            (data?.isValid ?? true)
    }
}

struct MindRoomDiagnosticsSnapshot: Codable, Equatable {
    let schemaVersion: Int
    let status: MindRoomDiagnosticStatus
    let currentSessionId: UUID
    let droppedEventCount: Int
    let events: [MindRoomDiagnosticEvent]
}

final class MindRoomDiagnosticsStore {
    typealias AtomicWrite = (Data, URL) throws -> Void

    static let maximumEventCount = 128
    static let maximumHistoryBytes = 64 * 1_024
    static let maximumSafeInteger = 9_007_199_254_740_991
    static let defaultAtomicWrite: AtomicWrite = { data, url in
        try data.write(to: url, options: .atomic)
    }

    static let shared = MindRoomDiagnosticsStore(
        directoryURL: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MindRoomDiagnostics", isDirectory: true)
    )

    private struct PersistedHistory: Codable {
        let schemaVersion: Int
        var droppedEventCount: Int
        var events: [MindRoomDiagnosticEvent]
    }

    private let queue = DispatchQueue(label: "chat.mindroom.native-diagnostics-store")
    private let directoryURL: URL
    private let historyURL: URL
    private let fileManager: FileManager
    private let currentSessionId: UUID
    private let wallClockMilliseconds: () -> Double
    private let monotonicMilliseconds: () -> Double
    private let monotonicBaselineMilliseconds: Double
    private let atomicWrite: AtomicWrite
    private var status: MindRoomDiagnosticStatus = .available
    private var droppedEventCount = 0
    private var events: [MindRoomDiagnosticEvent] = []
    private var nextSequence = 1

    init(
        directoryURL: URL,
        fileManager: FileManager = .default,
        currentSessionId: UUID = UUID(),
        wallClockMilliseconds: @escaping () -> Double = { Date().timeIntervalSince1970 * 1_000 },
        monotonicMilliseconds: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime * 1_000 },
        atomicWrite: @escaping AtomicWrite = MindRoomDiagnosticsStore.defaultAtomicWrite
    ) {
        self.directoryURL = directoryURL
        historyURL = directoryURL.appendingPathComponent("history-v1.json", isDirectory: false)
        self.fileManager = fileManager
        self.currentSessionId = currentSessionId
        self.wallClockMilliseconds = wallClockMilliseconds
        self.monotonicMilliseconds = monotonicMilliseconds
        monotonicBaselineMilliseconds = monotonicMilliseconds()
        self.atomicWrite = atomicWrite

        queue.async { [self] in
            initialize()
        }
    }

    func record(name: MindRoomDiagnosticEventName, data: MindRoomDiagnosticState? = nil) {
        let safeData = data?.isEmpty == false && data?.isValid == true ? data : nil
        let at = wallClockMilliseconds()
        let monotonicMs = max(0, monotonicMilliseconds() - monotonicBaselineMilliseconds)
        queue.async { [self] in
            let event = MindRoomDiagnosticEvent(
                at: at,
                monotonicMs: monotonicMs,
                sequence: nextSequence,
                sessionId: currentSessionId,
                name: name,
                data: safeData
            )
            nextSequence += 1
            events.append(event)
            enforceBounds()
            persist()
        }
    }

    func read() -> MindRoomDiagnosticsSnapshot {
        queue.sync { snapshot() }
    }

    func read(completion: @escaping (MindRoomDiagnosticsSnapshot) -> Void) {
        queue.async { [self] in
            completion(snapshot())
        }
    }

    private func initialize() {
        do {
            try prepareDirectory()
            try loadHistory()
            enforceBounds()
        } catch is DecodingError {
            status = .corrupt
            droppedEventCount = 0
            events = []
        } catch let error as HistoryValidationError where error == .invalid {
            status = .corrupt
            droppedEventCount = 0
            events = []
        } catch {
            status = .unavailable
            droppedEventCount = 0
            events = []
        }
    }

    private func snapshot() -> MindRoomDiagnosticsSnapshot {
        MindRoomDiagnosticsSnapshot(
            schemaVersion: 1,
            status: status,
            currentSessionId: currentSessionId,
            droppedEventCount: droppedEventCount,
            events: events
        )
    }

    private enum HistoryValidationError: Error, Equatable {
        case invalid
    }

    private func prepareDirectory() throws {
        try fileManager.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        var protectedDirectory = directoryURL
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try protectedDirectory.setResourceValues(resourceValues)
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: directoryURL.path
        )
    }

    private func loadHistory() throws {
        guard fileManager.fileExists(atPath: historyURL.path) else { return }
        let history = try JSONDecoder().decode(PersistedHistory.self, from: Data(contentsOf: historyURL))
        guard history.schemaVersion == 1,
              history.droppedEventCount >= 0,
              history.droppedEventCount <= Self.maximumSafeInteger,
              history.events.allSatisfy(\.isValid) else {
            throw HistoryValidationError.invalid
        }
        droppedEventCount = history.droppedEventCount
        events = history.events.map { event in
            MindRoomDiagnosticEvent(
                at: event.at,
                monotonicMs: event.monotonicMs,
                sequence: event.sequence,
                sessionId: event.sessionId,
                name: event.name,
                data: event.data?.isEmpty == false ? event.data : nil
            )
        }
        if let latestCurrentSequence = events
            .filter({ $0.sessionId == currentSessionId })
            .map(\.sequence)
            .max() {
            nextSequence = min(latestCurrentSequence + 1, Self.maximumSafeInteger)
        }
    }

    private func enforceBounds() {
        while events.count > Self.maximumEventCount {
            events.removeFirst()
            incrementDroppedEventCount()
        }
        while !events.isEmpty && ((try? encodedHistory().count) ?? Int.max) > Self.maximumHistoryBytes {
            events.removeFirst()
            incrementDroppedEventCount()
        }
    }

    private func incrementDroppedEventCount() {
        if droppedEventCount < Self.maximumSafeInteger {
            droppedEventCount += 1
        }
    }

    private func encodedHistory() throws -> Data {
        try JSONEncoder().encode(
            PersistedHistory(schemaVersion: 1, droppedEventCount: droppedEventCount, events: events)
        )
    }

    private func persist() {
        do {
            try atomicWrite(encodedHistory(), historyURL)
            try fileManager.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: historyURL.path
            )
        } catch {
            status = .unavailable
        }
    }
}
