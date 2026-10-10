# Repository security settings

These are proposed settings for a maintainer to review and apply in GitHub.
Committing this checklist does not change repository settings, enable a security
service, or prove that any protection is active.

## Main branch ruleset

Target `main` and enable:

- Require a pull request before merging.
- Require status checks after confirming their names from successful runs:
  `windows-release-check (clef)`, `Analyze (actions)`,
  `Analyze (javascript-typescript)`, `Analyze (csharp)`, and `dependency-review`.
- Require branches to be up to date before merging; resolve conversations.
- Block force pushes and branch deletion.

For a solo maintainer, start with **zero required approvals** rather than
requiring the author to approve their own PR. CODEOWNERS routes reviews but does
not itself enforce them. Enable one required independent approval and code-owner
review only when a second eligible reviewer is available. Review any bypass list
explicitly; do not silently grant a broad bypass. Signed-commit enforcement is
optional only after all contribution paths support it.

## Release tag ruleset

Target `clef-v*`. Restrict new tag creation to the designated release maintainer
and block tag updates/deletion. Do not move, delete, or rename historical tags,
including `v1.1.0.0`. Review how any maintainer bypass affects update/deletion
before enabling it. No tags are created by this maintenance change.

## Code security

- Enable dependency graph, Dependabot alerts, and Dependabot security updates.
  Weekly npm and Actions version updates are configured in `dependabot.yml`.
- Enable secret scanning and push protection where available.
- Enable private vulnerability reporting and verify **Report a vulnerability**
  is visible to an outside reporter before describing it as active.
- Use the committed advanced CodeQL workflow. Check for default setup first;
  do not enable conflicting default and advanced configurations.
- Review security alerts after the first successful scans. A passing workflow
  means the analysis completed, not that its findings are empty.

## Actions

- Set default workflow permissions to read repository contents.
- Turn off **Allow GitHub Actions to create and approve pull requests**.
- Require approval for workflows from all outside collaborators.
- Keep Actions pinned to full commit SHAs and review Dependabot updates.
- Normal build/audit jobs have read-only repository access. CodeQL and Scorecard
  request `security-events: write` only for scanning results. Scorecard does not
  publish to the external OpenSSF service and has no OIDC permission.
- The separate draft-release job requests `contents: write`, `id-token: write`,
  and `attestations: write`. It downloads this run's build output and does not
  check out or execute repository source. These grants are job-scoped, not
  repository-wide credentials.

## Ongoing maintenance

The helper bundles .NET; users' system .NET updates do not service that copy.
Rebuild and distribute a new Clef version when relevant .NET 10 runtime patches
ship. `10.0.x` and `global.json` select a serviced stable .NET 10 SDK on fresh CI
runs. Dependabot's npm/Actions updates do not update the bundled .NET runtime.

Confirm two-factor authentication for every account with write access. No
account permissions, security settings, secrets, or collaborators are changed by
this PR. The maintainer must approve setting changes separately.
