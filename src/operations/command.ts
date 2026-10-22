// Menu command operations — execute AE menu commands by ID.
// Reference: https://hyperbrew.co/blog/2025-after-effects-command-ids/

import { registerOp, jsxVal } from "../registry.js";

/** Menu command IDs for Undo and Redo — the two that drive the undo stack. */
export const UNDO_COMMAND_ID = 16;
export const REDO_COMMAND_ID = 2035;

/** True when this menu command is Undo or Redo (see Operation.undoGroup). */
export function isUndoRedoCommandId(id: unknown): boolean {
  return id === UNDO_COMMAND_ID || id === REDO_COMMAND_ID;
}

registerOp({
  name: "command.execute",
  category: "command",
  description:
    "Execute an AE menu command by its numeric ID. Use command.list to discover common IDs. " +
    "Undo (16) and Redo (2035) run outside this call's undo group, so they revert/replay the PREVIOUS call.",
  params: [{ name: "id", type: "number", description: "Menu command ID", required: true }],
  // Undo/Redo must not be executed inside an open undo group — AE applies them
  // to that group and the requested step survives. Everything else groups
  // normally, so one Ctrl+Z still reverts one call.
  undoGroup: (args) => !isUndoRedoCommandId(args.id),
  // Same pair: dialog suppression opens an undo-transaction-like scope that
  // Undo/Redo would resolve against, so they skip it too.
  suppressDialogs: (args) => !isUndoRedoCommandId(args.id),
  toJsx(args) {
    return `
            app.executeCommand(${jsxVal(args.id)});
            return { ok: true, commandId: ${jsxVal(args.id)} };
        `;
  },
});

registerOp({
  name: "command.find",
  category: "command",
  readOnly: true,
  description:
    "Find a menu command ID by its menu label (AE's app.findMenuCommandId). The label must be the one THIS After Effects shows — a localized AE needs the localized label («Сбор файлов…», not «Collect Files...»); the trailing ellipsis is tried both as «...» and «…». Command IDs themselves are language-independent: check command.list first, then command.execute {id}.",
  params: [
    {
      name: "name",
      type: "string",
      description: "Menu command label as shown in this AE's UI language",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            var _name = ${jsxVal(args.name)};
            var _base = String(_name).replace(/(\\.\\.\\.|\\u2026)\\s*$/, "");
            var _tries = [_name, _base + "...", _base + "\\u2026", _base];
            var _id = 0, _hit = _name;
            for (var _i = 0; _i < _tries.length && !_id; _i++) {
                try { _id = app.findMenuCommandId(_tries[_i]); } catch (eF) { _id = 0; }
                if (_id) _hit = _tries[_i];
            }
            if (!_id || _id === 0) return { ok: false, error: "command not found: " + _name + " — the label must match this AE's UI language exactly (localized AE: localized label, e.g. \u00ab\u0421\u0431\u043e\u0440 \u0444\u0430\u0439\u043b\u043e\u0432\u2026\u00bb); known language-independent ids: command.list" };
            return { ok: true, name: _hit, commandId: _id };
        `;
  },
});

registerOp({
  name: "command.list",
  category: "command",
  readOnly: true,
  description:
    "Return a curated list of commonly-used menu command IDs (language-independent — use them with command.execute on a localized AE instead of command.find).",
  params: [],
  toJsx() {
    return `
            return { ok: true, commands: [
                { id: 16, name: "Undo" },
                { id: 2482, name: "Collect Files... (File > Dependencies; opens the dialog — drive it with the UI scripts of the AE skill)" },
                { id: 2004, name: "New Composition" },
                { id: 2005, name: "New Folder" },
                { id: 2019, name: "New Solid" },
                { id: 2025, name: "New Adjustment Layer" },
                { id: 2028, name: "New Null Object" },
                { id: 2030, name: "New Camera" },
                { id: 2031, name: "New Light" },
                { id: 2035, name: "Redo" },
                { id: 2040, name: "Deselect All" },
                { id: 2055, name: "Purge Image Caches" },
                { id: 2071, name: "Pre-compose" },
                { id: 2072, name: "Move All Attributes" },
                { id: 2078, name: "Trim Comp to Work Area" },
                { id: 2156, name: "Fit to Comp" },
                { id: 2157, name: "Fit to Comp Width" },
                { id: 2158, name: "Fit to Comp Height" },
                { id: 2243, name: "Convert Audio to Keyframes" },
                { id: 2349, name: "Convert to Bezier Path" },
                { id: 2371, name: "Time-Reverse Keyframes" },
                { id: 2450, name: "Fit to Screen" },
                { id: 2501, name: "Snap to Grid" },
                { id: 2691, name: "Render Queue" },
                { id: 2732, name: "Convert Expression to Keyframes" },
                { id: 3101, name: "Purge All Memory & Disk Cache" },
                { id: 10312, name: "Align Layers to Composition" }
            ] };
        `;
  },
});
