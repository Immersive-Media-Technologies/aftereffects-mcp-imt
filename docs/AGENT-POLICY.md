# Agent permission policy — reference

How Deep Artisan gates AE-MCP for an autonomous agent; use it as a template for your own client.

## The principle: deny what Cmd+Z cannot revert

Every `ae_do` call runs inside **one undo group**, so creating, editing and deleting layers,
effects, keyframes, masks and text is reversible with a single Cmd+Z. Those operations need no
permission gate — the agent may do them freely and the human can always step back.

What must be gated is what the undo stack does not cover:

| Operation(s)                                                                                      | Why                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `eval.run`                                                                                        | arbitrary ExtendScript = file system and network access beyond After Effects (also keep `AE_MCP_ENABLE_EVAL` unset) |
| `project.new`, `project.open`                                                                     | drop unsaved work; not undoable                                                                                     |
| `project.reduce`, `project.purge`, `project.remove_unused_footage`, `project.consolidate_footage` | outside the undo stack                                                                                              |
| `pref.*`, `render.save_template`, `font.set_favorites`, `font.set_substitution`                   | change the application, not the project                                                                             |
| `render.start`, `render.queue_in_ame`                                                             | write files to disk and occupy After Effects for minutes                                                            |

Everything else — allow.

## Gate by operation name, not by tool name

All writes go through **one** tool, `ae_do`, with the operation in the `operation` field. A
tool-level allow-list (`mcp__ae__ae_do`) therefore cannot distinguish `layer.create_text` from
`project.new`. Parse the arguments: gate on `operation`, and for `batch.run` walk the nested list
under the key **`ops`** (not `operations`) — a batch wrapper must never be a way around a rule.

Reference implementation (TypeScript, from the Deep Artisan client):

```ts
const DENY = new Set([
  "eval.run",
  "project.new",
  "project.open",
  "project.reduce",
  "project.purge",
  "project.remove_unused_footage",
  "project.consolidate_footage",
  "render.start",
  "render.queue_in_ame",
  "render.save_template",
  "font.set_favorites",
  "font.set_substitution",
]);
const DENY_PREFIX = ["pref."];

export function aeDeniedOp(input: {
  operation?: string;
  args?: { ops?: Array<{ operation?: string }> };
}): string | null {
  const check = (op: string | undefined): string | null =>
    !op ? null : DENY.has(op) || DENY_PREFIX.some((p) => op.startsWith(p)) ? op : null;
  const top = check(input.operation);
  if (top) return top;
  if (input.operation === "batch.run") {
    for (const o of input.args?.ops ?? []) {
      const hit = check(o.operation);
      if (hit) return hit;
    }
  }
  return null;
}
```

## Dry run before execution

`ae_do {operation, args, dryRun: true}` validates the arguments and returns the ExtendScript
that would run — **without contacting After Effects**. A planning agent can preview a whole
sequence this way and only then execute.

## Environment for first experiments

- `AE_MCP_READONLY=1` — only non-mutating operations are listed and allowed.
- `AE_MCP_ALLOW_CATEGORIES=layer,keyframe,effect` — restrict to categories.
- Work on a **copy** of the `.aep`; keep `AE_MCP_ENABLE_EVAL` unset.

## Client timeouts

- `MCP_TIMEOUT=120000` — a cold After Effects start plus the first `osascript` exceeds 30 s.
- Tool output cap ≥ 50 000 tokens (Claude Code: `MAX_MCP_OUTPUT_TOKENS`) — `ae_project_info`
  on a real project is larger than the 25 000 default and would be spilled to a file the model
  never reads.
