// Live self-test: starts the server over stdio, calls ae_version_info and prints the answer.
// печатает ответ. Отдельный файл, а не строчка в install.sh, потому что
// именно он различает три неотличимых снаружи отказа: сервер не поднялся,
// AppleEvents запрещены, AE не отвечает.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srv = spawn(process.execPath, [join(root, "dist", "index.js")], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
srv.stderr.on("data", (d) => (stderr += d.toString()));

let buf = "";
const pending = new Map();
srv.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* not a JSON-RPC line */
    }
  }
});

let id = 0;
const send = (method, params) =>
  new Promise((res) => {
    const rid = ++id;
    pending.set(rid, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: rid, method, params }) + "\n");
  });

const die = (msg) => {
  console.log(JSON.stringify({ ok: false, error: msg, stderr: stderr.slice(0, 2000) }, null, 2));
  srv.kill();
  process.exit(1);
};

const timer = setTimeout(
  () => die("timeout 120 s — After Effects did not answer (check the Automation permission)"),
  120_000,
);

try {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "selftest", version: "1" },
  });
  srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const r = await send("tools/call", { name: "ae_version_info", arguments: {} });
  clearTimeout(timer);
  const payload = r.result?.structuredContent ?? r.result ?? r.error;
  console.log(JSON.stringify(payload, null, 2));
  srv.kill();
  process.exit(payload?.ok === true ? 0 : 1);
} catch (e) {
  clearTimeout(timer);
  die(String(e?.message ?? e));
}
