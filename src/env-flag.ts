/**
 * Boolean environment flags. Accepts what every launcher produces: "1" / "0" (shell),
 * "true" / "false" (Claude Desktop MCPB user settings), "on" / "off", "yes" / "no".
 * Unset or anything else → the default.
 */
export function envFlag(
  name: string,
  defaultValue = false,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[name];
  if (raw === undefined) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no" || v === "") return false;
  return defaultValue;
}
