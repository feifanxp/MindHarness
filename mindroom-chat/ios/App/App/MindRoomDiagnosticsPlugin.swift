import Capacitor

@objc(MindRoomDiagnosticsPlugin)
public final class MindRoomDiagnosticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MindRoomDiagnosticsPlugin"
    public let jsName = "MindRoomDiagnostics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]
    private let recorder: MindRoomDiagnosticsRecorder

    public override init() {
        recorder = .shared
        super.init()
    }

    init(recorder: MindRoomDiagnosticsRecorder) {
        self.recorder = recorder
        super.init()
    }

    @objc func read(_ call: CAPPluginCall) {
        recorder.read { snapshot in
            call.resolve(snapshot.capacitorValue)
        }
    }
}

private extension MindRoomDiagnosticsSnapshot {
    var capacitorValue: [String: Any] {
        [
            "schemaVersion": schemaVersion,
            "status": status.rawValue,
            "currentSessionId": currentSessionId.uuidString,
            "droppedEventCount": droppedEventCount,
            "events": events.map(\.capacitorValue)
        ]
    }
}

private extension MindRoomDiagnosticEvent {
    var capacitorValue: [String: Any] {
        var value: [String: Any] = [
            "at": at,
            "monotonicMs": monotonicMs,
            "sequence": sequence,
            "sessionId": sessionId.uuidString,
            "name": name.rawValue
        ]
        if let data, !data.isEmpty {
            value["data"] = data.capacitorValue
        }
        return value
    }
}

private extension MindRoomDiagnosticState {
    var capacitorValue: [String: Any] {
        var value: [String: Any] = [:]
        if let applicationState { value["applicationState"] = applicationState }
        if let sceneState { value["sceneState"] = sceneState }
        if let loading { value["loading"] = loading }
        if let progress { value["progress"] = progress }
        if let attached { value["attached"] = attached }
        if let hidden { value["hidden"] = hidden }
        if let opaque { value["opaque"] = opaque }
        if let transparent { value["transparent"] = transparent }
        if let emptyBounds { value["emptyBounds"] = emptyBounds }
        if let errorDomain { value["errorDomain"] = errorDomain.rawValue }
        if let errorCode { value["errorCode"] = errorCode }
        return value
    }
}
