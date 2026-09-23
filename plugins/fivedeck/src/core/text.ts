/** Text helpers shared by key rendering, server status, and command dispatch. */

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Removes Cfx `^0`-`^9` colour codes and GTA `~r~`-style formatting tokens from server names. */
export function stripCfxFormatting(value: string): string {
  return value
    .replace(/\^[0-9]/g, "")
    .replace(/~[a-zA-Z]~/g, "")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&apos;";
    }
  });
}

/** Truncates by user-perceived characters (code points) and appends an ellipsis when shortened. */
export function truncateText(value: string, maxCharacters: number): string {
  const characters = Array.from(value.trim());
  if (characters.length <= maxCharacters) return characters.join("");
  return `${characters.slice(0, Math.max(1, maxCharacters - 1)).join("").trimEnd()}…`;
}

/**
 * Splits a multi-line command box into individual console commands. Blank lines and lines starting
 * with `//` or `#` are ignored so users can annotate longer sequences. Control characters are
 * removed because they would otherwise reach the game as raw key input.
 */
export function commandLines(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map(line => line.replace(CONTROL_CHARACTERS, "").replace(/\t/g, " ").trim())
    .filter(line => line.length > 0 && !line.startsWith("//") && !line.startsWith("#"));
}

/** Removes a leading chat slash so `/e dance` and `e dance` both become the console command `e dance`. */
export function consoleCommand(line: string): string {
  return line.replace(/^\/+/, "").trim();
}

/** Short uptime for small key text: `12s`, `42m`, `3h 07m`, `2d 04h`. */
export function formatUptimeCompact(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h`;
}

/** Fills `{value}` (and `{v}`) placeholders in a command template. */
export function fillTemplate(template: string, value: string | number): string {
  return template.replace(/\{(?:value|v)\}/gi, String(value));
}
