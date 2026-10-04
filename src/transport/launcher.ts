// How the dispatcher gets into After Effects, per platform.
//
// win32 — `AfterFX.exe -r <jsx>`. Fire-and-forget: the spawned process hands
// the script to the running AE instance (or boots one) and exits; its exit
// code says nothing. `-r` can carry only a file path — and AfterFX.exe cuts
// that path at the first SPACE, quotes or not (seen live on Windows 11 with
// AE 2026: a dispatcher under `…\Claude Extensions\…` was never run, the same
// build under a space-free path answered in under a second). So the path
// handed to `-r` is never the package path: a one-line bootstrap is written
// under the runtime root (which also pins the mailbox, like the macOS
// bootstrap), and when even that path has a space (a user profile with a
// space in its name) it is replaced by its DOS 8.3 short name.
//
// darwin — After Effects has no `-r` equivalent; the scripting entry point is
// AppleScript. `osascript` sends a DoScript event carrying a two-statement
// bootstrap that pins the mailbox path into `$.global` and evalFiles the
// dispatcher. Injecting the path sidesteps mailbox discovery entirely: Node's
// os.tmpdir() and ExtendScript's Folder.temp never have to agree on macOS.
// Unlike AfterFX.exe, osascript's exit code IS meaningful — non-zero with
// "Not authorized to send Apple events" (-1743) means the OS-level Automation
// permission was denied — so the transport watches it for fast failure.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DISPATCHER_JSX, RUNTIME_DIR, RUNTIME_ROOT } from "../config.js";

export interface LaunchPlan {
  command: string;
  args: string[];
  /**
   * Watch stderr + exit code and treat non-zero as a launch failure. True for
   * osascript (its exit code carries the Automation-permission diagnosis);
   * false for AfterFX.exe, whose exit code is noise.
   */
  diagnoseExit: boolean;
}

/** ExtendScript single-quoted string literal for a filesystem path. */
function jsxPath(p: string): string {
  return `'${p.replace(/\\/g, "/").replace(/'/g, "\\'")}'`;
}

/** AppleScript double-quoted string literal. */
function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * AppleScript addresses the application bundle, not the binary inside it —
 * accept either and normalize to the `.app` path.
 */
function appBundlePath(aePath: string): string {
  const normalized = aePath.replace(/\\/g, "/");
  const match = normalized.match(/^(.*?\.app)(\/|$)/);
  return match ? match[1] : normalized;
}

export function buildLaunchPlan(
  aePath: string,
  platform: NodeJS.Platform = process.platform,
  runtimeDir: string = RUNTIME_DIR,
  dispatcherJsx: string = DISPATCHER_JSX,
  runtimeRoot: string = RUNTIME_ROOT,
): LaunchPlan {
  if (platform === "darwin") {
    const bootstrap =
      `$.global.AE_MCP_RUNTIME_DIR_OVERRIDE = ${jsxPath(runtimeDir)}; ` +
      `$.evalFile(${jsxPath(dispatcherJsx)});`;
    return {
      command: "/usr/bin/osascript",
      args: [
        // The AppleScript default event timeout is 2 minutes; DoScript blocks
        // osascript until the JSX returns, so lift it well past every built-in
        // call timeout (the longest is the 10-minute project import).
        "-e",
        "with timeout of 7200 seconds",
        "-e",
        `tell application ${appleScriptString(appBundlePath(aePath))} to DoScript ${appleScriptString(bootstrap)}`,
        "-e",
        "end timeout",
      ],
      diagnoseExit: true,
    };
  }
  return {
    command: aePath,
    args: ["-r", windowsLaunchJsx(runtimeDir, dispatcherJsx, runtimeRoot)],
    diagnoseExit: false,
  };
}

/** DOS 8.3 short form of an existing Windows path (no spaces); the path itself when unavailable. */
export function windowsShortPath(p: string): string {
  if (!/\s/.test(p)) return p;
  try {
    const out = execFileSync("cmd.exe", ["/d", "/c", `for %I in ("${p}") do @echo %~sI`], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    }).trim();
    if (out && !/\s/.test(out)) return out;
  } catch {
    /* short names disabled on the volume — fall through */
  }
  return p;
}

/**
 * The file AfterFX.exe -r receives on Windows: a bootstrap next to the
 * mailbox that pins the runtime dir and evalFiles the real dispatcher, so the
 * package path (which may contain spaces) never travels on the command line.
 */
export function windowsLaunchJsx(
  runtimeDir: string = RUNTIME_DIR,
  dispatcherJsx: string = DISPATCHER_JSX,
  runtimeRoot: string = RUNTIME_ROOT,
): string {
  const bootstrap = path.join(runtimeRoot, "launch.jsx");
  try {
    mkdirSync(runtimeRoot, { recursive: true });
    writeFileSync(
      bootstrap,
      `$.global.AE_MCP_RUNTIME_DIR_OVERRIDE = ${jsxPath(runtimeDir)};\n$.evalFile(${jsxPath(dispatcherJsx)});\n`,
      "utf8",
    );
  } catch {
    return dispatcherJsx; // runtime root not writable — the old direct path is the only option
  }
  return windowsShortPath(bootstrap);
}
