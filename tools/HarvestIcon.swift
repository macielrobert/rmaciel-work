/* Draws Harvest's icon as a 1024 px PNG: three columns — pending (grey),
   accepted (white), rejected (faint) — the app's own layout, in the site's
   colours (black ground, white ink, the #8f8f99 accent grey).

     swift tools/HarvestIcon.swift out.png      (tools/build-app.sh runs this)

   Chosen from four sketches on 2026-10-04. Drawn in code rather than kept as
   a picture so it can be adjusted by number, and so the repo holds no binary.
   Proportions follow Apple's icon grid: the rounded square is 824 of 1024,
   so it sits the same size as every other icon in the Dock. */

import AppKit

let size = 1024.0
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// The sketch was drawn on a 120-unit square with the tile spanning 2…118.
// Map that tile onto Apple's 824 px tile at 100 px in.
let k = 824.0 / 116.0
func box(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> NSRect {
  NSRect(x: 100 + (x - 2) * k, y: size - (100 + (y - 2 + h) * k), width: w * k, height: h * k)
}
func grey(_ a: Double) -> NSColor { NSColor(srgbRed: 143 / 255, green: 143 / 255, blue: 153 / 255, alpha: a) }

NSColor.black.setFill()
NSBezierPath(roundedRect: box(2, 2, 116, 116), xRadius: 26 * k, yRadius: 26 * k).fill()

grey(0.55).setFill()                                       // pending: a full column
for y in [34.0, 48, 62, 76] { box(28, y, 18, 10).fill() }
NSColor.white.setFill()                                    // accepted: the ones chosen
for y in [34.0, 48] { box(51, y, 18, 10).fill() }
grey(0.275).setFill()                                      // rejected: one, faint
box(74, 34, 18, 10).fill()

NSGraphicsContext.current = nil
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
