import Capacitor
import UIKit

@objc(MindRoomFileSavePlugin)
public class MindRoomFileSavePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate,
    UIAdaptivePresentationControllerDelegate {
    public let identifier = "MindRoomFileSavePlugin"
    public let jsName = "MindRoomFileSave"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "beginSave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendSave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentSave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abortSave", returnType: CAPPluginReturnPromise)
    ]

    private struct ExportSession {
        let id: String
        let pageID: String
        let directory: URL
        let fileURL: URL
    }

    private let saveQueue = DispatchQueue(label: "chat.mindroom.file-save", qos: .userInitiated)
    private var activeSession: ExportSession?
    private var pickerCall: CAPPluginCall?
    private weak var activePicker: UIDocumentPickerViewController?
    private var activePickerSessionID: String?

    @objc func beginSave(_ call: CAPPluginCall) {
        guard let pageID = call.getString("pageId"), !pageID.isEmpty else {
            call.reject("Save page is missing", "INVALID_PAGE")
            return
        }
        let fileName = safeFileName(call.getString("fileName"))

        saveQueue.async { [weak self] in
            guard let self = self else {
                call.reject("Unable to start save prompt", "PLUGIN_UNAVAILABLE")
                return
            }
            guard self.pickerCall == nil else {
                call.reject("A save prompt is already open", "SAVE_IN_PROGRESS")
                return
            }
            if let activeSession = self.activeSession {
                guard activeSession.pageID != pageID else {
                    call.reject("A save prompt is already open", "SAVE_IN_PROGRESS")
                    return
                }
                self.cleanupActiveSession()
            }

            let id = UUID().uuidString
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("mindroom-export-\(id)", isDirectory: true)
            let fileURL = directory.appendingPathComponent(fileName, isDirectory: false)

            do {
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true
                )
                try Data().write(to: fileURL, options: .atomic)
            } catch {
                try? FileManager.default.removeItem(at: directory)
                call.reject("Unable to prepare attachment", "FILE_WRITE_FAILED", error)
                return
            }

            self.activeSession = ExportSession(
                id: id,
                pageID: pageID,
                directory: directory,
                fileURL: fileURL
            )
            call.resolve(["id": id])
        }
    }

    @objc func appendSave(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let encodedData = call.getString("data") else {
            call.reject("Attachment data is missing", "INVALID_DATA")
            return
        }

        saveQueue.async { [weak self] in
            guard let self = self else {
                call.reject("Unable to continue save", "PLUGIN_UNAVAILABLE")
                return
            }
            guard let session = self.activeSession, session.id == id, self.pickerCall == nil else {
                call.reject("Save session is unavailable", "INVALID_SESSION")
                return
            }
            guard let data = Data(base64Encoded: encodedData) else {
                self.cleanupActiveSession()
                call.reject("Attachment data is invalid", "INVALID_DATA")
                return
            }

            do {
                let fileHandle = try FileHandle(forWritingTo: session.fileURL)
                try fileHandle.seekToEnd()
                try fileHandle.write(contentsOf: data)
                try fileHandle.close()
                call.resolve()
            } catch {
                self.cleanupActiveSession()
                call.reject("Unable to prepare attachment", "FILE_WRITE_FAILED", error)
            }
        }
    }

    @objc func presentSave(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Save session is missing", "INVALID_SESSION")
            return
        }

        saveQueue.async { [weak self] in
            guard let self = self else {
                call.reject("Unable to show save prompt", "PLUGIN_UNAVAILABLE")
                return
            }
            guard let session = self.activeSession, session.id == id else {
                call.reject("Save session is unavailable", "INVALID_SESSION")
                return
            }
            guard self.pickerCall == nil else {
                call.reject("A save prompt is already open", "SAVE_IN_PROGRESS")
                return
            }

            self.pickerCall = call
            DispatchQueue.main.async { [weak self] in
                guard let self = self,
                      let viewController = self.bridge?.viewController,
                      viewController.viewIfLoaded?.window != nil,
                      viewController.presentedViewController == nil,
                      !viewController.isBeingPresented,
                      !viewController.isBeingDismissed,
                      viewController.transitionCoordinator == nil else {
                    self?.rejectPresentationUnavailable(sessionID: session.id)
                    return
                }

                let picker = UIDocumentPickerViewController(
                    forExporting: [session.fileURL],
                    asCopy: true
                )
                picker.delegate = self
                picker.shouldShowFileExtensions = true
                self.activePicker = picker
                self.activePickerSessionID = session.id
                viewController.present(picker, animated: true) { [weak self, weak picker] in
                    guard let self = self else { return }
                    guard let picker = picker, self.activePicker === picker else {
                        if self.activePickerSessionID == session.id {
                            self.activePicker = nil
                            self.activePickerSessionID = nil
                            self.rejectPresentationUnavailable(sessionID: session.id)
                        }
                        return
                    }
                    guard picker.presentingViewController != nil,
                          picker.viewIfLoaded?.window != nil else {
                        self.activePicker = nil
                        self.activePickerSessionID = nil
                        self.rejectPresentationUnavailable(sessionID: session.id)
                        return
                    }
                    guard let presentationController = picker.presentationController else {
                        assertionFailure("Presented document picker has no presentation controller")
                        return
                    }
                    presentationController.delegate = self
                }
            }
        }
    }

    @objc func abortSave(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Save session is missing", "INVALID_SESSION")
            return
        }

        saveQueue.async { [weak self] in
            guard let self = self else {
                call.resolve()
                return
            }
            guard self.pickerCall == nil else {
                call.reject("A save prompt is already open", "SAVE_IN_PROGRESS")
                return
            }

            if self.activeSession?.id == id {
                self.cleanupActiveSession()
            }
            call.resolve()
        }
    }

    public func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        completePicker(controller, saved: true)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        completePicker(controller, saved: false)
    }

    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard let picker = presentationController.presentedViewController
            as? UIDocumentPickerViewController else { return }
        completePicker(picker, saved: false)
    }

    private func completePicker(_ picker: UIDocumentPickerViewController, saved: Bool) {
        guard activePicker === picker, let sessionID = activePickerSessionID else { return }
        activePicker = nil
        activePickerSessionID = nil

        saveQueue.async { [weak self] in
            guard let self = self else { return }
            guard self.activeSession?.id == sessionID else { return }
            self.pickerCall?.resolve(["saved": saved])
            self.pickerCall = nil
            self.cleanupActiveSession()
        }
    }

    private func rejectPresentationUnavailable(sessionID: String) {
        saveQueue.async { [weak self] in
            guard let self = self else { return }
            guard self.activeSession?.id == sessionID else { return }
            self.pickerCall?.reject(
                "Unable to show save prompt",
                "PRESENTATION_UNAVAILABLE"
            )
            self.pickerCall = nil
            self.cleanupActiveSession()
        }
    }

    private func cleanupActiveSession() {
        if let session = activeSession {
            try? FileManager.default.removeItem(at: session.directory)
        }
        activeSession = nil
    }

    private func safeFileName(_ requestedName: String?) -> String {
        guard let requestedName = requestedName?.trimmingCharacters(in: .whitespacesAndNewlines),
              !requestedName.isEmpty else {
            return "attachment"
        }

        let name = (requestedName as NSString).lastPathComponent
        return name.isEmpty || name == "/" || name == "." || name == ".." ? "attachment" : name
    }
}
