/* Harvest in Finder's right-click menu:

     Harvest ›  Add to Project   › BUILD … DESIGN … ART …
                Crawl for Project › (a folder only)
                Open Harvest

   WHAT IT IS
     A Finder Sync extension — the one kind of add-on macOS lets put its own
     item, with sub-menus, at the top level of Finder's context menu (Quick
     Actions are single items and cannot list projects). It is built into
     Harvest.app/Contents/PlugIns by tools/build-app.sh and is switched on in
     System Settings, or with: pluginkit -e use -i work.rmaciel.harvest.finder

   HOW IT TALKS TO HARVEST
     It does not. macOS keeps an extension in a sandbox, so it reads one file
     — the project list Harvest writes to ~/Library/Application Support/
     Harvest/finder.json — and hands the choice to Harvest.app as an address,
     harvest://add?project=bus-stop&path=…, which opens Harvest if it is not
     running. HarvestApp.swift does the work and shows the result.

   QUIRK WORTH KNOWING
     Finder copies menu items across to its own process, so the item that
     comes back when one is chosen carries its title and tag but nothing
     attached to it. The tag is the project's place in the list as it was
     when the menu was drawn. */

import Cocoa
import FinderSync

struct Project: Decodable { let slug: String; let title: String; let section: String?; let draft: Bool? }

@objc(FinderSync)
final class FinderSync: FIFinderSync {
  var projects: [Project] = []

  override init() {
    super.init()
    // everywhere: the menu is offered on any file, in any folder
    FIFinderSyncController.default().directoryURLs = [URL(fileURLWithPath: "/")]
  }

  // The REAL home folder: inside the sandbox NSHomeDirectory() is the
  // extension's own container, not the user's.
  func load() -> [Project] {
    guard let pw = getpwuid(getuid()), let home = String(validatingUTF8: pw.pointee.pw_dir) else { return [] }
    let file = URL(fileURLWithPath: home).appendingPathComponent("Library/Application Support/Harvest/finder.json")
    guard let data = try? Data(contentsOf: file) else { return [] }
    return (try? JSONDecoder().decode([Project].self, from: data)) ?? []
  }

  override func menu(for kind: FIMenuKind) -> NSMenu? {
    guard kind == .contextualMenuForItems else { return nil }
    projects = load()
    let items = FIFinderSyncController.default().selectedItemURLs() ?? []
    // Finder hands a folder over with a trailing slash; reading the disk is
    // the fallback, and the sandbox may refuse it
    let oneFolder = items.count == 1 && (items[0].hasDirectoryPath || (try? items[0].resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true)

    let sub = NSMenu(title: "Harvest")
    if projects.isEmpty {
      let none = NSMenuItem(title: "Open Harvest once to list your projects", action: nil, keyEquivalent: "")
      none.isEnabled = false
      sub.addItem(none)
    } else {
      sub.addItem(parent("Add to Project", #selector(addTo(_:))))
      if oneFolder { sub.addItem(parent("Crawl for Project", #selector(crawlFor(_:)))) }
    }
    sub.addItem(.separator())
    sub.addItem(NSMenuItem(title: "Open Harvest", action: #selector(openHarvest(_:)), keyEquivalent: ""))

    let top = NSMenuItem(title: "Harvest", action: nil, keyEquivalent: "")
    let icon = NSWorkspace.shared.icon(forFile: "/Applications/Harvest.app")
    icon.size = NSSize(width: 16, height: 16)
    top.image = icon
    top.submenu = sub
    let menu = NSMenu(title: "")
    menu.addItem(top)
    return menu
  }

  // One item per project, under a heading per section, in the site's order.
  func parent(_ title: String, _ action: Selector) -> NSMenuItem {
    let list = NSMenu(title: title)
    var section: String? = nil
    for (i, p) in projects.enumerated() {
      if p.section != section {
        section = p.section
        if list.numberOfItems > 0 { list.addItem(.separator()) }
        let head = NSMenuItem(title: (p.section ?? "").uppercased(), action: nil, keyEquivalent: "")
        head.isEnabled = false
        list.addItem(head)
      }
      let item = NSMenuItem(title: p.title + (p.draft == true ? " · draft" : ""), action: action, keyEquivalent: "")
      item.tag = i
      list.addItem(item)
    }
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.submenu = list
    return item
  }

  @objc func addTo(_ sender: NSMenuItem) { send("add", sender) }
  @objc func crawlFor(_ sender: NSMenuItem) { send("crawl", sender) }
  @objc func openHarvest(_ sender: NSMenuItem) { NSWorkspace.shared.open(URL(string: "harvest://open")!) }

  func send(_ action: String, _ sender: NSMenuItem) {
    guard projects.indices.contains(sender.tag) else { return }
    let paths = (FIFinderSyncController.default().selectedItemURLs() ?? []).map { $0.path }
    guard !paths.isEmpty else { return }
    var c = URLComponents()
    c.scheme = "harvest"
    c.host = action
    c.queryItems = [URLQueryItem(name: "project", value: projects[sender.tag].slug)] + paths.map { URLQueryItem(name: "path", value: $0) }
    if let url = c.url { NSWorkspace.shared.open(url) }
  }
}
