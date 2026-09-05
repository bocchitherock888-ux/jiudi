import Cocoa
import WebKit

private let bundleID = "local.jiudi"

@main
enum JiudiMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    private var server: Process?
    private var stdoutPipe: Pipe?
    private var runtimeRoot: URL?
    private var origin: URL?
    private var stopping = false
    private var downloads: [ObjectIdentifier: (download: WKDownload, directory: URL, temporary: URL, target: URL)] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
            .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
        if let other = others.first {
            other.activate()
            NSApp.terminate(nil)
            return
        }
        // Standard editing commands also make copy/paste and keyboard shortcuts work in WKWebView.
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出就地", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApp.mainMenu = menu
        do {
            let url = try startServer()
            origin = url
            makeWindow(url: url)
        } catch {
            stopServer()
            let alert = NSAlert()
            alert.messageText = "就地打不开"
            alert.informativeText = error.localizedDescription
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { stopServer() }
    func windowWillClose(_ notification: Notification) { stopServer() }

    private func failure(_ message: String) -> NSError {
        NSError(domain: bundleID, code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func stageRoot() throws -> URL {
        let source = Bundle.main.bundleURL.deletingLastPathComponent()
        guard FileManager.default.isReadableFile(atPath: source.appendingPathComponent("serve.py").path) else {
            throw failure("请把「就地.app」放在就地文件夹里，和网页文件在一起。")
        }
        let dest = FileManager.default.temporaryDirectory.appendingPathComponent("jiudi-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dest, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        runtimeRoot = dest
        for name in ["serve.py", "index.html", "image.html", "pdf.html", "video.html", "css", "js", "favicon.png", "apple-touch-icon.png"] {
            try FileManager.default.copyItem(at: source.appendingPathComponent(name), to: dest.appendingPathComponent(name))
        }
        return dest
    }

    private func pythonURL() throws -> URL {
        let env = ProcessInfo.processInfo.environment["PATH"] ?? ""
        let search = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] + env.split(separator: ":").map(String.init)
        for dir in search {
            let candidate = URL(fileURLWithPath: dir).appendingPathComponent("python3")
            if FileManager.default.isExecutableFile(atPath: candidate.path) { return candidate }
        }
        throw failure("找不到 python3，请先安装 Python 3。")
    }

    private func startServer() throws -> URL {
        let proc = Process()
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("jiudi-server")
        if let bundled, FileManager.default.isExecutableFile(atPath: bundled.path) {
            // The distribution helper embeds all resources and needs no Python or writable app directory.
            proc.executableURL = bundled
            proc.arguments = ["--no-browser", "--parent-pid", String(ProcessInfo.processInfo.processIdentifier)]
            proc.currentDirectoryURL = Bundle.main.resourceURL
        } else {
            let stage = try stageRoot()
            proc.executableURL = try pythonURL()
            proc.arguments = [stage.appendingPathComponent("serve.py").path, "0"]
            proc.currentDirectoryURL = stage
        }
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        env["PYTHONUNBUFFERED"] = "1"
        proc.environment = env
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = pipe
        stdoutPipe = pipe
        try proc.run()
        server = proc
        let deadline = Date().addingTimeInterval(8)
        var output = Data()
        let descriptor = pipe.fileHandleForReading.fileDescriptor
        var buffer = [UInt8](repeating: 0, count: 4096)
        while Date() < deadline {
            var descriptorState = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
            let ready = poll(&descriptorState, 1, 50)
            if ready > 0 && descriptorState.revents & Int16(POLLIN) != 0 {
                let count = Darwin.read(descriptor, &buffer, buffer.count)
                if count > 0 { output.append(contentsOf: buffer.prefix(count)) }
                let text = String(decoding: output, as: UTF8.self)
                for line in text.split(whereSeparator: \.isNewline) {
                    guard let last = line.split(separator: " ").last,
                          let url = URL(string: String(last)), url.scheme == "http",
                          url.host == "127.0.0.1", let port = url.port, port > 0 else { continue }
                    // Drain ongoing request logs so a full pipe cannot stall the HTTP service.
                    pipe.fileHandleForReading.readabilityHandler = { handle in
                        if handle.availableData.isEmpty { handle.readabilityHandler = nil }
                    }
                    return url
                }
                if output.count > 65536 { output = Data(output.suffix(32768)) }
            }
            if !proc.isRunning { throw failure("服务启动失败：" + String(decoding: output.suffix(1500), as: UTF8.self)) }
        }
        throw failure("服务启动超时，请重新打开应用。")
    }

    private func stopServer() {
        if stopping { return }
        stopping = true
        for entry in downloads.values {
            entry.download.cancel { _ in }
            try? FileManager.default.removeItem(at: entry.directory)
        }
        downloads.removeAll()
        if let proc = server, proc.isRunning {
            proc.terminate()
            let deadline = Date().addingTimeInterval(1.5)
            while proc.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.025) }
            if proc.isRunning { Darwin.kill(proc.processIdentifier, SIGKILL) }
            proc.waitUntilExit()
        }
        server = nil
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        try? stdoutPipe?.fileHandleForReading.close()
        stdoutPipe = nil
        // This is the fresh UUID directory created by this exact app instance.
        if let stage = runtimeRoot { try? FileManager.default.removeItem(at: stage) }
        runtimeRoot = nil
    }

    private func makeWindow(url: URL) {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        let size = NSSize(width: min(1280, screen.width - 40), height: min(860, screen.height - 40))
        let rect = NSRect(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2, width: size.width, height: size.height)
        let win = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        win.title = "就地"
        win.minSize = NSSize(width: 720, height: 520)
        win.delegate = self
        win.isReleasedWhenClosed = false
        window = win
        let config = WKWebViewConfiguration()
        let wv = WKWebView(frame: win.contentView!.bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.navigationDelegate = self
        wv.uiDelegate = self
        win.contentView = wv
        webView = wv
        wv.load(URLRequest(url: url))
        win.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func isLocal(_ url: URL) -> Bool {
        guard let allowed = origin else { return false }
        if url.scheme == "blob", let inner = URL(string: String(url.absoluteString.dropFirst(5))) { return isLocal(inner) }
        return url.scheme == allowed.scheme && url.host == allowed.host && url.port == allowed.port
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, isLocal(url) else { decisionHandler(.cancel); return }
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [weak self] result in
            guard let self = self, result == .OK, let target = panel.url else { completionHandler(nil); return }
            let directory = target.deletingLastPathComponent().appendingPathComponent(".jiudi-save-" + UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
                let temporary = directory.appendingPathComponent("download")
                self.downloads[ObjectIdentifier(download)] = (download, directory, temporary, target)
                completionHandler(temporary)
            } catch {
                completionHandler(nil)
                self.showSaveError(error.localizedDescription)
            }
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let entry = downloads.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: entry.directory)
        }
        if (error as NSError).code == NSURLErrorCancelled { return }
        showSaveError(error.localizedDescription)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let entry = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        // Staging on the destination volume makes replacement atomic, including Save Panel “Replace”.
        if Darwin.rename(entry.temporary.path, entry.target.path) == 0 {
            try? FileManager.default.removeItem(at: entry.directory)
        } else {
            let error = NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
            showSaveError(error.localizedDescription + "\n文件已保留在：" + entry.temporary.path)
        }
    }

    private func showSaveError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "保存失败"
        alert.informativeText = message
        alert.beginSheetModal(for: window)
    }
}
