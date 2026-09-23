# Security policy

DaveDev Stream Deck plugins run on people's own computers, and FiveDeck sends
keyboard input to games and can start server processes. Security reports are
welcome and taken seriously.

## Report a vulnerability

Please report vulnerabilities privately through GitHub:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Describe the issue, the affected plugin and version, and the steps to
   reproduce it.

Please do not open a public issue, pull request, or discussion for a
vulnerability before a fix is released. If private reporting is unavailable,
open an issue that asks for a private contact without including any details.

You can expect an acknowledgement within 7 days and a status update at least
every 14 days until the report is resolved. Fixes ship as a new plugin version,
and the advisory credits the reporter unless they ask not to be named.

## Supported versions

Only the latest release of each plugin receives security fixes.

| Plugin | Supported |
| --- | --- |
| Clef | Latest release |
| FiveDeck | Latest release |

## Scope

The following are in scope:

- Plugin code, property inspectors, and bundled assets under `plugins/`.
- Build, packaging, and release scripts, and the GitHub Actions workflows.
- FiveDeck's handling of keyboard input, server credentials, spawned
  processes, and network responses.

The following are out of scope. Please report them to their owners:

- FiveM, RedM, FXServer, txAdmin, and Cfx.re services.
- The Elgato Stream Deck application and SDK.
- Third-party FiveM resources and servers.

## How the plugins protect you

FiveDeck is built around these rules:

- **Keystrokes go only to the game.** FiveDeck sends keyboard input only while
  a FiveM or RedM game window is in the foreground. If you switch to another
  window, a key press does nothing instead of typing a command into that
  window.
- **Secrets stay out of shared profiles.** RCON passwords are stored in the
  plugin's global settings, not in per-key settings. Exported or shared Stream
  Deck profiles therefore do not contain them.
- **No shell.** Server processes start from an explicit `FXServer.exe` path with
  an argument list, never through a command shell, so key settings cannot inject
  shell commands.
- **Untrusted network data is treated as untrusted.** Server names and
  responses are length-limited, stripped of formatting codes, and XML-escaped
  before they are drawn on a key.
- **Pinned native code.** The only native module, koffi, is packaged from the
  lockfile, and its integrity hash is verified whenever it has to be downloaded.
- **No telemetry.** The plugins do not collect or send usage data.

RCON is an unencrypted, legacy protocol. Use it only for servers on the same
computer or a trusted local network, and use a unique password.

## Release integrity

Tagged releases are built on GitHub-hosted runners. Each release attaches a
SHA-256 checksum and a signed build-provenance attestation. To verify a
download, run:

```sh
gh attestation verify <file>.streamDeckPlugin --repo Soldrynn/DaveDev-Streamdeck-Plugins
```
