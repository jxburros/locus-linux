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

Use OSV's official scanner and reporter actions at the existing v2.3.8 release,
with the base/proposed comparison used by its PR reusable workflow. Check out
the event's exact base SHA and proposed merge SHA with `fetch-depth: 1` into the
same `source/` directory so both scans use identical source paths. Scan each
complete tree, compare the reports, and fail on newly introduced findings.
Keep `--fail-on-vuln=true` and SARIF upload enabled. There are no
ignored packages/advisories, excluded directories, or lowered severity thresholds.
Both complete scan JSON reports are uploaded as artifacts, so baseline
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
Existing upstream findings do not force unrelated upstream divergence. The initial official PR reusable workflow attempt required `fetch-depth: 0`
and remained in checkout for over six minutes. Two shallow tree checkouts avoid
that cost without excluding any dependency sources. Reports live outside the
checkout so the second checkout cannot remove or replace the base report. The
existing check name is preserved, and newer runs cancel obsolete scans for the
same PR. Scanner findings may return nonzero; the reporter is the failing gate,
including when a scan report is missing or invalid.

Run locked installation, typecheck, unit tests, production build, and the real
GitHub dependency check. Record exact results in the changelogs. The separately
recorded multi-tab browser defect is unrelated to this dependency CI failure and
is not fixed or suppressed by this decision.
