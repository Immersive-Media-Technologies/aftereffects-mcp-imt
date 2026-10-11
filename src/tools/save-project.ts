import { z } from "zod";

import { projectLockPath } from "../policy.js";
import { jsxVal } from "../registry.js";
import { defineTool, toMcpResult } from "./define-tool.js";

export const saveProjectTool = defineTool({
  name: "ae_save_project",
  title: "Save project",
  description: "Save the project. Pass `path` for Save As.",
  group: "document",
  // Overwrites the .aep on disk — not undoable with Ctrl+Z.
  blockedInReadOnly: true,
  effect: "destructive",
  inputShape: {
    path: z
      .string()
      .optional()
      .describe(
        "Optional absolute path to save the project to (Save As). If omitted, save to the existing path — " +
          "errors if the project has never been saved.",
      ),
  },
  handler: async (args, transport) => {
    // 11.10: under AE_MCP_PROJECT_LOCK a Save As to another path would move the
    // project out of the lock — refused before AE is contacted.
    const lock = projectLockPath();
    if (lock && args.path && args.path.replace(/\\/g, "/") !== lock) {
      return toMcpResult({
        ok: false,
        result: {
          ok: false,
          error: `project lock: Save As to ${args.path} is refused — writes stay in ${lock} (AE_MCP_PROJECT_LOCK)`,
        },
        error: null,
        errorCode: null,
        stack: null,
        logs: [],
        durationMs: 0,
      });
    }
    const code = `
        var _path = ${jsxVal(args.path ?? null)};
        if (_path) {
            var f = new File(_path);
            app.project.save(f);
            return { ok: true, saved: true, path: f.fsName.replace(/\\\\/g, "/") };
        }
        if (!app.project.file) {
            return { ok: false, saved: false, error: "project has no existing path; pass 'path' to save as" };
        }
        app.project.save();
        return { ok: true, saved: true, path: app.project.file.fsName.replace(/\\\\/g, "/") };
    `;
    const result = await transport.execute({ code, label: "save_project" });
    return toMcpResult(result);
  },
});
