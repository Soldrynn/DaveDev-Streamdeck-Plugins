# Repository security settings

Some protections can't be committed as files. The maintainer applies them once
in the GitHub repository settings. Review this checklist after changing the
repository's visibility or ownership.

## Settings → Code security

- [ ] Private vulnerability reporting: **Enabled**.
- [ ] Dependency graph and Dependabot alerts: **Enabled**.
- [ ] Dependabot security updates: **Enabled**. Version updates come from
      `.github/dependabot.yml`.
- [ ] Secret scanning and push protection: **Enabled**.
- [ ] Code scanning: uses the committed `CodeQL` workflow. Don't also enable
      default setup, because the two conflict.

## Settings → Rules → Rulesets (branch `main`)

- [ ] Require a pull request before merging, with one approval and code-owner
      review.
- [ ] Require these status checks to pass: `windows-release-check (clef)`,
      `windows-release-check (fivedeck)`, `Analyze (javascript-typescript)`,
      and `dependency-review`.
- [ ] Block force pushes and deletions.
- [ ] Require signed commits, if every contributor can sign.

## Settings → Rules → Rulesets (tags `*-v*`)

- [ ] Restrict creation, update, and deletion to maintainers, so only
      maintainers can trigger the release workflow.

## Settings → Actions → General

- [ ] Workflow permissions: **Read repository contents**. Each workflow asks
      for any extra permission it needs.
- [ ] Turn off **Allow GitHub Actions to create and approve pull requests**.
- [ ] Require approval for workflows from outside collaborators: **All outside
      collaborators**.

## Account

- [ ] Two-factor authentication on every account with write access, using
      passkeys or security keys where possible.
