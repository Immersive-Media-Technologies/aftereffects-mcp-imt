#!/usr/bin/env osascript -l JavaScript
// On-screen After Effects windows with bounds in screen points (CGWindowList),
// plus the displays — to find which display holds AE and the pixel/point scale
// for screencapture crops. No Accessibility permission needed.
//   ae-windows.js            → windows
//   ae-windows.js displays   → displays (id, origin, size in points, scale)
ObjC.import("CoreGraphics");
ObjC.import("Foundation");
ObjC.import("AppKit");
function run(argv) {
  if (String(argv[0] || "") === "displays") {
    var scr = $.NSScreen.screens,
      out = [];
    for (var i = 0; i < scr.count; i++) {
      var s = scr.objectAtIndex(i),
        f = s.frame;
      out.push(
        "display " +
          (i + 1) +
          " origin " +
          Math.round(f.origin.x) +
          "," +
          Math.round(f.origin.y) +
          " size " +
          Math.round(f.size.width) +
          "x" +
          Math.round(f.size.height) +
          " points, scale " +
          s.backingScaleFactor,
      );
    }
    return out.join("\n");
  }
  var arr = ObjC.deepUnwrap(
    ObjC.castRefToObject(
      $.CGWindowListCopyWindowInfo(
        $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements,
        0,
      ),
    ),
  );
  var r = [];
  for (var j = 0; j < arr.length; j++) {
    var w = arr[j];
    if (String(w.kCGWindowOwnerName).indexOf("After Effects") < 0) continue;
    var b = w.kCGWindowBounds;
    r.push(
      "id " +
        w.kCGWindowNumber +
        " layer " +
        w.kCGWindowLayer +
        " " +
        Math.round(b.X) +
        "," +
        Math.round(b.Y) +
        " " +
        Math.round(b.Width) +
        "x" +
        Math.round(b.Height) +
        " name=" +
        (w.kCGWindowName || ""),
    );
  }
  return r.length
    ? r.join("\n")
    : "no on-screen AE windows (AE not running, hidden, or on another Space)";
}
