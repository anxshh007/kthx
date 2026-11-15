# Credits

## Background photographs

Both photographs were downloaded from Wikimedia Commons on 15 November 2026. Each license was checked on its file page at download time. The images contain no identifiable people and no logos. They are stored in this repository, cropped to 3840×2160 and darkened under `assets/backgrounds/masters/`. They are never hotlinked.

| Slot                            | Title                    | Author      | Source                                                               | License                            |
| ------------------------------- | ------------------------ | ----------- | -------------------------------------------------------------------- | ---------------------------------- |
| `canon` (Canon Vault)           | UIUC Library Main Stacks | Chevsapher  | https://commons.wikimedia.org/wiki/File:UIUC_Library_Main_Stacks.jpg | CC0 1.0 (public domain dedication) |
| `continuity` (Continuity Guard) | Movie-918655 1920        | Free-Photos | https://commons.wikimedia.org/wiki/File:Movie-918655_1920.jpg        | CC0 1.0 (public domain dedication) |

## Procedural backgrounds

For six slots, no photograph with a verifiable reuse license, a resolution of at least 3840 pixels, and no people or logos was found during the build. These slots are `home`, `voice`, `forge`, `showrunner`, `ledger` and `router`. Their 3840×2160 masters are drawn procedurally at build time by `scripts/backgrounds.ts`, using the Studio palette. They are original work released with this repository under its MIT license.

## Fonts

Both fonts are bundled locally through Fontsource and served from the build. No font is fetched from a CDN.

- **Inter** by Rasmus Andersson, SIL Open Font License 1.1. Package: `@fontsource-variable/inter`.
- **Literata** by TypeTogether for Google, SIL Open Font License 1.1. Package: `@fontsource-variable/literata`.

## Sample story

_The Lantern Keepers_ is an original story written for this repository. It includes the story bible, the episodes, the outline and both authors' voice samples.
