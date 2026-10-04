/* Harvest as a Mac app: one window, no browser, no Terminal.

   WHAT IT IS
     A thin shell. It starts the same tools/harvest.js the .command file runs,
     reads the address it prints, and shows that page in a native web view
     (WKWebView — Safari's engine, built into macOS). Quitting the app stops the
     server with an interrupt, so harvest.js saves its state on the way out.

   WHY NOT ELECTRON OR TAURI
     Electron is a ~200 MB browser of its own and an npm dependency; Tauri
     needs a Rust toolchain. This is ~150 lines against frameworks the Mac
     already has, compiled by the swiftc that also builds Harvest's OCR helper.

   WHERE THINGS ARE
     The repo and node paths are written into Info.plist by tools/build-app.sh
     (HarvestRepo, HarvestNode). Move the repo and the app must be rebuilt.
     Server output goes to ~/Library/Application Support/Harvest/harvest.log. */

import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate {
  var window: NSWindow!
  var web: WKWebView!
  let server = Process()
  var loaded = false
  var quitting = false   // set on Quit, so stopping the server is not reported as a failure

  func applicationDidFinishLaunching(_ note: Notification) {
    buildMenu()
    // a harvest:// address given when launched counts as one opened (open -a Harvest --args harvest://…)
    waiting += CommandLine.arguments.dropFirst().compactMap { URL(string: $0) }.filter { $0.scheme == "harvest" }

    let config = WKWebViewConfiguration()
    web = WKWebView(frame: .zero, configuration: config)
    web.uiDelegate = self
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
    window.title = "Harvest"
    window.contentView = web
    window.center()
    window.setFrameAutosaveName("Harvest")   // reopens where it was left
    window.makeKeyAndOrderFront(nil)
    web.loadHTMLString(page("Starting Harvest…"), baseURL: nil)
    NSApp.activate(ignoringOtherApps: true)
    start()
  }

  func start() {
    let info = Bundle.main.infoDictionary ?? [:]
    let repo = info["HarvestRepo"] as? String ?? ""
    let node = info["HarvestNode"] as? String ?? "/usr/local/bin/node"
    // HOME, as the server reads it (node's os.homedir()), so the two agree on
    // where Harvest's memory is — a scratch copy for testing is started with
    // HOME pointing elsewhere, and must not touch the real log
    let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
    let store = (home as NSString).appendingPathComponent("Library/Application Support/Harvest")
    try? FileManager.default.createDirectory(atPath: store, withIntermediateDirectories: true)
    let logPath = (store as NSString).appendingPathComponent("harvest.log")
    FileManager.default.createFile(atPath: logPath, contents: nil)
    let log = FileHandle(forWritingAtPath: logPath)

    server.executableURL = URL(fileURLWithPath: node)
    server.arguments = [(repo as NSString).appendingPathComponent("tools/harvest.js")]
    var env = ProcessInfo.processInfo.environment
    env["HARVEST_NO_OPEN"] = "1"   // this window is the browser
    env["HARVEST_APP"] = "1"       // and it should stop if this app disappears
    server.environment = env
    server.standardError = log

    // The server prints its address once at start. Keep reading after that
    // (and copy everything to the log): a pipe nobody drains fills up and
    // stalls the process writing to it.
    let out = Pipe()
    server.standardOutput = out
    out.fileHandleForReading.readabilityHandler = { [weak self] h in
      let data = h.availableData
      log?.write(data)
      guard let self = self, !self.loaded, let s = String(data: data, encoding: .utf8),
            let r = s.range(of: #"http://127\.0\.0\.1:\d+"#, options: .regularExpression),
            let url = URL(string: String(s[r]) + "/") else { return }
      self.loaded = true
      DispatchQueue.main.async { self.origin = String(s[r]); self.web.load(URLRequest(url: url)); self.deliver() }
    }
    server.terminationHandler = { [weak self] p in
      DispatchQueue.main.async {
        guard let self = self, !self.quitting else { return }
        self.web.loadHTMLString(self.page("Harvest stopped (code \(p.terminationStatus)).<br>The log is at ~/Library/Application Support/Harvest/harvest.log.<br>If the site folder has moved, rebuild the app: tools/build-app.sh"), baseURL: nil)
      }
    }
    do { try server.run() }
    catch { web.loadHTMLString(page("Could not start Harvest: \(error.localizedDescription)<br>Node was expected at \(node)."), baseURL: nil) }
  }

  // Interrupt, not kill: harvest.js catches SIGINT and saves before exiting.
  func applicationWillTerminate(_ note: Notification) {
    quitting = true
    if server.isRunning { server.interrupt(); server.waitUntilExit() }
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

  // A web view shows no alert boxes unless its host does.
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
  }

  // Nor any confirm box: without this, confirm() answers "no" without asking.
  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = message
    a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
    completionHandler(a.runModal() == .alertFirstButtonReturn)
  }

  // Nor a file chooser: <input type="file"> does nothing until the host opens
  // the panel. Used by the Project panel's icon and wordmark uploads.
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let p = NSOpenPanel()
    p.canChooseFiles = true
    p.canChooseDirectories = false
    p.allowsMultipleSelection = parameters.allowsMultipleSelection
    p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.urls : nil) }
  }

  @objc func reloadPage() { web.reload() }

  /* FINDER'S "Harvest ›" MENU (tools/HarvestFinder.swift) arrives here as an
     address — harvest://add?project=<slug>&path=…&path=…, harvest://crawl?…,
     harvest://open — and is held until the server is up, because choosing a
     project in Finder is also how Harvest gets opened. Files are added; a
     folder is linked, and one of over 300 files asks first: linking a whole
     studio folder is how Daily Shapes got 1,950 cards. */
  var origin: String?
  var waiting: [URL] = []

  func application(_ application: NSApplication, open urls: [URL]) {
    waiting += urls.filter { $0.scheme == "harvest" }
    NSApp.activate(ignoringOtherApps: true)
    window?.makeKeyAndOrderFront(nil)
    deliver()
  }

  func deliver() {
    guard let origin = origin, !waiting.isEmpty else { return }
    let urls = waiting
    waiting = []
    Task { @MainActor in for u in urls { await self.handle(u, origin) } }
  }

  @MainActor func handle(_ url: URL, _ origin: String) async {
    let c = URLComponents(url: url, resolvingAgainstBaseURL: false)
    let q = c?.queryItems ?? []
    guard let project = q.first(where: { $0.name == "project" })?.value else { return }   // harvest://open: being in front is the whole job
    let crawl = c?.host == "crawl"
    var done = 0, problems: [String] = []
    for p in q.filter({ $0.name == "path" }).compactMap({ $0.value }) {
      var isDir: ObjCBool = false
      FileManager.default.fileExists(atPath: p, isDirectory: &isDir)
      let name = (p as NSString).lastPathComponent
      var r: [String: Any]
      if crawl {
        r = await post(origin, "/api/crawl", ["root": p, "projects": [project]])
      } else if isDir.boolValue {
        r = await post(origin, "/api/link", ["project": project, "path": p])
        if r["confirm"] as? Bool == true {
          let a = NSAlert()
          a.messageText = "“\(name)” holds over 300 files."
          a.informativeText = "Add every one of them to this project, or crawl the folder for it — only the files that name the project or look like its pictures?"
          a.addButton(withTitle: "Crawl for It"); a.addButton(withTitle: "Add All"); a.addButton(withTitle: "Cancel")
          switch a.runModal() {
          case .alertFirstButtonReturn: r = await post(origin, "/api/crawl", ["root": p, "projects": [project]])
          case .alertSecondButtonReturn: r = await post(origin, "/api/link", ["project": project, "path": p, "force": true])
          default: continue
          }
        }
      } else {
        r = await post(origin, "/api/addfile", ["project": project, "path": p])
      }
      if let e = r["error"] as? String { problems.append("\(name): \(e)") } else { done += 1 }
    }
    if !problems.isEmpty {
      let a = NSAlert()
      a.messageText = problems.count == 1 ? "One item was not added." : "\(problems.count) items were not added."
      a.informativeText = problems.joined(separator: "\n")
      a.runModal()
    }
    guard done > 0 else { return }
    // shown in the page: the project is selected, and the status line says what happened
    let verb = crawl ? "Crawling it for " : "Added \(done) from Finder to "
    whenReady("(() => { const p = S.projects.find(p => p.slug === '\(project)'); document.querySelector('[data-s=\"\(project)\"]')?.click(); say('\(verb)' + (p ? p.title : 'the project') + '.'); })()")
  }

  func post(_ origin: String, _ path: String, _ body: [String: Any]) async -> [String: Any] {
    var r = URLRequest(url: URL(string: origin + path)!)
    r.httpMethod = "POST"
    r.setValue(origin, forHTTPHeaderField: "Origin")
    r.httpBody = try? JSONSerialization.data(withJSONObject: body)
    guard let (data, _) = try? await URLSession.shared.data(for: r),
          let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return ["error": "Harvest did not answer."] }
    return j
  }

  // The page may still be loading when Harvest was opened by the menu itself:
  // try again every half second until its project list is drawn (10 s at most).
  func whenReady(_ js: String, tries: Int = 20) {
    web.evaluateJavaScript("!!document.querySelector('[data-s]')") { ready, _ in
      if ready as? Bool == true { self.web.evaluateJavaScript(js) }
      else if tries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.whenReady(js, tries: tries - 1) } }
    }
  }

  func page(_ msg: String) -> String {
    "<body style='background:#000;color:#8f8f99;font:13px -apple-system;padding:40px'>\(msg)</body>"
  }

  // Without an Edit menu, Cmd-C / Cmd-V / Cmd-A do nothing in a web view —
  // and most of Harvest is typing alt text and editing copy.
  func buildMenu() {
    let main = NSMenu()
    func menu(_ title: String, _ items: [(String, Selector?, String, NSEvent.ModifierFlags)]) {
      let item = NSMenuItem(); main.addItem(item)
      let m = NSMenu(title: title)
      for (t, sel, key, mods) in items {
        if t == "-" { m.addItem(.separator()); continue }
        let i = NSMenuItem(title: t, action: sel, keyEquivalent: key)
        i.keyEquivalentModifierMask = mods
        // Reload is answered HERE, not passed down to whatever has focus: aimed
        // at the web view through the focus chain, Cmd-R did nothing unless the
        // page itself happened to have keyboard focus.
        if sel == #selector(reloadPage) { i.target = self }
        m.addItem(i)
      }
      item.submenu = m
    }
    menu("Harvest", [("Quit Harvest", #selector(NSApplication.terminate(_:)), "q", .command)])
    menu("Edit", [
      ("Undo", Selector(("undo:")), "z", .command), ("Redo", Selector(("redo:")), "z", [.command, .shift]), ("-", nil, "", []),
      ("Cut", #selector(NSText.cut(_:)), "x", .command), ("Copy", #selector(NSText.copy(_:)), "c", .command),
      ("Paste", #selector(NSText.paste(_:)), "v", .command), ("Select All", #selector(NSText.selectAll(_:)), "a", .command),
    ])
    menu("View", [("Reload", #selector(reloadPage), "r", .command)])
    menu("Window", [("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m", .command)])
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
