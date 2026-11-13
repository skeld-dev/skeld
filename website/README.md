# Skeld website

Website source for `skeld.dev`, built with Light, TypeScript 7, Vite, and native CSS.

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

The Vite HTML transform renders the page with Light's markup renderer. The browser adopts the same template tree and upgrades the tab component. The request walkthrough illustrates a `POST /projects` contract across input validation, handler values, response serialization and schema-aware logging. Visitors can inspect four stages, run a finite sequence, or select an over-limit request. It does not execute Skeld or make backend requests. Playback starts once when the path enters view, pauses offscreen or while the document is hidden, and stops for manual inspection. Reduced-motion users control the stages without animation; all stages remain readable without JavaScript. Navigation currently uses native section anchors; no router is installed.

Light is pinned to `7b8145a237e85bcc12195fba97ef78607cc73778`; components is pinned to `35c5a123d1e09f1c2fe9e1ce0b408ec7003a916e`. Both come from `ul0gic/lightstart` as package distributions. Update a pin and the root lockfile together, then verify adoption, tab behavior, and the production build.

## Light integration

Light owns the page templates (`html/core`), initial HTML (`markup`), browser adoption and teardown (`html`), reactive navigation and walkthrough state (`signals`), and the tabs component (`View.define` with `@lightstart/components`). Template bindings update text, attributes and visibility from signals. Light tabs own selection and keyboard navigation; the site supplies their Polar appearance through `style: false`.

The browser uses the same templates as the initial HTML render. Keep DOM-free template imports so rendering works at build time, and release listeners, observers, timers and the Light tree during hot replacement. Native anchors and small browser lifecycle functions handle scrolling, visibility and motion.

The current page has no persisted records, remote data or shared application services requiring Light models, resources or controllers. Add those modules when a feature needs them. Light's utility-class and theme engines are available, but the existing design uses authored CSS and shared tokens. Vite remains the development and production build tool.

## Styling

All authored CSS lives in `src/design-system/`. The page loads its single `styles.css` entry, which imports tokens, fonts, base styles, shared controls, site layout, and homepage layout. Tokens are ordinary CSS custom properties on `:root`; `base.css` owns the browser defaults the site needs. There is no Tailwind dependency, plugin, directive or utility-generation step. `tokens.css` is the source of truth for shared visual values. Page and component modules contain markup and behavior only. `request-journey.css` owns the request illustration; its markup is in `contract-walkthrough.ts` and its playback lifecycle is in `request-journey.ts`. Code examples use the frost editor surface and semantic syntax colors from `tokens.css`. Keep the supplied Polar composition, keyboard focus and reduced-motion support when iterating.

Plus Jakarta Sans is the main typeface, paired with IBM Plex Mono for code. The locally hosted `plus-jakarta-sans-variable.ttf` is the unmodified upright variable font from Google Fonts (`ofl/plusjakartasans/PlusJakartaSans[wght].ttf`), covering weights 200–800. Its OFL notice is in `public/assets/licenses/plus-jakarta-sans-OFL.txt`. Fonts need no build-time tooling or external requests.

The shared brand icon is `public/assets/skeld-icon.png`, used by the header, footer, all section eyebrows and browser favicon. It is the user-selected glacial S artwork with its original transparency.

## Checks

```sh
npm run check --workspace @skeld/website
npm run lint --workspace @skeld/website
npm run knip --workspace @skeld/website
npm run build --workspace @skeld/website
```

The root `biome.json` owns all lint and formatting settings, with a scoped override for Vite's required default export. Knip scans the TypeScript application and Vite entry; Vite resolves the native CSS imports during the build. The root type-check also includes the website.

## Hosting and documentation

Cloudflare serves the `dist/` directory as static assets; no Node server or browser rendering runs inside a Worker. The deploy command builds and publishes through Wrangler, and is only for an authorized release. Local development and builds do not deploy anything. To verify the built assets under the local Workers runtime, run `npm exec --workspace @skeld/website -- wrangler dev --local` after building.

Documentation lives in [`../docs/`](../docs/README.md). The website will consume that source rather than maintain a second copy. Contribution links should point to the repository's [`CONTRIBUTING.md`](../CONTRIBUTING.md); `docs/maintainers/` stays outside the published documentation.

This scaffold implements the landing page. Documentation routes, search, and publication are subsequent work.
