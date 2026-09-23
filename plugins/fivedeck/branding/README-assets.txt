FiveDeck branding assets
========================

Source of truth
  src/core/brand.ts           Palette, the "5 in keys" mark, halftone, key surface.
  src/core/glyphs.ts          Action glyphs (pink accent on keys, white in the action list).
  fivedeck-app-icon.svg       App icon source; npm run build renders plugin-icon.png (256) and @2x (512).

Marketplace (1920 x 960, rendered from the plugin's real key art)
  THUMBNAIL.png               Marketplace thumbnail and README hero.
  GALLERY1.png                Play: "No chat. No F8." (emotes, commands, push-to-talk).
  GALLERY2.png                Servers: "Join by code." (live status keys).
  GALLERY3.png                Develop: "Ship faster." (FXServer, resources, overlays, artifacts).
  GALLERY4.png                Stream Deck +: "Emote wheel." (Command Dial touch strip).

Rebuild (from plugins/fivedeck)
  npm run assets                                        Regenerates every icon and key image.
  node --experimental-strip-types branding/work/compose.mts
  python3 branding/work/render.py                       Needs Playwright + Chromium.

Fonts in branding/work/src are Montserrat and IBM Plex (SIL OFL 1.1, licences beside them).
davedev-badge.png is the DaveDev badge lifted from the Clef gallery art with a luminance alpha.
The device renders are generic and carry no Elgato logo.
