// Commissar overlay: a tiny macOS helper for the Commissar Study Watch extension (native messaging, stdio).
// What a browser cannot do:
//   1. Show the Commissar over every app, fullscreen apps and every Space included: a non-activating panel at the
//      screen-saver level that joins all Spaces as a fullscreen auxiliary.
//   2. Tell the extension which app is in front (name and bundle id only: no window titles, no screen contents).
//   3. Bring the browser back in front (macOS 14+ ignores a background browser asking for that itself).
// Messages from the extension (JSON, 4-byte little-endian length first, as Chrome native messaging sends them):
//   {type: "watch", line, until, rows, colors, width, height}  his small watch panel (drawn natively, no WebKit)
//   {type: "watch", html, width, height}                      the same as a page (version 1 extensions)
//   {type: "scare", html, width, height, ms}  a big panel in the middle for `ms`, then gone (its WebKit too)
//   {type: "focus"}                           the browser that started the helper comes to the front
//   {type: "hide"}                            both panels away
//   {type: "quit"}
// Messages to the extension: {type: "ready", version}, {type: "app", name, bundle}, {type: "click", action}.
// The HTML comes only from the extension that is allowed in the host manifest (Chrome enforces allowed_origins).
// Kept small on purpose: idle it waits on stdin and on app-switch notifications, and only the scare panel ever
// starts WebKit (released again when the scare ends).
// Build: tools/install-overlay.mjs (swiftc). License: AGPL-3.0, like the extension.
import Cocoa
import WebKit

let helperVersion = 2

/// Takes a click even while its panel is not the key window (the panel never takes focus from your app).
final class FirstClickWebView: WKWebView {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class FirstClickButton: NSButton {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// The pixel bust: two pre-rendered frames (eyes dim / eyes hot) swapped on a slow timer. No drawing per tick.
final class FaceView: NSView {
  private var cold: CGImage?
  private var hot: CGImage?
  override var mouseDownCanMoveWindow: Bool { true }

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.magnificationFilter = .nearest
    layer?.contentsGravity = .resizeAspect
  }
  required init?(coder: NSCoder) { nil }

  func setArt(rows: [String], colors: [String: [Int]]) {
    cold = FaceView.render(rows, colors, eyes: [255, 40, 30])
    hot = FaceView.render(rows, colors, eyes: [255, 224, 138])
    layer?.contents = cold
  }

  func flicker(_ on: Bool) { layer?.contents = on ? hot : cold }

  private static func render(_ rows: [String], _ colors: [String: [Int]], eyes: [Int]) -> CGImage? {
    let h = min(rows.count, 64)
    let w = min(rows.map { $0.count }.max() ?? 0, 64)
    guard w > 0, h > 0 else { return nil }
    var px = [UInt8](repeating: 0, count: w * h * 4)
    for (y, row) in rows.prefix(h).enumerated() {
      for (x, ch) in row.prefix(w).enumerated() {
        let key = String(ch)
        guard key != ".", var c = colors[key], c.count >= 3 else { continue }
        if key == "r" { c = eyes }
        let i = (y * w + x) * 4
        px[i] = UInt8(clamping: c[0]); px[i + 1] = UInt8(clamping: c[1]); px[i + 2] = UInt8(clamping: c[2]); px[i + 3] = 255
      }
    }
    guard let provider = CGDataProvider(data: Data(px) as CFData) else { return nil }
    return CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                   space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                   provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
  }
}

/// The background of his watch panel: dark card, thin border, red stripe on the left. Drag it anywhere.
final class CardView: NSView {
  override var mouseDownCanMoveWindow: Bool { true }
  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.backgroundColor = NSColor(red: 10 / 255, green: 8 / 255, blue: 7 / 255, alpha: 0.92).cgColor
    layer?.cornerRadius = 10
    layer?.borderWidth = 1
    layer?.borderColor = NSColor(red: 58 / 255, green: 52 / 255, blue: 42 / 255, alpha: 1).cgColor
    let stripe = CALayer()
    stripe.backgroundColor = NSColor(red: 192 / 255, green: 57 / 255, blue: 43 / 255, alpha: 1).cgColor
    stripe.frame = CGRect(x: 0, y: 0, width: 4, height: frame.height)
    stripe.autoresizingMask = [.layerHeightSizable]
    layer?.addSublayer(stripe)
    layer?.masksToBounds = true
  }
  required init?(coder: NSCoder) { nil }
}

final class Overlay: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
  private var watchPanel: NSPanel?
  private var watchWeb: WKWebView? // only for a version 1 extension that still sends a page
  private var face: FaceView?
  private var lineLabel: NSTextField?
  private var untilLabel: NSTextField?
  private var flickerTimer: Timer?
  private var scarePanel: NSPanel?
  private var scareWeb: WKWebView?
  private var scareTimer: Timer?
  private var lastBundle = ""
  private var placing = false // moving his panel ourselves: not a spot you chose
  private var browser: NSRunningApplication?
  private let out = FileHandle.standardOutput
  private let outLock = NSLock()
  private let originKey = "watchOrigin"

  func applicationDidFinishLaunching(_ notification: Notification) {
    registerFonts()
    browser = Overlay.findBrowser()
    send(["type": "ready", "version": helperVersion])
    // which app is in front: now, and every time it changes
    let center = NSWorkspace.shared.notificationCenter
    center.addObserver(self, selector: #selector(appChanged(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    reportApp(NSWorkspace.shared.frontmostApplication)
    let reader = Thread { [weak self] in self?.readLoop() }
    reader.stackSize = 256 * 1024
    reader.start()
  }

  @objc private func appChanged(_ note: Notification) {
    reportApp(note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
  }

  private func reportApp(_ app: NSRunningApplication?) {
    guard let app = app else { return }
    let bundle = String((app.bundleIdentifier ?? "").prefix(120))
    let name = String((app.localizedName ?? "").prefix(80))
    if bundle + "|" + name == lastBundle { return } // the same app again: nothing new to say
    lastBundle = bundle + "|" + name
    send(["type": "app", "name": name, "bundle": bundle])
  }

  /// A display was added, removed or rearranged: keep his panel on a screen you can see.
  @objc private func screensChanged() {
    guard let panel = watchPanel, panel.isVisible else { return }
    place(panel, watchOrigin(panel.frame.size))
  }

  // ---------------------------------------------------------------- the bundled font (JetBrains Mono, OFL)

  /// Registers fonts/*.woff2 next to the helper for this process only (the installer copies them there).
  private func registerFonts() {
    let exe = Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0])
    let dir = exe.resolvingSymlinksInPath().deletingLastPathComponent().appendingPathComponent("fonts")
    guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
    let fonts = files.filter { ["woff2", "woff", "ttf", "otf"].contains($0.pathExtension.lowercased()) }
    if !fonts.isEmpty { CTFontManagerRegisterFontURLs(fonts as CFArray, .process, false, nil) }
  }

  private func font(_ size: CGFloat, bold: Bool = false, italic: Bool = false) -> NSFont {
    var traits: NSFontTraitMask = []
    if bold { traits.insert(.boldFontMask) }
    if italic { traits.insert(.italicFontMask) }
    if let f = NSFontManager.shared.font(withFamily: "JetBrains Mono", traits: traits, weight: bold ? 9 : 5, size: size) { return f }
    let menlo = NSFont(name: bold ? "Menlo-Bold" : italic ? "Menlo-Italic" : "Menlo-Regular", size: size)
    return menlo ?? NSFont.monospacedSystemFont(ofSize: size, weight: bold ? .bold : .regular)
  }

  // ---------------------------------------------------------------- native messaging

  private func readLoop() {
    let input = FileHandle.standardInput
    while true {
      let header = input.readData(ofLength: 4)
      if header.count < 4 { break } // the extension disconnected: quit
      let length = header.withUnsafeBytes { UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self)) }
      if length == 0 || length > 2_000_000 { break } // nothing the extension sends is this big
      let body = input.readData(ofLength: Int(length))
      if body.count < Int(length) { break }
      guard let message = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else { continue }
      DispatchQueue.main.async { self.handle(message) }
    }
    DispatchQueue.main.async { NSApp.terminate(nil) }
  }

  private func send(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    var length = UInt32(data.count).littleEndian
    outLock.lock()
    defer { outLock.unlock() }
    out.write(Data(bytes: &length, count: 4))
    out.write(data)
  }

  private func handle(_ message: [String: Any]) {
    let width = CGFloat(min(900, max(120, (message["width"] as? NSNumber)?.doubleValue ?? 220)))
    let height = CGFloat(min(900, max(120, (message["height"] as? NSNumber)?.doubleValue ?? 290)))
    switch message["type"] as? String {
    case "watch":
      if let html = message["html"] as? String { showWatchPage(html, NSSize(width: width, height: height)) }
      else { showWatch(message, NSSize(width: width, height: height)) }
    case "scare":
      showScare((message["html"] as? String) ?? "", NSSize(width: width, height: height), ms: (message["ms"] as? NSNumber)?.doubleValue ?? 12_000)
    case "focus":
      focusBrowser()
    case "hide":
      hideWatch()
      endScare()
    case "quit":
      NSApp.terminate(nil)
    default:
      break
    }
  }

  // ---------------------------------------------------------------- his watch panel

  private func showWatch(_ message: [String: Any], _ size: NSSize) {
    if watchPanel == nil || face == nil { buildWatch(size) }
    guard let panel = watchPanel else { return }
    if let rows = message["rows"] as? [String], let colors = message["colors"] as? [String: [Int]] { face?.setArt(rows: rows, colors: colors) }
    lineLabel?.stringValue = String(((message["line"] as? String) ?? "I am watching you.").prefix(160))
    untilLabel?.stringValue = String(((message["until"] as? String) ?? "").prefix(80))
    if !panel.isVisible { place(panel, watchOrigin(panel.frame.size)) }
    panel.orderFrontRegardless()
    startFlicker()
  }

  private func buildWatch(_ size: NSSize) {
    watchPanel?.orderOut(nil) // a version 1 page panel, replaced
    watchWeb = nil
    let panel = makePanel(NSRect(origin: watchOrigin(size), size: size), interactive: true)
    panel.isMovableByWindowBackground = true // drag him where he does not cover your work
    panel.delegate = self
    let card = CardView(frame: NSRect(origin: .zero, size: size).insetBy(dx: 6, dy: 6))
    card.autoresizingMask = [.width, .height]
    let root = NSView(frame: NSRect(origin: .zero, size: size))
    root.addSubview(card)
    panel.contentView = root

    let w = card.bounds.width
    var y = card.bounds.height - 8
    let faceSize: CGFloat = min(120, card.bounds.height - 140)
    y -= faceSize
    let face = FaceView(frame: NSRect(x: (w - faceSize) / 2, y: y, width: faceSize, height: faceSize))
    card.addSubview(face)

    let line = NSTextField(wrappingLabelWithString: "")
    line.font = font(13, italic: true)
    line.textColor = NSColor(red: 238 / 255, green: 230 / 255, blue: 211 / 255, alpha: 1)
    line.alignment = .center
    line.maximumNumberOfLines = 3
    y -= 46
    line.frame = NSRect(x: 10, y: y, width: w - 16, height: 44)
    card.addSubview(line)

    let until = NSTextField(labelWithString: "")
    until.font = font(10)
    until.textColor = NSColor(red: 201 / 255, green: 162 / 255, blue: 39 / 255, alpha: 1)
    until.alignment = .center
    y -= 15
    until.frame = NSRect(x: 8, y: y, width: w - 12, height: 14)
    card.addSubview(until)

    let pass = button("I need outside resources (10 min)", action: #selector(passClicked))
    pass.frame = NSRect(x: 12, y: 36, width: w - 20, height: 24)
    card.addSubview(pass)
    let back = button("Back to my post", action: #selector(backClicked))
    back.frame = NSRect(x: 12, y: 8, width: w - 20, height: 24)
    card.addSubview(back)

    watchPanel = panel
    self.face = face
    lineLabel = line
    untilLabel = until
  }

  private func button(_ title: String, action: Selector) -> NSButton {
    let b = FirstClickButton(title: title, target: self, action: action)
    b.isBordered = false
    b.wantsLayer = true
    b.layer?.backgroundColor = NSColor(red: 42 / 255, green: 36 / 255, blue: 28 / 255, alpha: 1).cgColor
    b.layer?.borderColor = NSColor(red: 58 / 255, green: 52 / 255, blue: 42 / 255, alpha: 1).cgColor
    b.layer?.borderWidth = 1
    b.layer?.cornerRadius = 5
    b.attributedTitle = NSAttributedString(string: title, attributes: [.font: font(10, bold: true), .foregroundColor: NSColor(red: 238 / 255, green: 230 / 255, blue: 211 / 255, alpha: 1)])
    return b
  }

  @objc private func passClicked() { send(["type": "click", "action": "outsidePass"]) }
  @objc private func backClicked() {
    focusBrowser() // at once, from the click itself; the extension then switches to the study tab
    send(["type": "click", "action": "returnNow"])
  }

  /// The eyes flicker about twice a second; a coalescing timer, stopped whenever the panel is not on screen.
  private func startFlicker() {
    flickerTimer?.invalidate()
    flickerTimer = nil
    face?.flicker(false)
    if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion || face == nil { return }
    let t = Timer(timeInterval: 0.45, repeats: true) { [weak self] _ in self?.face?.flicker(Double.random(in: 0..<1) < 0.35) }
    t.tolerance = 0.2
    RunLoop.main.add(t, forMode: .common)
    flickerTimer = t
  }

  private func hideWatch() {
    flickerTimer?.invalidate()
    flickerTimer = nil
    watchPanel?.orderOut(nil)
    if let web = watchWeb { web.loadHTMLString("", baseURL: nil) } // a version 1 page: stop its timers
  }

  /// A version 1 extension sends his panel as a page: shown as before (with WebKit).
  private func showWatchPage(_ html: String, _ size: NSSize) {
    if watchWeb == nil {
      watchPanel?.orderOut(nil) // the native panel, replaced
      flickerTimer?.invalidate()
      face = nil; lineLabel = nil; untilLabel = nil
      let panel = makePanel(NSRect(origin: watchOrigin(size), size: size), interactive: true)
      let web = makeWeb(size)
      panel.contentView = web
      watchPanel = panel
      watchWeb = web
    }
    watchWeb?.loadHTMLString(html, baseURL: nil)
    watchPanel?.orderFrontRegardless()
  }

  /// Where his panel goes: where you last dragged it, if that is still on a screen; else bottom right.
  private func watchOrigin(_ size: NSSize) -> NSPoint {
    if let s = UserDefaults.standard.string(forKey: originKey) {
      let p = NSPointFromString(s)
      let r = NSRect(origin: p, size: size)
      if NSScreen.screens.contains(where: { $0.visibleFrame.intersection(r).width >= size.width * 0.6 && $0.visibleFrame.intersection(r).height >= size.height * 0.6 }) { return p }
    }
    let screen = activeScreen()?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900) // no display right now
    return NSPoint(x: screen.maxX - size.width - 16, y: screen.minY + 16)
  }

  private func place(_ panel: NSPanel, _ origin: NSPoint) {
    placing = true
    panel.setFrameOrigin(origin)
    placing = false
  }

  func windowDidMove(_ notification: Notification) {
    guard !placing, let panel = notification.object as? NSPanel, panel === watchPanel, panel.isVisible else { return }
    UserDefaults.standard.set(NSStringFromPoint(panel.frame.origin), forKey: originKey)
  }

  // ---------------------------------------------------------------- the screamer

  private func showScare(_ html: String, _ size: NSSize, ms: Double) {
    guard let screen = activeScreen()?.frame else { return } // no display right now: nothing to scare
    let rect = NSRect(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2, width: size.width, height: size.height)
    if scarePanel == nil { scarePanel = makePanel(rect, interactive: false) }
    scarePanel?.setFrame(rect, display: false)
    if scareWeb == nil {
      let web = makeWeb(size)
      scarePanel?.contentView = web
      scareWeb = web
    }
    scareWeb?.loadHTMLString(html, baseURL: nil)
    scarePanel?.orderFrontRegardless()
    scareTimer?.invalidate()
    let t = Timer(timeInterval: min(30_000, max(1_000, ms)) / 1000, repeats: false) { [weak self] _ in self?.endScare() }
    t.tolerance = 0.3
    RunLoop.main.add(t, forMode: .common)
    scareTimer = t
  }

  /// The scare is over: hide it and let its WebKit go (its web process quits once nothing uses it).
  private func endScare() {
    scareTimer?.invalidate()
    scareTimer = nil
    scarePanel?.orderOut(nil)
    if let web = scareWeb {
      web.stopLoading()
      web.navigationDelegate = nil
      web.configuration.userContentController.removeAllScriptMessageHandlers()
      web.removeFromSuperview()
    }
    scareWeb = nil
    scarePanel?.contentView = nil
  }

  // ---------------------------------------------------------------- bringing the browser back

  /// The browser that started the helper: the first app among its parent processes (Brave, Chrome).
  private static func findBrowser() -> NSRunningApplication? {
    var pid = getppid()
    for _ in 0..<8 {
      if pid <= 1 { break }
      if let app = NSRunningApplication(processIdentifier: pid), app.bundleURL != nil, app.activationPolicy == .regular { return app }
      pid = parentOf(pid)
    }
    return nil
  }

  private static func parentOf(_ pid: pid_t) -> pid_t {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    guard sysctl(&mib, 4, &info, &size, nil, 0) == 0, size > 0 else { return 0 }
    return info.kp_eproc.e_ppid
  }

  /// Brings the browser to the front. A plain activate() is ignored for a background caller since macOS 14, so
  /// this asks Launch Services, the way `open -a` does. Never opens anything else.
  private func focusBrowser() {
    if browser == nil || browser?.isTerminated == true { browser = Overlay.findBrowser() }
    guard let app = browser, let url = app.bundleURL else { return }
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier { return }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = true
    config.addsToRecentItems = false
    config.createsNewApplicationInstance = false
    config.promptsUserIfNeeded = false
    NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in }
  }

  // ---------------------------------------------------------------- panels

  /// The screen you are on: the one with the mouse (a fullscreen app may be on any of them).
  private func activeScreen() -> NSScreen? {
    let mouse = NSEvent.mouseLocation
    return NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens.first
  }

  /// A borderless, non-activating panel above everything, on every Space, over fullscreen apps too.
  private func makePanel(_ rect: NSRect, interactive: Bool) -> NSPanel {
    let panel = NSPanel(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    panel.level = .screenSaver
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.hidesOnDeactivate = false
    panel.isFloatingPanel = true
    panel.becomesKeyOnlyIfNeeded = true
    panel.isReleasedWhenClosed = false
    panel.ignoresMouseEvents = !interactive // the screamer never catches clicks; the watch panel has its buttons
    return panel
  }

  /// A web view that keeps nothing on disk and may load nothing but the page it is given.
  private func makeWeb(_ size: NSSize) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.userContentController.add(self, name: "commissar")
    config.mediaTypesRequiringUserActionForPlayback = .all
    let web = FirstClickWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
    web.navigationDelegate = self
    web.autoresizingMask = [.width, .height]
    web.setValue(false, forKey: "drawsBackground")
    return web
  }

  // only the page the extension sent: no link, form or script may load anything else
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let url = action.request.url?.absoluteString ?? ""
    decisionHandler(action.navigationType == .other && (url == "about:blank" || url.isEmpty) ? .allow : .cancel)
  }

  // a version 1 watch page's button: window.webkit.messageHandlers.commissar.postMessage('outsidePass')
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let action = message.body as? String, ["outsidePass", "returnNow"].contains(action) else { return }
    if action == "returnNow" { focusBrowser() }
    send(["type": "click", "action": action])
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // no Dock icon, never takes focus
let overlay = Overlay()
app.delegate = overlay
app.run()
