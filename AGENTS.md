# AGENTS

This is **NOT** the Electron project that you know! Follow instructions provided in this file, don't make assumptions.

## Project setup and development

This project uses the Yarn package manager, installable via corepack.

If `node_modules/` does not exist, install packages with

```sh
yarn install
```

## Project structure

- Source code lives in `src/`. Code is organized by process:
  - The Electron main process lives in `src/main/`.
  - The Electron renderer process lives in `src/renderer/` and the renderer preload script lives in `src/preload`.
  - Shared code such as custom encodings or protocols live in `src/shared/`

## Contributing to the codebase

### Commits

Create small, atomic commits for maximum bisectability. If a change breaks something, it should be easy to isolate which commit was responsible. It is also preferable to use conventional commit messages.

Here's the recommended process for creating a commit:

1. Before committing, verify:
   - All modified files are intentional and complete
   - No sensitive data or debugging code remains
   - All changes follow all rules defined in this file
   - Tests pass and code is functional
   - Run `yarn lint:unsafe`

2. Stage only the files relevant to this task. Do not combine multiple independent, unrelated changes into one commit. Avoid `git add .` unless required.

3. Determine commit type based on changes:
   | Type | Use Case |
   |------|----------|
   | `feat` | New features |
   | `fix` | Bug fixes |
   | `refactor` | Code refactoring without functional changes |
   | `perf` | Performance improvements |
   | `test` | Adding or updating tests |
   | `docs` | Documentation changes |
   | `style` | Code style changes (formatting, semicolons, etc.) |
   | `chore` | Routine maintenance tasks |
   | `ci` | CI/CD configuration changes |
   | `build` | Changes to build system or dependencies |

4. Write a concise, imperative description. Format: `<type>: <description>`. It is strongly discouraged to have multi-line commit messages. Atomic commits make one small change per commit, so long descriptions should not be necessary. Examples: `feat: add user authentication`, `fix: resolve null pointer exception`, `refactor: simplify error handling`, `docs: update API documentation`, `test: add unit tests for login service`, `style: format code with prettier`, `chore: update dependencies`

5. Execute commit using `git commit -m "<type>: <description>"`

6. Verify that the commit was created successfully: `git log --oneline -1`

### Comments

Apply the following rules to every new or changed comment when modifying a file:

1. **Describe behavior, not history.** Comments explain what the code currently does. Avoid documenting past decisions, previous values, migration notes, or the reasoning trail that led to the current implementation. If context is genuinely necessary (e.g. a workaround for a specific bug), state it briefly as a present-tense fact ("Works around X doing Y"), not as a narrative.

2. **Preserve important details.** Edge cases, preconditions, return values, error-handling behavior, and side effects must stay when editing a comment. Condense wording without losing information.

3. **State limitations plainly.** Phrases like "best-effort cleanup," "silently ignores errors," or "not thread-safe" are acceptable and encouraged because they describe actual behavior.

4. **Remove decorative formatting.** No `---`, `===`, ASCII art, box-drawing borders, or section-divider lines inside comments. The language's standard documentation-comment syntax remains valid and should be kept.

5. **No specific benchmark numbers or magic counts.** Replace "tests 62k+ items" with "tests a large set." Remove hardcoded counts, timings, or sizes that a human maintainer wouldn't know or that will go stale, unless the number is actually part of the logic itself (e.g. a buffer size or a protocol constant).

6. **Use active voice and direct language.** Write "Validates the field" not "Performs validation on the field." Write "Discards partial files on mismatch" not "In order to ensure correctness, partial files are discarded."

7. **Match doc comments to interfaces, line comments to implementation.** Documentation comments describe what a function, type, class, or module does for its consumers - its contract. Regular inline/line comments explain _why_ a particular line or block of implementation logic exists. Keep each in its lane:
   - Doc comment -> public contract (inputs, outputs, behavior, constraints)
   - Line comment -> local reasoning for a non-obvious implementation choice

8. **Review after editing.** Re-read each file after making changes to verify no details were lost and no comment became misleading or out of sync with the code it describes.

9. **Leave good comments alone.** Not every comment needs rewriting. If a comment is already concise, accurate, and natural, skip it.

10. **Match the codebase tone.** Comments should read like a high-quality production codebase for that language and ecosystem - clear, brief, and technically precise. Follow the idiomatic comment style of the language in use rather than importing conventions from another language.

### Branches and pull requests

When adding a new feature or fixing a bug, do not commit or push directly to main branch. Instead, create a new branch in the conventional branch name format. This is similar to conventional commit names. Think of it as a conventional commit message that describes what the whole branch does - commit messages are atomic changes that culminate in the change described by the branch name. Keep branch names under 5 words. Branch names should be in the format of `<type>/<description-in-kebab-case>`.

When work on a branch is complete, inform the user that a pull request can be created to merge the branch's changes into the main branch. Do not push or create pull requests without obtaining permission first.

### Dependencies

When installing or upgrading dependencies, always respect `npmMinimalAgeGate` in `.yarnrc.yml`. Never attempt to bypass it without informing the user and gaining explicit permission from them. When requesting permission, end your request with the following paragraph, verbatim:

> **WARNING: Installing the latest version of this package right now is risky.** Packages and maintainer accounts are sometimes hijacked, and malicious code can be published and downloaded within hours, long before it is detected. Approving this install means you may be running untrusted code in your environment with no prior review. Do you want to proceed?

## Asset creation

Do NOT commit programmatic art generators for static assets such as icons, background images, and sprites. It is not easily human readable. It gets messy, inconsistent, and ultimately unmaintainable. Instead, generate art using a script, then save an SVG copy of the generated art. Committing artwork generator scripts as an intermediate step is acceptable, but such scripts should never be included when a pull request is opened.

An exception to this rule is if the art is dynamic in nature (i.e. a fractal pattern for background). In such cases, it is acceptable to have programmatic art generators.
