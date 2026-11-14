# Releases and hosting

The public repository is `skeld-dev/skeld`. Only `packages/core` is published to npm, as
`@skeld/core`; the first public development version is `0.1.0`. Other workspaces are private.
Website deployment is independent of package releases.

## GitHub setup

Use the existing GitHub CLI login for HTTPS Git access, or an SSH key owned by the maintainer.
Do not put personal GitHub tokens in workflows. GitHub supplies the workflow's `GITHUB_TOKEN`.

After the first push, configure the repository:

- Enable the dependency graph, Dependabot alerts and security updates, secret scanning and push protection.
- Use the committed advanced CodeQL workflow, not a second default-setup scan.
- Protect `main`: require pull requests, resolved conversations and passing `Checks`,
  `Dependency audit`, `CodeQL (javascript-typescript)` and `CodeQL (actions)` checks.
  Verify the exact check names from the first run before making them required.
- Require CodeQL code-scanning results for high/critical security findings. A successful analysis
  job means the scan ran; by itself it does not mean there are no findings.
- Restrict creation, updates and deletion of `v*` tags to maintainers. Disable force pushes to `main`.
- Require review of workflow and package changes using `.github/CODEOWNERS` when another maintainer
  is available. Do not require a solo author to approve their own pull request.
- Limit Actions to the actions used in the committed workflows and require full commit SHA pins.
  Keep workflow permissions read-only by default. Fork pull requests get no release credentials.
- Create an `npm` environment restricted to release tags matching `v*`. npm's staged approval is
  the final publishing approval; no second environment reviewer is required for the same action.

All jobs use GitHub-hosted `ubuntu-26.04`, the newest generally available Ubuntu image verified
on November 13, 2026. `ubuntu-latest` is still rolling between images until November 19.
Action versions are pinned to verified upstream release commits with version comments so
Dependabot can propose updates. Node and pnpm follow `.nvmrc` and `packageManager`.

## Checks and security coverage

`ci.yml` checks types, strict Biome lint, unused dependencies, ordinary and diagnostic correctness,
API documentation, runnable examples, package contents, consumer declarations, and the website build.
Benchmarks need a quiet dedicated machine and are not CI timing gates.

`security.yml` runs CodeQL's extended security queries for JavaScript/TypeScript and GitHub Actions,
plus a full-lockfile npm advisory audit. It runs on pull requests, `main`, daily, and during a release.
High and critical dependency advisories fail the audit; registry failures are not ignored.

Dependabot checks npm/pnpm dependencies and SHA-pinned GitHub Actions weekly. The benchmark workspace
is excluded from version-update scans because comparator versions are deliberate measurement baselines.
Explicit ignore rules also prevent security-update PRs for benchmark dependencies from either the shared
lockfile or the benchmark manifest. Update these dependencies manually when refreshing the baselines.
Vulnerability alerts remain enabled, and the full-lockfile dependency audit still covers benchmarks.
There is no automatic merge.
Git dependencies remain subject to source review and their immutable pins; registry auditing does not
establish that a Git dependency or vendored archive is safe.

GitHub documents limitations for pnpm 12's two-document lockfile. The first hosted run nevertheless
reported advisories from both manifests and the shared lockfile, including benchmark dependencies.
Do not assume that detection is complete. The scheduled `pnpm audit` job supplies independent full-lockfile
advisory coverage, including dependencies excluded from automatic update PRs.

## npm setup and first package

Finish npm account verification, enable 2FA, and confirm publish access under the `skeld` organization.
Browser login is separate from local CLI authentication. Use `npm login` locally when a CLI session is needed;
never copy credentials into repository files or chat.

A trusted publisher is configured on an existing npm package's settings. For a new package, bootstrap it
using an authenticated maintainer session with `npm stage publish` on the locally verified tarball.
Staging a new package creates a public `0.0.0-stage` placeholder; the intended package contents stay staged
until approved. Review the package in npm and approve with 2FA. Verify the artifact and metadata before this
first registry operation; it is not a dry run. This local bootstrap does not have GitHub build provenance.

Once the package exists, add the trusted publisher:

| Field             | Value                                         |
| ----------------- | --------------------------------------------- |
| Provider          | GitHub Actions                                |
| Organization/user | `skeld-dev`                                   |
| Repository        | `skeld`                                       |
| Workflow filename | `release.yml`                                 |
| Environment       | `npm`                                         |
| Allowed action    | Staged publishing; direct publishing disabled |

A new trust configuration must complete its first successful publish within two days; configure it when
ready to exercise it. Use npm CLI 11.15.0 or later for staging. GitHub builds use the npm shipped with the
pinned Node release and check that minimum before staging. No standing `NPM_TOKEN` secret is needed.

If bootstrap automation needs a token, use a short-lived granular token with access only to the required
package/scope and stage-only publishing, then revoke it after bootstrap. Organization-management access
alone does not grant package publishing access.

## Release procedure

1. Change the core version, review the release notes and package metadata, and merge through CI.
2. Create and push the matching tag, such as `v0.1.0`, on a commit in `main`.
3. In Actions, run **Stage npm release**, selecting that tag rather than `main`.
4. The workflow validates the tag/version/repository, reruns CI and security checks, then builds and packs
   core in a fresh job. It checks recorder exclusion and export boundaries on the exact tarball.
5. A separate job downloads the immutable workflow artifact, verifies its SHA-256 checksum, and stages
   that tarball through npm trusted publishing with provenance. It does not install project dependencies
   or execute package lifecycle scripts with publishing authority.
6. Review the staged artifact and approve it on npm with 2FA. The workflow never calls `npm stage approve`.
7. Verify installation from the registry, then create the GitHub release for the same tag. Attach the
   tested tarball/checksum from the workflow artifact and the release notes.

Do not rebuild between verifying and staging the tarball. Do not reuse an already-published version.
The package registry URL, tag and `repository.url` must agree with the source repository.

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
