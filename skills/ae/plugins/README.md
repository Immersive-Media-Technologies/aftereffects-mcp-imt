# plugins/ — one file per third-party plugin

File name = slug (`<vendor>-<plugin>.md`). Written after a test (`recipes/plugin-test.md`). Keep it to facts the
agent needs on the next run — no marketing, no transcript.

```
# <Plugin name> <version> for After Effects
**Vendor / price / page.** **Status:** tested <date> on <AE version, Mac, UI language>; verdict.
## Install            where the files go, admin?, restart AE, importer conflicts, trial watermark
## Effect             matchName; how to apply (`effect.add`); what layer it needs (solid?)
## Parameters that matter   table: matchName · name · type · meaning · quirk
## Input              how the model/file gets in (importer → layer index parameter)
## Camera / 3D        picks up the comp camera? units; scale semantics; FOV coupling
## UI-only            buttons/panels the script cannot press and the workaround
## Scripting quirks   properties that throw on read, NO_VALUE groups, expressions that work
## Performance        measured (what, resolution, frames, seconds, machine)
## Open issues        with the next test that would settle each
## Sources            docs, pages, test notes
```
