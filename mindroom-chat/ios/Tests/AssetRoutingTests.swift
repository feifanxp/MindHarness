import Capacitor
import WebKit
import XCTest
@testable import RoutingHost

private final class SchemeTask: NSObject, WKURLSchemeTask {
    let request: URLRequest
    var response: URLResponse?
    var data = Data()
    var error: Error?
    var finished = false

    init(_ request: URLRequest) { self.request = request }
    func didReceive(_ response: URLResponse) { self.response = response }
    func didReceive(_ data: Data) { self.data.append(data) }
    func didFinish() { finished = true }
    func didFailWithError(_ error: Error) { self.error = error }
}

@MainActor
final class AssetRoutingTests: XCTestCase {
    private let index = Data("<!doctype html><title>MindRoom</title>".utf8)

    private func withHandler(_ body: (WebViewAssetHandler, URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try index.write(to: directory.appendingPathComponent("index.html"))
        let handler = WebViewAssetHandler(router: MindRoomBridgeViewController().router())
        handler.setAssetPath(directory.path)
        try body(handler, directory)
    }

    private func load(_ path: String, with handler: WebViewAssetHandler, range: String? = nil) -> SchemeTask {
        var request = URLRequest(url: URL(string: "capacitor://localhost\(path)")!)
        request.setValue(range, forHTTPHeaderField: "Range")
        let task = SchemeTask(request)
        handler.webView(WKWebView(), start: task)
        return task
    }

    func testAppRoutesServeHTMLRegardlessOfServerOrEventSuffix() throws {
        let routes = [
            "/", "/home", "/home/!room%3Alocalhost",
            "/home/!room%3Amindroom.chat", "/direct/!room%3Amatrix.org",
            "/%23space%3Amindroom.chat", "/!space%3Amindroom.chat/!room%3Amatrix.org",
            "/home/%23alias%3Amindroom.chat?threadId=%24thread#reply",
            "/home/!room%3Amindroom.chat/%24event%3Amatrix.org",
            "/home/!room%3Aexample.js", "/home/!room%3Aexample.mp4",
            "/home/!room%3Acordova.js", "/explore/mindroom.chat",
            "/login/mindroom.chat", "/register/mindroom.chat", "/reset-password/mindroom.chat"
        ]
        try withHandler { handler, _ in
            for route in routes {
                let task = load(route, with: handler)
                XCTAssertNil(task.error, route)
                XCTAssertTrue(task.finished, route)
                XCTAssertEqual(task.data, index, route)
                XCTAssertEqual(task.response?.mimeType, "text/html", route)
            }
        }
    }

    func testExistingAssetsKeepTheirBytesAndMIMEType() throws {
        let assets: [(String, Data, String)] = [
            ("bundle.js", Data("window.assetLoaded = true;".utf8), "text/javascript"),
            ("style.css", Data("body { color: green; }".utf8), "text/css"),
            ("module.wasm", Data([0, 97, 115, 109, 1, 0, 0, 0]), "application/wasm"),
            ("icon.svg", Data("<svg xmlns='http://www.w3.org/2000/svg'/>".utf8), "image/svg+xml")
        ]
        try withHandler { handler, directory in
            for (name, data, mimeType) in assets {
                try data.write(to: directory.appendingPathComponent(name))
                let task = load("/\(name)", with: handler)
                XCTAssertNil(task.error, name)
                XCTAssertTrue(task.finished, name)
                XCTAssertEqual(task.data, data, name)
                XCTAssertEqual(task.response?.mimeType, mimeType, name)
            }
            let missing = load("/missing.js", with: handler)
            XCTAssertNotNil(missing.error)
            XCTAssertFalse(missing.finished)
            XCTAssertTrue(missing.data.isEmpty)
        }
    }

    func testWebRouteDefinitionsResolveThroughNativeHandler() throws {
        let url = try XCTUnwrap(Bundle(for: AssetRoutingTests.self).url(forResource: "web-routes", withExtension: "json"))
        let routes = try JSONDecoder().decode([String].self, from: Data(contentsOf: url))
        XCTAssertFalse(routes.isEmpty)
        try withHandler { handler, _ in
            for route in routes {
                let task = load(route, with: handler)
                XCTAssertNil(task.error, route)
                XCTAssertTrue(task.finished, route)
                XCTAssertEqual(task.data, index, route)
                XCTAssertEqual(task.response?.mimeType, "text/html", route)
            }
        }
    }

    func testNativeMediaRangeAndMissingFileArePreserved() throws {
        try withHandler { handler, directory in
            let mediaURL = directory.appendingPathComponent("clip.mp4")
            try Data([0, 1, 2, 3, 4, 5, 6, 7]).write(to: mediaURL)
            let nativePath = CapacitorBridge.fileStartIdentifier + mediaURL.path
            let task = load(nativePath, with: handler, range: "bytes=2-5")
            XCTAssertNil(task.error)
            XCTAssertTrue(task.finished)
            XCTAssertEqual(task.data, Data([2, 3, 4, 5]))
            XCTAssertEqual(task.response?.mimeType, "video/mp4")
            let response = task.response as? HTTPURLResponse
            XCTAssertEqual(response?.statusCode, 206)
            XCTAssertEqual(response?.value(forHTTPHeaderField: "Content-Range"), "bytes 2-5/8")

            try FileManager.default.removeItem(at: mediaURL)
            let missing = load(nativePath, with: handler)
            XCTAssertNotNil(missing.error)
            XCTAssertTrue(missing.data.isEmpty)
        }
    }

    func testAppBundleDeclaresSystemBootTimePrivacyReason() throws {
        let manifestURL = try XCTUnwrap(
            Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"),
            "The shipping app bundle must contain its privacy manifest"
        )
        let manifest = try XCTUnwrap(
            PropertyListSerialization.propertyList(
                from: Data(contentsOf: manifestURL),
                options: [],
                format: nil
            ) as? [String: Any]
        )
        let accessedAPITypes = try XCTUnwrap(manifest["NSPrivacyAccessedAPITypes"] as? [[String: Any]])
        let systemBootTime = try XCTUnwrap(accessedAPITypes.first {
            $0["NSPrivacyAccessedAPIType"] as? String == "NSPrivacyAccessedAPICategorySystemBootTime"
        })

        XCTAssertEqual(systemBootTime["NSPrivacyAccessedAPITypeReasons"] as? [String], ["35F9.1"])
    }
}
