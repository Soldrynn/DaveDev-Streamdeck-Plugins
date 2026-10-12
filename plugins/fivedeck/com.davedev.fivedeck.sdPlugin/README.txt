FiveDeck v0.2
DIRECT CONNECTION PREVIEW 0.2.0.1 - not a public stable release

Installation: export a backup of your Stream Deck profile, then double-click
FiveDeck-0.2.0.1-direct-preview.streamDeckPlugin. It updates existing FiveDeck.

Windows 10/11 x64 | Stream Deck 7.1+ | Any Stream Deck with keys, plus Stream Deck + dials

Play
- Game Command: run console commands without opening chat. Press, Hold (+/-
  commands such as push-to-talk), or Toggle between two command sets.
- Emote: tap to play an emote, hold to cancel it.
- Chat Message: type a message or chat command into chat.
- Game Key: press or hold a key such as F13-F24 to drive FiveM key bindings.
- Join Server: live name and player count for a join code or address. Tap to
  join; hold to switch servers now.
- Launch FiveM: start or focus FiveM; hold to quit.

Develop
- Dev Toggle: resmon, netgraph, FPS, perf, streaming debug, net event log.
- FXServer: start a local server or txAdmin, see uptime, players, and script
  errors, open its live log, hold to stop.
- Server Command: ensure/restart/stop resources or run console commands, over
  the managed console or RCON.
- Artifact Watch: compare your FXServer build with the recommended artifacts.
- Command Dial (Stream Deck +): rotate through commands or numbers, press to run.

Direct connection setup (preview)
Command actions use FiveM's local Remote Console connection. They never fall
back to typing into F8 or chat, or to a hidden keyboard shortcut. No bridge
bind or command-file installation is needed.

1. Start FiveM normally. In any command key or dial's connection settings,
   select Primary (127.0.0.1:29200), or Legacy secondary (-cl2) on port 29300.
   This client choice applies to all command keys and dials.
2. Legacy uses its normal loopback listener. Do not add -devcon: on Legacy
   that option widens the listener's network binding beyond this PC.
   Enhanced has Remote Console disabled by default. Open F8 > Console >
   Remote Console, enable it once, then close F8. Enhanced supports only
   the primary port 29200.
3. Click Test connection. This checks the handshake without running a command.
4. Return to the game and press a command key or the Command Dial.

First safe test
Add Game Command, Press mode, with: echo FIVEDECK_TEST
Test connection, return to FiveM, then press once. Expect SENDING then SENT,
with no F8/chat popup. To verify processing, manually open F8 afterward and
look for FIVEDECK_TEST, then close it. Echo changes no game state.
CHECK LINK means dispatch failed; read the connection panel. CHECK GAME means
transmission began but the outcome is uncertain; check before repeating.

Feedback and safety
- FiveM responded means a successful handshake, not a live ongoing connection.
- Command transmitted means sent, not confirmed as executed. The panel shows
  the last result and transmission time reported to that inspector.
- Every intentional press opens a connection, sends one batch, then closes it.
  Failed commands are not automatically reconnected or retried. Check the game
  before pressing again, since a command might have run before a disconnect.
- Commands, emotes, and developer overlays still depend on client version,
  command availability, and server permissions.
- Dev Toggle displays FiveDeck's last requested state, not verified game state.
- Command batches are limited to 1024 UTF-8 bytes. FiveM interprets wait lines;
  transmission status does not wait for execution. A disconnect can prevent
  a Hold-mode release from reaching the game. Changed client/session releases
  are cancelled; release in-game if needed. Prefer Game Key for critical PTT.
- The client does not reassemble fragmented command packets. One bounded write
  per fresh connection reduces this risk but cannot eliminate TCP splitting.
- Join Server supports the primary client only. Select Primary before joining.
- Join Server's switch and Launch FiveM's quit also need the direct connection.
- This preview needs Windows in-game validation, including FiveM Enhanced.
  Automated protocol tests are not an in-game compatibility guarantee.

Existing profiles
Command-action keys that used Bridge, F8 console, or Chat now use the direct
connection automatically. The explicit Chat Message action still types into
chat, and Game Key still sends its chosen key. Their input settings apply
only to keyboard actions, which require a FiveM window to be active.

No FiveM resource is needed. Licensed under Apache-2.0. FiveDeck is not
affiliated with Cfx.re, Rockstar Games, or Elgato.
