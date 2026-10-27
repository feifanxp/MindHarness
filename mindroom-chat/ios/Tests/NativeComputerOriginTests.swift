import Network
import WebKit
import XCTest
@testable import RoutingHost

/// A disposable loopback API observes WebKit's actual wire origin, with shipping ATS settings.
private final class ComputerOriginProbeServer {
    private let queue = DispatchQueue(label: "mindroom.test.computer-origin")
    private let listener: NWListener
    private var requests: [(method: String, origin: String)] = []

    init() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            connection.start(queue: self.queue)
            self.receive(connection)
        }
        listener.start(queue: queue)
    }

    var port: UInt16? {
        guard case .ready = listener.state else { return nil }
        return listener.port?.rawValue
    }
    var observedRequests: [(method: String, origin: String)] { queue.sync { requests } }
    func stop() { listener.cancel() }

    private func receive(_ connection: NWConnection, prefix: Data = Data()) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
            guard let self, error == nil else { connection.cancel(); return }
            let bytes = prefix + (data ?? Data())
            guard bytes.count <= 65536 else { connection.cancel(); return }
            guard let text = String(data: bytes, encoding: .utf8), text.contains("\r\n\r\n") else {
                if complete { connection.cancel() } else { self.receive(connection, prefix: bytes) }
                return
            }
            let lines = text.components(separatedBy: "\r\n")
            let method = lines.first?.components(separatedBy: " ").first ?? ""
            let origin = lines.first { $0.lowercased().hasPrefix("origin:") }
                .map { String($0.dropFirst(7)).trimmingCharacters(in: .whitespaces) } ?? ""
            self.requests.append((method, origin))
            guard let body = try? JSONSerialization.data(withJSONObject: ["origin": origin]) else {
                connection.cancel(); return
            }
            let headers = [
                "HTTP/1.1 200 OK", "Content-Type: application/json", "Content-Length: \(body.count)",
                "Access-Control-Allow-Origin: capacitor://localhost", "Access-Control-Allow-Methods: GET, OPTIONS",
                "Access-Control-Allow-Headers: authorization", "Vary: Origin", "Connection: close", "", ""
            ].joined(separator: "\r\n")
            connection.send(content: Data(headers.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
        }
    }
}

@MainActor
final class NativeComputerOriginTests: XCTestCase {
    func testComputerCorsUsesBundledNativeOriginForPreflightAndAuthenticatedFetch() async throws {
        let (_, webView) = try await loadNativeTestFixture()
        let server = try ComputerOriginProbeServer()
        defer { server.stop() }
        for _ in 0..<100 {
            if server.port != nil { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let port = try XCTUnwrap(server.port)
        let result = try await webView.callAsyncJavaScript("""
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
              const response = await fetch(url, {
                signal:controller.signal, headers:{Authorization:'Bearer native-origin-test-only'}
              });
              return await response.json();
            } finally { clearTimeout(timeout); }
            """, arguments: ["url": "http://localhost:\(port)/api/computers/origin-probe"], in: nil, contentWorld: .page)
        XCTAssertEqual((result as? [String: String])?["origin"], "capacitor://localhost")
        let requests = server.observedRequests
        XCTAssertEqual(requests.map(\.method), ["OPTIONS", "GET"], "A bearer header must exercise real CORS preflight")
        XCTAssertTrue(requests.allSatisfy { $0.origin == "capacitor://localhost" })
    }
}
