# DaveDev Stream Deck Plugins

Free, open-source plugins for the Elgato Stream Deck by DaveDev. Each plugin is
self-contained in its own directory under `plugins/` with its own build, tests,
documentation, and licence notices.

| Plugin | Description | Platform | Marketplace |
| --- | --- | --- | --- |
| [Clef](plugins/clef/README.md) | Controls Apple Music for Windows from keys and Stream Deck + dials. | Windows 11 x64 | [Clef on the Elgato Marketplace](https://marketplace.elgato.com/product/clef-be8b8106-dc02-494f-b38d-ebda12ef2338) |
| [FiveDeck](plugins/fivedeck/README.md) | Runs FiveM commands and emotes without chat, joins servers by join code with live player counts, and drives local FXServer development. | Windows 10/11 x64 | Preview; see [releases](https://github.com/Soldrynn/DaveDev-Streamdeck-Plugins/releases) |

## Build a plugin

Each plugin documents its own requirements and commands in its README. In
general:

```powershell
cd plugins/<plugin>
npm ci
npm run build
npm run check
npm run validate
npm run pack
```

## Contribute

Use [GitHub issues](https://github.com/Soldrynn/DaveDev-Streamdeck-Plugins/issues)
for reproducible bugs and focused feature requests, and name the plugin in the
title. Pull requests should keep each plugin self-contained. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the checks each change needs.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
Releases are built by GitHub Actions and carry a signed build-provenance
attestation and a SHA-256 checksum. Workflows pin every action to a commit,
and Dependabot, CodeQL, dependency review, and OpenSSF Scorecard watch the
repository. [docs/REPOSITORY-SECURITY.md](docs/REPOSITORY-SECURITY.md) lists
the repository settings the maintainer applies by hand.

## License

Every plugin in this repository is licensed under the
[Apache License 2.0](LICENSE) unless its directory states otherwise. Bundled
third-party components remain under their original licences; see each plugin's
third-party notices.

Stream Deck and Elgato are trademarks of Corsair Memory, Inc. This independent
project is not affiliated with or endorsed by Elgato.
