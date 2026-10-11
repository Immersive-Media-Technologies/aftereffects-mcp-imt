import { z } from "zod";

import { errorResult } from "../errors.js";
import {
  ACCESSIBILITY_HINT,
  dialogScanSupported,
  dismissAeDialog,
  scanAeDialogs,
} from "../transport/dialogs.js";
import { defineTool, jsonResult } from "./define-tool.js";

// Modal dialogs are the one thing an autonomous agent cannot see from the
// mailbox: while one is up no script runs and every call ends in a timeout.
// The transport already reports DIALOG_OPEN with the dialog's text; this
// tool lets the agent look on its own and close a dialog by its cancel
// action — a warning is acknowledged, a question (save changes?) is
// cancelled, never answered. Nothing here touches the project.

export const dialogsTool = defineTool({
  name: "ae_dialogs",
  title: "After Effects dialogs",
  description:
    "List the modal dialogs After Effects is showing, or dismiss one by its cancel action (what Escape does: a warning is acknowledged, a 'save changes?' question is cancelled — never answered for the user). " +
    "Use after a DIALOG_OPEN / TIMEOUT error, or before a step known to pop a dialog. Windows + macOS; on macOS reading the text and dismissing need Accessibility permission for the app that runs this server.",
  group: "inspect",
  blockedInReadOnly: false,
  effect: "read",
  inputShape: {
    action: z
      .enum(["list", "dismiss"])
      .default("list")
      .describe("list — report open dialogs; dismiss — close the one named by `id`."),
    id: z
      .string()
      .optional()
      .describe("Dialog id from a previous list / DIALOG_OPEN error (required for dismiss)."),
  },
  handler: async (args) => {
    if (!dialogScanSupported()) {
      return jsonResult({
        supported: false,
        dialogs: [],
        note: `dialog scan is not available on ${process.platform}`,
      });
    }
    if (args.action === "dismiss") {
      if (!args.id)
        return errorResult(
          "INVALID_ARGS",
          "ae_dialogs dismiss needs the dialog `id` (run action: list first)",
        );
      const r = await dismissAeDialog(args.id);
      if (!r.posted) {
        return errorResult(
          "OPERATION_FAILED",
          r.reason === "no_permission"
            ? ACCESSIBILITY_HINT
            : `no open After Effects dialog with id ${args.id}`,
          {
            details: { id: args.id, reason: r.reason ?? "not_found" },
          },
        );
      }
      return jsonResult({
        dismissed: r.closed,
        posted: true,
        text: r.text,
        note: r.closed
          ? "the dialog closed; retry the call that timed out"
          : "Escape was sent but the dialog is still open — it may need an answer from the user",
      });
    }
    const dialogs = await scanAeDialogs();
    return jsonResult({
      supported: true,
      count: dialogs.length,
      dialogs,
      ...(dialogs.some((d) => d.accessibility === false) ? { note: ACCESSIBILITY_HINT } : {}),
    });
  },
});
