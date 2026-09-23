# FiveDeck for Stream Deck

![FiveDeck: FiveM on any Stream Deck. No chat box. No resource.](branding/THUMBNAIL.png)

[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-555555)](https://www.microsoft.com/windows)
[![Stream Deck](https://img.shields.io/badge/Stream%20Deck-keys%20%2B%20dials-555555)](https://www.elgato.com/us/en/s/stream-deck)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-555555)](LICENSE)

FiveDeck connects any Elgato Stream Deck to FiveM. It runs commands and emotes
without opening chat, joins servers by join code with live player counts, and
starts, restarts, and watches a local FXServer while you develop. FiveDeck is a
standalone Stream Deck plugin: servers don't need to install a resource, and
players don't need to install anything in FiveM.

> **Preview release.** FiveDeck 0.1 is built from the FiveM client and FXServer
> source code and covered by automated tests. It has not yet been tested
> against every FiveM build, keyboard layout, and server setup. Please
> [report anything that doesn't work](https://github.com/Soldrynn/DaveDev-Streamdeck-Plugins/issues/new/choose).

## Features

FiveDeck provides the following actions.

For players:

| Action | Press | Shows |
| --- | --- | --- |
| Game Command | Runs one or more console commands. In Hold mode, `+commands` run on press and `-commands` on release. In Toggle mode, it alternates between two sets. | The command icon, lit while a toggle is on |
| Emote | Plays an emote; hold the key to cancel it | The emote name |
| Chat Message | Types a message or chat command into chat | Static icon |
| Game Key | Presses or holds a key, such as F13–F24, in the game | The key name |
| Join Server | Tap to join; hold to switch servers now | Server name, players, and capacity |
| Launch FiveM | Tap to start or focus FiveM; hold to quit | Whether FiveM is running |

For developers:

| Action | Press | Shows |
| --- | --- | --- |
| Dev Toggle | Turns resmon, netgraph, FPS, perf, streaming debug, or net event log on or off | An on/off switch |
| FXServer | Tap to start (or open the live log); hold to stop | Status, uptime, players, and a script-error count |
| Server Command | Runs `ensure`, `restart`, `stop`, or `refresh` for a resource, or any console commands | The resource name |
| Artifact Watch | Tap to download the recommended build; hold for the latest | Your build compared with the recommended and critical builds |

For Stream Deck +:

| Action | Rotate | Press or touch |
| --- | --- | --- |
| Command Dial | Choose from a list of commands, or pick a number | Runs the choice, for example `e dance` or `setradio 4` |

## Requirements

To use FiveDeck, you need the following:

- Windows 10 or 11 on an x64 computer.
- Elgato Stream Deck 7.1 or later, and any Stream Deck with keys. Command
  Dial needs a Stream Deck +.
- FiveM for the player actions. FXServer, Server Command, and Artifact Watch
  work without FiveM installed.

## Install FiveDeck

To install FiveDeck, do the following:

1. Download `com.davedev.fivedeck.streamDeckPlugin` from the
   [latest GitHub release](https://github.com/Soldrynn/DaveDev-Streamdeck-Plugins/releases/latest).
2. Double-click the downloaded file, and then approve the installation in
   Stream Deck.
3. In the Stream Deck action list, expand the **FiveDeck** category.
4. Drag an action such as **Emote** or **Join Server** onto a key.

## How FiveDeck talks to FiveM

FiveDeck sends keyboard input to FiveM, and it has three ways to deliver a
command.

### The bridge (default)

FiveM runs key-bound commands with full console rights, and its `exec` command
can read files from `fxd:/`, which is `%APPDATA%\CitizenFX`. FiveDeck binds one
key that no keyboard has (F24 by default) to `exec fxd:/fivedeck.cfg`. On each
press, it writes that key's commands into the file and taps F24, and FiveM runs
them on the next frame. The bridge has the following advantages:

- It doesn't open chat or the console.
- A key can run any number of commands, including `wait 1000` pauses.
- It works with every client command, including developer commands that the F8
  console blocks on normal FiveM builds.

FiveDeck installs the bind for you, once. If FiveM is closed, it adds this
line to `%APPDATA%\CitizenFX\fivem.cfg` and first saves a backup as
`fivem.cfg.fivedeck-backup`:

```text
bind KEYBOARD F24 "exec fxd:/fivedeck.cfg"
```

If FiveM is running, FiveDeck types the same `bind` command into F8 the first
time you use the bridge. F8 allows `bind` on every FiveM build. FiveDeck never
replaces a bind you already have on the bridge key; it tells you to pick
another key instead. To install the bind yourself instead, turn off **Install
the bridge bind automatically** and type this into F8:

```text
bind keyboard F24 "exec fxd:/fivedeck.cfg"
```

About three seconds after each use, FiveDeck clears the file so an old command
can't run again.

### F8 console and chat

Every command action can instead type into the F8 console or the chat box. The
console needs no setup, but on normal FiveM builds it only allows resource
commands and a few built-ins such as `connect`, `disconnect`, and `quit`. Chat
sends `/command` or plain messages the way you would type them.

### Safety

FiveDeck sends keys only while a FiveM or RedM window is in the foreground. If
you switch to another window, a key press does nothing instead of typing into
that window. To have FiveDeck bring FiveM to the front first, turn on **Bring
FiveM to the front before sending**.

## Use the player actions

### Push-to-talk and other hold controls

To make a Stream Deck key work like a held key, do one of the following:

- **Bind a FiveM control to the Stream Deck key.** Add **Game Key** with F13
  and **Mirror the Stream Deck key (hold)**. In FiveM, open **Settings → Key
  Bindings → FiveM**, select a control such as radio push-to-talk, and press
  the Stream Deck key. FiveM records F13 and treats the key like any other.
- **Run the command directly.** Add **Game Command** in **Hold** mode with a
  `+command` such as `+radiotalk`. FiveDeck runs `+radiotalk` on press and
  `-radiotalk` on release.

### Join and switch servers

**Join Server** accepts a join code (`abc123`), a `cfx.re/join` link, a
server-list link, a `fivem://connect` link, a pasted `connect` command, or an
address such as `127.0.0.1:30120`.

When you tap the key, FiveDeck starts FiveM with a `fivem://connect` link if the
game is closed. If FiveM is already open, FiveDeck hands the link to it, the
same way a browser's **Connect** button does.

FiveM doesn't reject a link it receives while you're in a server. It holds the
link until the session ends, which is why join links often seem blocked. To
switch servers in one press, **hold** the Join Server key: FiveDeck sends the
link and then `disconnect`, and FiveM connects to the new server as it leaves
the old one.

The key shows the server's name, player count, and capacity. For addresses,
FiveDeck reads the server's own `/dynamic.json` and `/info.json`. For join
codes, it uses the Cfx server list and refreshes at most once a minute. If the
list can't be reached, the key shows **JOIN** instead of a player count.

## Use the developer actions

### FXServer

FXServer starts a local server from `FXServer.exe`, either with a
`server.cfg` or as txAdmin. The server runs from the folder that holds
`server.cfg`, just like `FXServer.exe +exec server.cfg`.

The server can run in one of two console modes:

- **Hidden** (default): FiveDeck owns the console. You get a live log window,
  graceful stops with `quit`, commands from Server Command without RCON, a
  count of script errors, and the txAdmin PIN on the key during first-time
  setup. A hidden server stops when Stream Deck closes.
- **Own window:** FXServer opens its usual console window for you to type into.
  It keeps running after Stream Deck closes, and stopping it from Stream Deck
  ends the process.

Tap the key to start the server. While it runs, a tap opens the live log,
restarts the server, or opens txAdmin, depending on the key's setting. Hold
the key to stop the server. The key's status is `STARTING` until the server
answers on its game port, and then `RUNNING`.

### Server Command

Server Command restarts a resource or runs console commands on a server. If
FiveDeck started that server hidden, commands go straight into its console.
Otherwise, FiveDeck uses RCON. To use RCON, do the following:

1. Add `set rcon_password "a-long-unique-password"` to `server.cfg`. The
   password can't contain spaces.
2. In the key settings, select a server and enter its host, game port, and
   RCON password.

The key flashes a warning if FXServer replies `Couldn't find resource` or
prints a script error.

RCON is unencrypted, so use it only on the same computer or a trusted LAN.
FXServer limits RCON from other networks to one request every five seconds.
FiveDeck saves server connections in its global settings, so exported Stream
Deck profiles never contain RCON passwords.

### Server slots

FXServer, Server Command, and Artifact Watch share three server slots. Give a
slot a name, host, and game port once, and every key that uses that slot
follows it. For example, point an FXServer key and several Server Command keys
at **Server 1** to restart resources on the server that key started.

### Artifact Watch

Artifact Watch reads the same version feed that txAdmin uses. It compares the
feed with the build your server reports in `/info.json`, and shows
`CRITICAL`, `OUTDATED`, `CURRENT`, or `AHEAD`.

## Troubleshoot FiveDeck

### A key flashes a warning and nothing happens

Check the following:

- FiveM is the active window, or **Bring FiveM to the front before sending**
  is on.
- You're in a server or story mode. FiveM doesn't run key binds in the main
  menu, the pause menu, or while a text box such as chat is open.
- The **Game connection** section of any FiveDeck key shows **Bridge ready**.

The plugin log in `%APPDATA%\Elgato\StreamDeck\Plugins\com.davedev.fivedeck.sdPlugin\logs`
records why each press was refused.

### A developer overlay is out of step

FiveM remembers `resmon`, `netgraph`, and the other overlays between sessions,
and FiveDeck can't read their current state. Press the key twice to bring it
back in step.

### Typed text is wrong on my keyboard layout

FiveDeck types text as Unicode characters, so typed text doesn't depend on the
keyboard layout. Keys such as the console and chat keys are sent as a virtual
key plus its scan code. If one of them doesn't respond, turn on **Send scan
codes only**, or raise **Input delay** on slower computers.

## Known limitations

- FiveDeck supports Windows only, because FiveM and its input run on Windows.
- Key binds don't run in menus or while a text field has focus, which is
  FiveM's own rule.
- FiveM key bindings can't use modifier keys, so use F13–F24 without
  modifiers for **Game Key** controls that you bind in FiveM.
- Join-code status depends on the public Cfx server list, which can rate-limit
  or block automated requests.
- `players.json` hides player names on current FXServer builds, so FiveDeck
  shows counts, not names.

## Security and privacy

FiveDeck doesn't collect telemetry. It sends keys only to FiveM windows, starts
FXServer and FiveM directly instead of through a command shell, and keeps RCON
passwords out of shareable profiles. See the repository's
[security policy](../../SECURITY.md) to report a vulnerability.

## Build from source

You need Node.js 24 or later. Build on Windows, or on any system with network
access, where the build downloads the Windows koffi module and checks it
against the lockfile's integrity hash. From `plugins/fivedeck`, run:

```powershell
npm ci
npm run build
npm run check
npm run validate
npm run pack
```

The installer is written to `dist\com.davedev.fivedeck.streamDeckPlugin`.

To regenerate the artwork, run `npm run assets`, which writes the icons and
key images, and `npm run ui`, which writes the property inspectors.
`branding/README-assets.txt` covers the Marketplace images.

## Project layout

FiveDeck lives in `plugins/fivedeck`:

| Path | Purpose |
| --- | --- |
| `branding/` | App icon source, Marketplace thumbnail and gallery, and their render scripts. |
| `com.davedev.fivedeck.sdPlugin/` | Manifest, generated property inspectors, layouts, and assets. |
| `scripts/` | Build, asset and UI generators, validation, and the bundle smoke test. |
| `src/core/` | FiveM bridge, Windows input, FXServer supervision, RCON, server queries, and key art. |
| `src/actions/` | Stream Deck actions. |
| `tests/` | Behaviour tests that run without Stream Deck or FiveM. |

## License

FiveDeck is licensed under the [Apache License 2.0](LICENSE). Bundled
third-party components remain under their own licences; see the
[third-party notices](THIRD_PARTY_NOTICES.md).

FiveM, RedM, FXServer, txAdmin, and Cfx.re belong to their respective owners.
Stream Deck and Elgato are trademarks of Corsair Memory, Inc. FiveDeck is an
independent project and is not affiliated with or endorsed by Cfx.re, Rockstar
Games, Take-Two Interactive, or Elgato.
