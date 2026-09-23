# Contributing

Thanks for helping improve DaveDev Stream Deck plugins.

## Before you open a pull request

- Keep each change inside one plugin directory unless it's repository tooling.
- Run the plugin's `npm run build`, `npm run check`, and `npm run validate`.
- Add or update tests for behaviour that can run without Stream Deck hardware.
- Say in the pull request which parts you could only test on real hardware, and
  which you couldn't test at all.

## Dependencies

Add a dependency only when it removes real complexity. Runtime dependencies ship
inside the plugin installer, so they need a licence compatible with Apache-2.0,
a lockfile entry, and a line in the plugin's `THIRD_PARTY_NOTICES.md`. Dependabot
proposes weekly updates, and the dependency-review check blocks pull requests
that add known-vulnerable packages.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
Never include passwords, RCON passwords, license keys, or tokens in issues,
logs, screenshots, or test fixtures.
