#!/usr/bin/env osascript -l JavaScript
// Real mouse events for After Effects UI steps that ExtendScript cannot do
// (3D Camera Tracker «Create Camera», ground-plane points, plugin buttons).
// CGEventPost at kCGHIDEventTap — a *hardware-level* click. System Events
// «click at» / «click UI element» raised «internal verification failure
// {no current context}» and then the fatal dialog in AE 26.5 (live 11.10.2026).
//
//   ae-click.js move  X Y
//   ae-click.js click X Y [shift]
//   ae-click.js dblclick X Y
//   ae-click.js rclick X Y
//   ae-click.js drag  X1 Y1 X2 Y2
//
// X Y are screen POINTS of display 1 (origin top-left). On a 4K display at
// 1:1 points == pixels of `screencapture -D 1`; on a Retina display divide
// pixel coordinates by the backing scale (compare the screenshot width with
// the display width from ae-windows.js). Never post a click outside AE's
// window: a stray click opens a menu and DoScript then times out (-1712)
// until Escape.
ObjC.import("CoreGraphics");
function ev(type, x, y, btn, flags) {
  var e = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), btn);
  if (flags) $.CGEventSetFlags(e, flags);
  $.CGEventPost($.kCGHIDEventTap, e);
}
function run(argv) {
  var cmd = String(argv[0] || ""),
    a = argv.slice(1).map(parseFloat);
  var x = a[0],
    y = a[1],
    L = $.kCGMouseButtonLeft,
    R = $.kCGMouseButtonRight;
  var shift = argv.indexOf("shift") >= 0 ? $.kCGEventFlagMaskShift : 0;
  if (cmd === "move") {
    ev($.kCGEventMouseMoved, x, y, L);
    return "moved " + x + "," + y;
  }
  if (cmd === "click" || cmd === "dblclick") {
    ev($.kCGEventMouseMoved, x, y, L);
    delay(0.5);
    var n = cmd === "dblclick" ? 2 : 1;
    for (var i = 0; i < n; i++) {
      var d = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, $.CGPointMake(x, y), L);
      var u = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, $.CGPointMake(x, y), L);
      if (n === 2) {
        $.CGEventSetIntegerValueField(d, $.kCGMouseEventClickState, i + 1);
        $.CGEventSetIntegerValueField(u, $.kCGMouseEventClickState, i + 1);
      }
      if (shift) {
        $.CGEventSetFlags(d, shift);
        $.CGEventSetFlags(u, shift);
      }
      $.CGEventPost($.kCGHIDEventTap, d);
      delay(0.08);
      $.CGEventPost($.kCGHIDEventTap, u);
      delay(0.1);
    }
    return cmd + " " + x + "," + y + (shift ? " +shift" : "");
  }
  if (cmd === "rclick") {
    ev($.kCGEventMouseMoved, x, y, R);
    delay(0.5);
    ev($.kCGEventRightMouseDown, x, y, R);
    delay(0.1);
    ev($.kCGEventRightMouseUp, x, y, R);
    return "right-clicked " + x + "," + y;
  }
  if (cmd === "drag") {
    var x2 = a[2],
      y2 = a[3];
    ev($.kCGEventMouseMoved, x, y, L);
    delay(0.3);
    ev($.kCGEventLeftMouseDown, x, y, L);
    delay(0.15);
    for (var k = 1; k <= 20; k++) {
      ev($.kCGEventLeftMouseDragged, x + ((x2 - x) * k) / 20, y + ((y2 - y) * k) / 20, L);
      delay(0.03);
    }
    delay(0.2);
    ev($.kCGEventLeftMouseUp, x2, y2, L);
    return "dragged " + x + "," + y + " -> " + x2 + "," + y2;
  }
  return "usage: ae-click.js move|click|dblclick|rclick X Y [shift] | drag X1 Y1 X2 Y2";
}
