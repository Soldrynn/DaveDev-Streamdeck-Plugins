/**
 * Action glyphs in the 72-unit key space, centred on (36, 30) so a Stream Deck title still fits
 * underneath. Each glyph takes an accent colour: pink on keys, white in the monochrome action list.
 */
import { PALETTE } from "./brand.ts";

const W = "#FFFFFF";
const stroke = (width = 3.6) => `fill="none" stroke="${W}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;

type Glyph = (accent: string) => string;

const glyphs: Record<string, Glyph> = {
  // >_ console prompt
  command: accent => `<path d="M19 18.5 30 29.5 19 40.5" ${stroke(4.4)}/><rect x="34" y="37" width="19" height="4.4" rx="2.2" fill="${accent}"/>`,
  // Dancing figure with a spark
  emote: accent => `<circle cx="34" cy="14.5" r="4.6" fill="${W}"/><path d="M34 21v12.5M34 24.5l-9-6.5M34 24.5l8.5 3.5 4-8M34 33.5l-7 10M34 33.5l7.5 9" ${stroke(3.6)}/><path d="M50.5 9.5l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" fill="${accent}"/>`,
  // Speech bubble with typed lines
  chat: accent => `<path d="M17.5 17.5a4 4 0 0 1 4-4h29a4 4 0 0 1 4 4v19a4 4 0 0 1-4 4H33l-8.5 7v-7h-3a4 4 0 0 1-4-4z" ${stroke(3.4)}/><path d="M25 24h22" ${stroke(3.4)}/><path d="M25 31.5h13" fill="none" stroke="${accent}" stroke-width="3.4" stroke-linecap="round"/>`,
  // Keycap with a lit centre
  key: accent => `<rect x="18" y="12.5" width="36" height="33" rx="6" ${stroke(3.4)}/><path d="M23.5 40.5h25" ${stroke(2.4)} opacity=".55"/><rect x="29" y="21.5" width="14" height="10" rx="3" fill="${accent}"/>`,
  // Resource-monitor style meter
  toggle: accent => `<path d="M16 42.5h40" ${stroke(3)} opacity=".55"/><rect x="18.5" y="27" width="6.5" height="12.5" rx="2" fill="${W}"/><rect x="28.5" y="19" width="6.5" height="20.5" rx="2" fill="${W}"/><rect x="38.5" y="12.5" width="6.5" height="27" rx="2" fill="${accent}"/><rect x="48.5" y="23" width="6.5" height="16.5" rx="2" fill="${W}"/>`,
  // Arrow entering a doorway
  join: accent => `<path d="M36 13.5h13.5a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H36" ${stroke(3.6)}/><path d="M15.5 30h24M31 21.5 39.5 30 31 38.5" fill="none" stroke="${accent}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Server rack with status lights
  fxserver: accent => `<rect x="17" y="12" width="38" height="15" rx="4" ${stroke(3.4)}/><rect x="17" y="32" width="38" height="15" rx="4" ${stroke(3.4)}/><circle cx="24.5" cy="19.5" r="2.6" fill="${accent}"/><circle cx="24.5" cy="39.5" r="2.6" fill="${W}"/><path d="M34 19.5h13M34 39.5h13" ${stroke(3)}/>`,
  // Restart arrow around a resource cube
  "server-command": accent => `<path d="M49.5 22.5A16 16 0 1 0 51 33.5" ${stroke(3.6)}/><path d="M51.5 12.5v10.5H41" fill="none" stroke="${accent}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M36 22l7.5 4v8.5L36 38.5l-7.5-4V26z" fill="${W}"/>`,
  // Package with an upward badge
  artifact: accent => `<path d="M33 11.5 50 20v19l-17 8.5L16 39V20z" ${stroke(3.4)}/><path d="M16.5 20.5 33 29l16.5-8.5M33 29v18" ${stroke(3)}/>${accent === W
    ? `<circle cx="51" cy="41" r="8.5" fill="none" stroke="${W}" stroke-width="2.6"/><path d="M51 45v-8M47.5 40.5 51 37l3.5 3.5" ${stroke(2.4)}/>`
    : `<circle cx="51" cy="41" r="8.5" fill="${accent}"/><path d="M51 45.5v-9M47 40l4-4 4 4" fill="none" stroke="${PALETTE.ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`}`,
  // Rotary knob with a pink pointer
  dial: accent => `<circle cx="36" cy="30" r="15.5" ${stroke(3.4)}/><path d="M36 30V17.5" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round"/><path d="M14.5 43.5l3.5-2.5M57.5 43.5 54 41M12 26.5h4.5M60 26.5h-4.5M20 11.5l3 3M52 11.5l-3 3" ${stroke(2.6)} opacity=".6"/>`,
  // Play triangle inside a ring
  launch: accent => `<circle cx="36" cy="30" r="17.5" ${stroke(3.4)}/><path d="M31.5 21.5 44 30l-12.5 8.5z" fill="${accent}"/>`,
  // Pulse line with a live dot
  status: accent => `<path d="M14 31h9l4.5-12 8.5 23 5.5-15 3.5 4h6" ${stroke(3.6)}/><circle cx="55" cy="31" r="4" fill="${accent}"/>`
};

/** Key glyphs with the pink accent. */
export const GLYPHS: Record<string, string> = Object.fromEntries(Object.entries(glyphs).map(([name, glyph]) => [name, glyph(PALETTE.pink)]));

/** Monochrome white glyphs for the action list. */
export const LIST_GLYPHS: Record<string, string> = Object.fromEntries(Object.entries(glyphs).map(([name, glyph]) => [name, glyph(W)]));
