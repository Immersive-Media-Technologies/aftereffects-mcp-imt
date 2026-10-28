![AfterEffects-MCP-IMT + SKILLS — After Effects for AI agents](https://raw.githubusercontent.com/Immersive-Media-Technologies/aftereffects-mcp-imt/main/assets/banner.jpg)

# AfterEffects-MCP-IMT + SKILLS — After Effects for AI agents, built to be safe to hand over

Let an AI assistant (Claude Desktop, Cursor, ChatGPT, Google Antigravity or any MCP client) work
inside your running **Adobe After Effects**: read the project, build and edit comps, layers,
effects, keyframes, text, masks and expressions, render check frames — from plain language.

**Every Adobe UI language · a large skills library · built for AI and generative features.** AfterEffects-MCP-IMT works with every UI language Adobe ships, comes with a large skills library and is built for Adobe's AI and generative features — Roto Brush and Object Matte, Content-Aware Fill, generated image sources animated as native layers.

Two parts, made to work together:

- **The MCP server** — ~270 small, safe operations behind two tools, with a dry run, one undo
  group per call, checkpoints, a project lock and honest errors.
- **The skill** (`skills/ae`) — what the agent should _know_: the order of work, what a script
  cannot do in After Effects and how to get around it safely, step-by-step recipes (camera
  tracking, 3D content on footage, plug-in tests, render, motion graphics, masks), and plug-in
  knowledge files.

**Built for localized After Effects, not just English.** Most MCP servers and agent skills for Adobe
apps assume the English UI — on a German, Japanese or Russian install their effect, template and menu
names stop matching. AfterEffects-MCP-IMT addresses After Effects by its own identifiers (matchNames, command
ids) and translates English template names through After Effects' own dictionaries, so the same agent
and the same skill work on every UI language After Effects ships — verified live.

By **[Immersive Media Technologies](https://github.com/Immersive-Media-Technologies)**.

**macOS and Windows · After Effects 2024–2026 (26.5 verified on both, every UI language) ·
Node.js 22+ (none needed with the Claude Desktop extension — verified on macOS and on the Windows
Store build of Claude Desktop).**

> [!CAUTION]
> This edits real After Effects projects and sends project contents (names, expressions, footage
> paths, rendered previews) to the AI service you use. Work on a copy, check your provider's data
> policy for NDA work, and keep `AE_MCP_ENABLE_EVAL` off unless you need raw scripting.

## What you can ask for

- "Point out anything broken in this project — missing footage, fonts, expression errors."
- "Add a glow to every text layer in _Intro_, 30 % lighter than now, and show me frame 2.0."
- "Import this Illustrator file and animate the title with the text-pop preset."
- "Track the camera on this clip, put a 3D null on the floor and parent the logo to it." _(skill)_
- "Here is a reference frame: build this lower third natively, with a Speed slider and the texts in
  Essential Graphics." _(skill)_
- "Test this plug-in on a solid, dump its parameters, render a frame and tell me if it works." _(skill)_

The agent combines the operations itself and checks the project between steps; the skill keeps it
on the rails.

## Install

You need After Effects running on this computer and two permissions:

- **macOS — Automation:** the first call asks whether your AI client may control After Effects
  (a refusal shows up later as error −1743: System Settings → Privacy & Security → Automation).
- **Scripting file access:** After Effects → Settings → Scripting & Expressions → _Allow Scripts to
  Write Files and Access Network_.

| Client                                                                                             | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ![](https://www.google.com/s2/favicons?domain=claude.ai&sz=16) **Claude Desktop**                  | download [`aftereffects-mcp-imt.mcpb`](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/latest/download/aftereffects-mcp-imt.mcpb), double-click, **Install** (Windows: drag it onto Settings → Extensions). No Node needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ![](https://www.google.com/s2/favicons?domain=cursor.com&sz=16) **Cursor**                         | [![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=aftereffects&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBpbW1lcnNpdmUtbWVkaWEtdGVjaG5vbG9naWVzL2FmdGVyZWZmZWN0cy1tY3AtaW10Il0sImVudiI6eyJNQ1BfVElNRU9VVCI6IjEyMDAwMCJ9fQ==) — one click: Cursor opens and writes the config. No button on this page? Use the text link [Add to Cursor](https://cursor.com/en/install-mcp?name=aftereffects&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBpbW1lcnNpdmUtbWVkaWEtdGVjaG5vbG9naWVzL2FmdGVyZWZmZWN0cy1tY3AtaW10Il0sImVudiI6eyJNQ1BfVElNRU9VVCI6IjEyMDAwMCJ9fQ==), the button on [GitHub](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt#install), or put the snippet below into `~/.cursor/mcp.json`. |
| ![](https://www.google.com/s2/favicons?domain=antigravity.google&sz=16) **Google Antigravity**     | Settings → Customizations → Installed MCP Servers → **View raw config** → add the snippet below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ![](https://www.google.com/s2/favicons?domain=chatgpt.com&sz=16) **ChatGPT** (remote servers only) | on the After Effects machine: `npx -p @immersive-media-technologies/aftereffects-mcp-imt aftereffects-mcp-imt-chatgpt` — it starts the server behind a tunnel and prints the URL to paste into ChatGPT.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Any MCP client**                                                                                 | the snippet below in its `mcpServers`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

```json
{
  "mcpServers": {
    "aftereffects": {
      "command": "npx",
      "args": ["-y", "@immersive-media-technologies/aftereffects-mcp-imt"],
      "env": { "MCP_TIMEOUT": "120000" }
    }
  }
}
```

**From source, with a live self-test** (the route we use):

```bash
git clone https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt.git
cd aftereffects-mcp-imt && ./install.sh        # Windows: .\install.ps1
```

The installer checks After Effects and Node, builds, pings the running AE, names what is wrong
(−1743, scripting access, Node path) and — after asking — writes the entry into Claude Desktop's,
Cursor's and Antigravity's configs, backing them up.

**If something does not connect**

- `spawn npx ENOENT` on macOS: GUI apps do not see your shell `PATH` — put the absolute path of a
  Node from Homebrew or nodejs.org in place of `npx` (nvm's Node is invisible to them).
- Set `MCP_TIMEOUT` to `120000`: a cold After Effects start does not fit the default 30 s.
- A timeout with a **`DIALOG_OPEN`** message: After Effects is showing a dialog (save prompt,
  missing footage, a plug-in warning) — the error quotes it; the agent can close it with
  `ae_dialogs` or you click it away. On macOS reading and closing dialogs needs Accessibility
  permission for the client app.
- Windows: `AE_MCP_EXE` must point to `AfterFX.exe` when After Effects is not under
  `C:\Program Files\Adobe`. No supported GPU (a VM): dismiss the «System Compatibility Report»
  first. The `.mcpb` needs no Node.js on the machine — Claude Desktop runs it on its built-in
  Node (verified with the Microsoft Store build on Windows 11 ARM). Server log:
  `%LOCALAPPDATA%\Claude\logs\mcp-server-<name>.log`; mailbox: `%TEMP%\mcp-aftereffects`.
- If your client caps tool output, raise it to 50 000 — `ae_project_info` on a real project is
  bigger than the usual 25 000.

## How it stays safe

|                                 |                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dry run**                     | `ae_do {dryRun: true}` shows the ExtendScript that _would_ run and never touches After Effects.                                                                     |
| **One undo group per call**     | every `ae_do` — even a 30-step `batch.run` — is one Cmd+Z. `batch.run {atomic: true}` undoes itself when a step fails and says so (`rollback.verified`).            |
| **Checkpoints**                 | `project.checkpoint` keeps a copy of the .aep next to the project; `project.revert` brings it back after a crash, a relaunch or a bad idea — things undo cannot do. |
| **Project lock**                | `AE_MCP_PROJECT_LOCK=/path/to/one.aep` — the agent may change only that project; your other open work is untouchable.                                               |
| **Read-only mode**              | `AE_MCP_READONLY=1` for a first session: inspection and check frames only.                                                                                          |
| **Honest errors**               | every failure has a code (`DIALOG_OPEN`, `TIMEOUT`, `INVALID_ARGS`, `OPERATION_FAILED` …) and a hint; a batch reports which step failed.                            |
| **Nothing installed inside AE** | the server talks to After Effects from outside (`osascript` / `AfterFX.exe -r`); uninstall = delete the folder.                                                     |

What to forbid on the client side, if you gate at all: what Cmd+Z cannot revert — `eval.run`,
`project.new / open / revert`, the purge/consolidate operations, `pref.*`, `render.start`. The list
and a reference implementation are in [`docs/AGENT-POLICY.md`](docs/AGENT-POLICY.md).

## How the agent sees the project

- **`ae_project_info` / `ae_comp_info` / `ae_layer_info`** — the full picture when needed.
- **`comp.snapshot` → edit → `comp.diff`** — a cheap fingerprint before and after: which layers
  were added, removed or changed, and in what. Verification in a few dozen tokens.
- **`ae_render_frame`** — a PNG the agent can look at; `compareWith` an earlier frame answers
  "did the picture change, and where" without opening the image.
- **`property.sample`** — a camera's position / orientation / zoom at start, middle and end in one
  call; **`expression.validate`** and **`project.audit`** — errors before the user hits play.

## The skill

`skills/ae/SKILL.md` is a short **router** the agent reads first; it points to the one file the
task needs:

|                                                      |                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SKILL.md`                                           | the call budget (what made a live plug-in test cost 76 calls an hour — and how not to), the order of work (know the state → checkpoint → operate → verify by values, then by frame), and a table of **what a script cannot do in After Effects** with the safe workaround for each. |
| `recipes/camera-track.md`                            | 3D Camera Tracker end to end: start the analysis from the menu, wait in one call, press «Create Camera» with a real click (a synthetic click crashed AE 26.5), set the ground plane, read the camera back as numbers.                                                               |
| `recipes/attach-3d.md`                               | put a splat, a model or a solid on tracked footage: null at the origin, parent or expressions, scale, and a script that **measures** slide in pixels instead of eyeballing it.                                                                                                      |
| `recipes/plugin-test.md`                             | test a third-party plug-in: inspect the files before installing, apply on a solid, dump parameters by matchName, feed it a model layer, render, time it, write the verdict.                                                                                                         |
| `recipes/render.md`                                  | frames, segment renders, templates on a localized AE, where files go.                                                                                                                                                                                                               |
| `recipes/motion-graphics.md`                         | titles, lower thirds, logo stings, infographics as an **editable** AE comp: breakdown table, CONTROLS rig, real easing, Essential Graphics, a frame per phase.                                                                                                                      |
| `recipes/masks-roto.md`, `recipes/tracking-mocha.md` | masks and track mattes, Object Matte / Roto Brush, the Tracker panel and Mocha — what to script, what the user clicks.                                                                                                                                                              |
| `plugins/<name>.md`                                  | one knowledge file per plug-in (matchNames, how it takes input, what is UI-only, quirks, timing). First: irrealix Gaussian Splatting. Template in `plugins/README.md`.                                                                                                              |
| `scripts/`                                           | only the UI steps no script can do: hardware-level mouse events, window and display geometry, menu clicks by localized name, dialogs, a one-call wait for an analysis, screenshots, a frame strip, the slide measurement. **No script duplicates a server operation.**              |

Use it as a skill in clients that support them (copy `skills/ae` into `~/.claude/skills/`, or point
your system prompt at `SKILL.md`). The motion-graphics recipe routes to topic references from five
open MIT skill sets; they are fetched, not bundled — run `skills/ae/fetch-vendor.sh` once.

## Tools

| Tool                                                                                    | Purpose                                                                             |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ae_catalog` / `ae_do`                                                                  | discover the operations (24 categories) and run one — or several in one `batch.run` |
| `ae_project_info` / `ae_comp_info` / `ae_layer_info` / `ae_version_info` / `ae_context` | read                                                                                |
| `ae_render_frame`                                                                       | one frame as PNG (viewer-accurate colour; `compareWith` for metrics)                |
| `ae_save_project`, `ae_project_export_json` / `ae_project_import_json`                  | save; whole-project JSON round trip                                                 |
| `ae_dialogs`                                                                            | see and dismiss the modal dialogs that block scripting                              |

Full list with parameters: [`docs/TOOLS.md`](docs/TOOLS.md); the operations are listed by
`ae_catalog` at runtime.

| Variable                  | Default             | Meaning                                                            |
| ------------------------- | ------------------- | ------------------------------------------------------------------ |
| `AE_MCP_EXE`              | auto-detect         | the After Effects `.app` bundle (macOS) or `AfterFX.exe` (Windows) |
| `AE_MCP_READONLY`         | off                 | `1` → nothing may modify the project                               |
| `AE_MCP_PROJECT_LOCK`     | off                 | path of the one `.aep` the agent may change                        |
| `AE_MCP_CHECKPOINT_DIR`   | next to the project | where `project.checkpoint` keeps its copies                        |
| `AE_MCP_ENABLE_EVAL`      | off                 | `1` → `eval.run` (arbitrary ExtendScript) becomes available        |
| `AE_MCP_ALLOW_CATEGORIES` | all                 | comma-separated allow-list of operation categories                 |
| `AE_MCP_RUNTIME_DIR`      | OS temp             | where the IPC mailbox lives                                        |
| `MCP_TIMEOUT`             | client              | set `120000` in the client config                                  |

## Why this one

There are several After Effects MCP servers; most stop at "the AI can run ExtendScript". This one
is built around what an **autonomous** agent needs — and what the person handing over a project
needs: a small stable tool surface (two tools instead of 270), a real dry run, undo-safe
operations, checkpoints and a project lock, honest errors, an installer that says what is wrong,
and a skill that teaches the agent the parts of After Effects no API covers — on any UI language
After Effects ships, where most servers stop at the English one. Verified on AE 2026, macOS and
Windows.

## Releases

Each version is described on the
[**Releases**](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases) page;
every change is in [`CHANGELOG.md`](CHANGELOG.md). Upstream fixes are merged from
[kumoproductions/mcp-aftereffects](https://github.com/kumoproductions/mcp-aftereffects) by topic.

- [v1.0.2](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v1.0.2) · 2026-10-28 —
  descriptions everywhere: every Adobe UI language, a large skills library, built for Adobe's generative features.
- [v1.0.1](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v1.0.1) · 2026-10-28 —
  product name AfterEffects-MCP-IMT (was AE-MCP-IMT); server name `aftereffects-mcp-imt` like the npm package; the MCP Registry entry also lists the npm package.
- [v1.0.0](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v1.0.0) · 2026-10-28 —
  every After Effects UI language (matchNames, command ids, template names through After Effects'
  dictionaries; verified live), corrected command list, Apache-2.0.
- [v0.5.5](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.5.5) · 2026-10-11 —
  the After Effects skill (`skills/ae`), checkpoints + revert, atomic batches, comp snapshot/diff,
  expression validation, project audit, dialog detection, project lock, frame compare.
- [v0.4.4](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.4) · 2026-10-04 —
  Windows: Claude Desktop from the Microsoft Store.
- [v0.4.3](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.3) · 2026-10-04 —
  Windows verified (AfterFX.exe -r launch path).
- [v0.4.2](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.2) · 2026-10-01 —
  ChatGPT gateway fix; [v0.4.1](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.1) — ChatGPT in one command;
  [v0.4.0](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.0) — one-click installs (`.mcpb`, Cursor, npm, installers).
- [v0.3.5](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.3.5) · 2026-09-30 —
  the AE Motion skill; [v0.3.0](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.3.0) — first public release of the IMT fork.

A note for contributors: the offline transport tests (`npm test`) expect After Effects to be
**closed** on macOS — with it open the live AE answers the stand-in requests and a few of them fail.

## License

**[Apache License 2.0](LICENSE)** — © Immersive Media Technologies.

- Free to use, modify and distribute, commercial use included.
- **Attribution is required.** Every redistribution of this software or of a work derived from it
  must carry the notice from [`NOTICE`](NOTICE):
  `AfterEffects-MCP-IMT by Immersive Media Technologies — https://github.com/Immersive-Media-Technologies`.
- No warranty.

Third-party notices (upstream MIT code): [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
