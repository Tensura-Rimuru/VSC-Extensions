# Rust Precise Folding

A deliberately small VS Code extension that provides predictable folding for Rust source files.

## What it folds

- Consecutive `//` line comments.
- Consecutive `///` item documentation comments.
- Consecutive `//!` module documentation comments.
- Multi-line block comments (`/* ... */`), including nested Rust block comments.
- Rust functions and methods, starting at the `fn` declaration line so multiline signatures and `where` clauses collapse together.
- Other multiline Rust `{ ... }` blocks such as `impl`, `trait`, `mod`, `struct`, `enum`, `match`, control-flow blocks, and closures.

Strings, raw strings, character literals, and comments are ignored while looking for syntax braces and `fn` keywords, so comment or string contents do not create false folding ranges.

## rust-analyzer / multiple folding providers

VS Code can merge multiple folding providers, but conflicting ranges may be discarded. This extension therefore contributes itself as the default folding provider for Rust:

```json
"[rust]": {
    "editor.defaultFoldingRangeProvider": "Tensura-Rimuru.rust-precise-folding"
}
```

A user or workspace setting has higher precedence. If you explicitly configured a different Rust folding provider, remove that override or set it to the extension ID above.

## Development

```bash
npm install
npm test
npm run package
```

Press `F5` in VS Code to launch an Extension Development Host.
