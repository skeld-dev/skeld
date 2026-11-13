# Contributing to Skeld

Useful contributions make a service easier to build, clarify a guarantee, or fix an observable defect. Keep each change focused enough that a reviewer can understand the problem, the resulting behavior, and the evidence.

For a substantial API or behavior change, open an issue to discuss the use case and tradeoffs before building it. Small fixes and documentation corrections can go directly to a pull request. A bug report should include the Node and Skeld versions, a minimal reproduction, and expected versus actual behavior; remove credentials and private data.

## Set up the checkout

Use the Node version pinned in [`.nvmrc`](.nvmrc). From the repository root:

```sh
npm install
npm run check
```

The repository uses npm workspaces. The [repository map](README.md#repository) identifies each workspace, and the [examples](examples/README.md) show how to run a service and client locally. Source execution uses `node --conditions=skeld-source` so imports resolve to the workspace's TypeScript source.

## Make a focused change

Use public APIs in examples and behavioral tests. Keep related cases together under the [test category](tests/README.md#layout) that owns the behavior. A regression check should expose the original defect and pass after the fix; include a valid control so an unrelated failure cannot masquerade as success. Do not add tests that merely repeat implementation steps or weaken an expectation to make a failing check pass.

Explain changed public behavior in the same pull request. Public API pages are generated from source documentation, while guides explain how to use the behavior. See [writing and checking documentation](docs/maintainers/writing-docs.md) for source ownership, example checks, and diagram guidance.

## Check the affected behavior

For a code change, start with the relevant category, then run the ordinary suite and repository checks:

```sh
npm test -- contracts
npm test
npm run lint
npm run knip
```

Replace `contracts` with the category your change affects. `npm test` builds and runs ordinary correctness checks. The [test guide](tests/README.md#run) explains individual scripts, diagnostic mode, and the separate integrations.

For documentation-only changes, check links, formatting, and any examples or claims you changed. Follow the [documentation checks](docs/maintainers/writing-docs.md#verify-the-claims-that-changed); rerunning unrelated runtime tests is not a substitute for checking a snippet or its explanation.

Performance measurements are separate from correctness tests and need a quiet host. Use the [benchmark guide](benchmarks/README.md) when the change calls for a measurement, and report the environment and workload with any performance claim.

## Submit a pull request

Describe the concrete problem and the resulting behavior. Include reproduction steps when they help, the checks you ran, and any checks you could not run. Call out changes to public contracts, defaults, resource limits, or disclosure behavior so reviewers can assess their effect on existing applications.

Keep unrelated refactoring and generated output out of the diff. When a public API doc comment changes, regenerate its reference with `npm run api-docs` and include the resulting pages. Never include credentials or private request data in fixtures, logs, or screenshots.

The documentation website should link to this guide rather than publish a second copy of the contribution instructions.
