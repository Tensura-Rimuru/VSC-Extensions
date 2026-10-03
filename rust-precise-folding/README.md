# Rust Precise Folding

A deliberately small VS Code extension that only provides Rust folding.

## What it folds

- Consecutive `//!` module documentation comments.
- Consecutive `///` item documentation comments.
- Rust functions and methods, starting at the declaration line so multiline
  signatures and `where` clauses collapse together.
- Other multiline Rust `{ ... }` blocks that do not belong to a function body,
  providing useful folding for `impl`, `trait`, `mod`, `struct`, `enum`,
  `match`, control-flow blocks, closures, and similar syntax.

Strings, raw strings, character literals, line comments, and nested block
comments are ignored by the lexer so braces and `fn` text inside them do not
create false folding ranges.

## rust-analyzer / multiple folding providers

VS Code can merge folding providers, but conflicting ranges can be discarded.
VS Code therefore supports selecting a specific default folding provider with
`editor.defaultFoldingRangeProvider`. This extension contributes a Rust
configuration default pointing at itself:

```json
"[rust]": {
    "editor.defaultFoldingRangeProvider": "Tensura-Rimuru.rust-precise-folding"
}
```

A user or workspace setting has higher precedence. If you previously added a
wrong folding-provider override, remove it or set it to the identifier above.

## Development

```bash
npm install
npm test
npm run package
```

Press `F5` in VS Code to launch an Extension Development Host.
