/**
 * Keyboard table for synthetic input. Each key carries its Windows virtual-key code and its
 * set-1 scan code, because games that read raw input (GTA V, and therefore FiveM) look at the
 * scan code while the Windows message queue looks at the virtual key. Sending both keeps the two
 * paths in agreement.
 */

export interface KeyDefinition {
  /** Canonical name, also used in settings. */
  name: string;
  vk: number;
  scan: number;
  extended?: boolean;
}

const table: KeyDefinition[] = [];
const add = (name: string, vk: number, scan: number, extended = false): void => {
  table.push(extended ? { name, vk, scan, extended } : { name, vk, scan });
};

// Letters and digits.
const letterScans: Record<string, number> = {
  Q: 0x10, W: 0x11, E: 0x12, R: 0x13, T: 0x14, Y: 0x15, U: 0x16, I: 0x17, O: 0x18, P: 0x19,
  A: 0x1e, S: 0x1f, D: 0x20, F: 0x21, G: 0x22, H: 0x23, J: 0x24, K: 0x25, L: 0x26,
  Z: 0x2c, X: 0x2d, C: 0x2e, V: 0x2f, B: 0x30, N: 0x31, M: 0x32
};
for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") add(letter, letter.charCodeAt(0), letterScans[letter]);
for (let digit = 0; digit <= 9; digit++) add(String(digit), 0x30 + digit, digit === 0 ? 0x0b : 0x01 + digit);

// Function keys. F13-F24 exist on no ordinary keyboard, which makes them ideal for Stream Deck binds.
const functionScans = [0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44, 0x57, 0x58,
  0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x76];
functionScans.forEach((scan, index) => add(`F${index + 1}`, 0x70 + index, scan));

add("ESCAPE", 0x1b, 0x01);
add("BACKSPACE", 0x08, 0x0e);
add("TAB", 0x09, 0x0f);
add("RETURN", 0x0d, 0x1c);
add("SPACE", 0x20, 0x39);
add("CAPITAL", 0x14, 0x3a);
add("LSHIFT", 0xa0, 0x2a);
add("RSHIFT", 0xa1, 0x36);
add("LCONTROL", 0xa2, 0x1d);
add("RCONTROL", 0xa3, 0x1d, true);
add("LMENU", 0xa4, 0x38);
add("RMENU", 0xa5, 0x38, true);
add("INSERT", 0x2d, 0x52, true);
add("DELETE", 0x2e, 0x53, true);
add("HOME", 0x24, 0x47, true);
add("END", 0x23, 0x4f, true);
add("PAGEUP", 0x21, 0x49, true);
add("PAGEDOWN", 0x22, 0x51, true);
add("LEFT", 0x25, 0x4b, true);
add("UP", 0x26, 0x48, true);
add("RIGHT", 0x27, 0x4d, true);
add("DOWN", 0x28, 0x50, true);
add("PAUSE", 0x13, 0x45);
add("SCROLL", 0x91, 0x46);
add("NUMLOCK", 0x90, 0x45, true);
// Numpad digits as sent with Num Lock on.
const numpadScans = [0x52, 0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49];
numpadScans.forEach((scan, digit) => add(`NUMPAD${digit}`, 0x60 + digit, scan));
add("MULTIPLY", 0x6a, 0x37);
add("ADD", 0x6b, 0x4e);
add("SUBTRACT", 0x6d, 0x4a);
add("DECIMAL", 0x6e, 0x53);
add("DIVIDE", 0x6f, 0x35, true);
add("NUMPADENTER", 0x0d, 0x1c, true);
// US-layout punctuation. GRAVE is the key left of 1 (`/~ on US, the default console key on many layouts).
add("GRAVE", 0xc0, 0x29);
add("MINUS", 0xbd, 0x0c);
add("EQUALS", 0xbb, 0x0d);
add("LBRACKET", 0xdb, 0x1a);
add("RBRACKET", 0xdd, 0x1b);
add("BACKSLASH", 0xdc, 0x2b);
add("SEMICOLON", 0xba, 0x27);
add("APOSTROPHE", 0xde, 0x28);
add("COMMA", 0xbc, 0x33);
add("PERIOD", 0xbe, 0x34);
add("SLASH", 0xbf, 0x35);

const byName = new Map(table.map(key => [key.name, key]));
const aliases: Record<string, string> = {
  ENTER: "RETURN", ESC: "ESCAPE", CAPSLOCK: "CAPITAL", SHIFT: "LSHIFT", CTRL: "LCONTROL", CONTROL: "LCONTROL",
  ALT: "LMENU", LALT: "LMENU", RALT: "RMENU", LCTRL: "LCONTROL", RCTRL: "RCONTROL", PGUP: "PAGEUP",
  PGDN: "PAGEDOWN", DEL: "DELETE", INS: "INSERT", SCROLLLOCK: "SCROLL", TILDE: "GRAVE", BACKQUOTE: "GRAVE",
  "`": "GRAVE", "~": "GRAVE", "-": "MINUS", "=": "EQUALS", "[": "LBRACKET", "]": "RBRACKET", "\\": "BACKSLASH",
  ";": "SEMICOLON", "'": "APOSTROPHE", ",": "COMMA", ".": "PERIOD", "/": "SLASH"
};

/** Looks a key up by canonical name, alias, or single character, ignoring case. */
export function findKey(name: unknown): KeyDefinition | undefined {
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim();
  const upper = trimmed.toUpperCase();
  return byName.get(upper) ?? byName.get(aliases[upper] ?? aliases[trimmed] ?? "");
}

export const MODIFIER_KEYS = ["LSHIFT", "LCONTROL", "LMENU"] as const;
export type Modifier = "shift" | "ctrl" | "alt";

/** Keys offered in the key pickers, in display order. */
export function allKeyNames(): string[] {
  return table.map(key => key.name);
}

export interface KeyStroke {
  key: KeyDefinition;
  up: boolean;
}

/** Expands a chord (modifiers + key) into ordered press and release strokes. */
export function chordStrokes(key: KeyDefinition, modifiers: readonly Modifier[] = [], phase: "tap" | "down" | "up" = "tap"): KeyStroke[] {
  const modifierKeys = modifiers.map(modifier => byName.get(modifier === "shift" ? "LSHIFT" : modifier === "ctrl" ? "LCONTROL" : "LMENU")!);
  const down: KeyStroke[] = [...modifierKeys.map(k => ({ key: k, up: false })), { key, up: false }];
  const up: KeyStroke[] = [{ key, up: true }, ...[...modifierKeys].reverse().map(k => ({ key: k, up: true }))];
  if (phase === "down") return down;
  if (phase === "up") return up;
  return [...down, ...up];
}
