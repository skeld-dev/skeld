# Releases and hosting

The public repository is `skeld-dev/skeld`. Four workspaces are published to npm: `packages/core` as
`@skeld/core`, whose first public development version is `0.1.0`, `packages/auth` as `@skeld/auth`,
first published at `0.2.0`, `packages/openapi` as `@skeld/openapi`, whose first version is `0.3.0`, and
`packages/data` as `@skeld/data`, whose first version is `0.4.0`. Other workspaces are private.

The four packages share one version, and a release bumps all of them, changed or not. Below 1.0 a caret
range covers one minor version only, so openapi's peer range on core (`^0.4.5`) would exclude the next core
minor, and auth and data each depend on the exact core version they were packed with. **Publish npm release**
refuses to run when the four versions differ or when openapi's peer range is not `^` and that version.
Website deployment is independent of package releases.

## GitHub setup

Use the existing GitHub CLI login for HTTPS Git access, or an SSH key owned by the maintainer.
Do not put personal GitHub tokens in workflows. GitHub supplies the workflow's `GITHUB_TOKEN`.

After the first push, configure the repository:

- Enable the dependency graph, Dependabot alerts, secret scanning and push protection.
- Keep automatic Dependabot security-update PRs disabled. Review security alerts and make deliberate fixes;
  weekly version-update PRs remain enabled. Changing Dependabot configuration can cause an immediate update check.
- Use the committed advanced CodeQL workflow, not a second default-setup scan.
- Protect `main` with a ruleset ("Protect main"): require pull requests, resolved conversations, an up-to-date
  branch and passing `Checks`, with no bypass actors. The release workflow does not rerun the tests and relies on it.
- CodeQL runs on pull requests as part of `Checks` and weekly on `main`. `Checks` is the only status to
  require; a separate CodeQL scanning rule is not needed.
- Restrict creation, updates and deletion of `v*` tags to maintainers. Disable force pushes to `main`.
- Require review of workflow and package changes using `.github/CODEOWNERS` when another maintainer
  is available. Do not require a solo author to approve their own pull request.
- Limit Actions to the actions used in the committed workflows and require full commit SHA pins.
  Keep workflow permissions read-only by default. Fork pull requests get no release credentials.
- Create an `npm` environment restricted to the `main` branch. A reviewed version bump merged
  through required CI authorizes publication; no manual npm staging approval is required.

All jobs use GitHub-hosted `ubuntu-26.04`, the newest generally available Ubuntu image verified
on November 13, 2026. `ubuntu-latest` is still rolling between images until November 19.
Action versions are pinned to verified upstream release commits with version comments so
Dependabot can propose updates. Node and pnpm follow `.nvmrc` and `packageManager`.

## Checks and security coverage

The pull request is the one gate. `ci.yml` runs on pull requests and on manual request, and it is the only
place tests and scans run: nothing repeats them after a pull request merges, and the release workflow does not
run them again. Its first job, `Select checks`, chooses the other jobs with `tools/ci-select.ts`. On a pull
request it reads the changed paths; a path no rule claims, such as the lockfile, a workflow or a file under
`tools/`, selects every job. Documentation (`docs/`, any Markdown file) selects only the documentation checks and,
for files the site renders or links, the website build. An empty diff selects nothing. A manual run selects every job.

Each tool has one job:

| Tool         | Job                                                      | CI job                             |
| ------------ | -------------------------------------------------------- | ---------------------------------- |
| TypeScript   | Types                                                    | Typecheck, lint, audit and Semgrep |
| Biome        | Formatting and per-file lint                             | Typecheck, lint, audit and Semgrep |
| Knip         | Unused files, exports and dependencies                   | Typecheck, lint, audit and Semgrep |
| `pnpm audit` | Dependencies with known vulnerabilities, full lockfile   | Typecheck, lint, audit and Semgrep |
| Semgrep      | Skeld's own boundaries and conventions (`.semgrep`)      | Typecheck, lint, audit and Semgrep |
| CodeQL       | Vulnerabilities found by dataflow, and workflow security | CodeQL                             |

- CodeQL analyses JavaScript/TypeScript and GitHub Actions with the `security-extended` queries, configured once
  in `.github/codeql/codeql-config.yml`. It scans `packages`, `examples`, `tools` and `.github`; tests, benchmarks
  and the website are left out. The job saves the SARIF results and fails on any result not suppressed in source.
  It uploads results to code scanning except for pull requests from forks, whose token is read-only.
- The test groups (runtime with the diagnostic tests, database with PostgreSQL 19, protocol, extended, tooling)
  run as their own jobs, in parallel, when the changed paths select them. The API documentation, examples,
  consumer declaration and website jobs run when their paths change.
- A final `Checks` job fails when any selected job failed or was cancelled. It is the status branch protection requires.

`pnpm run sast` runs the same Semgrep command and the same CodeQL analysis locally (see `CONTRIBUTING.md`).

A pull request's checks cannot run longer than 10 minutes: `Select checks` has 2 minutes, every selected job 7
and `Checks` 1.
Benchmarks are not CI timing gates.

`security.yml` runs CodeQL with the same configuration and a full-lockfile advisory audit weekly on Monday and on
manual request. Release packaging refuses every open CodeQL alert on `main`. Resolve defects; mark a verified
false positive with a `// codeql[<rule-id>]` comment on the line above it, or dismiss it in GitHub with evidence.
A dismissal in GitHub does not reach the pull request check, which reads only the analysis results.

Dependabot checks npm/pnpm dependencies and SHA-pinned GitHub Actions weekly. Minor/patch npm upgrades are
grouped together; major upgrades remain separate. Actions are grouped, with at most two open action PRs and
three npm PRs. Automatic security-fix PRs are disabled in repository settings; alerts stay enabled.
The benchmark workspace is excluded from version scans because its versions are deliberate measurement baselines.
Explicit ignores also cover benchmark dependencies in the shared lockfile and benchmark manifest, should
security-update PRs ever be re-enabled. Update benchmark tooling versions deliberately. The full-lockfile audit still
covers these dependencies. There is no automatic merge.
Git dependencies remain subject to source review and their immutable pins; registry auditing does not
establish that a Git dependency or vendored archive is safe.

GitHub documents limitations for pnpm 12's two-document lockfile. The first hosted run nevertheless
reported advisories from both manifests and the shared lockfile, including benchmark dependencies.
Do not assume that detection is complete. The `pnpm audit` step on pull requests and weekly supplies independent
full-lockfile advisory coverage, including dependencies excluded from automatic update PRs.

## npm trusted publisher

`@skeld/core@0.1.0` was bootstrapped from a verified local archive. Later releases use GitHub OIDC;
no standing `NPM_TOKEN` secret or manual staging approval is needed. Each published package needs its
own trusted publisher, with the same values:

| Field             | Value                       |
| ----------------- | --------------------------- |
| Provider          | GitHub Actions              |
| Repository        | `skeld-dev/skeld`           |
| Workflow filename | `release.yml`               |
| Environment       | `npm`, restricted to `main` |
| Allowed action    | Direct publishing           |

Configure with `npm trust github <package> --file release.yml --repository skeld-dev/skeld
--environment npm --allow-publish --yes` (one command per package). npm requires account 2FA for setup changes;
normal workflow publications use the trusted identity. Keep account 2FA enabled. The workflow checks npm >=11.15.0.

A maintainer must configure trusted publishing for `@skeld/auth` on npmjs.com before the first release
that publishes it; the workflow holds no token, so without that configuration the auth publish fails.
The same holds for `@skeld/openapi`: its npm placeholder and its trusted publisher must exist before the
first release that publishes it, or its publish step fails. `@skeld/data` needs the same: create its npm
placeholder and its trusted publisher before the first release that publishes it.
npm's documentation describes the setup from the package's settings page and does not say whether a
name that has never been published can be configured there. If npm offers no settings for a new name
yet, bootstrap it from a verified local archive as was done for core. npm also requires a new
configuration's first successful publish within 2 days, or the configuration expires
([trusted publisher configuration expiry](https://docs.npmjs.com/trusted-publishers/)).

## Release procedure

1. Update the version in `packages/core/package.json`, `packages/auth/package.json`,
   `packages/openapi/package.json` and `packages/data/package.json` to the same new stable version, and
   openapi's peer range on core to `^` and that version, then merge the reviewed PR after CI. The packed auth
   and data depend on the exact core version in the workspace; openapi names core as a peer dependency with
   that caret range.
2. **Publish npm release** starts automatically on `main` when any of the four manifests changes. It
   validates the repository and each package's name, access and version against npm, and decides per
   package whether to publish. A version already on npm is skipped; registry errors fail. `@skeld/auth`,
   `@skeld/openapi` and `@skeld/data` may be absent from the registry; `@skeld/core` may not.
3. The tests do not run again. The "Protect main" ruleset requires a pull request, a passing `Checks` status
   and a branch up to date with `main`, with no bypass actors, so the merged commit is the tree that passed.
   Packaging requires no open CodeQL alerts on `main`, from the weekly scan. Documented false positives remain
   visible in GitHub as dismissed or suppressed alerts.
4. A clean build job builds the four packages, packs each one that will be published, checks recorder exclusion
   and exports on those exact tarballs, and uploads them as one artifact with one SHA-256 checksum file.
5. A separate publishing job verifies the checksums and publishes core first, then auth, openapi and data, with
   npm provenance and lifecycle scripts disabled. It neither checks out source nor installs project
   dependencies. If a publish fails, the packages after it are not published. Before publishing auth it reads
   the `@skeld/core` version named in the packed auth manifest and refuses unless that exact version was
   published earlier in the same run or is already on npm. Openapi and data have no such step: the workflow
   does not check that a published core satisfies openapi's peer range or matches data's exact version.
6. Verify installation and the short package READMEs on npm. An optional GitHub release/tag can point to
   the workflow's source commit and attach its archives/checksums. Tags do not trigger npm publication.

For a failed run, correct the cause and rerun **Publish npm release** on `main`. The workflow refuses
other branches. A version npm already accepted is skipped, so a rerun after a partial failure publishes
only what is missing; inspect the registry artifact before treating an ambiguous publish failure as success.
Never reuse an already-published version.

Each package README is a short npm landing page. Detailed behavior lives in `docs/reference/core.md`,
`docs/reference/auth.md` and `docs/reference/openapi.md`; `pnpm run reference-check` keeps the core reference example synchronized
with `examples/hello`.

## Cloudflare Workers Builds

Connect `skeld-dev/skeld` through the Cloudflare dashboard. Select a Worker with static assets,
using the existing `website/wrangler.json`; do not generate a second site or a Pages-specific configuration.
The Worker name is `skeld-website`.

| Setting                   | Value                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Production branch         | `main`                                                                                    |
| Root directory            | `website`                                                                                 |
| Build command             | `pnpm --filter @skeld/website --filter skeld install --frozen-lockfile && pnpm run build` |
| Deploy command            | `pnpm exec wrangler deploy`                                                               |
| `NODE_VERSION`            | `26.13.0`                                                                                 |
| `PNPM_VERSION`            | `12.19.0`                                                                                 |
| `SKIP_DEPENDENCY_INSTALL` | `1`                                                                                       |

The whole repository must be checked out. The filtered install includes root TypeScript tooling and the
website dependencies; it does not install the benchmark workspace or make the website depend on core.
The website also reads canonical root Markdown and selected public source examples at build time.
Wrangler uploads only `website/dist`, as configured relative to its config file.

Start with all build watch paths enabled. If limiting them later, include `website/*`, `docs/*`, `examples/*`,
`packages/core/README.md`, `tests/README.md`, `benchmarks/README.md`, `CONTRIBUTING.md`, `LICENSE`, `.nvmrc`,
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json` and `tsconfig.base.json`.
Watching only `website/*` would miss documentation and toolchain changes.

Cloudflare builds independently on pushes; it does not wait for GitHub CI. Required PR checks on `main`
provide the deployment gate. Keep automatic production deployment disabled until the first CI/security
run succeeds and branch protection is configured. Enable branch previews only for trusted branches initially.
The Cloudflare Git integration manages its build credentials; no Cloudflare API token is needed in GitHub.

The filtered install, production build, and `wrangler deploy --dry-run` were verified in a clean temporary
checkout. Account connection, domain routing, production deployment and live endpoint checks remain separate.

## References

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
- [GitHub runner image transition](https://github.com/actions/runner-images/issues/14748)
- [Dependabot ecosystem support and pnpm limitations](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
- [Cloudflare monorepo builds](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
- [Cloudflare build environment](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
