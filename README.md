<p align="center"><img src="assets/banner.jpg" alt="AE-MCP-IMT — After Effects for AI agents" width="1280"></p>

# AE-MCP-IMT — After Effects for AI agents, built to be safe to hand over

An MCP server that lets an AI agent (Claude Desktop, Cursor, ChatGPT or any
MCP-compatible client) drive a running Adobe After Effects: inspect projects, edit comps, layers,
effects, keyframes, text and masks, set expressions, render frames — from natural language.

Built by **[Immersive Media Technologies](https://github.com/Immersive-Media-Technologies)** as the
After Effects backbone of the Deep Artisan agent pipeline, and released so that other agent
builders can use the same, battle-tested layer.

**macOS and Windows · After Effects 2024–2026 · Node.js 22+ (or none with the Claude Desktop extension).** After Effects itself runs only on macOS and
Windows, so Linux is not a target. macOS is what we run every day; the Windows transport (`AfterFX.exe -r`)
is inherited from upstream and works the same way — reports from Windows users are welcome.

> [!CAUTION]
> This tool edits real After Effects projects and sends project contents (comp and layer names,
> expressions, footage paths, rendered previews) to the AI service you use. Start with a copy of a
> project, check your AI provider's data policy for NDA work, and keep `AE_MCP_ENABLE_EVAL` off.

## Why this one

There are several After Effects MCP servers. Most stop at "the AI can call ExtendScript". This
one is designed around what an **autonomous agent** actually needs: a small, stable tool surface,
a real dry run, undo-safe operations, honest errors and an installer that says what is wrong.

|                              | **AE-MCP-IMT (this repo)**                                                                                                                                                                                                                                                                                                               | kumoproductions/mcp-aftereffects                                                                  | Dakkshin/after-effects-mcp                                            | directorhomaidm-ops/aftereffects-mcp                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| Talks to AE via              | `osascript` per call — **nothing installed inside AE**                                                                                                                                                                                                                                                                                   | same (we are a fork)                                                                              | CEP panel polling every few seconds — must be installed and kept open | AppleScript `DoScript`, temp files                   |
| Operations                   | **199 atomic ops** behind 2 tools (`ae_catalog` / `ae_do`) — ~2 K tokens of tool schema per turn instead of 199 tools                                                                                                                                                                                                                    | 198 ops, same facade                                                                              | 14 commands                                                           | 80+ tools (every op = a tool in the model's context) |
| Dry run                      | **`ae_do {dryRun: true}` validates args and returns the generated ExtendScript without touching AE**                                                                                                                                                                                                                                     | `dryRun` existed only for JSON import; on `ae_do` it was silently dropped (the call ran for real) | —                                                                     | —                                                    |
| Undo                         | every `ae_do` call = one undo group (Cmd+Z reverts an agent step)                                                                                                                                                                                                                                                                        | same                                                                                              | —                                                                     | —                                                    |
| Effect presets               | 9 named templates (`glow`, `drop-shadow`, `cinematic-look`, `text-pop`, …) — **fixed**: two presets referenced effects that do not exist in AE (`ADBE Directional Blur`, `ADBE Glow`); properties addressed by index, so presets work on non-English AE (ru/ja) where by-name lookup returned `null` and silently applied factory values | —                                                                                                 | source of the presets (with those bugs)                               | —                                                    |
| Render output                | output folder created for `render.add_to_queue` / `render.set_om_settings` (AE fails with "Directory does not exist" otherwise)                                                                                                                                                                                                          | added later upstream                                                                              | —                                                                     | —                                                    |
| Install                      | **one click**: `.mcpb` for Claude Desktop (no Node needed), «Add to Cursor» button, `npx` for any other client; `./install.sh` / `install.ps1`: check AE and Node, build, **run a live self-test against AE**, write the client configs; failures are named (TCC −1743, scripting write access, Node path)                               | manual                                                                                            | clone, build, install panel, keep panel open                          | `uv run`                                             |
| Permission policy for agents | reference deny-list in `docs/`: what to forbid is **what Cmd+Z cannot revert** (`eval.run`, `project.new/open`, purge/consolidate, `pref.*`, `render.start`) — everything else is safe to let the agent do                                                                                                                               | consent gate for app-config ops                                                                   | —                                                                     | —                                                    |
| Motion-graphics agent skill  | **AE Motion** (`skills/ae-motion`): reference image + brief → element breakdown → a natively built, **editable** comp (text/shape layers, real easing, expressions, a CONTROLS rig, Essential Graphics / MOGRT), checked by rendered frames; topic references from five open skill sets fetched on demand                                | —                                                                                                 | —                                                                     | —                                                    |
| Verified on                  | **AE 2026, macOS + Windows, Eng and Rus UI**                                                                                                                                                                                                                                                                                             | Windows + macOS                                                                                   | AE 2022+                                                              | AE 2026, macOS                                       |
| License                      | **IMT Non-Commercial** for our work (attribution + link required, free for non-commercial use); upstream code stays MIT                                                                                                                                                                                                                  | MIT                                                                                               | MIT                                                                   | not specified                                        |

Facts about other projects are from their READMEs on GitHub at the time of writing; corrections welcome.

## What you can ask for

- "Import this Illustrator file and animate the title with a text-pop preset."
- "Point out anything broken in this AEP — missing footage, expressions with errors, unused comps."
- "Apply the revisions from this PDF to the comps it names."
- "Add a glow to every text layer in _Intro_, 30 % lighter than now."
- "Render frame 120 of _Main_ so I can see the result."
- "Here is a reference frame: build this lower third natively — title, subtitle, accent bar — with a Speed slider and the texts in Essential Graphics." (with the AE Motion skill)

The agent combines the 199 operations (11 MCP tools) itself, checking project state between steps.

## Install

Requirements: Adobe After Effects 2024–2026 running on this computer (2026 verified). Two permissions
without which nothing works: **Automation** — macOS must let the client control After Effects (the
first call raises the system dialog; a refusal is remembered and shows up as AppleScript error
**−1743**, System Settings → Privacy & Security → Automation); and **scripting file access** — After
Effects → Settings → Scripting & Expressions → _Allow Scripts to Write Files and Access Network_. Pick
the route for your client:

| Client                                                                                                                                                            | Route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | What you need                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://www.google.com/s2/favicons?domain=claude.ai&sz=32" width="16" height="16" alt=""> **Claude Desktop**                                            | download [`aftereffects-mcp-imt.mcpb`](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/latest/download/aftereffects-mcp-imt.mcpb), double-click it, click **Install** — the settings dialog has the switches (read-only mode, `eval.run`)                                                                                                                                                                                                                  | nothing else: Claude Desktop brings its own Node.js                                                                                                       |
| <img src="https://www.google.com/s2/favicons?domain=cursor.com&sz=32" width="16" height="16" alt=""> **Cursor**                                                   | <a href="https://cursor.com/en/install-mcp?name=aftereffects&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBpbW1lcnNpdmUtbWVkaWEtdGVjaG5vbG9naWVzL2FmdGVyZWZmZWN0cy1tY3AtaW10Il0sImVudiI6eyJNQ1BfVElNRU9VVCI6IjEyMDAwMCJ9fQ=="><img src="https://cursor.com/deeplink/mcp-install-dark.png" alt="Add to Cursor" height="24"></a> — one click, Cursor writes the config                                                                                                                 | Node.js 22+ (`npx` fetches the package)                                                                                                                   |
| <img src="https://www.google.com/s2/favicons?domain=antigravity.google&sz=32" width="16" height="16" alt=""> **Google Antigravity**                               | Settings → Customizations → Installed MCP Servers → **View raw config** (or type `/mcp` in the prompt panel) and add the `aftereffects` entry from the snippet below to `~/.gemini/config/mcp_config.json`; `install.sh` / `install.ps1` write it for you                                                                                                                                                                                                                                | Node.js 22+                                                                                                                                               |
| <img src="https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32" width="16" height="16" alt=""> **ChatGPT** and other clients that take only remote servers | one command on the After Effects machine — `npx -p @immersive-media-technologies/aftereffects-mcp-imt aftereffects-mcp-imt-chatgpt` — starts the server behind a Streamable-HTTP gateway and a tunnel, and prints the public URL to paste into ChatGPT → Settings → Connectors → Create (developer mode, authentication: none). After Effects stays on your machine; the tunnel is your door — whoever knows the URL can drive it while this runs, so stop it (Ctrl+C) after the session | Node.js 22+ and a tunnel tool: `cloudflared` (no account; `brew install cloudflared` / `winget install Cloudflare.cloudflared`) or `ngrok` (free account) |
| **Any MCP client** with a JSON config                                                                                                                             | the snippet below in its `mcpServers`                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Node.js 22+                                                                                                                                               |

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

A GUI client on macOS does not see your shell `PATH`: if it reports `spawn npx ENOENT`, replace
`npx` with the absolute path of a Node installed by Homebrew or the official installer (`nvm` Node is
invisible to it) — exactly what the installer below writes. `MCP_TIMEOUT` of 120 s matters: a cold
After Effects start plus the first `osascript` does not fit the default 30 s. If your client caps
tool output, raise the cap to 50 000 — `ae_project_info` on a real
project is larger than the 25 000 default.

**From source, with a live self-test** (the route we run ourselves): clone, then `./install.sh` on
macOS or `.\install.ps1` on Windows. The script checks After Effects and Node (absolute path),
builds `dist/`, runs a live round-trip with the running After Effects (`tools/selftest.mjs`) and
names what is wrong (−1743, scripting file access, Node path), then — after asking — writes the
entry into Claude Desktop's, Cursor's and Google Antigravity's config files, backing them up first. `--no-config` only
prints the snippet; `--yes` skips the questions. The Windows script is not run by us yet.

```bash
git clone https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt.git
cd aftereffects-mcp-imt && ./install.sh
```

**Windows.** The dispatcher is launched as `AfterFX.exe -r`; set `AE_MCP_EXE` to your `AfterFX.exe`
when After Effects is not under `C:\Program Files\Adobe`. Inherited from upstream, not run by us.

| Variable                  | Default     | Meaning                                                                          |
| ------------------------- | ----------- | -------------------------------------------------------------------------------- |
| `AE_MCP_EXE`              | auto-detect | the After Effects `.app` bundle (macOS) or `AfterFX.exe` (Windows)               |
| `AE_MCP_READONLY`         | off         | `1` / `true` → nothing may modify the project; recommended for the first session |
| `AE_MCP_ENABLE_EVAL`      | off         | `1` / `true` → `eval.run` (arbitrary ExtendScript) becomes available             |
| `AE_MCP_ALLOW_CATEGORIES` | all         | comma-separated allowlist of operation categories                                |
| `AE_MCP_RUNTIME_DIR`      | OS temp     | where the IPC mailbox lives                                                      |
| `MCP_TIMEOUT`             | client      | set it to `120000` in the client config — a cold AE start does not fit 30 s      |

## Motion-graphics skill (AE Motion)

`skills/ae-motion/SKILL.md` teaches the agent to build motion graphics **as an editable After Effects
project**, not as a rendered clip: titles, lower thirds, kinetic type, logo stings, infographics,
transitions and overlays made of native text and shape layers, keyframes with real easing,
expressions driven by a `CONTROLS` null (Speed, Delay, colours, switches) and Essential Graphics
properties (MOGRT export on request). The workflow:

1. read the reference image and the motion brief; check that the fonts are installed;
2. show a breakdown table — what is built natively in AE, what is generated source material
   (illustrations as separate transparent PNGs), the background (still, video footage or
   generative — never baked into the plate), and what would need an external render (last resort);
3. build through `ae_do` / `batch.run` (one undo group per step), parent at rest, ease every key;
4. verify with a few `ae_render_frame` checks (entrance / mid / hold / exit) and report the controls.

The skill routes to topic references (easing and rigging, shapes, text animators, expressions,
MOGRT, ExtendScript pitfalls, After Effects 2026 changes, motion principles) from five open skill
sets. They are **fetched, not bundled**: run `skills/ae-motion/fetch-vendor.sh` once (pinned commits,
download only). The skill also maps those sets' tool names to this server's operations.

Use it as a skill in clients that support them (e.g. copy `skills/ae-motion` into
`~/.claude/skills/` for Claude Desktop), or point the model at `SKILL.md` in your
system prompt.

## Tools

| Tool                                                                     | Purpose                                                                                                                                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ae_catalog`                                                             | list the 23 categories and 199 operations, or one operation with its parameters                                                        |
| `ae_do`                                                                  | run one operation (`operation`, `args`, `dryRun`) — one undo group per call; `batch.run` executes several operations in one undo group |
| `ae_context`                                                             | ambient context for the agent: project state, active comp, selection, ES3 rules, the undo contract                                     |
| `ae_project_info` / `ae_comp_info` / `ae_layer_info` / `ae_version_info` | introspection                                                                                                                          |
| `ae_save_project`                                                        | save                                                                                                                                   |
| `ae_project_export_json` / `ae_project_import_json`                      | whole-project round trip (also the way to snapshot and restore)                                                                        |
| `ae_render_frame`                                                        | render one frame to PNG for the agent to look at                                                                                       |

The full operation reference is generated from the source: [`docs/TOOLS.md`](docs/TOOLS.md).

## Safety model for agents

- **Dry run first.** `ae_do {dryRun: true}` returns the ExtendScript that _would_ run and never
  contacts After Effects. Let the agent plan, then execute.
- **Deny what Cmd+Z cannot revert.** Because every call is one undo group, creating, editing and
  even deleting layers is reversible and needs no gate. Forbid on the client side: `eval.run`
  (arbitrary ExtendScript = file system access), `project.new` / `project.open` (drop unsaved
  work), `project.reduce` / `purge` / `remove_unused_footage` / `consolidate_footage` (outside the
  undo stack), `pref.*` and `render.save_template` (change the application, not the project),
  `render.start` / `render.queue_in_ame` (write files, occupy AE). Nested batches must be gated by
  their inner `ops` — a batch wrapper is not a way around a rule.
- `AE_MCP_READONLY=1` for the first experiments on a new machine. `AE_MCP_ENABLE_EVAL` stays off.
- The upstream `npm test` **is not safe on macOS with After Effects open**: four transport tests
  assume a fake executable isolates them, but on macOS the path is not executed — the live AE
  answers. Run the suite with AE closed or on CI (where it self-skips).

## Release history

Each version is described on the
[**Releases**](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases) page — what the
server does at that version and what the release added:

- [v0.4.1](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.1) · 2026-10-01 —
  ChatGPT in one command (gateway + tunnel), client icons in Install.
- [v0.4.0](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.0) · 2026-10-01 —
  one-click installs: Claude Desktop extension (`.mcpb`), «Add to Cursor», npm package, `install.sh` /
  `install.ps1` that write the client configs.
- [v0.3.5](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.3.5) · 2026-09-30 —
  the AE Motion skill (editable motion graphics built natively in AE); server and tools unchanged.
- [v0.3.0](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.3.0) · 2026-09-30 —
  first public release of the IMT fork: the full server (199 operations, 23 categories) plus the fork's dry run,
  effect presets, render folders, installer with self-test and the agent policy.

Every change, including the upstream history 0.1.0 – 0.2.0, is in [`CHANGELOG.md`](CHANGELOG.md).

## Changes against upstream

See [`CHANGELOG.md`](CHANGELOG.md) and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). In short:
the `ae_do` dry run that really is one; effect templates that exist and work on localized AE, with
misses reported in `warnings`; render output folders; the installer with a live self-test; the agent
permission model and the macOS notes above; since 0.3.5 the AE Motion skill. Upstream fixes are merged from
[kumoproductions/mcp-aftereffects](https://github.com/kumoproductions/mcp-aftereffects) by topic,
one at a time.

## License

**[IMT Non-Commercial License](LICENSE)** — © Immersive Media Technologies.

- **Non-commercial use only.** Selling this software, offering it as or inside a paid product or
  service, or using it in commercial client work requires a separate written license from
  Immersive Media Technologies.
- **Attribution is mandatory.** Every use, copy, fork or derived product must credit the creator,
  visibly to its users: `AE-MCP-IMT by Immersive Media Technologies — https://github.com/Immersive-Media-Technologies`.
- No warranty.

Full terms: [`LICENSE`](LICENSE). Third-party notices: [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
