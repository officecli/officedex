// Render the system-resolved app icon, including macOS's automatic treatment.
// Looking at the PNG or extracting the ICNS alone does not exercise that path.
import AppKit

guard CommandLine.arguments.count == 3,
      FileManager.default.fileExists(atPath: CommandLine.arguments[1] + "/Contents/Info.plist") else {
    fputs("Usage: swift scripts/preview-mac-app-icon.swift /path/to/OfficeDex.app /tmp/icon.png\n", stderr)
    exit(1)
}

let icon = NSWorkspace.shared.icon(forFile: CommandLine.arguments[1])
let size = 256
let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
    isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
icon.draw(in: NSRect(x: 0, y: 0, width: size, height: size),
          from: .zero, operation: .copy, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(
    to: URL(fileURLWithPath: CommandLine.arguments[2])
)
