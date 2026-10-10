// GIF SHRINK — makes a smaller copy of an animated GIF for the site, keeping
// every frame and its timing. Written for NOISE's IMG_8617.gif (2026-10-09):
// 1920x1080 and 66.5 MB, over Harvest's MAX_GIF (20 MB), beside forty others
// at 720 wide in 32-47 colours. Out came 720x405, 29 colours, 8.4 MB.
//
//   swiftc -O tools/gif-shrink.swift -o /tmp/gif-shrink
//   /tmp/gif-shrink in.gif out.gif [width, default 720] [colours, default 32]
//
// Writes a NEW file; never point out.gif at the original. Nothing in Harvest
// calls this — it is run by hand (or by Claude) when a GIF is refused.
//
// Not gifsicle or ffmpeg: neither is on this Mac, and the Mac's own ImageIO
// does the job with nothing to install. ImageIO cannot be told a palette size,
// so the colours are chosen here and every pixel snapped to them first. ONE
// palette for the whole animation, so a pixel that does not move is the same
// colour in every frame and ImageIO's frame differencing can skip it — the
// colour count, not the frame size, was most of the 66 MB.
// The palette is a median cut over every 10th frame, and two choices in it
// were found by looking, not reasoning:
//   - weighted by the SQUARE ROOT of each colour's pixel count. Weighted by the
//     count itself, the thin bright-green edges were outvoted by the fills and
//     came out olive, at 48 colours as well as 32.
//   - each box becomes its most common REAL colour, not the average of the box.
//     Averaged, solid black came out dark grey.
import Foundation
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count >= 3 else { print("usage: gif-shrink in.gif out.gif [width] [colours]"); exit(1) }
// the original is the only full-size copy: written over, it is gone
guard URL(fileURLWithPath: a[1]).standardizedFileURL != URL(fileURLWithPath: a[2]).standardizedFileURL else { print("out.gif must be a new file, not the original"); exit(1) }
let width = a.count > 3 ? Int(a[3])! : 720, K = a.count > 4 ? Int(a[4])! : 32
guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil) else { fatalError("cannot read \(a[1])") }
let n = CGImageSourceGetCount(src)
let first = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let height = Int((Double(first.height) * Double(width) / Double(first.width)).rounded())
let cs = CGColorSpace(name: CGColorSpace.sRGB)!

func delay(_ i: Int) -> Double {
  let p = CGImageSourceCopyPropertiesAtIndex(src, i, nil) as? [CFString: Any]
  let g = p?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
  return (g?[kCGImagePropertyGIFUnclampedDelayTime] as? Double) ?? (g?[kCGImagePropertyGIFDelayTime] as? Double) ?? 0.1
}
func frame(_ i: Int) -> CGContext {
  let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: cs, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(CGImageSourceCreateImageAtIndex(src, i, nil)!, in: CGRect(x: 0, y: 0, width: width, height: height))
  return ctx
}
func pixels(_ c: CGContext) -> UnsafeMutablePointer<UInt8> { c.data!.bindMemory(to: UInt8.self, capacity: width * height * 4) }

// pass 1: colour histogram over every 10th frame
var hist = [UInt32: Int]()
for i in stride(from: 0, to: n, by: 10) {
  autoreleasepool {
    let c = frame(i), p = pixels(c)
    for k in 0..<(width * height) { hist[UInt32(p[k*4]) << 16 | UInt32(p[k*4+1]) << 8 | UInt32(p[k*4+2]), default: 0] += 1 }
  }
}
// median cut: split the box with the widest channel range (weighted by pixel count) until K boxes
typealias C = (r: Int, g: Int, b: Int, w: Int)
// weighted by the square root of the pixel count, so a thin bright edge is not outvoted by the fills
var boxes: [[C]] = [hist.map { (Int($0.key >> 16), Int($0.key >> 8 & 255), Int($0.key & 255), max(1, Int(Double($0.value).squareRoot()))) }]
func range(_ b: [C]) -> (Int, Int) {   // (channel, spread)
  let rs = b.map(\.r), gs = b.map(\.g), bs = b.map(\.b)
  let s = [rs.max()! - rs.min()!, gs.max()! - gs.min()!, bs.max()! - bs.min()!]
  let ch = s.firstIndex(of: s.max()!)!
  return (ch, s[ch])
}
while boxes.count < K {
  guard let i = boxes.indices.filter({ boxes[$0].count > 1 }).max(by: { range(boxes[$0]).1 * boxes[$0].reduce(0) { $0 + $1.w } < range(boxes[$1]).1 * boxes[$1].reduce(0) { $0 + $1.w } }) else { break }
  let ch = range(boxes[i]).0
  let key: (C) -> Int = ch == 0 ? { $0.r } : ch == 1 ? { $0.g } : { $0.b }
  let s = boxes[i].sorted { key($0) < key($1) }
  let total = s.reduce(0) { $0 + $1.w }
  var acc = 0, cut = 1
  for (j, c) in s.enumerated() { acc += c.w; if acc * 2 >= total { cut = max(1, min(s.count - 1, j + 1)); break } }
  boxes[i] = Array(s[..<cut]); boxes.append(Array(s[cut...]))
}
// each box is represented by its most common REAL colour, not an average: black stays black
let palette: [(Int, Int, Int)] = boxes.map { b in let m = b.max { $0.w < $1.w }!; return (m.r, m.g, m.b) }
var nearest = [UInt32: (UInt8, UInt8, UInt8)]()
func snap(_ r: UInt8, _ g: UInt8, _ b: UInt8) -> (UInt8, UInt8, UInt8) {
  let key = UInt32(r) << 16 | UInt32(g) << 8 | UInt32(b)
  if let hit = nearest[key] { return hit }
  let best = palette.min { x, y in
    let dx = (x.0 - Int(r)) * (x.0 - Int(r)) + (x.1 - Int(g)) * (x.1 - Int(g)) + (x.2 - Int(b)) * (x.2 - Int(b))
    let dy = (y.0 - Int(r)) * (y.0 - Int(r)) + (y.1 - Int(g)) * (y.1 - Int(g)) + (y.2 - Int(b)) * (y.2 - Int(b))
    return dx < dy
  }!
  let v = (UInt8(best.0), UInt8(best.1), UInt8(best.2)); nearest[key] = v; return v
}

// pass 2: every frame, snapped to the palette
guard let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.gif.identifier as CFString, n, nil) else { fatalError("cannot write") }
CGImageDestinationSetProperties(dst, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
for i in 0..<n {
  autoreleasepool {
    let c = frame(i), p = pixels(c)
    for k in 0..<(width * height) { let s = snap(p[k*4], p[k*4+1], p[k*4+2]); p[k*4] = s.0; p[k*4+1] = s.1; p[k*4+2] = s.2 }
    let d = delay(i)
    CGImageDestinationAddImage(dst, c.makeImage()!, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: d, kCGImagePropertyGIFUnclampedDelayTime: d]] as CFDictionary)
  }
}
guard CGImageDestinationFinalize(dst) else { fatalError("finalize failed") }
print("\(n) frames, \(width)x\(height), \(palette.count) colours")
