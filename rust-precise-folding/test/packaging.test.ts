import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const root = join(__dirname, '..', '..');
const manifest = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
) as {
    main?: string;
    activationEvents?: string[];
    version?: string;
    contributes?: {
        configurationDefaults?: {
            '[rust]'?: {
                'editor.defaultFoldingRangeProvider'?: string;
                'editor.foldingStrategy'?: string;
            };
        };
    };
};
const tsconfig = JSON.parse(
    readFileSync(join(root, 'tsconfig.json'), 'utf8'),
) as {
    compilerOptions?: { rootDir?: string; outDir?: string };
};

assert(manifest.version === '0.2.1',
    `package.json version must be 0.2.1 (got ${manifest.version ?? 'undefined'})`);
assert(manifest.activationEvents?.includes('onLanguage:rust'),
    'package.json must activate on Rust language documents');
assert(manifest.activationEvents?.includes('onStartupFinished'),
    'package.json must activate on startup so the folding provider is registered deterministically');
assert(manifest.main === './dist/extension.js',
    `package.json main must point to ./dist/extension.js (got ${manifest.main ?? 'undefined'})`);
assert(tsconfig.compilerOptions?.rootDir === 'src',
    `tsconfig rootDir must be src (got ${tsconfig.compilerOptions?.rootDir ?? 'undefined'})`);
assert(tsconfig.compilerOptions?.outDir === 'dist',
    `tsconfig outDir must be dist (got ${tsconfig.compilerOptions?.outDir ?? 'undefined'})`);

assert(manifest.contributes?.configurationDefaults?.['[rust]']?.['editor.defaultFoldingRangeProvider'] === 'Tensura-Rimuru.rust-precise-folding',
    'Rust must use rust-precise-folding as its default folding provider');
assert(manifest.contributes?.configurationDefaults?.['[rust]']?.['editor.foldingStrategy'] === 'auto',
    'Rust folding strategy must use contributed providers');

console.log('PASS: VS Code packaging entry point matches the TypeScript build output');
