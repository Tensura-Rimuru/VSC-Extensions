export type FoldingRangeKindName = 'comment' | 'syntax';

export interface SourceRange {
    start: number;
    end: number;
    kind: FoldingRangeKindName;
}

type TokenType = 'fn' | '{' | '}' | ';' | '=>' | 'other';

interface Token {
    type: TokenType;
    offset: number;
}

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_CONTINUE = /[A-Za-z0-9_]/;

/**
 * Returns ranges for consecutive Rust doc comments.
 *
 * `//!` and `///` are intentionally kept as separate groups. A blank line,
 * normal comment, code line, or a change between inner/outer doc comments
 * starts a new group.
 */
export function getDocCommentRanges(lines: readonly string[]): SourceRange[] {
    const ranges: SourceRange[] = [];

    let start = -1;
    let end = -1;
    let marker: 'module' | 'item' | null = null;
    const flush = (): void => {
        if (start >= 0 && end > start) {
            ranges.push({ start, end, kind: 'comment' });
        }

        start = -1;
        end = -1;
        marker = null;
    };

    for (let line = 0; line < lines.length; line++) {
        const kind = getDocCommentKind(lines[line]);

        if (kind === null) {
            flush();
            continue;
        }
        if (start < 0) {
            start = line;
            end = line;
            marker = kind;
            continue;
        }

        if (marker !== kind) {
            flush();
            start = line;
            end = line;
            marker = kind;
            continue;
        }

        end = line;
    }

    flush();
    return ranges;
}

/**
 * Creates function/method folding ranges and then folds all remaining
 * multi-line Rust brace blocks. Function ranges start at the `fn` line so a
 * multi-line signature collapses as one unit, including `where` clauses.
 */
export function getRustFoldingRanges(source: string): SourceRange[] {
    const tokens = lexRust(source);
    const lineStarts = buildLineStarts(source);
    const ranges: SourceRange[] = [];
    const functionBodies = new Set<number>();
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type !== 'fn') {
            continue;
        }

        const openIndex = findFunctionBody(tokens, i);
        if (openIndex < 0) {
            continue;
        }

        const closeIndex = findMatchingBrace(tokens, openIndex);
        if (closeIndex < 0) {
            continue;
        }

        const start = offsetToLine(lineStarts, tokens[i].offset);
        const end = offsetToLine(lineStarts, tokens[closeIndex].offset);
        if (end > start) {
            ranges.push({ start, end, kind: 'syntax' });
            functionBodies.add(openIndex);
        }
    }

    // Add generic brace folding for the rest of Rust syntax. This keeps useful
    // folding for impl/trait/mod/struct/enum/match/if/closures/etc. while
    // allowing a function's own range to start at `pub async fn ...` rather
    // than at its opening brace.
    const braceStack: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.type === '{') {
            braceStack.push(i);
            continue;
        }

        if (token.type !== '}') {
            continue;
        }

        const openIndex = braceStack.pop();
        if (openIndex === undefined || functionBodies.has(openIndex)) {
            continue;
        }
        const start = offsetToLine(lineStarts, tokens[openIndex].offset);
        const end = offsetToLine(lineStarts, token.offset);

        if (end > start) {
            ranges.push({ start, end, kind: 'syntax' });
        }
    }

    return deduplicateAndSortRanges(ranges);
}

function getDocCommentKind(line: string): 'module' | 'item' | null {
    const trimmed = line.trimStart();

    if (trimmed.startsWith('//!')) {
        return 'module';
    }
    if (trimmed.startsWith('///')) {
        return 'item';
    }

    return null;
}

function findFunctionBody(tokens: readonly Token[], fnIndex: number): number {
    for (let i = fnIndex + 1; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.type === ';') {
            return -1;
        }

        if (token.type === '{') {
            return i;
        }
        // Braces are the only structural tokens we currently need from the
        // lexer. The delimiters below are therefore inferred from source text
        // by lexRust() and represented as ordinary tokens only when needed.
    }

    return -1;
}

function findMatchingBrace(tokens: readonly Token[], openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < tokens.length; i++) {
        if (tokens[i].type === '{') {
            depth++;
        } else if (tokens[i].type === '}') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}

function deduplicateAndSortRanges(ranges: readonly SourceRange[]): SourceRange[] {
    const unique = new Map<string, SourceRange>();
    for (const range of ranges) {
        unique.set(`${range.start}:${range.end}:${range.kind}`, range);
    }

    return [...unique.values()].sort((a, b) =>
        a.start - b.start || b.end - a.end || a.kind.localeCompare(b.kind)
    );
}

function lexRust(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    let blockCommentDepth = 0;

    while (i < source.length) {
        const c = source[i];
        const n = source[i + 1] ?? '';
        if (blockCommentDepth > 0) {
            if (c === '/' && n === '*') {
                blockCommentDepth++;
                i += 2;
                continue;
            }

            if (c === '*' && n === '/') {
                blockCommentDepth--;
                i += 2;
                continue;
            }

            i++;
            continue;
        }
        // Line comments, including //! and ///. Doc comments are collected
        // separately from the raw lines above.
        if (c === '/' && n === '/') {
            i += 2;
            while (i < source.length && source[i] !== '\n') {
                i++;
            }
            continue;
        }

        if (c === '/' && n === '*') {
            blockCommentDepth = 1;
            i += 2;
            continue;
        }
        const rawString = parseRawStringStart(source, i);
        if (rawString !== null) {
            i = skipRawString(source, rawString.contentStart, rawString.hashes);
            continue;
        }

        if (c === '"' || (c === 'b' && n === '"')) {
            i = skipQuoted(source, c === 'b' ? i + 1 : i, '"');
            continue;
        }

        if (c === '\'' && looksLikeCharLiteral(source, i)) {
            i = skipQuoted(source, i, '\'');
            continue;
        }
        if (c === 'b' && n === '\'' && looksLikeCharLiteral(source, i + 1)) {
            i = skipQuoted(source, i + 1, '\'');
            continue;
        }

        if (IDENTIFIER_START.test(c)) {
            const start = i;
            i++;

            while (i < source.length && IDENTIFIER_CONTINUE.test(source[i])) {
                i++;
            }
            const value = source.slice(start, i);
            if (value === 'fn') {
                tokens.push({ type: 'fn', offset: start });
            }

            continue;
        }

        if (c === '{' || c === '}' || c === ';') {
            tokens.push({ type: c, offset: i });
            i++;
            continue;
        }

        if (c === '=' && n === '>') {
            tokens.push({ type: '=>', offset: i });
            i += 2;
            continue;
        }

        i++;
    }
    return tokens;
}

function parseRawStringStart(source: string, offset: number): { contentStart: number; hashes: number } | null {
    let prefixLength: number;

    if (source[offset] === 'r') {
        prefixLength = 1;
    } else if (source[offset] === 'b' && source[offset + 1] === 'r') {
        prefixLength = 2;
    } else {
        return null;
    }

    let cursor = offset + prefixLength;
    let hashes = 0;

    while (source[cursor] === '#') {
        hashes++;
        cursor++;
    }
    if (source[cursor] !== '"') {
        return null;
    }

    return {
        contentStart: cursor + 1,
        hashes,
    };
}

function skipRawString(source: string, contentStart: number, hashes: number): number {
    for (let i = contentStart; i < source.length; i++) {
        if (source[i] !== '"') {
            continue;
        }

        let cursor = i + 1;
        let matched = 0;
        while (matched < hashes && source[cursor] === '#') {
            matched++;
            cursor++;
        }

        if (matched === hashes) {
            return cursor;
        }
    }

    return source.length;
}

function skipQuoted(source: string, quoteIndex: number, quote: '"' | '\''): number {
    let escaped = false;

    for (let i = quoteIndex + 1; i < source.length; i++) {
        const c = source[i];

        if (escaped) {
            escaped = false;
            continue;
        }
        if (c === '\\') {
            escaped = true;
            continue;
        }

        if (c === quote) {
            return i + 1;
        }

        if (quote === '\'' && (c === '\n' || c === '\r')) {
            return quoteIndex + 1;
        }
    }

    return source.length;
}

function looksLikeCharLiteral(source: string, quoteIndex: number): boolean {
    if (source[quoteIndex] !== '\'') {
        return false;
    }

    let escaped = false;
    for (let i = quoteIndex + 1; i < source.length; i++) {
        const c = source[i];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (c === '\\') {
            escaped = true;
            continue;
        }

        if (c === '\n' || c === '\r') {
            return false;
        }

        if (c === '\'') {
            return i > quoteIndex + 1;
        }
    }

    return false;
}
function buildLineStarts(source: string): number[] {
    const starts: number[] = [0];

    for (let i = 0; i < source.length; i++) {
        if (source.charCodeAt(i) === 10) {
            starts.push(i + 1);
        }
    }

    return starts;
}

function offsetToLine(lineStarts: readonly number[], offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;

    while (low <= high) {
        const middle = (low + high) >> 1;
        const start = lineStarts[middle];
        if (start <= offset) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return high;
}

// Exported solely for focused unit tests. The extension itself only consumes
// getDocCommentRanges/getRustFoldingRanges.
export const __testing = {
    lexRust,
};
