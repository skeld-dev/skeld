# Releases and hosting

The public repository is `skeld-dev/skeld`. Two workspaces are published to npm: `packages/core` as
`@skeld/core`, whose first public development version is `0.1.0`, and `packages/auth` as `@skeld/auth`,
first published at `0.2.0`. Other workspaces are private.
Website deployment is independent of package releases.

## GitHub setup

Use the existing GitHub CLI login for HTTPS Git access, or an SSH key owned by the maintainer.
Do not put personal GitHub tokens in workflows. GitHub supplies the workflow's `GITHUB_TOKEN`.

After the first push, configure the repository:

- Enable the dependency graph, Dependabot alerts, secret scanning and push protection.
- Keep automatic Dependabot security-update PRs disabled. Review security alerts and make deliberate fixes;
  weekly version-update PRs remain enabled. Changing Dependabot configuration can cause an immediate update check.
- Use the committed advanced CodeQL workflow, not a second default-setup scan.
- Protect `main`: require pull requests, resolved conversations, an up-to-date branch and passing `Checks`.
- CodeQL runs weekly and during releases, not on every PR. Do not require its status or a CodeQL scanning
  rule on PRs. Review open findings before a release: a successful scan means analysis completed, not that
  there are no findings.
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

`ci.yml` runs on pull requests, on manual request, and when called by the release workflow. Its first job,
`Select checks`, chooses the other jobs with `tools/ci-select.ts`. On a pull request it reads the changed
paths; a path no rule claims selects the full run. Manual and release runs always take the full run.

- The static job checks types, strict Biome lint, unused dependencies and exports, and the complete lockfile's
  security advisories. It runs on every pull request that changes a file, and in every full run.
- A pull request runs only the test groups its paths select (runtime, database, protocol, extended, tooling,
  diagnostic), plus the API documentation, examples, consumer declaration and website jobs when their paths change.
- The full run replaces the test groups with one full correctness job (with PostgreSQL 18), and adds the
  diagnostic tests, the public API reference and its example, the runnable examples and the website build.
- A final `Checks` job fails when any selected job failed or was cancelled. It is the status branch protection requires.

CI does not repeat after a PR merges to `main`. Benchmarks are not CI timing gates. Each job has its own
timeout; no hosted timing of the split workflow has been measured.

`security.yml` runs one job combining CodeQL's extended security queries for JavaScript/TypeScript and
GitHub Actions with a full-lockfile advisory audit. It runs weekly on Monday, on manual request and during
a release. It does not run on every PR or push. Both workflows fail on any dependency advisory;
registry errors also fail. Release packaging also refuses every open CodeQL alert on `main`, after
waiting for the release scan to finish processing. Resolve defects or explicitly dismiss verified false
positives with evidence in GitHub; a successful analysis alone is not permission to publish.

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
Do not assume that detection is complete. The scheduled `pnpm audit` job supplies independent full-lockfile
advisory coverage, including dependencies excluded from automatic update PRs.

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
npm's documentation describes the setup from the package's settings page and does not say whether a
name that has never been published can be configured there. If npm offers no settings for `@skeld/auth`
yet, bootstrap it from a verified local archive as was done for core. npm also requires a new
configuration's first successful publish within 2 days, or the configuration expires
([trusted publisher configuration expiry](https://docs.npmjs.com/trusted-publishers/)).

## Release procedure

1. Update the version in `packages/core/package.json`, `packages/auth/package.json` or both to a new stable
   version and merge the reviewed PR after CI. The packed auth depends on the exact core version in the
   workspace, so an auth release that needs a new core releases core with it.
2. **Publish npm release** starts automatically on `main` when either manifest changes. It validates the
   repository and each package's name, access and version against npm, and decides per package whether
   to publish. A version already on npm is skipped; registry errors fail. `@skeld/auth` may be absent from
   the registry; `@skeld/core` may not.
3. CI and CodeQL run for that commit when at least one package will be published. Packaging requires the
   checks, an advisory-free lockfile and no open CodeQL alerts on `main`. Documented false positives remain
   visible in GitHub as dismissed alerts.
4. A clean build job builds both packages, packs each one that will be published, checks recorder exclusion
   and exports on those exact tarballs, and uploads them as one artifact with one SHA-256 checksum file.
5. A separate publishing job verifies the checksums and publishes core first, then auth, with npm provenance
   and lifecycle scripts disabled. It neither checks out source nor installs project dependencies. If core's
   publish fails, auth is not published. Before publishing auth it reads the `@skeld/core` version named in the
   packed auth manifest and refuses unless that exact version was published earlier in the same run or is
   already on npm.
6. Verify installation and the short package READMEs on npm. An optional GitHub release/tag can point to
   the workflow's source commit and attach its archives/checksums. Tags do not trigger npm publication.

For a failed run, correct the cause and rerun **Publish npm release** on `main`. The workflow refuses
other branches. A version npm already accepted is skipped, so a rerun after a partial failure publishes
only what is missing; inspect the registry artifact before treating an ambiguous publish failure as success.
Never reuse an already-published version.

Each package README is a short npm landing page. Detailed behavior lives in `docs/reference/core.md`
and `docs/reference/auth.md`; `pnpm run reference-check` keeps the core reference example synchronized
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
