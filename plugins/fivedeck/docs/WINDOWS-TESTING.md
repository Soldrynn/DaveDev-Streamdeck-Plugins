# FiveDeck: next Windows test session

Prepared 12 October 2026. Target: **FiveDeck Preview 0.2.0.1**, direct DevCon transport. All boxes below are **not yet PC-tested**. Start with P0; the rest can wait until that passes.

## P0: install, first command, recovery (about 15 minutes)

1. **Back up before updating.** In Stream Deck Preferences → Profiles, right-click each profile containing FiveDeck and choose Export. Check the exported file exists; keep the previous known-good installer too. A profile export is not a backup of plugin binaries or global server credentials. Do not uninstall FiveDeck as part of this test. [Elgato profile export](https://docs.elgato.com/streamdeck/sdk/guides/profiles/)
   - Record Windows version, Stream Deck software/version/model, FiveM Legacy or Enhanced, client build, and test-server name.
   - Use a spare test profile/page and a private development server or safe idle session. Avoid live RP, radio PTT, paid actions, and production server commands.

2. **Install the exact preview.** Double-click `FiveDeck-0.2.0.1-direct-preview.streamDeckPlugin`. It updates the existing `com.davedev.fivedeck` plugin. Confirm the action category is **FiveDeck Preview** and the installed manifest reports **0.2.0.1**. Windows 10/11 x64 and Stream Deck 7.1+ are required by this preview.
   - Optional read-only PowerShell version check:
     ```powershell
     Get-Content "$env:APPDATA\Elgato\StreamDeck\Plugins\com.davedev.fivedeck.sdPlugin\manifest.json" -Raw | ConvertFrom-Json | Select-Object Name, Version, UUID
     ```
   - Installer SHA-256: `6f9a29815040925777de826ea8f2e016eb09345d3551d676a839db394f74b93d`.

3. **Choose the local connection safely.** Start FiveM normally. Add **Game Command** → **Press: run once** → Commands: `echo FIVEDECK_SMOKE_A`. Under **Connection settings & setup**, select **Primary · 127.0.0.1:29200**. This selection applies to all command keys/dials.
   - **Legacy:** do not add `-devcon`. Its normal listener is loopback; `-devcon` changes that binding to all IPv4 interfaces. [Cfx receiver source](https://github.com/citizenfx/fivem/blob/master/code/components/devcon/src/DevConServer.cpp)
   - **Enhanced:** manually open F8 → Console → Remote Console, enable it if you choose to allow local remote commands, then close F8. This is a security-relevant user setup step; FiveDeck does not enable it. Enhanced uses 29200, not the Legacy secondary port 29300. [Cfx Enhanced documentation](https://docs.fivem.net/docs/developers/legacy-vs-enhanced/#remote-console-devcon)
   - Optional read-only binding check:
     ```powershell
     Get-NetTCPConnection -State Listen -LocalPort 29200,29300 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess
     ```
     Expect the intended FiveM listener on `127.0.0.1`. If it shows `0.0.0.0`, `::`, or a LAN/public address, stop and review the configuration. Do not open firewall/router ports to make this test pass. No listener means setup is incomplete; do not treat it as an installer failure.

4. **Separate handshake from execution.** Click **Test connection** once. Expect **FiveM responded**, no command execution, and an enabled button after completion. Return to FiveM with F8/chat closed; press the Game Command key once. Expect brief **SENDING**, then **SENT**. Neither F8 nor chat should open automatically. Open F8 manually afterward: `FIVEDECK_SMOKE_A` should appear once, then close F8. That observed marker, rather than SENT, establishes execution for this test.
   - If the key shows **CHECK LINK**, read the inspector/log before continuing.
   - If it shows **CHECK GAME**, transmission started but its outcome is uncertain. Check the game before repeating anything with side effects.

5. **Idle and repeated presses.** Change the marker to `echo FIVEDECK_SMOKE_REPEAT`; allow the setting to save. Press three times roughly one second apart, then inspect F8 manually: expect three new markers. Close F8, wait 60 seconds without pressing, and press once: expect one additional marker. No repeated/background execution should occur during idle. If that passes, try three quick deliberate taps and count exactly three new markers. Record any missing/duplicate marker or warning; do not spam a gameplay command to diagnose it.

6. **Background and missing-client safety.** Put a blank Notepad window in the foreground while FiveM stays open. Press the echo key: Notepad must receive no text or shortcut, and FiveM should receive the echo without being brought forward. Then quit FiveM normally, keep Notepad active, and press once: expect a warning, no typing, and no automatic launch or retry. Restart FiveM, wait 10 seconds without pressing, and confirm the failed echo was not replayed. Use **Test connection**, then a new deliberate press; it should work again.
   - The inspector can still show an earlier successful result after FiveM closes. It displays the last result; it is not a continuously monitored connection.

7. **Explicit keyboard actions stay separate.** Add **Chat Message** with the single line `FIVEDECK_UNSENT`; turn **Send immediately** off and **Bring FiveM to the front before sending keys** off. With Notepad active, press: expect a warning and no text. With FiveM active and its chat initially closed, press: the marker should appear unsent in chat; cancel it manually. Do not use multiple lines here, because earlier lines are sent even with Send off. Also test an unbound **Game Key F13**: no foreground switch; no key-down when FiveM is inactive. A held key already pressed in FiveM must release when you let go, even after alt-tabbing.

**P0 stop conditions:** unintended typing, automatic F8/chat opening from a command action, automatic command replay, duplicated execution from one press, wrong-client execution, exposed listener, installer mismatch, or a stuck control. Save the exact step and log; do not work around the failure with `-devcon`, a bridge bind, firewall changes, or repeated side-effectful commands.

## P1: action and session coverage

Run after P0, only for hardware/client features you use. Mark unavailable features N/A, not passed.

- [ ] **Profile migration:** duplicate one existing Bridge/F8/Chat-transport Game Command key into the test profile, replace its command with an echo, and press. It should use direct transport with no keyboard fallback. The standalone Chat Message action must still be explicit keyboard input.
- [ ] **Toggle:** fresh Game Command, Toggle mode, Commands `echo FIVEDECK_TOGGLE_ON`, Off commands `echo FIVEDECK_TOGGLE_OFF`. Three presses should produce ON, OFF, ON. Its lit state records the last requested direction; it is not a readback from FiveM.
- [ ] **Emote / Dev Toggle:** try a harmless emote already known to work on that server; hold over 600 ms to cancel if enabled. For Dev Toggle, use FPS and restore the initial state afterward. Record the actual game effect separately from SENT; command permissions/build support can prevent effects even after transmission.
- [ ] **Command Dial, Stream Deck + only:** use list entries `A = echo FIVEDECK_DIAL_A` and `B = echo FIVEDECK_DIAL_B`. Rotate: no command. Press selected entry: one matching marker. Tap the touch strip: one matching marker. Check selection persistence after switching away/back, and repeat the absent-client failure without keyboard input.
- [ ] **Hold lifecycle:** only with an existing harmless `+command` whose matching `-command` is known and whose normal in-game release you know. Check press/release, two quick cycles, and changing Stream Deck pages while held. Normal releases should occur once. Separately test a client/process change while held: old releases must not be sent into a new target/session. You may need to release manually. Do not use critical PTT for this stress test.
- [ ] **Connection selection:** if using Legacy `-cl2`, test 29300 separately with distinctive echo markers and verify only the selected client gets them. Change selection and click Test immediately: it must probe the visible selection or ask you to wait for saving; never silently probe the old selection. Return to Primary. Enhanced secondary is unsupported.
- [ ] **Restart persistence:** close/reopen Stream Deck with no active holds; confirm existing actions/settings survive, no command runs by itself, and a fresh echo works. This does not require starting an FXServer.
- [ ] **Join/quit, last:** only when leaving the test session is acceptable. Primary only: Join tap submits the chosen link; hold over 700 ms requests a switch via direct `disconnect`. Launch hold over 900 ms requests `quit`. With direct connection unavailable, switch/quit must warn without typing; a join link may already be queued, so inspect the game before retrying. Do not infer successful joining/quitting from SENT.

## How to read the result

- **FiveM responded:** the CitizenFX handshake succeeded at that time; no command was sent by the test.
- **Command transmitted / SENT:** one batch was handed to the socket. This is not an execution acknowledgement, proof of permission, or completion of a `wait` sequence.
- **CHECK LINK:** the action failed; use its message/log to distinguish setup, validation, or transport failure.
- **CHECK GAME:** the command may have run. Inspect before retrying.
- Every deliberate dispatch opens a fresh local connection. There is no automatic command retry or keyboard fallback. Batches are limited to 1024 UTF-8 bytes, including separators/trailing newline. The Legacy receiver's lack of command-frame reassembly remains a transport limitation: a single bounded write reduces, but cannot remove, TCP fragmentation risk. [Cfx receiver source](https://github.com/citizenfx/fivem/blob/master/code/components/devcon/src/DevConServer.cpp)

## Record once, send only the useful evidence

Result: PASS / FAIL / NOT RUN / N/A for each numbered check. Include the failed step, marker/command, expected versus observed behavior, key/inspector text, whether F8/chat opened, and timestamp. Capture a short video or screenshot if useful. Relevant plugin logs are under `%APPDATA%\Elgato\StreamDeck\Plugins\com.davedev.fivedeck.sdPlugin\logs`. Redact passwords, tokens, private server addresses and unrelated chat; do not send exported global settings or credentials.

## Off-game evidence already completed

- The preserved 10 October preview recorded successful build, full `check` (113 tests/subtests plus inspector/assets/release/bundle checks), Elgato validation, and packing. Those were cloud checks, not Windows execution.
- On 12 October, all four published SHA-256 entries rechecked successfully; installer ZIP CRC passed with 88 files. Installer manifest, bundle, shared inspector script, and README exactly match the reviewed package. The full staged binary patch also exactly matches the delivered patch.
- Fresh focused run: **72/72 tests/subtests passed**, covering transport, direct actions, focus/keyboard guards, and connection requests. Inspector regressions also passed. Full build/pack were not repeated because source and installer are unchanged.
- No new reproduced source blocker found in this focused review. The review did not install anything on the PC or change FiveM/security settings. Real Windows rendering, installation, physical controls, and Legacy/Enhanced behavior remain unverified.
