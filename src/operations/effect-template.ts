// Effect templates — named presets that apply one or more effects with
// sensible defaults in a single call.
//
// ORIGIN: the template catalogue below is ported from
//   Dakkshin/after-effects-mcp — src/scripts/applyEffectTemplate.jsx
//   Copyright (c) Dakkshin, MIT License. See THIRD-PARTY-NOTICES.md.
//
// Deep Artisan changes vs. the original, and why each was necessary:
//
//   * LOCALE. The original addressed effect properties by English display name
//     (`effect.property("Shadow Color")`). On a non-English After Effects that
//     returns null for every one of them, and the original swallowed the miss
//     into `$.writeln` — so on a ru_RU / ja_JP install every template applied
//     its effects with untouched factory defaults and still reported success.
//     Verified against AE 26.3 ru_RU: all five Drop Shadow properties missed.
//     Settings are therefore keyed by 1-based property INDEX, which is stable
//     across locales, with the English name kept for documentation and tried
//     first as a fast path.
//   * MATCHNAMES. Two of the original's effects do not exist in After Effects:
//     "ADBE Directional Blur" (real: "ADBE Motion Blur") and "ADBE Glow"
//     (real: "ADBE Glo2"). Checked against the live 446-effect catalogue of
//     AE 26.3 — both templates were dead on arrival upstream.
//   * The effect group is reached via matchName "ADBE Effect Parade" rather
//     than the locale-dependent `layer.Effects` accessor.
//   * Per-effect failures are reported to the caller in `warnings` instead of
//     being swallowed; a missing plug-in fails the call loudly.
//   * Overrides are merged per effect, on the Node side, and go through
//     jsxVal — nothing from `args` is concatenated into the JSX source.

import { registerOp, jsxVal, jsxCompLayerPreamble } from "../registry.js";

/** One overridable property of a templated effect. */
interface TemplateSetting {
  /**
   * 1-based index of the property WITHIN the effect. Locale-independent and
   * therefore the authoritative address.
   */
  index: number;
  /** English display name — documentation, and the fast path on en_US. */
  name: string;
  value: unknown;
}

interface TemplateEffect {
  matchName: string;
  settings: TemplateSetting[];
}

/**
 * Named effect presets. A template is an ordered list of effects; the order
 * matters because AE renders the effect stack top-down.
 */
export const EFFECT_TEMPLATES: Record<string, { description: string; effects: TemplateEffect[] }> =
  {
    "gaussian-blur": {
      description: "Standard gaussian blur.",
      effects: [
        {
          matchName: "ADBE Gaussian Blur 2",
          settings: [{ index: 1, name: "Blurriness", value: 20 }],
        },
      ],
    },
    "directional-blur": {
      description: "Motion-style blur along one axis.",
      effects: [
        {
          matchName: "ADBE Motion Blur",
          settings: [
            { index: 1, name: "Direction", value: 0 },
            { index: 2, name: "Blur Length", value: 10 },
          ],
        },
      ],
    },
    "color-balance": {
      description: "Hue / lightness / saturation correction.",
      effects: [
        {
          matchName: "ADBE Color Balance (HLS)",
          settings: [
            { index: 1, name: "Hue", value: 0 },
            { index: 2, name: "Lightness", value: 0 },
            { index: 3, name: "Saturation", value: 0 },
          ],
        },
      ],
    },
    "brightness-contrast": {
      description: "Brightness and contrast correction.",
      effects: [
        {
          matchName: "ADBE Brightness & Contrast 2",
          settings: [
            { index: 1, name: "Brightness", value: 0 },
            { index: 2, name: "Contrast", value: 0 },
          ],
        },
      ],
    },
    curves: {
      description: "Curves, added with its default (linear) response for manual shaping.",
      effects: [{ matchName: "ADBE CurvesCustom", settings: [] }],
    },
    glow: {
      description: "Glow around bright areas.",
      effects: [
        {
          matchName: "ADBE Glo2",
          settings: [
            { index: 2, name: "Glow Threshold", value: 50 },
            { index: 3, name: "Glow Radius", value: 15 },
            { index: 4, name: "Glow Intensity", value: 1 },
          ],
        },
      ],
    },
    "drop-shadow": {
      description: "Drop shadow behind the layer.",
      effects: [
        {
          matchName: "ADBE Drop Shadow",
          settings: [
            { index: 1, name: "Shadow Color", value: [0, 0, 0] },
            { index: 2, name: "Opacity", value: 128 },
            { index: 3, name: "Direction", value: 135 },
            { index: 4, name: "Distance", value: 10 },
            { index: 5, name: "Softness", value: 10 },
          ],
        },
      ],
    },
    "cinematic-look": {
      description: "Curves + Vibrance chain for a filmic grade.",
      effects: [
        { matchName: "ADBE CurvesCustom", settings: [] },
        {
          matchName: "ADBE Vibrance",
          settings: [
            { index: 1, name: "Vibrance", value: 15 },
            { index: 2, name: "Saturation", value: -5 },
          ],
        },
      ],
    },
    "text-pop": {
      description: "Drop shadow + glow so text reads over busy footage.",
      effects: [
        {
          matchName: "ADBE Drop Shadow",
          settings: [
            { index: 1, name: "Shadow Color", value: [0, 0, 0] },
            { index: 2, name: "Opacity", value: 191 },
            { index: 4, name: "Distance", value: 5 },
            { index: 5, name: "Softness", value: 10 },
          ],
        },
        {
          matchName: "ADBE Glo2",
          settings: [
            { index: 2, name: "Glow Threshold", value: 50 },
            { index: 3, name: "Glow Radius", value: 10 },
            { index: 4, name: "Glow Intensity", value: 1.5 },
          ],
        },
      ],
    },
  };

const TEMPLATE_NAMES = Object.keys(EFFECT_TEMPLATES);

registerOp({
  name: "effect.apply_template",
  category: "effect",
  description:
    "Apply a named effect preset to a layer in one call. Each template is one or more effects with sensible defaults; pass `settings` to override individual values by their English property name. Templates: " +
    TEMPLATE_NAMES.join(", ") +
    ". Use effect.list_templates for the property names and defaults each one accepts.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    {
      name: "template",
      type: "string",
      description: `Template name — one of: ${TEMPLATE_NAMES.join(", ")}`,
      required: true,
    },
    {
      name: "settings",
      type: "object",
      description:
        'Value overrides keyed by the English property name, e.g. {"Blurriness": 40}. Names come from effect.list_templates. A key that no effect in the template declares is reported in `warnings` rather than failing the call.',
      required: false,
    },
  ],
  toJsx(args) {
    const tpl = EFFECT_TEMPLATES[String(args.template)];
    if (!tpl) {
      return `return { ok: false, error: "unknown template " + ${jsxVal(
        String(args.template),
      )} + " — available: " + ${jsxVal(TEMPLATE_NAMES.join(", "))} };`;
    }
    // Merge the caller's overrides into each effect's defaults HERE, on the
    // Node side, so the JSX only ever receives a plain literal via jsxVal.
    const overrides = (args.settings ?? {}) as Record<string, unknown>;
    const plan = tpl.effects.map((fx) => ({
      matchName: fx.matchName,
      settings: fx.settings.map((s) => ({
        index: s.index,
        name: s.name,
        value: Object.prototype.hasOwnProperty.call(overrides, s.name)
          ? overrides[s.name]
          : s.value,
      })),
    }));
    // Override keys no effect in this template declares — surfaced so a typo
    // ("blurriness" vs "Blurriness") is visible instead of silently doing
    // nothing, which is exactly how the upstream version failed.
    const known = new Set(tpl.effects.flatMap((fx) => fx.settings.map((s) => s.name)));
    const unknownKeys = Object.keys(overrides).filter((k) => !known.has(k));

    return `
            ${jsxCompLayerPreamble(args)}
            // matchName, not the localised display name: on a ru_RU / ja_JP
            // build "Effects" is not what the group is called in the UI.
            var _fxRoot = _layer.property("ADBE Effect Parade");
            if (!_fxRoot) return { ok: false, error: "layer '" + _layer.name + "' has no Effects group (is it a camera or a light?)" };
            var _plan = ${jsxVal(plan)};
            var _applied = [];
            var _warnings = ${jsxVal(
              unknownKeys.map((k) => `override '${k}' is not a property of this template`),
            )};
            for (var _i = 0; _i < _plan.length; _i++) {
                var _step = _plan[_i];
                var _fx = null;
                try { _fx = _fxRoot.addProperty(_step.matchName); } catch (eAdd) {
                    return { ok: false, error: "cannot add effect " + _step.matchName + ": " + AE.errText(eAdd) + " — is the plug-in installed?", applied: _applied };
                }
                var _set = [];
                for (var _j = 0; _j < _step.settings.length; _j++) {
                    var _s = _step.settings[_j];
                    // Fast path: the English name, which resolves on an en_US
                    // build. Authoritative path: the 1-based index, which
                    // resolves everywhere. Never trust the name alone.
                    var _prop = null;
                    try { _prop = _fx.property(_s.name); } catch (eByName) {}
                    if (!_prop) {
                        try { _prop = _fx.property(_s.index); } catch (eByIdx) {}
                    }
                    if (!_prop) {
                        _warnings.push(_step.matchName + ": no property '" + _s.name + "' (index " + _s.index + ")");
                        continue;
                    }
                    try {
                        _prop.setValue(_s.value);
                        _set.push({ name: _prop.name, index: _s.index });
                    } catch (eSet) {
                        _warnings.push(_step.matchName + "." + _s.name + ": " + AE.errText(eSet));
                    }
                }
                _applied.push({ index: _fx.propertyIndex, name: _fx.name, matchName: _fx.matchName, set: _set });
            }
            return {
                ok: true,
                template: ${jsxVal(String(args.template))},
                layer: _layer.name,
                applied: _applied,
                warnings: _warnings
            };
        `;
  },
});

registerOp({
  name: "effect.list_templates",
  category: "effect",
  readOnly: true,
  description:
    "List the named effect presets available to effect.apply_template, with the effects each one adds and the property names and defaults that can be overridden via `settings`. The catalogue is static server data — it describes what the templates declare, not what this After Effects install actually has; a missing plug-in is reported by effect.apply_template at apply time.",
  params: [],
  toJsx() {
    const catalogue = TEMPLATE_NAMES.map((name) => {
      const t = EFFECT_TEMPLATES[name];
      return {
        template: name,
        description: t.description,
        effects: t.effects.map((fx) => ({
          matchName: fx.matchName,
          settings: Object.fromEntries(fx.settings.map((s) => [s.name, s.value])),
        })),
      };
    });
    return `return { ok: true, templates: ${jsxVal(catalogue)}, count: ${jsxVal(
      catalogue.length,
    )} };`;
  },
});
