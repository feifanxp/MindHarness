import Capacitor
import Foundation
import XCTest
@testable import RoutingHost

private final class LockedDiagnosticClocks {
    private let lock = NSLock()
    private var wallClockValue: Double
    private var monotonicValue: Double

    init(wallClock: Double, monotonic: Double) {
        wallClockValue = wallClock
        monotonicValue = monotonic
    }

    func set(wallClock: Double, monotonic: Double) {
        lock.lock()
        wallClockValue = wallClock
        monotonicValue = monotonic
        lock.unlock()
    }

    func wallClock() -> Double {
        lock.lock()
        defer { lock.unlock() }
        return wallClockValue
    }

    func monotonic() -> Double {
        lock.lock()
        defer { lock.unlock() }
        return monotonicValue
    }
}

private final class BlockingAtomicWriter {
    private let lock = NSLock()
    private var writeCount = 0
    let blocked = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)

    func write(_ data: Data, to url: URL) throws {
        try MindRoomDiagnosticsStore.defaultAtomicWrite(data, url)
        lock.lock()
        writeCount += 1
        let shouldBlock = writeCount == 1
        lock.unlock()
        if shouldBlock {
            blocked.signal()
            _ = release.wait(timeout: .now() + 5)
        }
    }
}

private final class BlockingDirectoryFileManager: FileManager {
    let started = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    let finished = DispatchSemaphore(value: 0)

    override func createDirectory(
        at url: URL,
        withIntermediateDirectories createIntermediates: Bool,
        attributes: [FileAttributeKey: Any]? = nil
    ) throws {
        started.signal()
        defer { finished.signal() }
        guard release.wait(timeout: .now() + 5) == .success else {
            throw CocoaError(.fileWriteUnknown)
        }
        try super.createDirectory(
            at: url,
            withIntermediateDirectories: createIntermediates,
            attributes: attributes
        )
    }
}

final class NativeDiagnosticsStoreTests: XCTestCase {
    private let firstSession = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private let secondSession = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
    private var temporaryDirectories: [URL] = []

    override func tearDownWithError() throws {
        for directory in temporaryDirectories {
            try? FileManager.default.removeItem(at: directory)
        }
        temporaryDirectories = []
        try super.tearDownWithError()
    }

    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("mindroom-native-diagnostics-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        temporaryDirectories.append(directory)
        return directory
    }

    private func makeStore(
        directory: URL,
        sessionId: UUID,
        atomicWrite: @escaping MindRoomDiagnosticsStore.AtomicWrite = MindRoomDiagnosticsStore.defaultAtomicWrite
    ) -> MindRoomDiagnosticsStore {
        var wallClockMilliseconds = 1_750_000_000_000.0
        var monotonicMilliseconds = 10_000.0
        return MindRoomDiagnosticsStore(
            directoryURL: directory,
            currentSessionId: sessionId,
            wallClockMilliseconds: {
                wallClockMilliseconds += 1
                return wallClockMilliseconds
            },
            monotonicMilliseconds: {
                monotonicMilliseconds += 1
                return monotonicMilliseconds
            },
            atomicWrite: atomicWrite
        )
    }

    func testRetainsNewest128EventsAndCountsDroppedEvents() throws {
        let store = makeStore(directory: try temporaryDirectory(), sessionId: firstSession)
        let maximalState = MindRoomDiagnosticState(
            applicationState: Int.max,
            sceneState: Int.min,
            loading: true,
            progress: Double.greatestFiniteMagnitude,
            attached: true,
            hidden: true,
            opaque: true,
            transparent: true,
            emptyBounds: true,
            errorDomain: .other,
            errorCode: Int.min
        )

        for _ in 0..<130 {
            store.record(name: .memoryWarning, data: maximalState)
        }
        let snapshot = store.read()

        XCTAssertEqual(snapshot.status, .available)
        XCTAssertEqual(snapshot.events.count, 128)
        XCTAssertEqual(snapshot.events.first?.sequence, 3)
        XCTAssertEqual(snapshot.events.last?.sequence, 130)
        XCTAssertEqual(snapshot.droppedEventCount, 2)
        XCTAssertLessThanOrEqual(try JSONEncoder().encode(snapshot).count, 64 * 1_024)
    }

    func testReinstantiationLoadsPersistedEventsAndStartsANewSessionSequence() throws {
        let directory = try temporaryDirectory()
        let firstStore = makeStore(directory: directory, sessionId: firstSession)
        firstStore.record(name: .appLaunch)
        firstStore.record(name: .sceneBackground)
        XCTAssertEqual(firstStore.read().events.count, 2, "read must wait for prior writes")

        let secondStore = makeStore(directory: directory, sessionId: secondSession)
        secondStore.record(name: .appLaunch)
        let snapshot = secondStore.read()

        XCTAssertEqual(snapshot.status, .available)
        XCTAssertEqual(snapshot.currentSessionId, secondSession)
        XCTAssertEqual(snapshot.events.map(\.sessionId), [firstSession, firstSession, secondSession])
        XCTAssertEqual(snapshot.events.map(\.sequence), [1, 2, 1])
    }

    func testMonotonicTimeIsRelativeToEachDiagnosticSession() throws {
        let directory = try temporaryDirectory()
        let clocks = LockedDiagnosticClocks(wallClock: 1_750_000_000_000, monotonic: 9_876_543)
        let firstStore = MindRoomDiagnosticsStore(
            directoryURL: directory,
            currentSessionId: firstSession,
            wallClockMilliseconds: clocks.wallClock,
            monotonicMilliseconds: clocks.monotonic
        )

        clocks.set(wallClock: 1_750_000_000_250, monotonic: 9_876_793)
        firstStore.record(name: .appLaunch)
        let firstSnapshot = firstStore.read()
        XCTAssertEqual(firstSnapshot.events.first?.at, 1_750_000_000_250)
        XCTAssertEqual(firstSnapshot.events.first?.monotonicMs, 250)
        let historyFile = try XCTUnwrap(
            FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil)?
                .compactMap { $0 as? URL }
                .first { $0.pathExtension == "json" }
        )
        let persistedHistory = String(decoding: try Data(contentsOf: historyFile), as: UTF8.self)
        XCTAssertFalse(persistedHistory.contains("9876543"), "The raw boot-time baseline must remain in memory")

        clocks.set(wallClock: 1_750_000_001_000, monotonic: 5_000_000)
        let secondStore = MindRoomDiagnosticsStore(
            directoryURL: directory,
            currentSessionId: secondSession,
            wallClockMilliseconds: clocks.wallClock,
            monotonicMilliseconds: clocks.monotonic
        )
        clocks.set(wallClock: 1_750_000_001_025, monotonic: 5_000_025)
        secondStore.record(name: .appLaunch)
        let secondSnapshot = secondStore.read()

        XCTAssertEqual(secondSnapshot.events.map(\.sessionId), [firstSession, secondSession])
        XCTAssertEqual(secondSnapshot.events.map(\.monotonicMs), [250, 25])
        XCTAssertEqual(secondSnapshot.events.map(\.at), [1_750_000_000_250, 1_750_000_001_025])
    }

    func testEventClocksAreCapturedBeforeAnEarlierWriteBacklogClears() throws {
        let clocks = LockedDiagnosticClocks(wallClock: 100, monotonic: 10)
        let writer = BlockingAtomicWriter()
        let store = MindRoomDiagnosticsStore(
            directoryURL: try temporaryDirectory(),
            currentSessionId: firstSession,
            wallClockMilliseconds: clocks.wallClock,
            monotonicMilliseconds: clocks.monotonic,
            atomicWrite: writer.write
        )
        defer { writer.release.signal() }

        store.record(name: .appLaunch)
        XCTAssertEqual(writer.blocked.wait(timeout: .now() + 2), .success)
        clocks.set(wallClock: 200, monotonic: 20)
        store.record(name: .sceneForeground)
        clocks.set(wallClock: 300, monotonic: 30)
        writer.release.signal()

        let foreground = try XCTUnwrap(store.read().events.last)
        XCTAssertEqual(foreground.name, .sceneForeground)
        XCTAssertEqual(foreground.at, 200, "A queued event must retain its occurrence wall clock")
        XCTAssertEqual(foreground.monotonicMs, 10, "A queued event must retain its occurrence interval")
    }

    func testInitializationReturnsWhileDirectoryIOIsBlocked() throws {
        let fileManager = BlockingDirectoryFileManager()
        let initializerReturned = DispatchSemaphore(value: 0)
        let directory = try temporaryDirectory()

        DispatchQueue(label: "chat.mindroom.native-diagnostics-init-test").async {
            _ = MindRoomDiagnosticsStore(directoryURL: directory, fileManager: fileManager)
            initializerReturned.signal()
        }

        XCTAssertEqual(fileManager.started.wait(timeout: .now() + 2), .success)
        let returnedBeforeIOReleased = initializerReturned.wait(timeout: .now() + 1)
        XCTAssertEqual(returnedBeforeIOReleased, .success, "Diagnostics initialization must not block its caller on file I/O")
        fileManager.release.signal()
        if returnedBeforeIOReleased == .timedOut {
            XCTAssertEqual(initializerReturned.wait(timeout: .now() + 2), .success)
        }
        XCTAssertEqual(fileManager.finished.wait(timeout: .now() + 2), .success)
    }

    func testPluginReadDoesNotOccupyCallingSerialQueueWhilePersistenceIsBlocked() throws {
        let writer = BlockingAtomicWriter()
        let store = makeStore(
            directory: try temporaryDirectory(),
            sessionId: firstSession,
            atomicWrite: writer.write
        )
        let plugin = MindRoomDiagnosticsPlugin(recorder: MindRoomDiagnosticsRecorder(store: store))
        let resolved = DispatchSemaphore(value: 0)
        let rejected = DispatchSemaphore(value: 0)
        let followingBridgeTask = DispatchSemaphore(value: 0)
        let call = try XCTUnwrap(
            CAPPluginCall(
                callbackId: "native-diagnostics-read-test",
                methodName: "read",
                options: [:],
                success: { _, _ in resolved.signal() },
                error: { _ in rejected.signal() }
            )
        )
        let simulatedBridgeQueue = DispatchQueue(label: "chat.mindroom.native-diagnostics-bridge-test")
        defer { writer.release.signal() }

        store.record(name: .appLaunch)
        XCTAssertEqual(writer.blocked.wait(timeout: .now() + 2), .success)
        simulatedBridgeQueue.async { plugin.read(call) }
        simulatedBridgeQueue.async { followingBridgeTask.signal() }

        XCTAssertEqual(
            followingBridgeTask.wait(timeout: .now() + 1),
            .success,
            "A pending persistence barrier must not occupy Capacitor's serial bridge queue"
        )
        writer.release.signal()
        XCTAssertEqual(resolved.wait(timeout: .now() + 2), .success)
        XCTAssertEqual(rejected.wait(timeout: .now()), .timedOut)
    }

    func testCorruptHistoryIsReportedWithoutExportingUntrustedBytes() throws {
        let directory = try temporaryDirectory()
        let firstStore = makeStore(directory: directory, sessionId: firstSession)
        firstStore.record(name: .appLaunch)
        _ = firstStore.read()
        let historyFile = try XCTUnwrap(
            FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil)?
                .compactMap { $0 as? URL }
                .first { $0.pathExtension == "json" }
        )
        try Data("{\"secret\":\"private-room-token\"".utf8).write(to: historyFile)

        let store = makeStore(directory: directory, sessionId: secondSession)
        let snapshot = store.read()
        let exported = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)

        XCTAssertEqual(snapshot.status, .corrupt)
        XCTAssertEqual(snapshot.currentSessionId, secondSession)
        XCTAssertTrue(snapshot.events.isEmpty)
        XCTAssertFalse(exported.contains("private-room-token"))
    }

    func testFailedAtomicWriteIsReportedWhileKeepingSanitizedMemoryEvidence() throws {
        struct WriteFailure: Error {}
        let store = makeStore(
            directory: try temporaryDirectory(),
            sessionId: firstSession,
            atomicWrite: { _, _ in throw WriteFailure() }
        )

        store.record(name: .sceneInactive)
        let snapshot = store.read()

        XCTAssertEqual(snapshot.status, .unavailable)
        XCTAssertEqual(snapshot.events.map(\.name), [.sceneInactive])
    }

    func testUnknownPersistedFieldsAreStrippedBeforeExport() throws {
        let directory = try temporaryDirectory()
        let firstStore = makeStore(directory: directory, sessionId: firstSession)
        firstStore.record(name: .navigationFailed, data: MindRoomDiagnosticState(errorCode: 404))
        _ = firstStore.read()
        let historyFile = try XCTUnwrap(
            FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil)?
                .compactMap { $0 as? URL }
                .first { $0.pathExtension == "json" }
        )
        var history = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: historyFile)) as? [String: Any]
        )
        var events = try XCTUnwrap(history["events"] as? [[String: Any]])
        events[0]["url"] = "capacitor://localhost/private-room?token=private-query"
        events[0]["errorDescription"] = "private-navigation-description"
        history["events"] = events
        history["futureSecretField"] = "private-cross-version-value"
        try JSONSerialization.data(withJSONObject: history).write(to: historyFile, options: .atomic)

        let snapshot = makeStore(directory: directory, sessionId: secondSession).read()
        let exported = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)

        XCTAssertEqual(snapshot.status, .available)
        XCTAssertEqual(snapshot.events.first?.data?.errorCode, 404)
        XCTAssertFalse(exported.contains("private"))
        XCTAssertFalse(exported.contains("capacitor://"))
    }

    func testErrorStateKeepsOnlyAllowlistedDomainAndNumericCode() throws {
        let secret = "private-room-and-query-token"
        let error = NSError(
            domain: NSURLErrorDomain,
            code: NSURLErrorCannotFindHost,
            userInfo: [
                NSURLErrorKey: URL(string: "capacitor://localhost/\(secret)?token=\(secret)")!,
                NSLocalizedDescriptionKey: "Failed to load \(secret)"
            ]
        )
        let store = makeStore(directory: try temporaryDirectory(), sessionId: firstSession)

        store.record(name: .navigationProvisionalFailed, data: MindRoomDiagnosticState(error: error))
        let snapshot = store.read()
        let exported = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)

        XCTAssertEqual(snapshot.events.first?.data?.errorDomain, .url)
        XCTAssertEqual(snapshot.events.first?.data?.errorCode, NSURLErrorCannotFindHost)
        XCTAssertFalse(exported.contains(secret))
        XCTAssertFalse(exported.contains("capacitor://"))
        XCTAssertFalse(exported.contains("localizedDescription"))
    }
}
