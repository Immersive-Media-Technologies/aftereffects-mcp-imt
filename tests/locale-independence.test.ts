// After Effects behaves the same on every UI language (en, de, es, fr, it,
// pt-BR, ru, ja, ko, zh-CN) only while nothing the server sends it depends on
// text AE translates: display names of properties, menu labels, render
// template names, error messages. These tests pin every place that used to.
// Codegen and the real JSX helpers only — no After Effects.

import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { getOp } from "../src/registry.js";
import "../src/operations/index.js";
import {
  OUTPUT_MODULE_TEMPLATE_ALIASES,
  RENDER_SETTINGS_TEMPLATE_ALIASES,
} from "../src/operations/render.js";
import { toMcpResult } from "../src/tools/define-tool.js";
import { doTool } from "../src/tools/do.js";
import { FileIpcTransport } from "../src/transport/FileIpcTransport.js";
import { nullTransport } from "./helpers/null-transport.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HELPERS = readFileSync(path.join(ROOT, "jsx/helpers.jsx"), "utf8");
const DISPATCHER = readFileSync(path.join(ROOT, "jsx/dispatcher.jsx"), "utf8");

/** Source text of the function introduced by `header`, up to its closing brace. */
function extractFunction(src: string, header: string): string {
  const start = src.indexOf(header);
  if (start === -1) throw new Error(`not found in source: ${header}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated: ${header}`);
}

function filesUnder(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

describe("properties are reached by matchName, not by a translated display name", () => {
  // Adobe's list of names accessible by name covers Effects, Masks, Motion
  // Trackers, Marker, Time Remap, Text / Source Text and the transform
  // properties. These group names are NOT on it — a localized AE translates
  // them («Содержание», «Преобразовать», «Параметры материала», «Аудио»).
  const TRANSLATED =
    /\.property\("(Contents|Transform|Material Options|Audio|Camera Options|Light Options|Geometry Options)"\)/;

  it("in every source that generates or runs ExtendScript", () => {
    const sources = [
      ...filesUnder(path.join(ROOT, "src"), /\.ts$/),
      ...filesUnder(path.join(ROOT, "jsx"), /\.jsx$/),
    ];
    const hits: string[] = [];
    for (const file of sources) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (TRANSLATED.test(line))
            hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("shape ops: the layer's Contents and a group's Contents by their matchNames", () => {
    const jsx = getOp("shape.add_rect")!.toJsx({
      comp: "Main",
      layer: 1,
      groupIndex: 1,
      size: [10, 10],
    });
    expect(jsx).toContain('_layer.property("ADBE Root Vectors Group")');
    expect(jsx).toContain('_grp.property("ADBE Vectors Group")');
  });

  it("effect.apply_template tries the locale-independent index before the English name", () => {
    const jsx = getOp("effect.apply_template")!.toJsx({
      comp: "Main",
      layer: 1,
      template: "drop-shadow",
    });
    const byIndex = jsx.indexOf("_fx.property(_s.index)");
    const byName = jsx.indexOf("_fx.property(_s.name)");
    expect(byIndex).toBeGreaterThan(-1);
    expect(byName).toBeGreaterThan(byIndex);
  });
});

// ---------------------------------------------------------------------------
// Render templates
// ---------------------------------------------------------------------------

interface TemplateApi {
  resolveTemplateName(
    requested: string,
    available: string[],
    groups: unknown,
  ): { name: string; via: string } | null;
  visibleTemplateNames(available: string[]): string[];
}

/** The real resolver from jsx/helpers.jsx, with an optional stand-in for ExtendScript's localize(). */
function loadTemplateApi(localize?: (zstring: string) => string): TemplateApi {
  const body = [
    extractFunction(HELPERS, "AE.normTemplateName = function (s) {"),
    extractFunction(HELPERS, "AE.resolveTemplateName = function (requested, available, groups) {"),
    extractFunction(HELPERS, "AE.visibleTemplateNames = function (available) {"),
  ].join(";\n");
  return new Function("localize", `var AE = {}; ${body}; return AE;`)(localize) as TemplateApi;
}

const groups = (table: typeof RENDER_SETTINGS_TEMPLATE_ALIASES) =>
  table.map((t) => ({ key: t.key, names: Object.values(t.names) }));
const RS = groups(RENDER_SETTINGS_TEMPLATE_ALIASES);
const OM = groups(OUTPUT_MODULE_TEMPLATE_ALIASES);

// What a Russian AE 26.5 lists (read from the user's «Установки-indep-render/output.txt»).
const RU_RENDER = [
  "Настройки DV",
  "Настройки системы с несколькими компьютерами",
  "Настройки черновика",
  "Оптимальные настройки",
  "Текущие настройки",
  "_HIDDEN X-Factor",
];
const RU_OUTPUT = [
  "AIFF 48 кГц",
  "H.264 — Использовать настройки рендеринга — 15 Мбит/с",
  "H.264 — Использовать настройки рендеринга — 40 Мбит/с",
  "H.264 — Использовать настройки рендеринга — 5 Мбит/с",
  "Photoshop",
  "Без потерь",
  "Высокое качество",
  "Высокое качество с альфа-каналом",
  "Последовательность TIFF с альфа-каналом",
  "Только альфа-канал",
  "Формат без потери качества с альфа-каналом",
  "Эпизод с нескольких компьютеров",
  "_HIDDEN X-Factor 16",
];
const EN_RENDER = [
  "Best Settings",
  "Current Settings",
  "DV Settings",
  "Draft Settings",
  "Multi-Machine Settings",
];

describe("AE.resolveTemplateName (jsx/helpers.jsx)", () => {
  const api = loadTemplateApi();

  it("keeps a name this AE lists verbatim", () => {
    expect(api.resolveTemplateName("Оптимальные настройки", RU_RENDER, RS)).toEqual({
      name: "Оптимальные настройки",
      via: "exact",
    });
  });

  it("resolves every built-in English name to the name a Russian AE uses", () => {
    for (const t of RENDER_SETTINGS_TEMPLATE_ALIASES) {
      expect(api.resolveTemplateName(t.names.en, RU_RENDER, RS)?.name, t.names.en).toBe(t.names.ru);
    }
    for (const t of OUTPUT_MODULE_TEMPLATE_ALIASES) {
      expect(api.resolveTemplateName(t.names.en, RU_OUTPUT, OM)?.name, t.names.en).toBe(t.names.ru);
    }
  });

  it("resolves a name from another UI language and tolerates case, spacing and dash style", () => {
    expect(api.resolveTemplateName("Optimale Einstellungen", EN_RENDER, RS)?.name).toBe(
      "Best Settings",
    );
    expect(api.resolveTemplateName("best  settings", EN_RENDER, RS)).toEqual({
      name: "Best Settings",
      via: "normalized",
    });
    // AE's own English name has two spaces before the 5; the Russian one an em dash.
    expect(
      api.resolveTemplateName("H.264 - Match Render Settings - 5 Mbps", RU_OUTPUT, OM)?.name,
    ).toBe("H.264 — Использовать настройки рендеринга — 5 Мбит/с");
  });

  it("never picks a different template: an unknown name resolves to nothing", () => {
    expect(api.resolveTemplateName("Best Setting", RU_RENDER, RS)).toBeNull();
    expect(api.resolveTemplateName("My Preset", RU_RENDER, RS)).toBeNull();
    // A built-in this AE does not list (deleted by the user) is not swapped for another one.
    expect(api.resolveTemplateName("DV Settings", ["Best Settings"], RS)).toBeNull();
  });

  it("a user template that carries a built-in's English name wins over the built-in", () => {
    const list = [...RU_RENDER, "Best Settings"];
    expect(api.resolveTemplateName("Best Settings", list, RS)).toEqual({
      name: "Best Settings",
      via: "exact",
    });
  });

  it("prefers the name localize() gives for the template's ZString", () => {
    const both = ["Best Settings", "Оптимальные настройки"];
    expect(api.resolveTemplateName("Optimale Einstellungen", both, RS)?.name).toBe("Best Settings");
    const ru = loadTemplateApi((z) =>
      z.indexOf("$$$/AE/EGG/LStr/0492=") === 0 ? "Оптимальные настройки" : z.split("=")[1],
    );
    expect(ru.resolveTemplateName("Optimale Einstellungen", both, RS)?.name).toBe(
      "Оптимальные настройки",
    );
  });

  it("lists only the templates a user sees", () => {
    expect(api.visibleTemplateNames(RU_RENDER)).not.toContain("_HIDDEN X-Factor");
    expect(api.visibleTemplateNames(RU_RENDER)).toHaveLength(5);
  });
});

describe("render.set_output", () => {
  it("checks both template names before it changes anything, and fails on an unknown one", () => {
    const jsx = getOp("render.set_output")!.toJsx({
      queueNotify: true,
      renderTemplate: "Best Settings",
      outputTemplate: "Lossless",
      outputPath: "/tmp/x.mov",
    });
    const rsCheck = jsx.indexOf("AE.resolveTemplateName(_rtWant, _rtList");
    const omCheck = jsx.indexOf("AE.resolveTemplateName(_otWant, _otList");
    expect(rsCheck).toBeGreaterThan(-1);
    expect(omCheck).toBeGreaterThan(-1);
    for (const mutation of [
      "rq.queueNotify = true",
      "_rqi.applyTemplate(_rtName)",
      "_om.applyTemplate(_otName)",
      "_om.file = _of",
    ]) {
      expect(jsx.indexOf(mutation), mutation).toBeGreaterThan(Math.max(rsCheck, omCheck));
    }
    expect(jsx).toContain("does not exist in this After Effects");
    expect(jsx).toContain("Оптимальные настройки");
    // An unknown name is no longer just a warning.
    expect(jsx).not.toContain('_w.push("renderTemplate: "');
    expect(jsx).not.toContain('_w.push("outputTemplate: "');
  });

  it("emits no template machinery when no template is asked for", () => {
    const jsx = getOp("render.set_output")!.toJsx({ render: false });
    expect(jsx).not.toContain("resolveTemplateName");
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

type Formatter = (e: unknown) => string;

function loadFormatters(localize?: (z: string) => string): Array<[string, Formatter]> {
  const errText = extractFunction(HELPERS, "AE.errText = function (e) {");
  const describeErr = extractFunction(DISPATCHER, "function describeError(e) {");
  return [
    [
      "AE.errText",
      new Function("localize", `var AE = {}; ${errText}; return AE.errText;`)(
        localize,
      ) as Formatter,
    ],
    [
      "describeError",
      new Function("localize", `${describeErr}; return describeError;`)(localize) as Formatter,
    ],
  ];
}

const HINT = "[hint: an array value";

describe("the «invalid numeric result» hint does not depend on the UI language", () => {
  // AE's own text for $$$/AE/BEE/LStr/0392 in the ten languages it ships.
  const MESSAGES = [
    "invalid numeric result (divide by zero?)",
    "Ungültiges numerisches Ergebnis (Division durch Null?)",
    "resultado numérico no válido (¿dividir por cero?)",
    "résultat numérique incorrect (diviser par zéro ?)",
    "risultato numerico non valido (dividere per zero?)",
    "数値結果が無効です(ゼロによる除算?)",
    "잘못된 숫자 결과입니다. 0으로 나누었는지 확인하십시오.",
    "resultado numérico inválido (divisão por zero?)",
    "недопустимый числовой результат (деление на ноль?)",
    "数字结果无效（除以零？）",
  ];

  it.each(loadFormatters())("%s recognises it in every shipped language", (_label, format) => {
    for (const m of MESSAGES) expect(format(new Error(m)), m).toContain(HINT);
    expect(format(new Error("x is undefined"))).not.toContain(HINT);
  });

  it.each(
    loadFormatters((z) => (z.indexOf("$$$/AE/BEE/LStr/0392=") === 0 ? "zz numeric zz (?)" : z)),
  )("%s recognises AE's own text for it through localize()", (_label, format) => {
    expect(format(new Error("After Effects: ZZ Numeric ZZ (?)"))).toContain(HINT);
  });
});

describe("ExtendScript's error number reaches the caller", () => {
  const savedExe = process.env.AE_MCP_EXE;
  afterEach(() => {
    if (savedExe === undefined) delete process.env.AE_MCP_EXE;
    else process.env.AE_MCP_EXE = savedExe;
  });

  it("the dispatcher writes e.number next to the message", () => {
    expect(DISPATCHER).toContain("response.errorNumber = errNumber(eExec);");
  });

  it("from the dispatcher response through the transport", () => {
    // A stand-in that exists and never answers: the transport is constructed, never executed.
    process.env.AE_MCP_EXE =
      process.platform === "win32" ? "C:/Windows/System32/cmd.exe" : "/usr/bin/true";
    const transport = new FileIpcTransport() as unknown as {
      toEvalResult: (
        parsed: Record<string, unknown>,
        ms: number,
      ) => { errorNumber?: number | null };
    };
    const res = transport.toEvalResult(
      {
        id: "x",
        ok: false,
        phase: "execute",
        result: null,
        error: "foo is not a function",
        errorNumber: 24,
        stack: null,
        logs: [],
      },
      1,
    );
    expect(res.errorNumber).toBe(24);
  });

  it("into the error envelope of ae_do and of the other tools", async () => {
    const failure = {
      ok: false,
      result: null,
      error: "foo is not a function",
      errorCode: "JSX_THROW" as const,
      errorNumber: 24,
      stack: null,
      logs: [],
      durationMs: 1,
    };
    const viaTool = toMcpResult(failure);
    expect(
      (viaTool.structuredContent as { error: { details?: { errorNumber?: number } } }).error.details
        ?.errorNumber,
    ).toBe(24);

    const res = (await doTool.handler(
      { operation: "layer.create_null", args: { comp: "Main" } },
      nullTransport(failure),
    )) as { structuredContent?: { error?: { code: string; details?: Record<string, unknown> } } };
    expect(res.structuredContent?.error?.code).toBe("JSX_THROW");
    expect(res.structuredContent?.error?.details?.errorNumber).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// Menu commands
// ---------------------------------------------------------------------------

/** The { id, name } entries command.list returns. */
function listedCommands(): Array<{ id: number; name: string }> {
  const jsx = getOp("command.list")!.toJsx({});
  return [...jsx.matchAll(/\{ id: (\d+), name: "([^"]+)" \}/g)].map((m) => ({
    id: Number(m[1]),
    name: m[2],
  }));
}

describe("command.list", () => {
  const listed = listedCommands;

  it("carries the ids AE itself gives the menu items", () => {
    const byName = new Map(listed().map((c) => [c.name.split(" (")[0], c.id]));
    expect(byName.get("Deselect All")).toBe(2004);
    expect(byName.get("New Null Object")).toBe(2767);
    expect(byName.get("Track Camera")).toBe(3983);
    expect(byName.get("Track Motion")).toBe(2568);
    // 2040 is the Layer › Mask submenu, 2072 Effect › Remove All — never listed as something else.
    expect(listed().map((c) => c.id)).not.toContain(2040);
    expect(listed().map((c) => c.id)).not.toContain(2072);
  });

  it("lists every id once", () => {
    const ids = listed().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
