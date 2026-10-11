// 11.10.2026 — safety and verification atoms for an autonomous agent:
// checkpoints with revert, atomic batch.run, comp snapshot/diff, expression
// validation, project audit, the project lock, frame compare, small layout
// atoms. Codegen and Node-side logic only; AE acceptance is e2e.

import { afterEach, describe, expect, it } from "vitest";

import { denyOperation, projectLockGuardJsx, projectLockPath } from "../src/policy.js";
import { getOp, wantsUndoGroup } from "../src/registry.js";
import { compareFrames } from "../src/tools/render-frame.js";
import "../src/operations/index.js";

afterEach(() => {
  delete process.env.AE_MCP_PROJECT_LOCK;
  delete process.env.AE_MCP_READONLY;
});

describe("checkpoints", () => {
  it("checkpoint saves on the project's own path, copies the file and writes meta", () => {
    const jsx = getOp("project.checkpoint")!.toJsx({ label: "before re-solve" });
    expect(jsx).toContain("app.project.save();");
    expect(jsx).not.toContain("app.project.save(_");
    expect(jsx).toContain("_src.copy(_dst)");
    expect(jsx).toContain('"before re-solve"');
    expect(wantsUndoGroup(getOp("project.checkpoint")!, {})).toBe(false);
  });

  it("revert keeps the current state by default, closes without saving, copies and reopens", () => {
    const op = getOp("project.revert")!;
    const jsx = op.toJsx({ id: "20261011-093000" });
    expect(jsx).toContain("CloseOptions.DO_NOT_SAVE_CHANGES");
    expect(jsx).toContain("_cp.copy(_target)");
    expect(jsx).toContain("app.open(_target)");
    expect(jsx).toContain("-before-revert");
    expect(wantsUndoGroup(op, { id: "x" })).toBe(false);
    const noKeep = op.toJsx({ id: "x", keepCurrent: false });
    expect(noKeep).toContain("if (false)");
  });

  it("list_checkpoints is read-only", () => {
    const op = getOp("project.list_checkpoints")!;
    expect(op.readOnly).toBe(true);
    process.env.AE_MCP_READONLY = "1";
    expect(denyOperation(op)).toBeNull();
  });

  it("save_increment computes the next _vNNN name and never overwrites", () => {
    const jsx = getOp("project.save_increment")!.toJsx({ comment: "camera resolve" });
    expect(jsx).toContain("while (_dst.exists)");
    expect(jsx).toContain('"camera resolve"');
    expect(jsx).toContain("app.project.save(_dst)");
  });
});

describe("batch.run atomic", () => {
  it("runs its own undo group with a marker folder and undoes on failure", () => {
    const op = getOp("batch.run")!;
    const args = {
      ops: [{ operation: "layer.create_null", args: { comp: "Main" } }],
      atomic: true,
    };
    expect(wantsUndoGroup(op, args)).toBe(false);
    const jsx = op.toJsx(args);
    expect(jsx).toContain('app.beginUndoGroup("batch.run (atomic)")');
    expect(jsx).toContain("__ae_mcp_atomic_");
    expect(jsx).toContain("app.executeCommand(16)");
    expect(jsx).toContain("rollback: { performed: _undone, verified: _verified }");
    // atomic implies stopOnError
    expect(jsx).toContain("_stopped = true;");
  });

  it("stays inside the dispatcher's group when not atomic", () => {
    const op = getOp("batch.run")!;
    const args = { ops: [{ operation: "layer.create_null", args: { comp: "Main" } }] };
    expect(wantsUndoGroup(op, args)).toBe(true);
    expect(op.toJsx(args)).not.toContain("__ae_mcp_atomic_");
  });
});

describe("comp.snapshot / comp.diff", () => {
  it("snapshot is read-only and fingerprints transform, keys, effects", () => {
    const op = getOp("comp.snapshot")!;
    expect(op.readOnly).toBe(true);
    const jsx = op.toJsx({ comp: "Main" });
    expect(jsx).toContain("ADBE Effect Parade");
    expect(jsx).toContain("hash:");
  });

  it("diff compares by layer id and reports changed fields; hash-only when no layers given", () => {
    const op = getOp("comp.diff")!;
    const full = op.toJsx({ comp: "Main", snapshot: { hash: "abc", layers: [{ id: 1, n: "a" }] } });
    expect(full).toContain("changedLayers: changed");
    expect(full).toContain('"hash":"abc"');
    const hashOnly = op.toJsx({ comp: "Main", snapshot: { hash: "abc" } });
    expect(hashOnly).toContain("hash-only comparison");
  });
});

describe("expression.validate / project.audit", () => {
  it("validate forces valueAtTime at sample times and lists failing expressions", () => {
    const jsx = getOp("expression.validate")!.toJsx({ comp: "Main", sampleTimes: [0, 1] });
    expect(jsx).toContain("[0,1]");
    expect(jsx).toContain("node.valueAtTime(times[t], false)");
    expect(jsx).toContain("expressionError");
    expect(getOp("expression.validate")!.readOnly).toBe(true);
  });

  it("audit is read-only and reports findings with severities", () => {
    const op = getOp("project.audit")!;
    expect(op.readOnly).toBe(true);
    const jsx = op.toJsx({});
    for (const kind of [
      "missing_footage",
      "expression_errors",
      "missing_fonts",
      "duplicate_solids",
      "unused_footage",
      "empty_comps",
      "empty_folders",
    ])
      expect(jsx).toContain(kind);
    expect(jsx).toContain("_cap = 50");
  });
});

describe("project lock (AE_MCP_PROJECT_LOCK)", () => {
  it("is off without the env", () => {
    expect(projectLockPath()).toBeNull();
    expect(projectLockGuardJsx(getOp("layer.create_null")!, { comp: "Main" })).toBe("");
  });

  it("guards mutations, lets reads through, allows opening the locked file only", () => {
    process.env.AE_MCP_PROJECT_LOCK = "/Users/u/work/locked.aep";
    expect(projectLockGuardJsx(getOp("layer.create_null")!, { comp: "Main" })).toContain(
      "project lock: writes are allowed only in",
    );
    expect(
      projectLockGuardJsx(getOp("property.get")!, { comp: "Main", layer: 1, property: [] }),
    ).toBe("");
    expect(projectLockGuardJsx(getOp("project.open")!, { path: "/Users/u/work/locked.aep" })).toBe(
      "",
    );
    expect(projectLockGuardJsx(getOp("project.open")!, { path: "/Users/u/other.aep" })).toContain(
      "may be opened for writing",
    );
    expect(projectLockGuardJsx(getOp("project.new")!, {})).toContain(
      "would close the locked project",
    );
  });

  it("guards a batch only when a child mutates", () => {
    process.env.AE_MCP_PROJECT_LOCK = "/Users/u/work/locked.aep";
    const batch = getOp("batch.run")!;
    expect(
      projectLockGuardJsx(batch, { ops: [{ operation: "comp.info", args: { comp: "Main" } }] }),
    ).toBe("");
    expect(
      projectLockGuardJsx(batch, {
        ops: [{ operation: "layer.create_null", args: { comp: "Main" } }],
      }),
    ).toContain("project lock");
  });
});

describe("compareFrames", () => {
  it("reports changed ratio, mean diff and the bbox of the change", () => {
    const w = 4,
      h = 4;
    const a = { width: w, height: h, rgb: new Float64Array(w * h * 3) };
    const b = { width: w, height: h, rgb: new Float64Array(w * h * 3) };
    // change pixels (2,1) and (3,2)
    for (const [x, y] of [
      [2, 1],
      [3, 2],
    ]) {
      const i = (y * w + x) * 3;
      b.rgb[i] = 1;
      b.rgb[i + 1] = 0.5;
    }
    const c = compareFrames(a, b);
    expect(c.sameSize).toBe(true);
    expect(c.changedRatio).toBeCloseTo(2 / 16, 4);
    expect(c.bbox).toEqual({ x: 2, y: 1, w: 2, h: 2 });
    expect(c.maxAbsDiff).toBe(1);
    const diffSize = compareFrames(a, { width: 2, height: 2, rgb: new Float64Array(12) });
    expect(diffSize.sameSize).toBe(false);
  });
});

describe("layout / timing atoms", () => {
  it("layer.stagger offsets in seconds or frames, by start or in-point", () => {
    const jsx = getOp("layer.stagger")!.toJsx({
      comp: "Main",
      layers: [1, 2, 3],
      offset: 2,
      unit: "frames",
      mode: "in",
    });
    expect(jsx).toContain("_comp.frameDuration");
    expect(jsx).toContain("_l.inPoint = _at");
  });

  it("layer.fit_to_comp knows fit / fill / stretch and centres by default", () => {
    const jsx = getOp("layer.fit_to_comp")!.toJsx({ comp: "Main", layer: "plate", mode: "fill" });
    expect(jsx).toContain('_mode === "fill"');
    expect(jsx).toContain("ADBE Scale");
    expect(jsx).toContain("if (true)");
  });

  it("layer.align uses bounds and safe-area references", () => {
    const jsx = getOp("layer.align")!.toJsx({
      comp: "Main",
      layers: ["a", "b"],
      horizontal: "center",
      vertical: "bottom",
      reference: "title-safe",
    });
    expect(jsx).toContain("sourceRectAtTime");
    expect(jsx).toContain('"title-safe"');
  });

  it("comp.trim_to_content shifts layers to 0 and sets duration + work area", () => {
    const jsx = getOp("comp.trim_to_content")!.toJsx({ comp: "Main" });
    expect(jsx).toContain("_comp.duration = Math.max(_comp.frameDuration, _out)");
    expect(jsx).toContain("workAreaDuration");
  });
});
