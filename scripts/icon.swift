// Draws the app icon: ink-blue square, "Aa" and the five-step colour scale.
import AppKit
let size: CGFloat = 1024
let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()
NSColor(srgbRed: 0x2B/255, green: 0x46/255, blue: 0xC7/255, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()
let font = NSFont(name: "Georgia-Bold", size: 470) ?? NSFont.boldSystemFont(ofSize: 470)
let para = NSMutableParagraphStyle(); para.alignment = .center
let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white, .paragraphStyle: para]
NSAttributedString(string: "Aa", attributes: attrs).draw(in: NSRect(x: 0, y: 330, width: size, height: 560))
let colors: [(CGFloat, CGFloat, CGFloat)] = [(0xD2,0x40,0x3F),(0xE0,0x7A,0x2E),(0xD9,0xA2,0x1E),(0x7F,0xB3,0x3A),(0x23,0x95,0x5A)]
let d: CGFloat = 92, gap: CGFloat = 36
let total = CGFloat(colors.count) * d + CGFloat(colors.count - 1) * gap
var x = (size - total) / 2
for c in colors {
  NSColor.white.setFill()
  NSBezierPath(ovalIn: NSRect(x: x - 8, y: 222 - 8, width: d + 16, height: d + 16)).fill()
  NSColor(srgbRed: c.0/255, green: c.1/255, blue: c.2/255, alpha: 1).setFill()
  NSBezierPath(ovalIn: NSRect(x: x, y: 222, width: d, height: d)).fill()
  x += d + gap
}
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
