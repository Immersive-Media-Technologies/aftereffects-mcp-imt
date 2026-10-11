// Safety and verification atoms for an AUTONOMOUS agent (11.10.2026), drawn
// from the AE-agent landscape survey: checkpoints with revert (JUNKDOGE-JOE),
// comp fingerprints with diff (Engine-Room-Games snapshot.jsx), forced
// expression validation (JUNKDOGE validate_expressions), a project audit and
// incremental save (aedev-tools scripts). Ideas only — every line here is
// written against this registry's conventions (ES3 bodies, AE.* helpers,
// `{ ok, ... }` results).

import { jsxCompPreamble, jsxVal, registerOp } from "../registry.js";

// ── Checkpoints ───────────────────────────────────────────────────────────
//
// Undo covers one session; a crash, a relaunch, a project.open or a
// consolidate lose the stack. A checkpoint is a copy of the .aep next to the
// project (`<folder>/.ae-mcp-checkpoints/<project>/<id>.aep` — override with
// AE_MCP_CHECKPOINT_DIR), made after a save so it is a complete file.
// project.save() is called on the project's own path, never save(File): that
// would move the project. Revert closes, copies the checkpoint over the
// project file and reopens — outside the undo group like project.open.

const CHECKPOINT_DIR_JSX = `
    function _cpDir() {
        if (!app.project.file) return null;
        var _envDir = ${jsxVal(process.env.AE_MCP_CHECKPOINT_DIR?.trim() || null)};
        var _base = app.project.file.name.replace(/\\.aepx?$/i, "");
        var _root = _envDir ? new Folder(_envDir) : new Folder(app.project.file.parent.fsName + "/.ae-mcp-checkpoints");
        var _dir = new Folder(_root.fsName + "/" + _base);
        if (!_dir.exists) _dir.create();
        return _dir;
    }
    function _cp2(n) { return (n < 10 ? "0" : "") + n; }
    function _cpStamp() {
        var d = new Date();
        return d.getFullYear() + _cp2(d.getMonth() + 1) + _cp2(d.getDate()) + "-" + _cp2(d.getHours()) + _cp2(d.getMinutes()) + _cp2(d.getSeconds());
    }
    // ES3 has no Date.toISOString
    function _cpIso() {
        var d = new Date();
        return d.getUTCFullYear() + "-" + _cp2(d.getUTCMonth() + 1) + "-" + _cp2(d.getUTCDate()) + "T" + _cp2(d.getUTCHours()) + ":" + _cp2(d.getUTCMinutes()) + ":" + _cp2(d.getUTCSeconds()) + "Z";
    }
    function _cpReadMeta(f) {
        try { f.encoding = "UTF-8"; f.open("r"); var t = f.read(); f.close(); return JSON.parse(t); } catch (e) { return null; }
    }
    function _cpList(dir) {
        var out = [];
        var files = dir.getFiles("*.json");
        for (var i = 0; i < files.length; i++) {
            var m = _cpReadMeta(files[i]);
            if (m && m.id) { var aep = new File(dir.fsName + "/" + m.id + ".aep"); m.exists = aep.exists; m.bytes = aep.exists ? aep.length : 0; out.push(m); }
        }
        out.sort(function (a, b) { if (a.ts < b.ts) return -1; if (a.ts > b.ts) return 1; return 0; });
        return out;
    }
`;

registerOp({
  name: "project.checkpoint",
  category: "project",
  description:
    "Save the project and keep a copy of the .aep as a named checkpoint (next to the project in .ae-mcp-checkpoints/<project>/, or AE_MCP_CHECKPOINT_DIR). " +
    "Make one before a multi-step change you may want to throw away as a whole; project.revert brings it back even after a crash or relaunch, which undo cannot. Needs a saved project (a path).",
  params: [
    {
      name: "label",
      type: "string",
      description: "Short human label, e.g. 'before camera re-solve'",
      required: false,
    },
  ],
  // Saves the project file — not undoable; the copy is the whole point.
  undoGroup: () => false,
  toJsx(args) {
    return `
            ${CHECKPOINT_DIR_JSX}
            if (!app.project.file) return { ok: false, error: "project has no path — save it first (ae_save_project with a path)" };
            var _dir = _cpDir();
            app.project.save();
            var _id = _cpStamp();
            var _src = app.project.file;
            var _dst = new File(_dir.fsName + "/" + _id + ".aep");
            if (!_src.copy(_dst)) return { ok: false, error: "could not copy the project file to " + _dst.fsName };
            var _ai = app.project.activeItem;
            var _meta = { id: _id, label: ${jsxVal(args.label ?? null)} || "", ts: _cpIso(), project: _src.fsName.replace(/\\\\/g, "/"), activeComp: (_ai && _ai instanceof CompItem) ? _ai.name : null, time: (_ai && _ai instanceof CompItem) ? _ai.time : null, numItems: app.project.numItems };
            var _mf = new File(_dir.fsName + "/" + _id + ".json"); _mf.encoding = "UTF-8"; _mf.open("w"); _mf.write(JSON.stringify(_meta)); _mf.close();
            return { ok: true, id: _id, label: _meta.label, path: _dst.fsName.replace(/\\\\/g, "/"), bytes: _dst.length, checkpoints: _cpList(_dir).length };
        `;
  },
});

registerOp({
  name: "project.list_checkpoints",
  category: "project",
  readOnly: true,
  description:
    "List the checkpoints of the current project (id, label, time, active comp) — what project.revert can go back to.",
  params: [],
  toJsx() {
    return `
            ${CHECKPOINT_DIR_JSX}
            if (!app.project.file) return { ok: true, checkpoints: [], note: "project has no path — checkpoints live next to a saved project" };
            var _dir = _cpDir();
            return { ok: true, dir: _dir.fsName.replace(/\\\\/g, "/"), checkpoints: _cpList(_dir) };
        `;
  },
});

registerOp({
  name: "project.revert",
  category: "project",
  description:
    "Restore the project from a checkpoint (project.checkpoint): the current state is itself checkpointed first as 'before revert <id>' (keepCurrent, default true), the project is closed WITHOUT saving, the checkpoint copied over the project file and reopened. " +
    "Destructive to unsaved work; not undoable (the undo stack does not survive a reopen). Say which checkpoint you are reverting to.",
  params: [
    {
      name: "id",
      type: "string",
      description: "Checkpoint id from project.checkpoint / project.list_checkpoints",
      required: true,
    },
    {
      name: "keepCurrent",
      type: "boolean",
      description: "Checkpoint the current state before reverting (default true)",
      required: false,
    },
  ],
  // Project boundary — same class as project.open (see there).
  undoGroup: () => false,
  toJsx(args) {
    return `
            ${CHECKPOINT_DIR_JSX}
            if (!app.project.file) return { ok: false, error: "project has no path — nothing to revert" };
            var _dir = _cpDir();
            var _id = ${jsxVal(args.id)};
            var _cp = new File(_dir.fsName + "/" + _id + ".aep");
            if (!_cp.exists) return { ok: false, error: "no checkpoint '" + _id + "' under " + _dir.fsName + " (project.list_checkpoints)" };
            var _target = new File(app.project.file.fsName);
            var _kept = null;
            if (${jsxVal(args.keepCurrent !== false)}) {
                app.project.save();
                _kept = _cpStamp() + "-before-revert";
                if (!_target.copy(new File(_dir.fsName + "/" + _kept + ".aep"))) return { ok: false, error: "could not keep the current state before reverting" };
                var _mf = new File(_dir.fsName + "/" + _kept + ".json"); _mf.encoding = "UTF-8"; _mf.open("w");
                _mf.write(JSON.stringify({ id: _kept, label: "before revert to " + _id, ts: _cpIso(), project: _target.fsName.replace(/\\\\/g, "/") }));
                _mf.close();
            }
            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
            if (!_cp.copy(_target)) return { ok: false, error: "could not copy the checkpoint over " + _target.fsName + " — the project is closed; reopen it with project.open" };
            app.open(_target);
            var _m = _cpReadMeta(new File(_dir.fsName + "/" + _id + ".json"));
            if (_m && _m.activeComp) { try { var _c = AE.findCompByNameOrId(_m.activeComp); if (_c) { _c.openInViewer(); if (typeof _m.time === "number") _c.time = _m.time; } } catch (eV) {} }
            return { ok: true, reverted: _id, keptCurrentAs: _kept, file: app.project.file.fsName.replace(/\\\\/g, "/"), numItems: app.project.numItems };
        `;
  },
});

registerOp({
  name: "project.save_increment",
  category: "project",
  description:
    "Save As the next version of the project (name_v001.aep → name_v002.aep; a name without a version gets _v001) and continue working in the new file. The previous file is left untouched — use before restructuring an existing project.",
  params: [
    {
      name: "comment",
      type: "string",
      description:
        "Optional suffix after the version, e.g. 'camera-resolve' → name_v002_camera-resolve.aep",
      required: false,
    },
  ],
  undoGroup: () => false,
  toJsx(args) {
    return `
            if (!app.project.file) return { ok: false, error: "project has no path — save it first (ae_save_project with a path)" };
            var _f = app.project.file;
            var _name = _f.name.replace(/\\.aepx?$/i, "");
            var _ext = /\\.aepx$/i.test(_f.name) ? ".aepx" : ".aep";
            var _m = /^(.*?)_v(\\d+)(?:_.*)?$/.exec(_name);
            var _base = _m ? _m[1] : _name;
            var _n = _m ? parseInt(_m[2], 10) : 0;
            var _comment = ${jsxVal(args.comment ?? null)};
            var _next, _dst;
            do {
                _n++;
                var _v = String(_n); while (_v.length < 3) _v = "0" + _v;
                _next = _base + "_v" + _v + (_comment ? "_" + String(_comment).replace(/[^A-Za-z0-9._-]+/g, "-") : "") + _ext;
                _dst = new File(_f.parent.fsName + "/" + _next);
            } while (_dst.exists);
            app.project.save(_dst);
            return { ok: true, previous: _f.fsName.replace(/\\\\/g, "/"), file: app.project.file.fsName.replace(/\\\\/g, "/"), version: _n };
        `;
  },
});

// ── Comp fingerprint and diff ─────────────────────────────────────────────
//
// ae_comp_info is the full picture and costs accordingly. A snapshot is a
// per-layer fingerprint (what an edit usually changes) cheap enough to take
// before AND after a mutation; comp.diff says which layers changed and in
// what, so a write is verified in a few dozen tokens.

const SNAPSHOT_JSX = `
    function _fp(comp) {
        var layers = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var l = comp.layer(i);
            var keys = 0, exprs = 0, fx = [];
            try {
                var tr = l.property("ADBE Transform Group");
                if (tr) for (var t = 1; t <= tr.numProperties; t++) { var p = tr.property(t); if (p.propertyType === PropertyType.PROPERTY) { keys += p.numKeys || 0; if (p.canSetExpression && p.expressionEnabled) exprs++; } }
            } catch (eT) {}
            try { var eg = l.property("ADBE Effect Parade"); if (eg) for (var e = 1; e <= eg.numProperties; e++) fx.push(eg.property(e).matchName); } catch (eE) {}
            var tv = "";
            try { var tr2 = l.property("ADBE Transform Group"); tv = [AE.valueToJson(tr2.property("ADBE Position").value), AE.valueToJson(tr2.property("ADBE Scale").value), AE.valueToJson(tr2.property("ADBE Rotate Z").value), AE.valueToJson(tr2.property("ADBE Opacity").value)].join("|"); } catch (eV) {}
            var par = null; try { par = l.parent ? l.parent.index : null; } catch (eP) {}
            layers.push({ i: i, id: l.id, n: l.name, src: AE.safeGet(function () { return l.source ? l.source.id : null; }, null), in_: Math.round(l.inPoint * 1000) / 1000, out: Math.round(l.outPoint * 1000) / 1000, st: Math.round(l.startTime * 1000) / 1000, par: par, en: l.enabled, d3: AE.safeGet(function () { return l.threeDLayer; }, false), keys: keys, exprs: exprs, fx: fx, tv: tv });
        }
        var s = "";
        for (var k = 0; k < layers.length; k++) { var L = layers[k]; s += L.id + ":" + L.n + ":" + L.src + ":" + L.in_ + ":" + L.out + ":" + L.st + ":" + L.par + ":" + L.en + ":" + L.d3 + ":" + L.keys + ":" + L.exprs + ":" + L.fx.join(",") + ":" + L.tv + ";"; }
        var h = 0; for (var c = 0; c < s.length; c++) { h = ((h << 5) - h + s.charCodeAt(c)) | 0; }
        return { comp: comp.name, id: comp.id, w: comp.width, h: comp.height, fps: comp.frameRate, dur: comp.duration, time: comp.time, numLayers: comp.numLayers, hash: (h >>> 0).toString(16), layers: layers };
    }
`;

registerOp({
  name: "comp.snapshot",
  category: "comp",
  readOnly: true,
  description:
    "Cheap fingerprint of a comp: per layer id, name, source, in/out/start, parent, enabled, 3D, transform key count, expressions, effect matchNames, transform values at the current time; plus one hash. " +
    "Take one before a mutation and compare with comp.diff after it (pass the snapshot back) — verification in tens of tokens instead of ae_comp_info.",
  params: [{ name: "comp", type: "any", description: "Comp name or id", required: true }],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            ${SNAPSHOT_JSX}
            var _s = _fp(_comp);
            _s.ok = true;
            return _s;
        `;
  },
});

registerOp({
  name: "comp.diff",
  category: "comp",
  readOnly: true,
  description:
    "Compare a comp with an earlier comp.snapshot: layers added / removed (by layer id), changed (which fields: name, source, in/out/start, parent, enabled, 3D, keys, exprs, fx, transform values), and whether the hash moved. Pass the snapshot object (or just its hash for a yes/no).",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "snapshot",
      type: "any",
      description: "The object returned by comp.snapshot, or { hash } only",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            ${SNAPSHOT_JSX}
            var _prev = ${jsxVal(args.snapshot)};
            var _now = _fp(_comp);
            var _same = _prev && _prev.hash === _now.hash;
            if (!_prev || !(_prev.layers instanceof Array)) return { ok: true, changed: !_same, hash: _now.hash, previousHash: _prev ? _prev.hash : null, note: "hash-only comparison — pass the full snapshot for per-layer detail" };
            var _byId = {}; for (var i = 0; i < _prev.layers.length; i++) _byId[_prev.layers[i].id] = _prev.layers[i];
            var _seen = {}, added = [], removed = [], changed = [];
            var _fields = ["n", "src", "in_", "out", "st", "par", "en", "d3", "keys", "exprs", "tv"];
            // lookup table, not a chained ?: — ExtendScript misparses nested ternaries (live 11.10: "in_" and "st" came out as "3D")
            var _label = { n: "name", src: "source", in_: "in", out: "out", st: "startTime", par: "parent", en: "enabled", d3: "3D", keys: "keys", exprs: "exprs", tv: "transform" };
            for (var j = 0; j < _now.layers.length; j++) {
                var L = _now.layers[j]; _seen[L.id] = true; var P = _byId[L.id];
                if (!P) { added.push({ index: L.i, name: L.n }); continue; }
                var diff = [];
                for (var f = 0; f < _fields.length; f++) { var k = _fields[f]; if (String(P[k]) !== String(L[k])) diff.push(_label[k]); }
                if (String(P.fx) !== String(L.fx)) diff.push("effects");
                if (P.i !== L.i) diff.push("index");
                if (diff.length) changed.push({ index: L.i, name: L.n, fields: diff });
            }
            for (var id in _byId) if (_byId.hasOwnProperty(id) && !_seen[id]) removed.push({ index: _byId[id].i, name: _byId[id].n });
            return { ok: true, changed: !_same || added.length > 0 || removed.length > 0 || changed.length > 0, hash: _now.hash, previousHash: _prev.hash, added: added, removed: removed, changedLayers: changed, numLayers: _now.numLayers };
        `;
  },
});

// ── Expression validation and project audit ───────────────────────────────

const WALK_EXPR_JSX = `
    function _walkExpr(node, path, out, layerName, times) {
        if (node.propertyType === PropertyType.PROPERTY) {
            if (node.canSetExpression && node.expressionEnabled) {
                var err = null;
                try { for (var t = 0; t < times.length; t++) node.valueAtTime(times[t], false); } catch (eF) {}
                try { err = node.expressionError || null; } catch (eE) { err = AE.errText(eE); }
                out.push({ layer: layerName, path: path.join(" > "), matchName: node.matchName, ok: !err, error: err, expression: err ? String(node.expression).substring(0, 200) : undefined });
            }
            return;
        }
        for (var i = 1; i <= node.numProperties; i++) {
            var ch = node.property(i); if (!ch) continue;
            _walkExpr(ch, path.concat([ch.name]), out, layerName, times);
        }
    }
`;

registerOp({
  name: "expression.validate",
  category: "expression",
  readOnly: true,
  description:
    "Force-evaluate every enabled expression in a comp (or one layer) at a few times and report the ones with errors (layer, property path, error text, the expression's first 200 chars). AE only reports an expression error once it is evaluated — this makes sure every one is, before the user hits play or a render fails.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "Restrict to one layer (index or name)",
      required: false,
    },
    {
      name: "sampleTimes",
      type: "array",
      description: "Times in seconds (default: start, middle, end)",
      required: false,
    },
    {
      name: "includeOk",
      type: "boolean",
      description: "Also list the expressions that evaluate fine (default false)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            ${WALK_EXPR_JSX}
            var _times = ${jsxVal(args.sampleTimes ?? null)};
            if (_times === null) _times = [0, _comp.duration / 2, Math.max(0, _comp.duration - _comp.frameDuration)];
            var _only = ${jsxVal(args.layer ?? null)};
            var _out = [];
            for (var i = 1; i <= _comp.numLayers; i++) {
                var _l = _comp.layer(i);
                if (_only !== null && _l.index !== _only && _l.name !== _only) continue;
                _walkExpr(_l, [], _out, _l.name, _times);
            }
            var _bad = [], _okN = 0;
            for (var k = 0; k < _out.length; k++) { if (_out[k].ok) _okN++; else _bad.push(_out[k]); }
            return { ok: true, comp: _comp.name, expressions: _out.length, errors: _bad.length, failing: _bad, passing: ${jsxVal(!!args.includeOk)} ? _out : undefined };
        `;
  },
});

registerOp({
  name: "project.audit",
  category: "project",
  readOnly: true,
  description:
    "Health check of the whole project in one call: missing footage, missing/substituted fonts (AE 24+), expression errors (force-evaluated in every comp), unused footage, empty comps, empty folders, duplicate solids — each with a severity. The first step of a session on a project you did not build.",
  params: [
    {
      name: "maxExpressionErrors",
      type: "number",
      description: "Cap on listed expression errors (default 50)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${WALK_EXPR_JSX}
            var _cap = ${jsxVal(args.maxExpressionErrors ?? 50)};
            var missing = [], unusedFootage = [], emptyComps = [], emptyFolders = [], solids = {}, dupSolids = [], exprErrors = [], exprCount = 0, compCount = 0;
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (it instanceof FolderItem) { if (it.numItems === 0) emptyFolders.push({ id: it.id, name: it.name }); continue; }
                if (it instanceof FootageItem) {
                    if (it.footageMissing) missing.push({ id: it.id, name: it.name, path: AE.safeGet(function () { return it.missingFootagePath || (it.file ? it.file.fsName : null); }, null) });
                    if (it.usedIn.length === 0) unusedFootage.push({ id: it.id, name: it.name });
                    if (it.mainSource instanceof SolidSource) { var key = it.width + "x" + it.height + ":" + it.mainSource.color.join(","); if (solids[key]) { dupSolids.push({ id: it.id, name: it.name, sameAs: solids[key] }); } else { solids[key] = it.name; } }
                    continue;
                }
                if (it instanceof CompItem) {
                    compCount++;
                    if (it.numLayers === 0) emptyComps.push({ id: it.id, name: it.name });
                    var times = [0, it.duration / 2, Math.max(0, it.duration - it.frameDuration)];
                    for (var L = 1; L <= it.numLayers; L++) {
                        var out = []; _walkExpr(it.layer(L), [], out, it.name + " / " + it.layer(L).name, times);
                        for (var k = 0; k < out.length; k++) { exprCount++; if (!out[k].ok && exprErrors.length < _cap) exprErrors.push(out[k]); }
                    }
                }
            }
            var fonts = [];
            try { if (app.fonts && app.fonts.missingOrSubstitutedFonts) { var mf = app.fonts.missingOrSubstitutedFonts; for (var f = 0; f < mf.length; f++) fonts.push({ postScriptName: mf[f].postScriptName, family: mf[f].familyName, style: mf[f].styleName }); } } catch (eF) {}
            var findings = [];
            if (missing.length) findings.push({ severity: "error", kind: "missing_footage", count: missing.length, items: missing });
            if (exprErrors.length) findings.push({ severity: "error", kind: "expression_errors", count: exprErrors.length, items: exprErrors });
            if (fonts.length) findings.push({ severity: "warning", kind: "missing_fonts", count: fonts.length, items: fonts });
            if (dupSolids.length) findings.push({ severity: "info", kind: "duplicate_solids", count: dupSolids.length, items: dupSolids });
            if (unusedFootage.length) findings.push({ severity: "info", kind: "unused_footage", count: unusedFootage.length, items: unusedFootage });
            if (emptyComps.length) findings.push({ severity: "info", kind: "empty_comps", count: emptyComps.length, items: emptyComps });
            if (emptyFolders.length) findings.push({ severity: "info", kind: "empty_folders", count: emptyFolders.length, items: emptyFolders });
            return { ok: true, project: app.project.file ? app.project.file.fsName.replace(/\\\\/g, "/") : null, items: app.project.numItems, comps: compCount, expressions: exprCount, findings: findings, clean: findings.length === 0 };
        `;
  },
});

// ── Small layout / timing atoms (aedev-tools, yumehiko — rewritten) ───────

registerOp({
  name: "layer.stagger",
  category: "layer",
  description:
    "Offset a set of layers in time one after another (the Quick Offset idea): each next layer starts `offset` seconds (or frames) later than the previous. mode 'start' moves the whole layer, 'in' moves only the in-point.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layers",
      type: "array",
      description: "Layer indices or names, in the order to stagger (first stays put)",
      required: true,
    },
    {
      name: "offset",
      type: "number",
      description: "Offset between consecutive layers",
      required: true,
    },
    {
      name: "unit",
      type: "string",
      description: "'seconds' (default) or 'frames'",
      required: false,
    },
    {
      name: "mode",
      type: "string",
      description: "'start' (default, shift the layer) or 'in' (trim the in-point)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _targets = ${jsxVal(args.layers)};
            var _off = ${jsxVal(args.offset)}; if (${jsxVal(args.unit ?? "seconds")} === "frames") _off = _off * _comp.frameDuration;
            var _mode = ${jsxVal(args.mode ?? "start")};
            var _first = null, _done = [];
            for (var i = 0; i < _targets.length; i++) {
                var _l = AE.findLayerInComp(_comp, _targets[i]);
                if (!_l) return { ok: false, error: "layer not found: " + _targets[i], done: _done };
                if (_first === null) { _first = _mode === "in" ? _l.inPoint : _l.startTime; _done.push({ index: _l.index, name: _l.name, at: _first }); continue; }
                var _at = _first + _off * i;
                if (_mode === "in") { _l.inPoint = _at; } else { _l.startTime = _at; }
                _done.push({ index: _l.index, name: _l.name, at: _at });
            }
            return { ok: true, offset: _off, mode: _mode, layers: _done };
        `;
  },
});

registerOp({
  name: "layer.fit_to_comp",
  category: "layer",
  description:
    "Scale a layer to the comp: 'fit' (whole layer visible, keeps aspect), 'fill' (covers the comp, keeps aspect), 'width', 'height', or 'stretch' (both axes, distorts). Centres the layer unless center=false.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "layer", type: "any", description: "Layer index or name", required: true },
    {
      name: "mode",
      type: "string",
      description: "fit | fill | width | height | stretch (default fit)",
      required: false,
    },
    {
      name: "center",
      type: "boolean",
      description: "Also move the layer to the comp centre (default true)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _l = AE.findLayerInComp(_comp, ${jsxVal(args.layer)});
            if (!_l) return { ok: false, error: "layer not found: " + ${jsxVal(args.layer)} };
            var _w = AE.safeGet(function () { return _l.source.width; }, _l.width), _h = AE.safeGet(function () { return _l.source.height; }, _l.height);
            if (!_w || !_h) { var _r = _l.sourceRectAtTime(_comp.time, false); _w = _r.width; _h = _r.height; }
            if (!_w || !_h) return { ok: false, error: "layer has no measurable size" };
            var _sx = _comp.width / _w * 100, _sy = _comp.height / _h * 100, _mode = ${jsxVal(args.mode ?? "fit")}, _s;
            if (_mode === "fit") _s = [Math.min(_sx, _sy), Math.min(_sx, _sy)];
            else if (_mode === "fill") _s = [Math.max(_sx, _sy), Math.max(_sx, _sy)];
            else if (_mode === "width") _s = [_sx, _sx];
            else if (_mode === "height") _s = [_sy, _sy];
            else if (_mode === "stretch") _s = [_sx, _sy];
            else return { ok: false, error: "unknown mode '" + _mode + "'" };
            var _sc = _l.property("ADBE Transform Group").property("ADBE Scale");
            var _cur = _sc.value; if (_cur.length === 3) _s.push(_cur[2]);
            _sc.setValue(_s);
            if (${jsxVal(args.center !== false)}) { var _p = _l.property("ADBE Transform Group").property("ADBE Position"); var _pv = _p.value; var _np = [_comp.width / 2, _comp.height / 2]; if (_pv.length === 3) _np.push(_pv[2]); _p.setValue(_np); }
            return { ok: true, layer: _l.name, mode: _mode, scale: _s };
        `;
  },
});

registerOp({
  name: "layer.align",
  category: "layer",
  description:
    "Align layers to the comp, to its action/title-safe area, or to the first layer of the set, by their bounds at the current time: horizontal left|center|right, vertical top|middle|bottom. One undo group for the set.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "layers", type: "array", description: "Layer indices or names", required: true },
    {
      name: "horizontal",
      type: "string",
      description: "left | center | right (omit to leave x)",
      required: false,
    },
    {
      name: "vertical",
      type: "string",
      description: "top | middle | bottom (omit to leave y)",
      required: false,
    },
    {
      name: "reference",
      type: "string",
      description:
        "comp (default) | action-safe (90 %) | title-safe (80 %) | first (the first layer's bounds)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _targets = ${jsxVal(args.layers)}, _h = ${jsxVal(args.horizontal ?? null)}, _v = ${jsxVal(args.vertical ?? null)}, _ref = ${jsxVal(args.reference ?? "comp")};
            function _bounds(l) { var r = l.sourceRectAtTime(_comp.time, false); var p = l.property("ADBE Transform Group").property("ADBE Position").value, a = l.property("ADBE Transform Group").property("ADBE Anchor Point").value, s = l.property("ADBE Transform Group").property("ADBE Scale").value; var sx = s[0] / 100, sy = s[1] / 100; var left = p[0] + (r.left - a[0]) * sx, top = p[1] + (r.top - a[1]) * sy; return { left: left, top: top, right: left + r.width * sx, bottom: top + r.height * sy, p: p }; }
            var _ls = [];
            for (var i = 0; i < _targets.length; i++) { var _l = AE.findLayerInComp(_comp, _targets[i]); if (!_l) return { ok: false, error: "layer not found: " + _targets[i] }; _ls.push(_l); }
            if (!_ls.length) return { ok: false, error: "no layers" };
            var R;
            if (_ref === "first") { var b0 = _bounds(_ls[0]); R = { left: b0.left, top: b0.top, right: b0.right, bottom: b0.bottom }; }
            else { var m = 0; if (_ref === "action-safe") m = 0.05; else if (_ref === "title-safe") m = 0.1; R = { left: _comp.width * m, top: _comp.height * m, right: _comp.width * (1 - m), bottom: _comp.height * (1 - m) }; }
            var _done = [];
            for (var j = (_ref === "first" ? 1 : 0); j < _ls.length; j++) {
                var l = _ls[j], b = _bounds(l), dx = 0, dy = 0;
                if (_h === "left") dx = R.left - b.left; else if (_h === "right") dx = R.right - b.right; else if (_h === "center") dx = (R.left + R.right) / 2 - (b.left + b.right) / 2;
                if (_v === "top") dy = R.top - b.top; else if (_v === "bottom") dy = R.bottom - b.bottom; else if (_v === "middle") dy = (R.top + R.bottom) / 2 - (b.top + b.bottom) / 2;
                var pp = l.property("ADBE Transform Group").property("ADBE Position"); var pv = pp.value; var nv = [pv[0] + dx, pv[1] + dy]; if (pv.length === 3) nv.push(pv[2]); pp.setValue(nv);
                _done.push({ index: l.index, name: l.name, dx: dx, dy: dy });
            }
            return { ok: true, reference: _ref, layers: _done };
        `;
  },
});

registerOp({
  name: "comp.trim_to_content",
  category: "comp",
  description:
    "Set the comp's duration (and work area) to the span its layers actually occupy — earliest in-point to latest out-point — so renders and precomps stop carrying empty tail.",
  params: [{ name: "comp", type: "any", description: "Comp name or id", required: true }],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            if (_comp.numLayers === 0) return { ok: false, error: "comp has no layers" };
            var _in = Infinity, _out = 0;
            for (var i = 1; i <= _comp.numLayers; i++) { var l = _comp.layer(i); if (l.inPoint < _in) _in = l.inPoint; if (l.outPoint > _out) _out = l.outPoint; }
            if (_in > 0) { for (var j = 1; j <= _comp.numLayers; j++) _comp.layer(j).startTime -= _in; _out -= _in; }
            _comp.duration = Math.max(_comp.frameDuration, _out);
            _comp.workAreaStart = 0; _comp.workAreaDuration = _comp.duration;
            return { ok: true, comp: _comp.name, shiftedBy: _in > 0 ? _in : 0, duration: _comp.duration };
        `;
  },
});
