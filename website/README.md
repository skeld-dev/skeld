# Skeld website

Website source for `skeld.dev`, built with Light, TypeScript 7, Vite, and Tailwind.

## Run locally

From the repository root:

```sh
npm install
npm run dev --workspace @skeld/website
```

Open `http://<host-ip>:5173` from another device. Vite binds to `0.0.0.0` (all network interfaces) and refuses an occupied port. The production preview also binds to `0.0.0.0`, on port 4173:

```sh
npm run build --workspace @skeld/website
npm run preview --workspace @skeld/website
```

TypeScript and the Vite output target ESNext. This deliberately targets current browsers without legacy transpilation. The website has no dependency on Skeld core.

## Structure

```text
website/
  src/
    main.ts                 browser adoption and lifecycle
    components/             shared header, footer, symbols
    design-system/          all global styles and design tokens
    pages/home/             landing sections and their behavior
  public/assets/            self-hosted image, mark, fonts, licenses
  vite.config.ts            initial HTML rendering and browser build
  wrangler.json             Cloudflare static-assets hosting
```

The Vite HTML transform renders the page with Light's markup renderer. The browser adopts the same template tree and upgrades the tab component. The contract walkthrough presents illustrative code examples; it does not execute Skeld or make backend requests. Navigation currently uses native section anchors; no router is installed.

Light is pinned to `0b3411fbd265d20b748a09279d982376ae0e98fe`; components is pinned to `a7dfbe763a5e840a4a8203aa10345ae26bcad72c`. Both come from `ul0gic/lightstart` as package distributions. Update a pin and the root lockfile together, then verify adoption, tab behavior, and the production build.

## Styling

All authored CSS lives in `src/design-system/`. The page loads its single `styles.css` entry, which imports Tailwind, tokens, fonts, base styles, shared controls, site layout, and homepage layout. `tokens.css` is the source of truth for shared visual values. Page and component modules contain markup and behavior only. Keep the supplied Polar composition, keyboard focus and reduced-motion support when iterating.

## Checks

```sh
npm run check --workspace @skeld/website
npm run lint --workspace @skeld/website
npm run knip --workspace @skeld/website
npm run build --workspace @skeld/website
```

The root `biome.json` owns all lint and formatting settings, with scoped overrides for website Tailwind CSS and Vite's required default export. Knip scans the application, CSS imports, Vite entry. The root type-check also includes the website.

## Hosting and documentation

Cloudflare serves the `dist/` directory as static assets; no Node server or browser rendering runs inside a Worker. The deploy command builds and publishes through Wrangler, and is only for an authorized release. Local development and builds do not deploy anything. To verify the built assets under the local Workers runtime, run `npm exec --workspace @skeld/website -- wrangler dev --local` after building.

Documentation lives in [`../docs/`](../docs/README.md). The website will consume that source rather than maintain a second copy. Contribution links should point to the repository's [`CONTRIBUTING.md`](../CONTRIBUTING.md); `docs/maintainers/` stays outside the published documentation.

This scaffold implements the landing page. Documentation routes, search, and publication are subsequent work.
