# Third-Party Notices

AE-MCP-IMT by Immersive Media Technologies incorporates code from the projects
below. Both are distributed by their authors under the MIT License, which
requires that the copyright notice and permission notice be retained; they are
reproduced here. The combined work is licensed under the IMT Non-Commercial
License (see LICENSE).

---

## kumoproductions/mcp-aftereffects

Copyright (c) 2026 kumo.productions, Inc.

Upstream: https://github.com/kumoproductions/mcp-aftereffects
Used as: the base of this project. Transport, operation registry, tool
surface, policy layer, ExtendScript runtime helpers and test harness are
upstream code, carried with modifications noted in `CHANGELOG.md`.

---

## Dakkshin/after-effects-mcp

Copyright (c) Dakkshin

Upstream: https://github.com/Dakkshin/after-effects-mcp
Used as: source of the named effect-template catalogue in
`src/operations/effect-template.ts`, ported from
`src/scripts/applyEffectTemplate.jsx`. The catalogue was corrected during the
port (two non-existent effect matchNames, and locale-dependent property
addressing); see the file header for the specifics.

---

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Skills fetched by `skills/ae-motion/fetch-vendor.sh` (not redistributed)

The AE Motion skill routes to topic references from the following repositories. They are **not part of
this repository**: the script downloads them at pinned commits into `skills/ae-motion/vendor/`
(git-ignored), each with its own `LICENSE` and a `.source` file.

| Repository                                                                                                  | Commit  | Licence    |
| ----------------------------------------------------------------------------------------------------------- | ------- | ---------- |
| https://github.com/Engine-Room-Games/after-effects-mcp (`plugin/skills`)                                    | e0598fd | MIT        |
| https://github.com/fuuuuuuma/after-effects-agent (`plugins/after-effects-agent/skills/after-effects-agent`) | 8eaf847 | MIT        |
| https://github.com/LobzyJay/motion-design-with-claude (`skills`)                                            | a4d48c5 | MIT        |
| https://github.com/iart-ai/motion-design-skills (`skills`)                                                  | 3c129f7 | MIT        |
| https://github.com/heygen-com/hyperframes (`skills/hyperframes-animation`)                                  | 097250e | Apache-2.0 |
