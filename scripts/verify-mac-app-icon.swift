// Check the OS-rendered icon, not just the source PNG: macOS can add a bevel
// to otherwise flat legacy artwork. Keep the logo's interior uniformly white.
import AppKit

guard CommandLine.arguments.count == 2,
      FileManager.default.fileExists(atPath: CommandLine.arguments[1] + "/Contents/Info.plist") else {
    fputs("Usage: swift verify-mac-app-icon.swift /path/to/OfficeDex.app\n", stderr)
    exit(2)
}

let image = NSWorkspace.shared.icon(forFile: CommandLine.arguments[1])
let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: 256, pixelsHigh: 256,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
    isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
image.draw(in: NSRect(x: 0, y: 0, width: 256, height: 256),
           from: .zero, operation: .copy, fraction: 1)
NSGraphicsContext.restoreGraphicsState()

// These points sit well inside the white document, away from its eyes/edges.
for (x, y) in [(90, 85), (140, 90), (90, 170), (145, 175)] {
    guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
          color.alphaComponent >= 0.99,
          min(color.redComponent, color.greenComponent, color.blueComponent) >= 0.97 else {
        fputs("App icon is not flat white at (\(x), \(y)); inspect its system preview before release.\n", stderr)
        exit(1)
    }
}
print("Verified flat white foreground in the macOS-rendered app icon.")
