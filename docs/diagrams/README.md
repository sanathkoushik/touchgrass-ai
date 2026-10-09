# Diagrams

Interactive diagrams made with [Archify](https://github.com/tt-a1i/archify). Open the `.html` files in any browser.

| Diagram | Answers |
|---|---|
| [1-architecture.html](1-architecture.html) | What are the pieces, and how do they connect? |
| [2-one-recommendation-sequence.html](2-one-recommendation-sequence.html) | What happens, step by step, from tapping "Find my mission" to the AI upgrade? |
| [3-recommendation-lifecycle.html](3-recommendation-lifecycle.html) | What states can a recommendation be in, and what ends it? |

## How far to trust them

- Each box points at real source lines, pinned to commit `891d22a` (the editable sources are in `src/*.json`).
- Archify validated the structure and ran its own real-browser check on each file. That proves the diagrams are
  well-formed and readable by its rules. It cannot prove the *meaning* is right.
- The claims were checked against the code by the AI assistant that wrote them (two imprecise statements were found and
  corrected that way). That is a careful review, not a proof, and nobody has visually inspected the rendered pages yet.
- Diagrams describe the code at the pinned commit and will drift as the code changes.

## Regenerating

Edit the matching file in `src/`, then run Archify's `finalize` for its type with `--repo-root .` (see the Archify skill).
