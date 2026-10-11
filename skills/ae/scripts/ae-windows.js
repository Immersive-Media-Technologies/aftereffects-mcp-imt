#!/usr/bin/env osascript -l JavaScript
// On-screen After Effects windows with bounds in screen points (CGWindowList),
// plus the displays — to find which display holds AE and the pixel/point scale
// for screencapture crops. No Accessibility permission needed.
//   ae-windows.js            → windows (+ frontmost app, Stage Manager warning)
//   ae-windows.js displays   → displays (id, origin, size in points, scale)
// macOS Stage Manager: an app that is not frontmost sits in the strip on the
// left as a ~150 px thumbnail — its "window" bounds are the thumbnail's, and a
// click there switches apps instead of pressing a button (seen 11.10.2026 with
// AE and another app). Bring AE to the front first: ae-dialogs.sh front.
ObjC.import('CoreGraphics'); ObjC.import('Foundation'); ObjC.import('AppKit');
function run(argv) {
  if (String(argv[0] || '') === 'displays') {
    var scr = $.NSScreen.screens, out = [];
    for (var i = 0; i < scr.count; i++) {
      var s = scr.objectAtIndex(i), f = s.frame;
      out.push('display ' + (i + 1) + ' origin ' + Math.round(f.origin.x) + ',' + Math.round(f.origin.y) + ' size ' + Math.round(f.size.width) + 'x' + Math.round(f.size.height) + ' points, scale ' + s.backingScaleFactor);
    }
    return out.join('\n');
  }
  var arr = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
  var strip = [], ae = [];
  for (var j = 0; j < arr.length; j++) {
    var w = arr[j], b = w.kCGWindowBounds;
    if (String(w.kCGWindowOwnerName) === 'WindowManager' && String(w.kCGWindowName || '') === 'Gesture Blocking Overlay') strip.push(b);
    if (String(w.kCGWindowOwnerName).indexOf('After Effects') >= 0) ae.push(w);
  }
  function inStrip(b) {
    for (var k = 0; k < strip.length; k++) {
      var s = strip[k];
      if (b.X < s.X + s.Width && b.X + b.Width > s.X && b.Y < s.Y + s.Height && b.Y + b.Height > s.Y) return true;
    }
    return false;
  }
  var front = '';
  try { front = ObjC.unwrap($.NSWorkspace.sharedWorkspace.frontmostApplication.localizedName); } catch (e) {}
  var r = ['frontmost app: ' + front];
  var thumb = false;
  for (var n = 0; n < ae.length; n++) {
    var a = ae[n], ab = a.kCGWindowBounds;
    var t = inStrip(ab) || (ab.Width < 300 && ab.Height < 300 && strip.length > 0);
    if (t) thumb = true;
    r.push('id ' + a.kCGWindowNumber + ' layer ' + a.kCGWindowLayer + ' ' + Math.round(ab.X) + ',' + Math.round(ab.Y) + ' ' + Math.round(ab.Width) + 'x' + Math.round(ab.Height) + ' name=' + (a.kCGWindowName || '') + (t ? '  [STAGE MANAGER THUMBNAIL]' : ''));
  }
  if (!ae.length) r.push('no on-screen AE windows (AE not running, hidden, or on another Space)');
  if (thumb) r.push('WARNING: After Effects is a Stage Manager thumbnail — these are not its real bounds. Run ae-dialogs.sh front, then ae-windows.js again before any click.');
  return r.join('\n');
}
