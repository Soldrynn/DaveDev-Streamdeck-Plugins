# Security policy

## Report a vulnerability privately

Email vulnerability reports to [davedev.store@gmail.com](mailto:davedev.store@gmail.com).
Include the Clef version and installation source, the potential impact, and
steps to reproduce the issue. Do not include passwords, tokens, or unrelated
personal data.

You may also use **Report a vulnerability** in this repository's
[Security tab](https://github.com/Soldrynn/DaveDev-Streamdeck-Plugins/security)
if that option is available. This file does not itself enable GitHub private
vulnerability reporting.

Please do not post vulnerability details, proof-of-concept code, logs, or
personal data in a public issue or pull request.

## Supported versions

Security fixes target the latest Clef release. Please include the exact plugin
version and installation source in a report. Older versions should be upgraded
when a fixed release is available. The .NET 10 migration in source does not
update previously installed self-contained helper executables.

## Scope

Clef code, bundled components, local IPC, build scripts, and repository workflows
are in scope. Report issues in Apple Music, Windows, the Stream Deck application,
or upstream SDKs to their respective owners when appropriate.

## Release integrity

The `Draft Clef release` workflow is intended to build future `clef-v*` tags from
source already merged into `main`, verify their versions, and create a draft
with an installer, SHA-256 checksum, source/build metadata, and a GitHub artifact
attestation. Publishing remains a separate maintainer decision after testing.

Do not assume historical releases were built by this workflow or have an
attestation. For a release that has one, verify the downloaded installer with:

```sh
gh attestation verify <file>.streamDeckPlugin --repo Soldrynn/DaveDev-Streamdeck-Plugins
```

See [the release checklist](docs/RELEASING.md) for checksum verification and the
historical version discrepancy. A matching checksum proves file integrity, not
that a binary is safe or that it came from a particular commit; provenance must
be verified separately.
