/**
 * Live key images. Everything is plain SVG (rects, circles, text, one gradient) drawn in the
 * 72-unit key space and served at 144 px, which Stream Deck renders crisply on every model.
 */
import { keySurface, PALETTE, svgDataUri } from "./brand.ts";
import { GLYPHS } from "./glyphs.ts";
import { escapeXml, truncateText } from "./text.ts";

const FONT = "Segoe UI, Montserrat, Helvetica, Arial, sans-serif";
const MONO = "Cascadia Mono, Consolas, IBM Plex Mono, monospace";

export type Tone = "good" | "warn" | "bad" | "idle" | "accent";

const TONE_COLOR: Record<Tone, string> = {
  good: PALETTE.green,
  warn: PALETTE.amber,
  bad: PALETTE.red,
  idle: PALETTE.mute,
  accent: PALETTE.pink
};

function text(x: number, y: number, value: string, size: number, color: string, weight = 700, anchor: "start" | "middle" | "end" = "start", font = FONT, spacing = 0): string {
  return `<text x="${x}" y="${y}" fill="${color}" font-family="${font}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ""}>${escapeXml(value)}</text>`;
}

function wrap(svg: string): string {
  return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 72 72">${keySurface("k")}${svg}</svg>`);
}

export interface StatusKeyView {
  /** Short state label such as ONLINE or STARTING. */
  label: string;
  tone: Tone;
  title: string;
  subtitle?: string;
  /** Large value line, e.g. "42/128" or "4m 05s". */
  value?: string;
  /** 0..1 fill for the bottom bar; omitted hides the bar. */
  meter?: number;
  /** Small red counter at the right of the value line (e.g. script errors). */
  badge?: number;
}

export function statusKeyImage(view: StatusKeyView): string {
  const color = TONE_COLOR[view.tone];
  const parts: string[] = [
    `<circle cx="9.5" cy="9.6" r="3" fill="${color}"/>`,
    text(15.5, 12.4, truncateText(view.label.toUpperCase(), 11), 7.4, color, 800, "start", FONT, 0.5),
    text(7, 26.5, truncateText(view.title, 12), 10, PALETTE.white, 700)
  ];
  if (view.subtitle) parts.push(text(7, 36.5, truncateText(view.subtitle, 15), 7.4, PALETTE.mute, 600));
  const badged = Boolean(view.badge && view.badge > 0);
  if (view.value) parts.push(text(7, 57, truncateText(view.value, badged ? 7 : 9), badged ? 13 : 15.5, PALETTE.white, 800));
  if (view.meter !== undefined) {
    const width = 58;
    const fill = Math.round(width * Math.max(0, Math.min(1, view.meter)) * 10) / 10;
    parts.push(`<rect x="7" y="62.5" width="${width}" height="3.2" rx="1.6" fill="${PALETTE.white}" opacity=".16"/>`);
    if (fill > 0) parts.push(`<rect x="7" y="62.5" width="${fill}" height="3.2" rx="1.6" fill="${PALETTE.pink}"/>`);
  }
  if (badged) {
    const label = view.badge! > 99 ? "99+" : String(view.badge);
    const width = 7 + label.length * 4.6;
    parts.push(`<rect x="${65 - width}" y="45" width="${width}" height="12" rx="6" fill="${PALETTE.red}"/>`);
    parts.push(text(65 - width / 2, 53.8, label, 8, PALETTE.white, 800, "middle"));
  }
  return wrap(parts.join(""));
}

export interface ToggleKeyView {
  label: string;
  on: boolean;
}

/** A labelled switch: the label on top, a pill switch below. */
export function toggleKeyImage(view: ToggleKeyView): string {
  const knobX = view.on ? 47 : 25;
  return wrap([
    text(36, 21, truncateText(view.label.toUpperCase(), 10), 9.4, PALETTE.white, 800, "middle", FONT, 0.4),
    `<rect x="14" y="31" width="44" height="22" rx="11" fill="${view.on ? PALETTE.pink : PALETTE.steel}"/>`,
    `<circle cx="${knobX}" cy="42" r="8" fill="${PALETTE.white}"/>`,
    text(36, 64.5, view.on ? "ON" : "OFF", 7.4, view.on ? PALETTE.pink : PALETTE.mute, 800, "middle", FONT, 1)
  ].join(""));
}

export interface LabelKeyView {
  glyph: keyof typeof GLYPHS | string;
  label: string;
  /** Monospace for commands, proportional for names. */
  mono?: boolean;
}

/**
 * A glyph with a caption drawn into the image. Used when a key names what it does (an emote, a
 * resource) so the caption stays legible even if the user hides the Stream Deck title.
 */
export function labelKeyImage(view: LabelKeyView): string {
  const glyph = GLYPHS[view.glyph] ?? GLYPHS.command;
  const caption = truncateText(view.label, view.mono ? 11 : 12);
  return wrap([
    `<g transform="translate(36 25) scale(.72) translate(-36 -30)">${glyph}</g>`,
    `<rect x="5" y="49" width="62" height="17" rx="4" fill="${PALETTE.ink}" opacity=".72"/>`,
    text(36, 61, caption, view.mono ? 8.4 : 9.2, PALETTE.white, 700, "middle", view.mono ? MONO : FONT)
  ].join(""));
}

/** Flashes a glyph key pink for press feedback. */
export function flashKeyImage(glyphName: string): string {
  const glyph = GLYPHS[glyphName] ?? GLYPHS.command;
  return wrap(`<rect width="72" height="72" fill="${PALETTE.pink}" opacity=".32"/>${glyph}`);
}
