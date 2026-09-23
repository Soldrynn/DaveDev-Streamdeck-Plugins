/**
 * FiveDeck visual system, shared by the static asset generator and the live key renderer so every
 * key — drawn at build time or at runtime — sits on the same surface.
 *
 * The mark is the digit 5 drawn in Stream Deck keys on a 3 × 5 grid; one key is lit pink, the
 * "pressed" key. The key surface is DaveDev charcoal with a steel halftone that grows toward the
 * lower-right corner and a pink left edge.
 */

export const PALETTE = {
  pink: "#FF2C55",
  pinkDeep: "#C81E43",
  steel: "#334155",
  steelLight: "#64748B",
  charcoal: "#231F20",
  ink: "#141214",
  white: "#F8FAFC",
  mute: "#94A3B8",
  green: "#22C55E",
  amber: "#F59E0B",
  red: "#EF4444"
} as const;

/** Rows of the pixel "5", top to bottom; `2` marks the pink key. */
export const MARK_ROWS = ["112", "100", "111", "001", "111"] as const;

export interface MarkOptions {
  /** Top-left corner and pitch (distance between key origins). */
  x: number;
  y: number;
  pitch: number;
  key: number;
  radius: number;
  lit: string;
  accent: string;
  unlit: string;
  unlitOpacity: number;
  /** Adds a lip under each key for a raised, physical look. */
  depth?: number;
}

export function markSvg(options: MarkOptions): string {
  const parts: string[] = [];
  MARK_ROWS.forEach((row, rowIndex) => {
    [...row].forEach((cell, columnIndex) => {
      const x = options.x + columnIndex * options.pitch;
      const y = options.y + rowIndex * options.pitch;
      const r = options.radius;
      const k = options.key;
      if (cell === "0") {
        parts.push(`<rect x="${x}" y="${y}" width="${k}" height="${k}" rx="${r}" fill="${options.unlit}" opacity="${options.unlitOpacity}"/>`);
        return;
      }
      const fill = cell === "2" ? options.accent : options.lit;
      if (options.depth) {
        const lip = cell === "2" ? PALETTE.pinkDeep : "#B8C0CC";
        parts.push(`<rect x="${x}" y="${y + options.depth}" width="${k}" height="${k}" rx="${r}" fill="${lip}"/>`);
      }
      parts.push(`<rect x="${x}" y="${y}" width="${k}" height="${k}" rx="${r}" fill="${fill}"/>`);
    });
  });
  return parts.join("");
}

/**
 * Steel halftone dots in a square of `size`, growing toward the lower-right. `density` is the dot
 * pitch in the same units. Pure circles, so librsvg (build) and Stream Deck (runtime) both draw it.
 */
export function halftoneSvg(size: number, pitch: number, color: string = PALETTE.steel, opacity = 0.55): string {
  const dots: string[] = [];
  const start = size * 0.95;
  const span = size * 2 - start;
  for (let row = 0; row * pitch <= size + pitch; row++) {
    for (let column = 0; column * pitch <= size + pitch; column++) {
      const x = column * pitch + (row % 2 ? pitch / 2 : 0);
      const y = row * pitch;
      const t = (x + y - start) / span;
      if (t <= 0) continue;
      const r = +(pitch * 0.46 * Math.min(1, t)).toFixed(2);
      if (r < pitch * 0.06) continue;
      dots.push(`<circle cx="${+x.toFixed(2)}" cy="${y}" r="${r}"/>`);
    }
  }
  return `<g fill="${color}" opacity="${opacity}">${dots.join("")}</g>`;
}

/** The charcoal key surface every FiveDeck key starts from, in a 72-unit coordinate space. */
export function keySurface(id = "fd"): string {
  return `<defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="72" y2="72" gradientUnits="userSpaceOnUse">
      <stop stop-color="#2E292B"/>
      <stop offset="1" stop-color="${PALETTE.ink}"/>
    </linearGradient>
  </defs>
  <rect width="72" height="72" fill="url(#${id}-bg)"/>
  ${halftoneSvg(72, 5.2)}
  <rect x="0" y="9" width="2.6" height="18" fill="${PALETTE.pink}"/>`;
}

export function keySvg(body: string, pixelSize: number, id = "fd"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 72 72">
  ${keySurface(id)}
  ${body}
</svg>
`;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
