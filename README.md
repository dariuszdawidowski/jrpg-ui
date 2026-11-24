# JRPG User Interface widgets

## Project Overview

**JRPG-UI** is a 2D user interface library for JRPG-like browser games.

## Tech Stack

- The codebase is written in **TypeScript**.
- This project uses **Vite** (`vite.config.ts`) as the build tool and dev server.
- Use Vite conventions: `import.meta.env` for environment variables (prefixed with `VITE_`), native ES modules, and standard Vite static asset imports.
- Do not introduce Webpack-, CommonJS-, or Node-specific bundler workarounds (e.g., `require()`, `process.env`).
- The runtime environment is the **browser** (not Node.js or SSR unless explicitly stated).
- Target **modern browsers only** — do not write legacy workarounds, IE/old-Safari polyfills, or downlevel patterns for outdated JavaScript engines.
- Rely on modern ECMAScript and Web Platform APIs (e.g., ES2022+, native `fetch`, modern DOM APIs) and respect `tsconfig.json` (`target` / `lib`) and bundler/Browserslist settings.
## Development Guidelines

- Prefer small, playable vertical slices and incremental changes.
- Keep systems modular and data-driven, especially NPCs, schedules, dialogue, quests, items, locations, relationships, events, and music content.
- Use minimal dependencies.
- Design responsive UI for desktop and mobile safe areas.
- Keep performance suitable for modest mobile hardware.
- Favor readable, testable code over speculative abstractions.
- Do not implement unrelated features or rewrite working systems without a clear requirement.
## TypeScript Guidelines

-  Use **2 spaces** for indentation, **single quotes** for strings.
- Do **not** use **semicolons**.
- Use trailing commas in multi-line objects/arrays but don't force fixed line length - long lines are fine for a single line instruction.
- Use `import type` for type-only imports and prefer `interface` over `type` for object shapes.
- Prefer explicit types over `any` and ensure `tsc --noEmit` passes before finishing tasks.
- Document TypeScript code in English using TSDoc-compatible `/** ... */` comments on exported classes, interfaces, functions, public methods, and properties whose contracts are not obvious. Describe purpose, behaviour, side effects, units, defaults, and important constraints.
- Use `@param name - description`, `@returns`, `@throws`, `@typeParam`, and `@remarks` where useful. Do not repeat TypeScript types with JSDoc `{Type}` annotations. Keep comments accurate when changing code.
- Explain non-obvious algorithms, lifecycle requirements, and design decisions with concise comments. Avoid comments that merely restate straightforward code.

