# Releasing Clef

## Historical release caveat

The existing `v1.1.0.0` tag points to commit
`13dfcf451895ac18776e1f76df0bd13835acde2a`, while its GitHub release title says
Clef 1.1.0.1. That source snapshot predates dependency fixes on `main`. The
uploaded installer's exact source and runtime have not been independently
verified. Preserve the historical tag and assets; do not retag or replace them
to hide the discrepancy.

This change prepares **1.1.0.2**, including the .NET 10 helper migration. It does
not publish an installer or alter the historical release. A future corrected
release should use the new plugin-scoped tag **`clef-v1.1.0.2`** at the tested,
approved source commit after it has merged into `main`.

## Before creating a tag

1. Obtain maintainer approval for the source, version, tag creation, and release.
2. Require the draft PR's Windows build, helper self-tests/IPC smoke test,
   TypeScript tests, asset checks, package validation, npm audits, dependency
   review, and CodeQL checks to pass. Review scan findings as well as job status.
3. Test the generated installer on Windows 11 x64 with Apple Music and Stream
   Deck: playback/skip, per-app volume/mute, key holds, dial feedback, track artwork,
   playlist/favorite/shuffle/repeat, app restart, and helper recovery. Hosted
   Windows CI and the IPC test do not exercise real Apple Music or hardware.
4. Confirm `manifest.json`, the helper project/protocol, and npm/lockfile versions
   agree. npm uses three components; Stream Deck and the helper use four.
5. Confirm main/tag rulesets and the release workflow's job permissions have been
   reviewed. Ensure the selected source commit is already on `main`.

From the repository root, the metadata-only checks are:

```sh
node --test scripts/tests/*.test.mjs
node scripts/validate-release-tag.mjs clef-v1.1.0.2
```

Use a new, unused tag. Do not force-push a tag or reuse one whose release failed;
inspect the existing run and draft first. Tag creation is an explicit release
operation, separate from opening or merging a PR.

## What the tag workflow does

- Checks that the tagged commit is an ancestor of `main` and that the tag matches
  all Clef version sources.
- Installs locked dependencies and verifies their registry signatures and known
  vulnerability status. These checks have different purposes.
- Builds .NET 10 and the plugin, runs tests, validates, and packs one installer.
- Saves `SHA256SUMS.txt` and `BUILD-METADATA.json` alongside the installer.
- Passes the output to a separate job with release/attestation permissions.
- Rechecks transferred checksums, attests the installer, and creates a **draft**.
  It does not publish, replace existing assets, or overwrite an existing release.

The workflow cannot run until the source and workflow are merged and an approved
matching tag is created. It is not an attestation of older releases.

## Review the draft before publication

1. Confirm the source SHA, tag, workflow run, and installer version match.
2. Download the installer and checksum file from that draft; compare the SHA-256:

   ```powershell
   Get-FileHash .\com.davedev.clef.streamDeckPlugin -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

3. Verify provenance with GitHub CLI:

   ```sh
   gh attestation verify com.davedev.clef.streamDeckPlugin --repo Soldrynn/DaveDev-Streamdeck-Plugins
   ```

   Inspect the verified source commit and workflow identity, not only the command
   exit status. If attestation verification fails, do not claim provenance.
4. Finish the Windows 11 / Apple Music smoke test and release notes. State the
   .NET migration and that older installations need the rebuilt installer.
5. Publish only with maintainer approval. Marketplace submission is a separate
   operation; this workflow does not submit anything to Elgato.
