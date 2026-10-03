# VSC-Extensions

A collection of personal Visual Studio Code extensions.

## Extensions

### Rust Precise Folding

Provides focused folding support for Rust documentation comments, functions, methods, and Rust brace blocks.

See [`rust-precise-folding/README.md`](rust-precise-folding/README.md) for details.

## Repository structure

```text
VSC-Extensions/
├── .github/
│   └── workflows/
│       └── release.yml
├── rust-precise-folding/
│   ├── .vscode/
│   ├── src/
│   ├── test/
│   ├── .vscodeignore
│   ├── package.json
│   ├── tsconfig.json
│   └── tsconfig.test.json
├── .gitignore
├── LICENSE
└── README.md
```

Each extension remains self-contained. Repository-wide files such as the license and Git ignore rules are maintained at the repository root.

## Releases

The GitHub Actions workflow builds and tests every extension containing a `package.json`, creates the corresponding `.vsix` package, and creates a GitHub Release using the extension name and version.
