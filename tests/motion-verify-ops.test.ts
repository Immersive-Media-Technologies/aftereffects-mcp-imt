// 11.10.2026 — atoms the AE skill (stack/ae) needs after the first plugin
// test: a tolerant property.get (NO_VALUE status rows), property.sample
// (camera at several times in one call), layer.create_null with 3D/position,
// project.new on an empty untitled project. Codegen only; AE acceptance is
// the e2e suite.

import { describe, expect, it } from "vitest";

import { denyOperation } from "../src/policy.js";
import { getOp } from "../src/registry.js";
import "../src/operations/index.js";

describe("property.get tolerates unreadable values", () => {
  it("returns name + valueError instead of failing on NO_VALUE / throwing properties", () => {
    const jsx = getOp("property.get")!.toJsx({
      comp: "GS_test_chess",
      layer: 2,
      property: ["Effects", "ADBE 3D Tracker", "ADBE 3D Tracker-0311"],
    });
    expect(jsx).toContain("catch (eVal)");
    expect(jsx).toContain("_out.valueError");
    expect(jsx).toContain("name: _node.name");
  });
});

describe("property.sample", () => {
  it("is read-only and survives AE_MCP_READONLY", () => {
    const op = getOp("property.sample");
    expect(op).toBeDefined();
    expect(op!.readOnly).toBe(true);
    process.env.AE_MCP_READONLY = "1";
    try {
      expect(denyOperation(op!)).toBeNull();
    } finally {
      delete process.env.AE_MCP_READONLY;
    }
  });

  it("samples several paths at given times, defaulting to start / middle / end", () => {
    const withTimes = getOp("property.sample")!.toJsx({
      comp: "Main",
      layer: "3D Tracker Camera",
      properties: [["Transform", "Position"], ["Camera Options", "Zoom"]],
      times: [0, 4.67, 9.3],
    });
    expect(withTimes).toContain("[0,4.67,9.3]");
    expect(withTimes).toContain("valueAtTime(_times[_ti], false)");
    expect(withTimes).toContain("_row.valueError");
    const noTimes = getOp("property.sample")!.toJsx({
      comp: "Main",
      layer: 1,
      properties: [["Transform", "Position"]],
    });
    expect(noTimes).toContain("_comp.duration / 2");
    expect(noTimes).toContain("_comp.duration - _comp.frameDuration");
  });
});

describe("layer.create_null as a 3D anchor", () => {
  it("sets 3D, anchor and position in the same undo group", () => {
    const jsx = getOp("layer.create_null")!.toJsx({
      comp: "Main",
      name: "GS_Origin",
      threeD: true,
      position: [0, 0, 0],
      anchorPoint: [50, 50, 0],
    });
    expect(jsx).toContain("addNull()");
    expect(jsx).toContain("_layer.threeDLayer = true");
    expect(jsx).toContain("anchorPoint.setValue(_na)");
    expect(jsx).toContain("position.setValue(_np)");
  });

  it("stays a plain 2D null without the new args", () => {
    const jsx = getOp("layer.create_null")!.toJsx({ comp: "Main" });
    expect(jsx).toContain("if (false) _layer.threeDLayer = true");
    expect(jsx).toContain("var _np = null");
  });
});

describe("project.new on an empty untitled project", () => {
  it("treats newProject() === null with no file and no items as success", () => {
    const jsx = getOp("project.new")!.toJsx({});
    expect(jsx).toContain("!app.project.file && app.project.numItems === 0");
    expect(jsx).toContain('error: "app.newProject returned null"');
  });
});
