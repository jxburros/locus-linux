# 002 — Compare dependency findings against the PR base

- Date: 2026-10-03
- Status: adopted to implement the user's request to fix failing CI on PR #2.
- Scope: the existing `.github/workflows/dependency-vulnerability-scan.yml` only;
  no upstream kernel files or documentation requirements are changed.

## Context

The initial OSV job scans the entire proposed tree as though every finding were
introduced by this PR. Run 37154654681 reports vulnerable npm development
dependencies introduced with the shell, plus pre-existing findings in upstream
`Documentation/sphinx/{min_requirements,requirements}.txt`. The former must be
patched. The latter are not shell dependencies, and altering upstream minimum
compatibility requirements would violate the unmodified-kernel policy.

## Decision

Use OSV's official `osv-scanner-reusable-pr.yml` at the existing v2.3.8 release.
It scans the whole base and proposed trees, compares the reports, and fails on
new findings. Keep `fail-on-vuln: true` and SARIF upload enabled. There are no
ignored packages/advisories, excluded directories, or lowered severity thresholds.
Both complete scan JSON reports are uploaded by the reusable workflow, so baseline
findings remain visible for upstream maintenance; a green PR check does not mean
the baseline is vulnerability-free.

Patch the imported npm dependencies using compatible versions in the existing
major versions, retain the lockfile, and validate the full installed graph with
`npm audit` (including development dependencies).

The user's CI-fix request authorizes editing the existing GitHub workflow in its
required root location. This is a narrow exception to the Locus-only layout rule,
not permission to modify other upstream paths or add unrelated root automation.

## Consequences and validation

New dependency vulnerabilities anywhere in the scanned tree still fail the PR.
Existing upstream findings do not force unrelated upstream divergence. The official
PR workflow fetches history to compare branches; this costs more checkout time
than the former single-tree scan.

Run locked installation, typecheck, unit tests, production build, and the real
GitHub dependency check. Record exact results in the changelogs. The separately
recorded multi-tab browser defect is unrelated to this dependency CI failure and
is not fixed or suppressed by this decision.
