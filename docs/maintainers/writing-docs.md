# Write and check documentation

This is repository guidance for documentation contributors. Start with [Contributing to Skeld](../../CONTRIBUTING.md) for setup and submitting changes.

Write for someone trying to make a service work. Start a guide with the task and prerequisites, show a concrete action, then explain what the reader should observe and why. Include the failure case that reveals the boundary being taught.

## Keep one home for each kind of detail

- **Guides** teach a task using public APIs and runnable examples.
- **Concepts** explain ordering, guarantees, tradeoffs, and limits across APIs.
- **API pages** are generated from public source documentation. Change the source and regenerate them.
- **Logging reference** owns detailed event names, record fields, limits, and delivery semantics.
- **Examples** own complete runnable programs. Link to them rather than maintaining a second application in a guide.

A guide can explain the consequence of a default and link to its full reference. It does not need to reproduce every option. Keep internal project notes, implementation history, and unreleased proposals out of public usage instructions.

## Make code and diagrams earn their space

Use complete imports for a standalone snippet. Label an excerpt with its source and the context it requires. Do not invent a helper to make an example look shorter. Avoid casts that conceal contract mismatches.

Use Mermaid for a flow that is easier to understand visually, and explain the same relationship in nearby prose. A diagram must say whether it shows the normal path or every path. Tables work well for defaults, status handling, and comparisons.

The website builds its public collection directly from these Markdown files. Keep sequential steps visible together; use tabs only for real alternatives, such as browser and Node setup. Introduce MDX only where a component improves the explanation. Do not duplicate the documentation into a second website tree.

## Verify the claims that changed

Run from the repository root:

```sh
pnpm run api-docs --check
pnpm run api-check
pnpm run readme-check
pnpm run examples-check
pnpm run consumer-check
pnpm run consumer-check --page docs/guides/contracts.md
pnpm run consumer-check --page docs/guides/browser-security.md
```

These checks serve different purposes: generated reference freshness, public symbol documentation and examples, README/example parity, real HTTP example behavior, and consumer compatibility. The `--page` commands compile every TypeScript block in those two guides; the default consumer check covers the logging page. They do **not** automatically compile every fenced block in every guide or verify every prose claim.

For a new standalone snippet, compile it against the public package types with the documented consumer library settings. For a behavioral claim, run the corresponding example or focused regression and check the actual status, body, or log field. For an excerpt, compare it with the linked source. Check relative links and heading targets after moving pages.

Never change a test expectation merely to match a surprising result. Determine whether the documentation, implementation, or intended contract is wrong, then correct the appropriate source. Report any check that was not run.

## Website navigation

Keep maintainer guidance in the repository, outside the website's learning navigation and published documentation collection. The website's contribution link should point to the repository's root `CONTRIBUTING.md`, which links here. Maintain these instructions in one place.

`website/src/build/docs-manifest.ts` selects the public pages and navigation order. Add a page there when it is ready for readers. The website build checks relative document links and heading fragments. It serves explicitly referenced public checkout files as text while the framework repository is unpublished; point those source references to the repository when its public address exists. The contribution reference always originates from root `CONTRIBUTING.md`. Run the website build after changing links or headings.

Return to the [documentation home](../README.md).
