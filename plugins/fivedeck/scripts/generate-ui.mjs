// Generates every property inspector from shared fragments so the global sections stay identical.
// Run: npm run ui
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ui = join(root, "com.davedev.fivedeck.sdPlugin", "ui");

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <link rel="stylesheet" href="fivedeck.css">
  <script src="sdpi-components.js"></script>
</head>
<body>
${body.trim()}
  <script src="fivedeck.js"></script>
</body>
</html>
`;

const heading = text => `  <div class="fd-heading">${text}</div>`;
const note = html => `  <sdpi-item>\n    <small class="fd-note">${html}</small>\n  </sdpi-item>`;
const options = (entries, selected) => entries.map(([value, label]) => `      <option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("\n");
const select = (label, setting, entries, fallback, extra = "") => `  <sdpi-item label="${label}">
    <sdpi-select setting="${setting}" default="${fallback}"${extra}>
${options(entries)}
    </sdpi-select>
  </sdpi-item>`;
const checkbox = (label, setting, text, fallback = false, extra = "") => `  <sdpi-item label="${label}">
    <sdpi-checkbox setting="${setting}" label="${text}"${fallback ? ' default="true"' : ""}${extra}></sdpi-checkbox>
  </sdpi-item>`;
const textfield = (label, setting, placeholder = "", extra = "") => `  <sdpi-item label="${label}">
    <sdpi-textfield setting="${setting}" placeholder="${placeholder}"${extra}></sdpi-textfield>
  </sdpi-item>`;
const textarea = (label, setting, placeholder, rows = 4) => `  <sdpi-item label="${label}">
    <sdpi-textarea setting="${setting}" rows="${rows}" placeholder="${placeholder}"></sdpi-textarea>
  </sdpi-item>`;
const when = (setting, values, fallback, inner) => `  <div data-when="${setting}" data-is="${values}" data-default="${fallback}">
${inner}
  </div>`;

const functionKeys = Array.from({ length: 12 }, (_, i) => [`F${i + 13}`, `F${i + 13}`]);
const transport = select("Send with", "transport", [
  ["bridge", "Bridge (invisible, recommended)"],
  ["console", "F8 console"],
  ["chat", "Chat box"]
], "bridge");
const transportNote = note("<b>Bridge</b> runs anything instantly without opening chat or F8. <b>F8 console</b> needs no setup but can only run resource commands on normal FiveM builds. <b>Chat</b> types <code>/command</code> into chat.");

const gameSettings = `  <details class="fd-advanced">
    <summary>Game connection (all FiveDeck keys)</summary>
${heading("Bridge")}
  <sdpi-item>
    <div class="fd-status" data-bridge-status>Checking the bridge…</div>
  </sdpi-item>
  <sdpi-item>
    <sdpi-button data-bridge-install>Add the bind to fivem.cfg now</sdpi-button>
  </sdpi-item>
${select("Bridge key", "bridgeKey", functionKeys, "F24", " global")}
${checkbox("Setup", "autoBridge", "Install the bridge bind automatically", true, " global")}
${note("The bridge binds a key no keyboard has to <code>exec fxd:/fivedeck.cfg</code>. FiveDeck writes each press's commands into that file in <code>%APPDATA%\\CitizenFX</code> and taps the key. Binds only run while you're in a server or story mode, not in menus or text boxes.")}
${heading("Input")}
${checkbox("Focus", "focusGame", "Bring FiveM to the front before sending", false, " global")}
${select("Console key", "consoleKey", [["F8", "F8"], ["GRAVE", "` (grave)"], ["F1", "F1"], ["F2", "F2"]], "F8", " global")}
${select("Chat key", "chatKey", [["T", "T"], ["Y", "Y"], ["U", "U"], ["RETURN", "Enter"]], "T", " global")}
  <sdpi-item label="Input delay">
    <sdpi-range setting="inputDelayMs" min="30" max="600" step="10" default="90" global showlabels></sdpi-range>
  </sdpi-item>
${checkbox("Compatibility", "scanCodeOnly", "Send scan codes only", false, " global")}
${heading("FiveM")}
  <sdpi-item label="FiveM.exe">
    <sdpi-file setting="fivemPath" accept=".exe" global></sdpi-file>
  </sdpi-item>
${note("Leave empty to use the default install in <code>%LOCALAPPDATA%\\FiveM</code>. FiveDeck only sends keys while a FiveM window is active.")}
  </details>`;

const slotSelect = select("Server", "slot", [["s1", "Server 1"], ["s2", "Server 2"], ["s3", "Server 3"]], "s1");
const slotSettings = (withPassword) => ["s1", "s2", "s3"].map(slot => when("slot", slot, "s1", `${heading(`Server ${slot.slice(1)} connection (shared)`)}
${textfield("Name", `servers.${slot}.name`, `Server ${slot.slice(1)}`, " global")}
${textfield("Host", `servers.${slot}.host`, "127.0.0.1", " global")}
${textfield("Game port", `servers.${slot}.port`, "30120", ' global pattern="\\d{1,5}"')}
${withPassword ? `  <sdpi-item label="RCON password">
    <sdpi-password setting="servers.${slot}.password" global></sdpi-password>
  </sdpi-item>` : ""}`)).join("\n");
const rconNote = note("Commands go straight into the console of a hidden server FiveDeck started. Otherwise FiveDeck uses RCON: set <code>rcon_password</code> in server.cfg. RCON is unencrypted, so use it only on this PC or your LAN. The password is saved in FiveDeck's global settings and is never exported with a profile.");

const pages = {
  command: page("Game Command settings", `
${textarea("Commands", "commands", "e dance\n/me waves\nwait 1500\ne c", 5)}
${note("One command per line; a leading <code>/</code> is optional. With the bridge, <code>wait 1000</code> pauses between lines, and <code>+commands</code> such as <code>+radiotalk</code> work in Hold mode.")}
${select("Mode", "mode", [["press", "Press: run once"], ["hold", "Hold: + on press, − on release"], ["toggle", "Toggle: alternate two sets"]], "press")}
${when("mode", "toggle", "press", textarea("Off commands", "commandsOff", "e c", 3))}
${transport}
${transportNote}
${gameSettings}`),

  emote: page("Emote settings", `
${textfield("Emote", "emote", "dance")}
${textfield("Command", "prefix", "e")}
${note("FiveDeck runs <code>&lt;command&gt; &lt;emote&gt;</code>. Most emote menus (rpemotes, dpemotes, scully) use <code>e</code>.")}
${checkbox("Hold", "holdCancel", "Hold the key to cancel the emote", true)}
${when("holdCancel", "true", "true", textfield("Cancel with", "cancelCommand", "e c"))}
${checkbox("Caption", "caption", "Show the emote name on the key", true)}
${transport}
${gameSettings}`),

  chat: page("Chat Message settings", `
${textarea("Message", "message", "brb, grabbing a coffee", 3)}
${note("Each line is sent as its own message. Chat commands such as <code>/me</code> or <code>/ooc</code> work too.")}
${checkbox("Send", "send", "Send immediately (off leaves the last line open to edit)", true)}
${gameSettings}`),

  key: page("Game Key settings", `
${select("Key", "key", [...functionKeys,
    ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`]),
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(k => [k, k]),
    ..."0123456789".split("").map(k => [k, k]),
    ["NUMPAD0", "Numpad 0"], ["NUMPAD1", "Numpad 1"], ["NUMPAD2", "Numpad 2"], ["NUMPAD3", "Numpad 3"], ["NUMPAD4", "Numpad 4"],
    ["NUMPAD5", "Numpad 5"], ["NUMPAD6", "Numpad 6"], ["NUMPAD7", "Numpad 7"], ["NUMPAD8", "Numpad 8"], ["NUMPAD9", "Numpad 9"],
    ["SPACE", "Space"], ["RETURN", "Enter"], ["ESCAPE", "Escape"], ["BACKSPACE", "Backspace"], ["TAB", "Tab"], ["CAPITAL", "Caps Lock"],
    ["UP", "Up"], ["DOWN", "Down"], ["LEFT", "Left"], ["RIGHT", "Right"], ["INSERT", "Insert"], ["DELETE", "Delete"],
    ["HOME", "Home"], ["END", "End"], ["PAGEUP", "Page Up"], ["PAGEDOWN", "Page Down"], ["GRAVE", "` (grave)"]
  ], "F13")}
  <sdpi-item label="Modifiers">
    <sdpi-checkbox-list setting="modifiers" columns="3">
      <option value="ctrl">Ctrl</option>
      <option value="shift">Shift</option>
      <option value="alt">Alt</option>
    </sdpi-checkbox-list>
  </sdpi-item>
${select("Mode", "mode", [["hold", "Mirror the Stream Deck key (hold)"], ["tap", "Tap"]], "hold")}
${checkbox("Caption", "caption", "Show the key name on the key", true)}
${note("F13–F24 exist on no keyboard. In FiveM open <b>Settings → Key Bindings → FiveM</b>, choose a control such as radio push-to-talk, then press this Stream Deck key to assign it. FiveM key bindings can't use modifiers, so leave them off for that.")}
${gameSettings}`),

  toggle: page("Dev Toggle settings", `
${select("Overlay", "tool", [
    ["resmon", "Resource monitor (resmon)"],
    ["netgraph", "Net graph (netgraph)"],
    ["fps", "FPS counter (cl_drawFPS)"],
    ["perf", "Performance (cl_drawPerf)"],
    ["strdbg", "Streaming debug (strdbg)"],
    ["neteventlog", "Net event log (netEventLog)"],
    ["custom", "Custom…"]
  ], "resmon")}
${when("tool", "custom", "resmon", `${textfield("Label", "customLabel", "HUD")}
${textfield("On", "customOn", "hud 1")}
${textfield("Off", "customOff", "hud 0")}`)}
${note("These overlays are blocked in F8 on normal FiveM builds, so the toggle always uses the bridge. FiveM remembers them between sessions; if the key is out of step, press it twice.")}
${gameSettings}`),

  join: page("Join Server settings", `
${textfield("Server", "address", "cfx.re/join/abc123 or 127.0.0.1:30120")}
${textfield("Label", "label", "Shown instead of the server name")}
${checkbox("Status", "showStatus", "Show live status and players", true)}
${select("Refresh", "pollSeconds", [["15", "Every 15 seconds"], ["30", "Every 30 seconds"], ["60", "Every minute"], ["300", "Every 5 minutes"]], "60")}
${note("Paste a join code, a cfx.re/join link, a server-list link, or an address. Tap to join. If you're already in a server, FiveM holds the link until you leave; <b>hold the key</b> to switch now (FiveDeck sends <code>disconnect</code> for you). Join codes refresh at most once a minute.")}
${gameSettings}`),

  launch: page("Launch FiveM settings", `
${note("Tap to start FiveM, or bring it to the front if it's running. Hold to quit the game. The key lights up while FiveM runs.")}
${gameSettings}`),

  fxserver: page("FXServer settings", `
${slotSelect}
  <sdpi-item label="FXServer.exe">
    <sdpi-file setting="executable" accept=".exe"></sdpi-file>
  </sdpi-item>
${select("Start", "mode", [["cfg", "Server with server.cfg"], ["txadmin", "txAdmin"]], "cfg")}
${when("mode", "cfg", "cfg", `  <sdpi-item label="server.cfg">
    <sdpi-file setting="configPath" accept=".cfg"></sdpi-file>
  </sdpi-item>`)}
${when("mode", "txadmin", "cfg", textfield("txAdmin port", "txAdminPort", "40120", ' pattern="\\d{1,5}"'))}
${select("Console", "consoleMode", [["hidden", "Hidden (FiveDeck log, commands, graceful stop)"], ["window", "Own window (type into it yourself)"]], "hidden")}
${select("Tap while running", "pressAction", [["log", "Open the live log"], ["restart", "Restart the server"], ["txadmin", "Open txAdmin"], ["nothing", "Nothing"]], "log")}
${checkbox("Crashes", "autoRestart", "Restart automatically after a crash (up to 3 times in 5 minutes)")}
${textfield("Extra arguments", "extraArgs", "+set onesync on")}
${note("The server runs from the folder that holds server.cfg (txAdmin runs from the FXServer folder). Tap to start; <b>hold to stop</b>. The red badge counts script errors since start. Hidden servers stop when Stream Deck closes.")}
${slotSettings(false)}`),

  "server-command": page("Server Command settings", `
${slotSelect}
${select("Command", "preset", [
    ["ensure", "Restart resource (ensure)"],
    ["refresh-ensure", "Refresh, then restart resource"],
    ["restart", "Restart resource (restart)"],
    ["stop", "Stop resource"],
    ["refresh", "Refresh resource list"],
    ["custom", "Custom commands…"]
  ], "ensure")}
${when("preset", "ensure,refresh-ensure,restart,stop", "ensure", textfield("Resource", "resource", "my-resource"))}
${when("preset", "custom", "ensure", textarea("Commands", "custom", "say Restarting in 5 minutes\nstatus", 4))}
${checkbox("Caption", "caption", "Show the resource on the key", true)}
${rconNote}
${slotSettings(true)}`),

  artifacts: page("Artifact Watch settings", `
${select("Platform", "platform", [["win32", "Windows"], ["linux", "Linux"]], "win32")}
${checkbox("Compare", "compare", "Compare with the build a server runs", true)}
${when("compare", "true", "true", slotSelect)}
${note("Uses the same version feed as txAdmin. Tap to download the recommended build; hold for the latest. Critical means the build is below Cfx's critical version and should be updated.")}
${when("compare", "true", "true", slotSettings(false))}`),

  dial: page("Command Dial settings", `
${textfield("Label", "label", "Emotes")}
${select("Mode", "mode", [["list", "List of commands"], ["range", "Number range"]], "list")}
${when("mode", "list", "list", `${textarea("Commands", "items", "Dance = e dance\nWave = e wave\nSit = e sit\nCancel = e c", 6)}
${note("One per line. <code>Label = command</code> shows the label on the touch strip.")}`)}
${when("mode", "range", "list", `${textfield("Template", "template", "setradio {value}")}
${textfield("Minimum", "min", "1")}
${textfield("Maximum", "max", "10")}
${textfield("Step", "step", "1")}`)}
${checkbox("Wrap", "wrap", "Wrap around at the ends", true)}
${transport}
${gameSettings}`)
};

for (const [name, html] of Object.entries(pages)) await writeFile(join(ui, `${name}.html`), html);
console.log(`Wrote ${Object.keys(pages).length} property inspectors.`);
