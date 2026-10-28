// Render queue operations.

import { registerOp, jsxVal, jsxCompPreamble } from "../registry.js";

/**
 * A built-in render-settings or output-module template under its name in each
 * UI language After Effects ships. Template names live in the user's
 * preferences in the language AE ran in when it created them — on a Russian AE
 * "Best Settings" is «Оптимальные настройки» — and applyTemplate() takes a name
 * only verbatim.
 */
interface TemplateAliases {
  /** The ZString AE translates the name from: `localize()` of it is THIS AE's name. */
  key: string;
  /** English first, then de, es, fr, it, ja, ko, pt-BR, ru, zh-CN. */
  names: Record<string, string>;
}

// Read from After Effects 26.5's own string tables: English from its binaries,
// the other nine from Dictionaries/<locale>/after_effects_<locale>.dat. A name
// only ever resolves to a template the running AE actually lists, so a stale
// entry here can cost a resolution, never select a different template.
export const RENDER_SETTINGS_TEMPLATE_ALIASES: TemplateAliases[] = [
  {
    key: "$$$/AE/EGG/LStr/0492",
    names: {
      en: "Best Settings",
      de: "Optimale Einstellungen",
      es: "Configuración óptima",
      fr: "Paramètres optimaux",
      it: "Impostazioni migliori",
      ja: "最良設定",
      ko: "최고 설정",
      "pt-BR": "Melhores configurações",
      ru: "Оптимальные настройки",
      "zh-CN": "最佳设置",
    },
  },
  {
    key: "$$$/AE/EGG/LStr/0491",
    names: {
      en: "Draft Settings",
      de: "Entwurfseinstellungen",
      es: "Configuración borrador",
      fr: "Rendu ébauche",
      it: "Impostazioni bozza",
      ja: "ドラフト設定",
      ko: "초안 설정",
      "pt-BR": "Configurações de rascunho",
      ru: "Настройки черновика",
      "zh-CN": "草图设置",
    },
  },
  {
    key: "$$$/AE/EGG/LStr/0489",
    names: {
      en: "Current Settings",
      de: "Aktuelle Einstellungen",
      es: "Configuración actual",
      fr: "Paramètres actuels",
      it: "Impostazioni correnti",
      ja: "現在の設定",
      ko: "현재 설정",
      "pt-BR": "Configurações atuais",
      ru: "Текущие настройки",
      "zh-CN": "当前设置",
    },
  },
  {
    key: "$$$/AE/EGG/LStr/2104",
    names: {
      en: "DV Settings",
      de: "DV-Einstellungen",
      es: "Configuración de DV",
      fr: "Paramètres DV",
      it: "Impostazioni DV",
      ja: "DV 設定",
      ko: "DV 설정",
      "pt-BR": "Configurações de DV",
      ru: "Настройки DV",
      "zh-CN": "DV 设置",
    },
  },
  {
    key: "$$$/AE/EGG/LStr/1387",
    names: {
      en: "Multi-Machine Settings",
      de: "Einstellungen für mehrere Rechner",
      es: "Configuración de varios equipos",
      fr: "Paramètres machines multiples",
      it: "Impostazioni per più sistemi",
      ja: "マルチマシン設定",
      ko: "다중 시스템 설정",
      "pt-BR": "Configurações de vários computadores",
      ru: "Настройки системы с несколькими компьютерами",
      "zh-CN": "多机设置",
    },
  },
];

export const OUTPUT_MODULE_TEMPLATE_ALIASES: TemplateAliases[] = [
  {
    key: "$$$/AE/Edit/Templates/OutputModule/HighQualityProRes442",
    names: {
      en: "High Quality",
      de: "Hohe Qualität",
      es: "Calidad alta",
      fr: "Qualité supérieure",
      it: "Alta qualità",
      ja: "高品質",
      ko: "고품질",
      "pt-BR": "Qualidade superior",
      ru: "Высокое качество",
      "zh-CN": "高品质",
    },
  },
  {
    key: "$$$/AE/Edit/Templates/OutputModule/HighQualityAlphaProRes4444",
    names: {
      en: "High Quality with Alpha",
      de: "Hohe Qualität mit Alpha",
      es: "Calidad alta con Alfa",
      fr: "Qualité supérieure avec alpha",
      it: "Alta qualità con alfa",
      ja: "アルファ付き高品質",
      ko: "고품질(알파 포함)",
      "pt-BR": "Alta qualidade com alfa",
      ru: "Высокое качество с альфа-каналом",
      "zh-CN": "具有 Alpha 的高品质",
    },
  },
  {
    key: "$$$/AE/EGG/LStr/0894",
    names: {
      en: "Lossless",
      de: "Verlustfrei",
      es: "Sin pérdida",
      fr: "Non destructif",
      it: "Senza perdite",
      ja: "ロスレス圧縮",
      ko: "손실 없음",
      "pt-BR": "Sem perdas",
      ru: "Без потерь",
      "zh-CN": "无损",
    },
  },
  {
    key: "$$$/AE/EGG/LStr/1894",
    names: {
      en: "Lossless with Alpha",
      de: "Verlustfrei mit Alpha",
      es: "Sin pérdida con alfa",
      fr: "Non destructif avec alpha",
      it: "Senza perdita con alfa",
      ja: "ロスレス圧縮（アルファ付き）",
      ko: "알파 포함 무손실",
      "pt-BR": "Sem perdas com alfa",
      ru: "Формат без потери качества с альфа-каналом",
      "zh-CN": "使用 Alpha 无损耗",
    },
  },
  {
    key: "$$$/AE/EGG/LStr/0499",
    names: {
      en: "Alpha Only",
      de: "Nur Alphakanal",
      es: "Sólo alfa",
      fr: "Alpha seule",
      it: "Solo alfa",
      ja: "アルファのみ",
      ko: "알파 전용",
      "pt-BR": "Somente alfa",
      ru: "Только альфа-канал",
      "zh-CN": "仅 Alpha",
    },
  },
  {
    key: "$$$/AE/EGG/LStr/1386",
    names: {
      en: "Multi-Machine Sequence",
      de: "Sequenz für mehrere Rechner",
      es: "Secuencia de varios equipos",
      fr: "Séquence machines multiples",
      it: "Sequenza in più sistemi",
      ja: "マルチマシンシーケンス",
      ko: "다중 시스템 시퀀스",
      "pt-BR": "Sequência de vários computadores",
      ru: "Эпизод с нескольких компьютеров",
      "zh-CN": "多机序列",
    },
  },
  {
    key: "$$$/ae/OutputModuleTemplates/TIFF_Seq_with_Alpha",
    names: {
      en: "TIFF Sequence with Alpha",
      de: "TIFF-Sequenz mit Alpha",
      es: "Secuencia TIFF con alfa",
      fr: "Séquence TIFF avec alpha",
      it: "Sequenza TIFF con alfa",
      ja: "TIFF シーケンス (アルファ付き)",
      ko: "알파가 포함된 TIFF 시퀀스",
      "pt-BR": "Sequência TIFF com alfa",
      ru: "Последовательность TIFF с альфа-каналом",
      "zh-CN": "带有 Alpha 的 TIFF 序列",
    },
  },
  {
    key: "$$$/ae/OutputModuleTemplates/AIFF_48KHz",
    names: {
      en: "AIFF 48kHz",
      de: "AIFF 48 kHz",
      es: "AIFF 48 kHz",
      fr: "AIFF 48 kHz",
      it: "AIFF 48kHz",
      ja: "AIFF 48 kHz",
      ko: "AIFF 48kHz",
      "pt-BR": "AIFF 48kHz",
      ru: "AIFF 48 кГц",
      "zh-CN": "AIFF 48kHz",
    },
  },
  {
    key: "$$$/AE/Edit/Templates/OutputModule/H264Bitrate_5",
    names: {
      en: "H.264 - Match Render Settings -  5 Mbps",
      de: "H.264 – Render-Einstellungen abgleichen – 5 Mbit/s",
      es: "H.264: Configuración de procesamiento de coincidencia, 5 Mbps",
      fr: "H.264 - paramètres de rendu de correspondance - 5 Mbits",
      it: "H.264 - Impostazioni di rendering corrispondenti - 5 mbps",
      ja: "H.264 - レンダリング設定を一致 - 5 Mbps",
      ko: "H.264 - 렌더링 일치 설정 - 5Mbps",
      "pt-BR": "H.264 - Corresponder configurações de renderização - 5 Mbps",
      ru: "H.264 — Использовать настройки рендеринга — 5 Мбит/с",
      "zh-CN": "H.264 - 匹配渲染设置 - 5 Mbps",
    },
  },
  {
    key: "$$$/AE/Edit/Templates/OutputModule/H264Bitrate15",
    names: {
      en: "H.264 - Match Render Settings - 15 Mbps",
      de: "H.264 – Render-Einstellungen abgleichen – 15 Mbit/s",
      es: "H.264: Ajustes de procesamiento de coincidencia, 15 Mbps",
      fr: "H.264 - Paramètres de rendu de correspondance - 15 Mbits",
      it: "H.264 - Impostazioni di rendering corrispondenti - 15 mbps",
      ja: "H.264 - レンダリング設定を一致 - 15 Mbps",
      ko: "H.264 - 렌더링 일치 설정 - 15Mbps",
      "pt-BR": "H.264 - Corresponder configurações de renderização - 15 Mbps",
      ru: "H.264 — Использовать настройки рендеринга — 15 Мбит/с",
      "zh-CN": "H.264 - 匹配渲染设置 - 15 Mbps",
    },
  },
  {
    key: "$$$/AE/Edit/Templates/OutputModule/H264Bitrate40",
    names: {
      en: "H.264 - Match Render Settings - 40 Mbps",
      de: "H.264 – Render-Einstellungen abgleichen – 40 Mbit/s",
      es: "H.264: Ajustes de procesamiento de coincidencia, 40 Mbps",
      fr: "H.264 - Paramètres de rendu de correspondance - 40 Mbits",
      it: "H.264 - Impostazioni di rendering corrispondenti - 40 mbps",
      ja: "H.264 - レンダリング設定を一致 - 40 Mbps",
      ko: "H.264 - 렌더링 일치 설정 - 40Mbps",
      "pt-BR": "H.264 - Corresponder configurações de renderização - 40 Mbps",
      ru: "H.264 — Использовать настройки рендеринга — 40 Мбит/с",
      "zh-CN": "H.264 - 匹配渲染设置 - 40 Mbps",
    },
  },
];

/** The alias tables in the shape AE.resolveTemplateName (jsx/helpers.jsx) takes. */
function jsxTemplateGroups(table: TemplateAliases[]): string {
  return jsxVal(table.map((t) => ({ key: t.key, names: Object.values(t.names) })));
}

registerOp({
  name: "render.add_to_queue",
  category: "render",
  description:
    "Add a composition to the render queue. Optionally set output path (the output folder is created if missing). Format/codec/channels of the output module — render.set_om_settings.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "outputPath",
      type: "string",
      description: "Output file path (optional, sets on the first output module)",
      required: false,
    },
  ],
  toJsx(args) {
    const outputPathJsx = args.outputPath
      ? `
                try {
                    var _of = new File(${jsxVal(args.outputPath)});
                    if (_of.parent && !_of.parent.exists) { _of.parent.create(); }
                    _rqi.outputModules[1].file = _of;
                    _result.outputPath = ${jsxVal(args.outputPath)};
                } catch(e) { _result.outputWarning = "could not set output path: " + AE.errText(e); }
            `
      : "";
    return `
            ${jsxCompPreamble(args)}
            var _rqi = app.project.renderQueue.items.add(_comp);
            var _result = { ok: true, queueIndex: app.project.renderQueue.numItems, compName: _comp.name };
            ${outputPathJsx}
            return _result;
        `;
  },
});

registerOp({
  name: "render.start",
  category: "render",
  description: "Start rendering the render queue. Blocks until complete.",
  params: [],
  toJsx() {
    return `
            var rq = app.project.renderQueue;
            if (rq.numItems === 0) return { ok: false, error: "render queue is empty" };
            rq.render();
            return { ok: true, rendered: rq.numItems };
        `;
  },
});

registerOp({
  name: "render.clear_queue",
  category: "render",
  description: "Remove all items from the render queue.",
  params: [],
  toJsx() {
    return `
            var rq = app.project.renderQueue;
            var removed = 0;
            while (rq.numItems > 0) {
                rq.item(1).remove();
                removed++;
            }
            return { ok: true, removed: removed };
        `;
  },
});

/** Resolve `_rqi` from an optional queueIndex arg (default: last item). */
function jsxRqItemPreamble(args: Record<string, unknown>): string {
  return `
        var rq = app.project.renderQueue;
        if (rq.numItems === 0) return { ok: false, error: "render queue is empty" };
        var _qi = ${jsxVal(args.queueIndex ?? null)};
        if (_qi === null) _qi = rq.numItems;
        if (_qi < 1 || _qi > rq.numItems) return { ok: false, error: "queue index out of range (1-" + rq.numItems + ")" };
        var _rqi = rq.item(_qi);
    `;
}

registerOp({
  name: "render.set_output",
  category: "render",
  description:
    "Configure a render-queue item: render/output templates, output path, time span, render flag, skipFrames, logType, postRenderAction. Template names are in the UI language of this After Effects — discover them with render.list_templates; the built-in templates also accept their English name. A template name this AE does not have fails the call (nothing is changed) and the error lists the available names. Raw settings via render.get_settings / render.set_settings.",
  params: [
    {
      name: "queueIndex",
      type: "number",
      description: "1-based queue item index (default: last item)",
      required: false,
    },
    {
      name: "renderTemplate",
      type: "string",
      description:
        'Render settings template name as render.list_templates lists it. The built-in ones also resolve from their English name ("Best Settings", "Draft Settings", "Current Settings", "DV Settings", "Multi-Machine Settings") on a localized AE',
      required: false,
    },
    {
      name: "outputTemplate",
      type: "string",
      description:
        'Output module template name as render.list_templates lists it. The built-in ones also resolve from their English name ("High Quality", "High Quality with Alpha", "Lossless", "Lossless with Alpha", "Alpha Only", "TIFF Sequence with Alpha", "AIFF 48kHz", "H.264 - Match Render Settings - 15 Mbps", …) on a localized AE',
      required: false,
    },
    { name: "outputPath", type: "string", description: "Output file path", required: false },
    {
      name: "timeSpanStart",
      type: "number",
      description: "Render span start in seconds (comp time)",
      required: false,
    },
    {
      name: "timeSpanDuration",
      type: "number",
      description: "Render span duration in seconds",
      required: false,
    },
    {
      name: "outputModuleIndex",
      type: "number",
      description: "1-based output module index (default 1)",
      required: false,
      default: 1,
    },
    {
      name: "render",
      type: "boolean",
      description: "Whether this item renders when the queue starts (the Render checkbox)",
      required: false,
    },
    {
      name: "skipFrames",
      type: "number",
      description: "Render every Nth frame (0 = every frame)",
      required: false,
    },
    {
      name: "logType",
      type: "string",
      description: "errorsOnly|errorsAndSettings|errorsAndPerFrameInfo",
      required: false,
    },
    {
      name: "postRenderAction",
      type: "string",
      description: "none|import|importAndReplaceUsage|setProxy (on the output module)",
      required: false,
    },
    {
      name: "includeSourceXMP",
      type: "boolean",
      description: "Embed source-footage XMP metadata in the output",
      required: false,
    },
    {
      name: "queueItemNotify",
      type: "boolean",
      description: "Per-item Notify checkbox (AE 22.0+)",
      required: false,
    },
    {
      name: "queueNotify",
      type: "boolean",
      description: "QUEUE-WIDE Notify checkbox (RenderQueue.queueNotify, AE 22.0+)",
      required: false,
    },
  ],
  toJsx(args) {
    const rqiSets: string[] = [];
    if (args.queueNotify !== undefined)
      rqiSets.push(
        `try { rq.queueNotify = ${jsxVal(args.queueNotify)}; } catch (eQq) { _w.push("queueNotify (AE 22.0+): " + AE.errText(eQq)); }`,
      );
    // Template names are checked before anything is changed. An unknown name
    // used to cost only a warning, and AE then rendered with whatever template
    // the item already had — on a localized AE every English name ("Best
    // Settings") is unknown. Now it fails the call and lists the names this AE
    // has; the built-in templates also resolve from their English name (or
    // their name in any UI language AE ships) to the one this AE uses.
    const templateChecks: string[] = [];
    if (args.renderTemplate !== undefined) {
      templateChecks.push(`
            var _rtWant = ${jsxVal(args.renderTemplate)};
            _rtName = _rtWant;
            var _rtList = null;
            try { _rtList = _rqi.templates; } catch (eRtl) {}
            if (_rtList && _rtList.length) {
                var _rtHit = AE.resolveTemplateName(_rtWant, _rtList, ${jsxTemplateGroups(RENDER_SETTINGS_TEMPLATE_ALIASES)});
                if (!_rtHit) return { ok: false, error: "render settings template '" + _rtWant + "' does not exist in this After Effects (template names are in its UI language) - available: " + AE.visibleTemplateNames(_rtList).join(", "), renderTemplates: AE.visibleTemplateNames(_rtList) };
                _rtName = _rtHit.name;
                if (_rtHit.via !== "exact") _w.push("renderTemplate '" + _rtWant + "' is '" + _rtName + "' in this After Effects");
            }
        `);
      rqiSets.push(
        `try { _rqi.applyTemplate(_rtName); } catch (eRt) { return { ok: false, error: "render settings template '" + _rtName + "' could not be applied: " + AE.errText(eRt), warnings: _w }; }`,
      );
    }
    if (args.timeSpanStart !== undefined)
      rqiSets.push(
        `try { _rqi.timeSpanStart = ${jsxVal(args.timeSpanStart)}; } catch (eTs) { _w.push("timeSpanStart: " + AE.errText(eTs)); }`,
      );
    if (args.timeSpanDuration !== undefined)
      rqiSets.push(
        `try { _rqi.timeSpanDuration = ${jsxVal(args.timeSpanDuration)}; } catch (eTd) { _w.push("timeSpanDuration: " + AE.errText(eTd)); }`,
      );
    if (args.render !== undefined)
      rqiSets.push(
        `try { _rqi.render = ${jsxVal(args.render)}; } catch (eRf) { _w.push("render: " + AE.errText(eRf)); }`,
      );
    if (args.skipFrames !== undefined)
      rqiSets.push(
        `try { _rqi.skipFrames = ${jsxVal(args.skipFrames)}; } catch (eSk) { _w.push("skipFrames: " + AE.errText(eSk)); }`,
      );
    if (args.logType !== undefined)
      rqiSets.push(`
                try {
                    var _ltMap = { "errorsOnly": LogType.ERRORS_ONLY, "errorsAndSettings": LogType.ERRORS_AND_SETTINGS, "errorsAndPerFrameInfo": LogType.ERRORS_AND_PER_FRAME_INFO };
                    if (_ltMap.hasOwnProperty(${jsxVal(args.logType)})) {
                        _rqi.logType = _ltMap[${jsxVal(args.logType)}];
                    } else { _w.push("logType: unknown value " + ${jsxVal(args.logType)}); }
                } catch (eLt) { _w.push("logType: " + AE.errText(eLt)); }
            `);
    if (args.queueItemNotify !== undefined)
      rqiSets.push(
        `try { _rqi.queueItemNotify = ${jsxVal(args.queueItemNotify)}; } catch (eQn) { _w.push("queueItemNotify (AE 22.0+): " + AE.errText(eQn)); }`,
      );
    const omSets: string[] = [];
    if (args.outputTemplate !== undefined) {
      templateChecks.push(`
            var _otWant = ${jsxVal(args.outputTemplate)};
            _otName = _otWant;
            var _otList = null;
            try { _otList = _om.templates; } catch (eOtl) {}
            if (_otList && _otList.length) {
                var _otHit = AE.resolveTemplateName(_otWant, _otList, ${jsxTemplateGroups(OUTPUT_MODULE_TEMPLATE_ALIASES)});
                if (!_otHit) return { ok: false, error: "output module template '" + _otWant + "' does not exist in this After Effects (template names are in its UI language) - available: " + AE.visibleTemplateNames(_otList).join(", "), outputTemplates: AE.visibleTemplateNames(_otList) };
                _otName = _otHit.name;
                if (_otHit.via !== "exact") _w.push("outputTemplate '" + _otWant + "' is '" + _otName + "' in this After Effects");
            }
        `);
      omSets.push(
        `try { _om.applyTemplate(_otName); } catch (eOt) { return { ok: false, error: "output module template '" + _otName + "' could not be applied: " + AE.errText(eOt), warnings: _w }; }`,
      );
    }
    if (args.outputPath !== undefined)
      omSets.push(
        `try { var _of = new File(${jsxVal(args.outputPath)}); if (_of.parent && !_of.parent.exists) { _of.parent.create(); } _om.file = _of; } catch (eOp) { _w.push("outputPath: " + AE.errText(eOp)); }`,
      );
    if (args.postRenderAction !== undefined)
      omSets.push(`
                try {
                    var _praMap = { "none": PostRenderAction.NONE, "import": PostRenderAction.IMPORT, "importAndReplaceUsage": PostRenderAction.IMPORT_AND_REPLACE_USAGE, "setProxy": PostRenderAction.SET_PROXY };
                    if (_praMap.hasOwnProperty(${jsxVal(args.postRenderAction)})) {
                        _om.postRenderAction = _praMap[${jsxVal(args.postRenderAction)}];
                    } else { _w.push("postRenderAction: unknown value " + ${jsxVal(args.postRenderAction)}); }
                } catch (ePa) { _w.push("postRenderAction: " + AE.errText(ePa)); }
            `);
    if (args.includeSourceXMP !== undefined)
      omSets.push(
        `try { _om.includeSourceXMP = ${jsxVal(args.includeSourceXMP)}; } catch (eXm) { _w.push("includeSourceXMP: " + AE.errText(eXm)); }`,
      );
    return `
            ${jsxRqItemPreamble(args)}
            var _w = [];
            var _rtName = null;
            var _otName = null;
            var _om = null;
            try { _om = _rqi.outputModule(${jsxVal(args.outputModuleIndex ?? 1)}); } catch (eOm) {}
            if (!_om) return { ok: false, error: "no output module at index " + ${jsxVal(args.outputModuleIndex ?? 1)} };
            ${templateChecks.join("\n")}
            ${rqiSets.join("\n")}
            ${omSets.join("\n")}
            return {
                ok: true,
                queueIndex: _qi,
                comp: _rqi.comp.name,
                renderTemplate: _rtName,
                outputTemplate: _otName,
                timeSpanStart: _rqi.timeSpanStart,
                timeSpanDuration: _rqi.timeSpanDuration,
                outputPath: _om.file ? _om.file.fsName.replace(/\\\\/g, "/") : null,
                warnings: _w
            };
        `;
  },
});

registerOp({
  name: "render.get_settings",
  category: "render",
  readOnly: true,
  description:
    "Read the raw render settings of a queue item and the settings of each of its output modules (getSettings, AE 13.0+). format 'settable' returns only keys accepted by render.set_settings / render.set_om_settings.",
  params: [
    {
      name: "queueIndex",
      type: "number",
      description: "1-based queue item index (default: last item)",
      required: false,
    },
    {
      name: "format",
      type: "string",
      description: "settable|all (default settable)",
      required: false,
      default: "settable",
    },
  ],
  toJsx(args) {
    return `
            ${jsxRqItemPreamble(args)}
            if (typeof _rqi.getSettings !== "function") return { ok: false, error: "getSettings needs AE 13.0+" };
            var _fmt = ${jsxVal(args.format ?? "settable")} === "all" ? GetSettingsFormat.STRING : GetSettingsFormat.STRING_SETTABLE;
            var _rs = null;
            try { _rs = _rqi.getSettings(_fmt); } catch (eRs) { return { ok: false, error: "getSettings failed: " + AE.errText(eRs) }; }
            var _oms = [];
            for (var _o = 1; _o <= _rqi.numOutputModules; _o++) {
                var _om = _rqi.outputModule(_o);
                var _os = null;
                try { _os = _om.getSettings(_fmt); } catch (eOs) {}
                _oms.push({ index: _o, name: AE.safeGet(function () { return _om.name; }, null), settings: _os });
            }
            return { ok: true, queueIndex: _qi, comp: _rqi.comp ? _rqi.comp.name : null, renderSettings: _rs, outputModules: _oms };
        `;
  },
});

registerOp({
  name: "render.set_settings",
  category: "render",
  description:
    'Set raw render settings on a queue item (RenderQueueItem.setSettings, AE 13.0+), e.g. { "Quality": "Best", "Resolution": "Half" }. Discover valid keys/values with render.get_settings.',
  params: [
    {
      name: "queueIndex",
      type: "number",
      description: "1-based queue item index (default: last item)",
      required: false,
    },
    {
      name: "settings",
      type: "object",
      description: "Key/value map from render.get_settings format 'settable'",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxRqItemPreamble(args)}
            if (typeof _rqi.setSettings !== "function") return { ok: false, error: "setSettings needs AE 13.0+" };
            try { _rqi.setSettings(${jsxVal(args.settings)}); } catch (eSs) { return { ok: false, error: "setSettings failed: " + AE.errText(eSs) }; }
            var _after = null;
            try { _after = _rqi.getSettings(GetSettingsFormat.STRING_SETTABLE); } catch (eAf) {}
            return { ok: true, queueIndex: _qi, renderSettings: _after };
        `;
  },
});

registerOp({
  name: "render.set_om_settings",
  category: "render",
  description:
    'Set raw output-module settings on a queue item (OutputModule.setSettings, AE 13.0+), e.g. { "Format": "QuickTime", "Channels": "RGB + Alpha" }. Discover valid keys/values with render.get_settings.',
  params: [
    {
      name: "queueIndex",
      type: "number",
      description: "1-based queue item index (default: last item)",
      required: false,
    },
    {
      name: "outputModuleIndex",
      type: "number",
      description: "1-based output module index (default 1)",
      required: false,
      default: 1,
    },
    {
      name: "settings",
      type: "object",
      description: "Key/value map from render.get_settings format 'settable'",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxRqItemPreamble(args)}
            var _om = null;
            try { _om = _rqi.outputModule(${jsxVal(args.outputModuleIndex ?? 1)}); } catch (eOm) {}
            if (!_om) return { ok: false, error: "no output module at index " + ${jsxVal(args.outputModuleIndex ?? 1)} };
            if (typeof _om.setSettings !== "function") return { ok: false, error: "setSettings needs AE 13.0+" };
            try { _om.setSettings(${jsxVal(args.settings)}); } catch (eSs) { return { ok: false, error: "setSettings failed: " + AE.errText(eSs) }; }
            var _after = null;
            try { _after = _om.getSettings(GetSettingsFormat.STRING_SETTABLE); } catch (eAf) {}
            return { ok: true, queueIndex: _qi, outputModuleIndex: ${jsxVal(args.outputModuleIndex ?? 1)}, settings: _after };
        `;
  },
});

registerOp({
  name: "render.remove_item",
  category: "render",
  description:
    "Remove ONE item from the render queue by its 1-based index (render.clear_queue removes all).",
  params: [
    {
      name: "queueIndex",
      type: "number",
      description: "1-based queue item index (explicit — no default for a destructive op)",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxRqItemPreamble(args)}
            var _compName = _rqi.comp ? _rqi.comp.name : null;
            try { _rqi.remove(); } catch (eRm) { return { ok: false, error: "remove failed: " + AE.errText(eRm) }; }
            return { ok: true, removed: _compName, remaining: rq.numItems };
        `;
  },
});

registerOp({
  name: "render.duplicate_item",
  category: "render",
  description:
    "Duplicate a render-queue item (RenderQueueItem.duplicate) — e.g. to render the same comp with a second settings/output combination.",
  params: [
    {
      name: "queueIndex",
      type: "number",
      description: "1-based queue item index (default: last item)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxRqItemPreamble(args)}
            var _dup = null;
            try { _dup = _rqi.duplicate(); } catch (eDp) { return { ok: false, error: "duplicate failed: " + AE.errText(eDp) }; }
            return { ok: true, comp: _dup.comp ? _dup.comp.name : null, numItems: rq.numItems };
        `;
  },
});

registerOp({
  name: "render.list_templates",
  category: "render",
  readOnly: true,
  description:
    "List available render-settings templates and output-module templates, under the names this After Effects uses (they are in its UI language). The render queue must have at least one item (templates are read from a queue item).",
  params: [],
  toJsx() {
    return `
            var rq = app.project.renderQueue;
            if (rq.numItems === 0) return { ok: false, error: "add a comp to the render queue first (render.add_to_queue) — templates are read from a queue item" };
            var _rqi = rq.item(1);
            var _render = [];
            var _output = [];
            try { _render = _rqi.templates; } catch (eR) {}
            try { _output = _rqi.outputModule(1).templates; } catch (eO) {}
            return { ok: true, renderTemplates: _render, outputTemplates: _output };
        `;
  },
});

registerOp({
  name: "render.status",
  category: "render",
  readOnly: true,
  description: "Report the render queue state: per-item status, time spans, and output paths.",
  params: [],
  toJsx() {
    return `
            var rq = app.project.renderQueue;
            var _statusNames = {};
            try {
                _statusNames[RQItemStatus.WILL_CONTINUE] = "WILL_CONTINUE";
                _statusNames[RQItemStatus.NEEDS_OUTPUT] = "NEEDS_OUTPUT";
                _statusNames[RQItemStatus.UNQUEUED] = "UNQUEUED";
                _statusNames[RQItemStatus.QUEUED] = "QUEUED";
                _statusNames[RQItemStatus.RENDERING] = "RENDERING";
                _statusNames[RQItemStatus.USER_STOPPED] = "USER_STOPPED";
                _statusNames[RQItemStatus.ERR_STOPPED] = "ERR_STOPPED";
                _statusNames[RQItemStatus.DONE] = "DONE";
            } catch (eSn) {}
            var _items = [];
            for (var _i = 1; _i <= rq.numItems; _i++) {
                var _rqi = rq.item(_i);
                var _outputs = [];
                try {
                    for (var _o = 1; _o <= _rqi.numOutputModules; _o++) {
                        var _f = _rqi.outputModule(_o).file;
                        _outputs.push(_f ? _f.fsName.replace(/\\\\/g, "/") : null);
                    }
                } catch (eOut) {}
                _items.push({
                    index: _i,
                    comp: _rqi.comp ? _rqi.comp.name : null,
                    status: _statusNames[_rqi.status] || String(_rqi.status),
                    render: _rqi.render,
                    timeSpanStart: _rqi.timeSpanStart,
                    timeSpanDuration: _rqi.timeSpanDuration,
                    elapsedSeconds: AE.safeGet(function () { return _rqi.elapsedSeconds; }, null),
                    outputs: _outputs
                });
            }
            return { ok: true, rendering: rq.rendering, numItems: rq.numItems, canQueueInAME: AE.safeGet(function () { return rq.canQueueInAME; }, false), items: _items };
        `;
  },
});

registerOp({
  name: "render.queue_in_ame",
  category: "render",
  description:
    "Send the render queue to Adobe Media Encoder (for H.264/HEVC etc.). Requires AME installed. renderImmediately=true starts the AME queue.",
  params: [
    {
      name: "renderImmediately",
      type: "boolean",
      description: "Start rendering in AME right away (default false)",
      required: false,
      default: false,
    },
  ],
  toJsx(args) {
    return `
            var rq = app.project.renderQueue;
            if (rq.numItems === 0) return { ok: false, error: "render queue is empty" };
            if (typeof rq.queueInAME !== "function") return { ok: false, error: "queueInAME not available (needs AE 14.0 / CC 2017+)" };
            var _can = false;
            try { _can = rq.canQueueInAME; } catch (eC) {}
            if (!_can) return { ok: false, error: "cannot queue in AME — is Adobe Media Encoder installed and at least one item queued?" };
            rq.queueInAME(${jsxVal(!!args.renderImmediately)});
            return { ok: true, sent: rq.numItems, renderImmediately: ${jsxVal(!!args.renderImmediately)} };
        `;
  },
});

registerOp({
  name: "render.save_template",
  category: "render",
  appConfig: true,
  description:
    "Save a queue item's current render settings, or an output module's current settings, as a named template (saveAsTemplate) for reuse via render.set_output.",
  params: [
    {
      name: "type",
      type: "string",
      description: "render (RenderQueueItem settings) | output (OutputModule settings)",
      required: true,
    },
    { name: "name", type: "string", description: "Template name to save under", required: true },
    {
      name: "queueIndex",
      type: "number",
      description: "1-based queue item index (default: last item)",
      required: false,
    },
    {
      name: "outputModuleIndex",
      type: "number",
      description: "1-based output module index (type=output only, default 1)",
      required: false,
      default: 1,
    },
  ],
  toJsx(args) {
    return `
            ${jsxRqItemPreamble(args)}
            var _type = ${jsxVal(args.type)};
            if (_type === "render") {
                try { _rqi.saveAsTemplate(${jsxVal(args.name)}); } catch (eSt) { return { ok: false, error: "saveAsTemplate failed: " + AE.errText(eSt) }; }
                return { ok: true, type: "render", name: ${jsxVal(args.name)} };
            }
            if (_type === "output") {
                var _om = null;
                try { _om = _rqi.outputModule(${jsxVal(args.outputModuleIndex ?? 1)}); } catch (eOm) {}
                if (!_om) return { ok: false, error: "no output module at index " + ${jsxVal(args.outputModuleIndex ?? 1)} };
                try { _om.saveAsTemplate(${jsxVal(args.name)}); } catch (eSo) { return { ok: false, error: "saveAsTemplate failed: " + AE.errText(eSo) }; }
                return { ok: true, type: "output", name: ${jsxVal(args.name)} };
            }
            return { ok: false, error: "type must be render|output" };
        `;
  },
});
