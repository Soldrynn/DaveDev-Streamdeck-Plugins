# DaveDev Stream Deck Plugins

Free, open-source plugins for the Elgato Stream Deck by DaveDev. Each plugin is
self-contained in its own directory under `plugins/` with its own build, tests,
documentation, and licence notices.

| Plugin | Description | Platform | Marketplace |
| --- | --- | --- | --- |
| [Clef](plugins/clef/README.md) | Controls Apple Music for Windows from keys and Stream Deck + dials. | Windows 11 x64 | [Clef on the Elgato Marketplace](https://marketplace.elgato.com/product/clef-be8b8106-dc02-494f-b38d-ebda12ef2338) |

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
title. Pull requests should keep each plugin self-contained.

## License

Every plugin in this repository is licensed under the
[Apache License 2.0](LICENSE) unless its directory states otherwise. Bundled
third-party components remain under their original licences; see each plugin's
third-party notices.

Stream Deck and Elgato are trademarks of Corsair Memory, Inc. This independent
project is not affiliated with or endorsed by Elgato.
