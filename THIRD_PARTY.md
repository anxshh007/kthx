# Third-party packages

Every package Kathix depends on directly. Each was installed from npm at its latest stable release on 14 November 2026. The one exception is TypeScript (see `DECISIONS.md`). All Kathix code is original and written for this repository.

| Package                       | Version | License      | Used for                                         |
| ----------------------------- | ------- | ------------ | ------------------------------------------------ |
| @anthropic-ai/sdk             | 1.8.0   | Apache-2.0   | Anthropic provider adapter (official SDK)        |
| @codemirror/commands          | 6.11.1  | MIT          | Script Studio editor keymaps and history         |
| @codemirror/state             | 6.7.6   | MIT          | Script Studio editor state                       |
| @codemirror/view              | 6.43.15 | MIT          | Script Studio editor view and decorations        |
| @fontsource-variable/inter    | 5.3.0   | OFL-1.1      | Interface typeface, bundled locally              |
| @fontsource-variable/literata | 5.3.0   | OFL-1.1      | Script typeface, bundled locally                 |
| @hono/node-server             | 2.1.8   | MIT          | Node HTTP adapter for the Studio server          |
| commander                     | 15.1.0  | MIT          | `kathix` command line                            |
| diff                          | 9.0.0   | BSD-3-Clause | Diffs on suggestion cards and authorship mapping |
| docx                          | 9.15.4  | MIT          | Word (.docx) export                              |
| hono                          | 4.13.18 | MIT          | Server routes and server-sent events             |
| mammoth                       | 1.13.0  | BSD-2-Clause | Reading uploaded .docx files                     |
| react                         | 19.3.1  | MIT          | Studio interface                                 |
| react-dom                     | 19.3.1  | MIT          | Studio interface                                 |
| unpdf                         | 2.2.0   | MIT          | Reading text-based .pdf uploads                  |
| zod                           | 4.6.7   | MIT          | Request validation and model output schemas      |

## Development and build only

| Package                   | Version | License    | Used for                                           |
| ------------------------- | ------- | ---------- | -------------------------------------------------- |
| @eslint/js                | 10.0.1  | MIT        | Lint rules                                         |
| @playwright/test          | 1.65.1  | Apache-2.0 | End-to-end and UI truth tests                      |
| @types/node               | 26.6.6  | MIT        | Type definitions                                   |
| @types/react              | 19.3.0  | MIT        | Type definitions                                   |
| @types/react-dom          | 19.3.0  | MIT        | Type definitions                                   |
| @vitejs/plugin-react      | 6.3.0   | MIT        | Vite React transform                               |
| eslint                    | 10.15.0 | MIT        | Linting                                            |
| eslint-plugin-react-hooks | 7.1.1   | MIT        | React hook rules                                   |
| globals                   | 17.14.0 | MIT        | Lint globals                                       |
| prettier                  | 3.10.1  | MIT        | Formatting                                         |
| sharp                     | 0.35.5  | Apache-2.0 | Background image pipeline and contrast test        |
| tsx                       | 4.23.15 | MIT        | Running TypeScript directly (server, CLI, scripts) |
| typescript                | 6.0.3   | Apache-2.0 | Type checking                                      |
| typescript-eslint         | 8.72.2  | MIT        | TypeScript lint rules                              |
| vite                      | 8.3.8   | MIT        | Studio client build and dev server                 |
| vitest                    | 5.1.0   | MIT        | Unit, integration and eval tests                   |

## Built into the platform

- **SQLite** through Node.js's built-in `node:sqlite` module. It is public domain and needs no package.
- **Fetch, Web Crypto and streams** come from Node.js 24, under the MIT license.

Images and fonts are credited in `CREDITS.md`.
