import WebKit
import XCTest
@testable import RoutingHost

@MainActor
private func waitForNativeDocument(
    _ controller: MindRoomBridgeViewController, after previous: String? = nil
) async -> (webView: WKWebView, bootID: String)? {
    let deadline = Date().addingTimeInterval(15)
    while Date() < deadline {
        // Cold startup can still replace or navigate the controller's initial view.
        if let webView = controller.webView, !webView.isLoading,
           let bootID = try? await webView.evaluateJavaScript("window.routingBootId") as? String,
           !bootID.isEmpty, bootID != previous, controller.webView === webView {
            return (webView, bootID)
        }
        try? await Task.sleep(nanoseconds: 100_000_000)
    }
    return nil
}

/// Observe startup before initiating a controlled navigation; never race the app's first load.
@MainActor
func loadNativeTestFixture() async throws -> (MindRoomBridgeViewController, WKWebView) {
    let controller = try XCTUnwrap(UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
        .compactMap { $0.rootViewController as? MindRoomBridgeViewController }.first)
    let initialDocument = await waitForNativeDocument(controller)
    let initial = try XCTUnwrap(initialDocument, "The bundled app must finish startup before fixture navigation")
    initial.webView.load(URLRequest(url: URL(string: "capacitor://localhost/")!))
    let freshDocument = await waitForNativeDocument(controller, after: initial.bootID)
    let fresh = try XCTUnwrap(freshDocument, "A new bundled fixture document must load before probing native behavior")
    return (controller, fresh.webView)
}
