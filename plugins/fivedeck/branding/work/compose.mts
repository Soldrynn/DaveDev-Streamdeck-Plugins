// Builds the FiveDeck Marketplace thumbnail and gallery as HTML pages from the plugin's real key
// art, then render.py screenshots them. Run from plugins/fivedeck:
//   node --experimental-strip-types branding/work/compose.mts && python3 branding/work/render.py
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keySvg, markSvg, PALETTE } from "../../src/core/brand.ts";
import { GLYPHS } from "../../src/core/glyphs.ts";
import { labelKeyImage, statusKeyImage, toggleKeyImage } from "../../src/core/key-art.ts";

const work = dirname(fileURLToPath(import.meta.url));
const out = join(work, "out");
await mkdir(out, { recursive: true });

const inline = (dataUri: string) => Buffer.from(dataUri.split(",")[1], "base64").toString("utf8")
  .replace(/width="144" height="144"/, 'width="100%" height="100%"');
const staticKey = (name: string) => keySvg(GLYPHS[name], 144).replace(/width="144" height="144"/, 'width="100%" height="100%"');
const onKey = async (name: string) => (await readFile(join(work, "..", "..", "com.davedev.fivedeck.sdPlugin", "assets", "actions", `${name}-on@2x.svg`), "utf8"))
  .replace(/width="144" height="144"/, 'width="100%" height="100%"');

const keys = {
  joinLab: inline(statusKeyImage({ label: "online", tone: "good", title: "Los Santos Lab", subtitle: "cfx.re/join/3lamjz", value: "87/128", meter: 87 / 128 })),
  joinDev: inline(statusKeyImage({ label: "online", tone: "good", title: "Dev Server", subtitle: "127.0.0.1:30120", value: "2/48", meter: 2 / 48 })),
  joinRp: inline(statusKeyImage({ label: "online", tone: "good", title: "Night City RP", subtitle: "cfx.re/join/q8m3x4", value: "241/256", meter: 241 / 256 })),
  joinOff: inline(statusKeyImage({ label: "offline", tone: "bad", title: "Staging", subtitle: "10.0.0.12:30120", value: "—" })),
  joinSouth: inline(statusKeyImage({ label: "online", tone: "good", title: "Southside", subtitle: "cfx.re/join/7kd2pa", value: "58/64", meter: 58 / 64 })),
  joinRace: inline(statusKeyImage({ label: "online", tone: "good", title: "Apex Racing", subtitle: "cfx.re/join/r4c3zz", value: "31/100", meter: 31 / 100 })),
  joinPrivate: inline(statusKeyImage({ label: "join", tone: "accent", title: "Whitelist", subtitle: "cfx.re/join/wl0001", value: "JOIN" })),
  joinTest: inline(statusKeyImage({ label: "checking", tone: "idle", title: "Test Build", subtitle: "cfx.re/join/tst777" })),
  dance: inline(labelKeyImage({ glyph: "emote", label: "dance5" })),
  sit: inline(labelKeyImage({ glyph: "emote", label: "sitchair" })),
  wave: inline(labelKeyImage({ glyph: "emote", label: "wave" })),
  command: staticKey("command"),
  radio: inline(labelKeyImage({ glyph: "key", label: "+radiotalk", mono: true })),
  f13: inline(labelKeyImage({ glyph: "key", label: "F13", mono: true })),
  chat: staticKey("chat"),
  resmon: inline(toggleKeyImage({ label: "resmon", on: true })),
  netgraph: inline(toggleKeyImage({ label: "netgraph", on: false })),
  fps: inline(toggleKeyImage({ label: "fps", on: true })),
  fxserver: inline(statusKeyImage({ label: "running", tone: "good", title: "FXServer", subtitle: "build 17000", value: "42m", meter: 2 / 48, badge: 2 })),
  ensureHud: inline(labelKeyImage({ glyph: "server-command", label: "ensure hud", mono: true })),
  ensureCore: inline(labelKeyImage({ glyph: "server-command", label: "ensure core", mono: true })),
  refresh: inline(labelKeyImage({ glyph: "server-command", label: "refresh", mono: true })),
  artifact: inline(statusKeyImage({ label: "current", tone: "good", title: "Artifacts", subtitle: "rec 17000", value: "17000" })),
  launchOn: await onKey("launch"),
  commandOn: await onKey("command"),
  join: staticKey("join")
};

const font = (family: string, weight: number, file: string) =>
  `@font-face{font-family:"${family}";font-weight:${weight};src:url(asset:${file}) format("woff2");}`;
const css = `
${font("Montserrat", 500, "montserrat-latin-500-normal.woff2")}
${font("Montserrat", 700, "montserrat-latin-700-normal.woff2")}
${font("Montserrat", 800, "montserrat-latin-800-normal.woff2")}
${font("Montserrat", 900, "montserrat-latin-900-normal.woff2")}
${font("IBM Plex Mono", 500, "ibm-plex-mono-latin-500-normal.woff2")}
${font("IBM Plex Mono", 600, "ibm-plex-mono-latin-600-normal.woff2")}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1920px;height:960px;overflow:hidden;background:#141214}
.frame{position:relative;width:1920px;height:960px;overflow:hidden;
  background:radial-gradient(1400px 900px at 30% 40%, #221e21 0%, #171517 55%, #100f10 100%);}
.dots{position:absolute;inset:0;
  background-image:radial-gradient(circle, rgba(255,44,85,.55) 1.6px, transparent 2.2px);
  background-size:26px 26px;
  -webkit-mask-image:linear-gradient(100deg, transparent 55%, rgba(0,0,0,.25) 75%, #000 100%);
  mask-image:linear-gradient(100deg, transparent 55%, rgba(0,0,0,.25) 75%, #000 100%);}
.steel{position:absolute;inset:0;
  background-image:radial-gradient(circle, rgba(100,116,139,.22) 1.4px, transparent 2px);
  background-size:26px 26px;background-position:13px 13px;
  -webkit-mask-image:linear-gradient(115deg, transparent 20%, #000 90%);mask-image:linear-gradient(115deg, transparent 20%, #000 90%);}
.edge{position:absolute;left:0;top:0;bottom:0;width:10px;background:${PALETTE.pink}}
.bracket{position:absolute;left:44px;width:34px;height:34px;border-color:${PALETTE.pink};border-style:solid}
.bracket.top{top:40px;border-width:2px 0 0 2px}
.bracket.bottom{bottom:40px;border-width:0 0 2px 2px}
.copy{position:absolute;left:120px;top:0;bottom:0;width:720px;display:flex;flex-direction:column;justify-content:center}
.eyebrow{font:600 24px "IBM Plex Mono";letter-spacing:.3em;color:${PALETTE.pink};text-transform:uppercase;margin-bottom:28px}
h1{font:900 168px/0.86 "Montserrat";color:${PALETTE.white};letter-spacing:-.01em}
h1 .pink{color:${PALETTE.pink};display:block}
.rule{width:150px;height:6px;background:${PALETTE.pink};margin:44px 0 38px;border-radius:3px}
.body{font:500 25px/1.55 "IBM Plex Mono";color:#d9dee6;max-width:640px}
.tag{font:500 26px/1.6 "IBM Plex Mono";letter-spacing:.14em;color:#e7ebf0;text-transform:uppercase}
.mark{width:150px;height:150px;margin-bottom:34px}
.sign{position:absolute;left:120px;bottom:48px;display:flex;align-items:center;gap:22px;font:500 17px "IBM Plex Mono";letter-spacing:.28em;color:#8b95a5;text-transform:uppercase}
.sign img{height:46px}
.deck{position:absolute;border-radius:40px;padding:56px 58px 60px;
  background:linear-gradient(160deg,#2a2a2d 0%,#1d1d20 55%,#161618 100%);
  box-shadow:0 60px 120px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.07), inset 0 0 0 1px rgba(255,255,255,.04)}
.grid{display:grid;grid-template-columns:repeat(5,var(--key));gap:var(--gap)}
.key{width:var(--key);height:var(--key);border-radius:18px;padding:7px;background:#050506;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.05), 0 6px 14px rgba(0,0,0,.6)}
.key .face{width:100%;height:100%;border-radius:12px;overflow:hidden;background:#000}
.key .face svg{display:block}
.key.empty .face{background:linear-gradient(160deg,#0d0d0f,#060607)}
.strip{display:grid;grid-template-columns:repeat(4,200px);width:800px;height:100px;border-radius:10px;overflow:hidden;background:#000;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.panel{position:relative;width:200px;height:100px;background:linear-gradient(135deg,#2e292b,#141214)}
.panel::before{content:"";position:absolute;left:0;top:8px;width:3px;height:22px;background:${PALETTE.pink}}
.panel .icon{position:absolute;left:8px;top:14px;width:48px;height:48px}
.panel .t{position:absolute;left:64px;top:9px;font:700 11px "Montserrat";color:${PALETTE.pink};letter-spacing:.04em}
.panel .v{position:absolute;left:64px;top:26px;font:700 18px "Montserrat";color:${PALETTE.white};white-space:nowrap}
.panel .d{position:absolute;left:64px;top:53px;font:500 10px "Montserrat";color:#94a3b8;white-space:nowrap}
.panel .bar{position:absolute;left:8px;top:74px;width:184px;height:8px;border-radius:4px;background:#334155;overflow:hidden}
.panel .bar i{display:block;height:100%;background:${PALETTE.pink}}
.knobs{display:grid;grid-template-columns:repeat(4,200px);width:800px;margin-top:44px;justify-items:center}
.knob{width:118px;height:118px;border-radius:50%;
  background:repeating-conic-gradient(from 0deg,#1b1b1d 0deg 3deg,#2a2a2d 3deg 6deg);
  box-shadow:0 14px 28px rgba(0,0,0,.6), inset 0 0 0 9px #141416, inset 0 2px 0 11px rgba(255,255,255,.05)}
`;

const keyCell = (svg?: string) => svg ? `<div class="key"><div class="face">${svg}</div></div>` : `<div class="key empty"><div class="face"></div></div>`;
const deck = (cells: (string | undefined)[], left: number, top: number, size = 128, gap = 28) =>
  `<div class="deck" style="left:${left}px;top:${top}px;--key:${size}px;--gap:${gap}px"><div class="grid">${cells.map(keyCell).join("")}</div></div>`;

const markHtml = `<svg class="mark" viewBox="0 0 512 512">${markSvg({ x: 146, y: 42, pitch: 84, key: 70, radius: 16, lit: PALETTE.white, accent: PALETTE.pink, unlit: PALETTE.steelLight, unlitOpacity: 0.28, depth: 7 })}</svg>`;

const chrome = (content: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="frame"><div class="steel"></div><div class="dots"></div><div class="edge"></div>
<div class="bracket top"></div><div class="bracket bottom"></div>
${content}
<div class="sign"><img src="asset:davedev-badge.png" alt=""><span>DaveDev · FiveDeck</span></div>
</div></body></html>`;

const copy = (eyebrow: string, white: string, pink: string, body: string, extra = "", size = 168) => `<div class="copy">
${extra}${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}
<h1 style="font-size:${size}px">${white}<span class="pink">${pink}</span></h1>
<div class="rule"></div>
${body}
</div>`;

const panel = (glyph: string, title: string, value: string, detail: string, position: number) => `<div class="panel">
<div class="icon">${keySvg(GLYPHS[glyph], 48).replace(/width="48" height="48"/, 'width="48" height="48"')}</div>
<div class="t">${title}</div><div class="v">${value}</div><div class="d">${detail}</div>
<div class="bar"><i style="width:${position}%"></i></div></div>`;

const pages: Record<string, string> = {
  THUMBNAIL: chrome(`${copy("", "FIVE", "DECK", `<div class="tag">FiveM on any Stream Deck<br>No chat box. No resource.</div>`, markHtml)}
${deck([keys.joinLab, keys.dance, keys.sit, keys.radio, keys.resmon,
  keys.fxserver, keys.ensureHud, keys.artifact, keys.command, keys.netgraph,
  keys.launchOn, keys.joinDev, keys.wave, keys.chat, keys.f13], 890, 160)}`),

  GALLERY1: chrome(`${copy("Play", "NO CHAT.", "NO F8.", `<div class="body">Emotes, commands, and push-to-talk run the instant you press. FiveDeck's bridge sends them straight to the game, with no chat box, no console, and no FiveM resource.</div>`)}
${deck([keys.dance, keys.sit, keys.wave, keys.commandOn, keys.radio,
  keys.chat, keys.f13, keys.command, undefined, undefined,
  undefined, undefined, undefined, undefined, undefined], 890, 160)}`),

  GALLERY2: chrome(`${copy("Servers", "JOIN BY", "CODE.", `<div class="body">Live names and player counts for any join code or address. Tap to join. Hold to switch servers now, even mid-session.</div>`, "", 146)}
${deck([keys.joinLab, keys.joinRp, keys.joinSouth, keys.joinRace, keys.launchOn,
  keys.joinPrivate, keys.joinDev, keys.joinOff, keys.joinTest, undefined,
  undefined, undefined, undefined, undefined, undefined], 890, 160)}`),

  GALLERY3: chrome(`${copy("Develop", "SHIP", "FASTER.", `<div class="body">Start FXServer or txAdmin, restart resources, count script errors, flip resmon and netgraph, and know when your artifacts are out of date.</div>`, "", 150)}
${deck([keys.fxserver, keys.ensureHud, keys.ensureCore, keys.refresh, keys.artifact,
  keys.resmon, keys.netgraph, keys.fps, keys.joinDev, undefined,
  undefined, undefined, undefined, undefined, undefined], 890, 160)}`),

  GALLERY4: chrome(`${copy("Stream Deck +", "EMOTE", "WHEEL.", `<div class="body">Rotate through emotes, radio channels, or any list of commands, then press the dial to run it.</div>`, "", 150)}
<div class="deck" style="left:920px;top:150px;--key:128px;--gap:28px;padding:52px 60px 60px">
<div class="grid" style="grid-template-columns:repeat(4,128px);gap:22px 96px;justify-content:center;width:800px">${[keys.dance, keys.radio, keys.fxserver, keys.joinLab, keys.sit, keys.command, keys.ensureHud, keys.resmon].map(keyCell).join("")}</div>
<div style="height:34px"></div>
<div class="strip">${panel("dial", "EMOTES", "Dance", "3 / 12  ·  press to run", 18)}${panel("dial", "RADIO", "4", "setradio 4", 33)}${panel("dial", "VOICE RANGE", "Normal", "2 / 3  ·  press to run", 50)}${panel("dial", "PROPS", "Umbrella", "7 / 9  ·  press to run", 75)}</div>
<div class="knobs"><div class="knob"></div><div class="knob"></div><div class="knob"></div><div class="knob"></div></div>
</div>`)
};

for (const [name, html] of Object.entries(pages)) await writeFile(join(out, `${name}.html`), html);
console.log(`Composed ${Object.keys(pages).length} pages.`);
