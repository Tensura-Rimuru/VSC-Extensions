export type FoldingRangeKindName = 'comment' | 'syntax';

export interface SourceRange {
    start: number;
    end: number;
    kind: FoldingRangeKindName;
}

type TokenType =
    | 'fn'
    | 'identifier'
    | '{'
    | '}'
    | '('
    | ')'
    | '['
    | ']'
    | ';'
    | ','
    | 'other';

interface Token {
    type: TokenType;
    offset: number;
    text?: string;
}

interface CommentOccurrence {
    start: number;
    end: number;
    lineKind?: 'line' | 'module' | 'item';
}

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_CONTINUE = /[A-Za-z0-9_]/;

/**
 * Returns ranges for consecutive Rust documentation comments.
 *
 * `//!` and `///` are intentionally kept as separate groups. A blank line,
 * normal comment, code line, or a change between inner/outer doc comments
 * starts a new group.
 */
export function getDocCommentRanges(lines: readonly string[]): SourceRange[] {
    return getLineCommentRanges(lines, new Set(['module', 'item']));
}

/**
 * Returns all foldable multi-line comment ranges.
 *
 * Consecutive full-line `//`, `///`, and `//!` comments are folded as comment
 * ranges. Multi-line block comments are also folded, including nested Rust
 * block comments. Comments that appear inside strings or character literals
 * are ignored.
 */
export function getCommentFoldingRanges(source: string): SourceRange[] {
    const occurrences: CommentOccurrence[] = [];
    let i = 0;
    let lineStart = 0;
    let line = 0;

    while (i < source.length) {
        const c = source[i];
        const n = source[i + 1] ?? '';

        if (c === '\n') {
            line++;
            lineStart = i + 1;
            i++;
            continue;
        }

        if (c === '/' && n === '/') {
            const lineKind = getLineCommentKind(source, i);
            const startsOnItsOwnLine = /^\s*$/.test(source.slice(lineStart, i));
            const endOffset = findLineEnd(source, i + 2);

            if (startsOnItsOwnLine) {
                occurrences.push({
                    start: line,
                    end: line,
                    lineKind,
                });
            }

            line = countNewlines(source, i, endOffset, line);
            const lastNewline = source.lastIndexOf('\n', endOffset - 1);
            lineStart = lastNewline >= 0 ? lastNewline + 1 : lineStart;
            i = endOffset;
            continue;
        }

        if (c === '/' && n === '*') {
            const startLine = line;
            const endOffset = skipBlockComment(source, i);
            line = countNewlines(source, i, endOffset, line);
            const endLine = line;

            if (endLine > startLine) {
                occurrences.push({ start: startLine, end: endLine });
            }

            const lastNewline = source.lastIndexOf('\n', endOffset - 1);
            lineStart = lastNewline >= 0 ? lastNewline + 1 : lineStart;
            i = endOffset;
            continue;
        }

        const rawString = parseRawStringStart(source, i);
        if (rawString !== null) {
            const endOffset = skipRawString(source, rawString.contentStart, rawString.hashes);
            line = countNewlines(source, i, endOffset, line);
            const lastNewline = source.lastIndexOf('\n', endOffset - 1);
            lineStart = lastNewline >= 0 ? lastNewline + 1 : lineStart;
            i = endOffset;
            continue;
        }

        if (c === '"' || (c === 'b' && n === '"')) {
            const quoteIndex = c === 'b' ? i + 1 : i;
            const endOffset = skipQuoted(source, quoteIndex, '"');
            line = countNewlines(source, i, endOffset, line);
            const lastNewline = source.lastIndexOf('\n', endOffset - 1);
            lineStart = lastNewline >= 0 ? lastNewline + 1 : lineStart;
            i = endOffset;
            continue;
        }

        if (c === '\'' && isCharacterLiteral(source, i)) {
            const endOffset = skipQuoted(source, i, '\'');
            line = countNewlines(source, i, endOffset, line);
            const lastNewline = source.lastIndexOf('\n', endOffset - 1);
            lineStart = lastNewline >= 0 ? lastNewline + 1 : lineStart;
            i = endOffset;
            continue;
        }

        i++;
    }

    const lineGroups = groupLineComments(occurrences);
    const blockRanges = occurrences
        .filter((occurrence) => occurrence.lineKind === undefined)
        .map((occurrence) => ({
            start: occurrence.start,
            end: occurrence.end,
            kind: 'comment' as const,
        }));

    return deduplicateAndSortRanges([...lineGroups, ...blockRanges]);
}

/**
 * Creates function/method folding ranges and folds remaining multi-line Rust
 * brace blocks. Function ranges start at the `fn` declaration and include the
 * complete body, while nested blocks get their own syntax ranges.
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

function getLineCommentRanges(
    lines: readonly string[],
    kinds: Set<'module' | 'item'>,
): SourceRange[] {
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
        if (kind === null || !kinds.has(kind)) {
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

function getLineCommentKind(source: string, offset: number): 'line' | 'module' | 'item' {
    const marker = source.slice(offset, offset + 3);
    if (marker === '//!') {
        return 'module';
    }
    if (marker === '///') {
        return 'item';
    }
    return 'line';
}

function groupLineComments(occurrences: readonly CommentOccurrence[]): SourceRange[] {
    const lineComments = occurrences
        .filter((occurrence) => occurrence.lineKind !== undefined)
        .sort((a, b) => a.start - b.start);

    const ranges: SourceRange[] = [];
    let groupStart: CommentOccurrence | undefined;
    let groupEnd: CommentOccurrence | undefined;

    const flush = (): void => {
        if (groupStart !== undefined && groupEnd !== undefined && groupEnd.end > groupStart.start) {
            ranges.push({
                start: groupStart.start,
                end: groupEnd.end,
                kind: 'comment',
            });
        }
        groupStart = undefined;
        groupEnd = undefined;
    };

    for (const occurrence of lineComments) {
        if (groupStart === undefined) {
            groupStart = occurrence;
            groupEnd = occurrence;
            continue;
        }

        if (
            occurrence.start === groupEnd!.end + 1
            && occurrence.lineKind === groupEnd!.lineKind
        ) {
            groupEnd = occurrence;
            continue;
        }

        flush();
        groupStart = occurrence;
        groupEnd = occurrence;
    }

    flush();
    return ranges;
}

function findFunctionBody(tokens: readonly Token[], fnIndex: number): number {
    let seenName = false;
    let parameterDepth = 0;
    let bracketDepth = 0;
    let sawParameterList = false;

    for (let i = fnIndex + 1; i < tokens.length; i++) {
        const token = tokens[i];

        if (!seenName) {
            if (token.type === 'identifier') {
                seenName = true;
                continue;
            }

            // A Rust function item has a name immediately after `fn`.
            // `fn(...) -> T` is a function pointer type and must not be
            // mistaken for a function body later in the file.
            return -1;
        }

        switch (token.type) {
            case '(':
                parameterDepth++;
                sawParameterList = true;
                break;
            case ')':
                if (parameterDepth > 0) {
                    parameterDepth--;
                }
                break;
            case '[':
                bracketDepth++;
                break;
            case ']':
                if (bracketDepth > 0) {
                    bracketDepth--;
                }
                break;
            case ';':
                if (parameterDepth === 0 && bracketDepth === 0) {
                    return -1;
                }
                break;
            case ',':
                // Commas are valid inside generic bounds and `where` clauses,
                // so they cannot be used as a function-termination marker.
                break;
            case '{':
                if (sawParameterList && parameterDepth === 0 && bracketDepth === 0) {
                    return i;
                }
                break;
            default:
                break;
        }
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

        if (c === '/' && n === '/') {
            i = findLineEnd(source, i + 2);
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

        if (c === '\'' && isCharacterLiteral(source, i)) {
            i = skipQuoted(source, i, '\'');
            continue;
        }

        if (IDENTIFIER_START.test(c)) {
            const start = i;
            i++;
            while (i < source.length && IDENTIFIER_CONTINUE.test(source[i])) {
                i++;
            }

            const text = source.slice(start, i);
            if (text === 'fn') {
                tokens.push({ type: 'fn', offset: start, text });
            } else {
                tokens.push({ type: 'identifier', offset: start, text });
            }
            continue;
        }

        switch (c) {
            case '{':
            case '}':
            case '(':
            case ')':
            case '[':
            case ']':
            case ';':
            case ',':
                tokens.push({ type: c, offset: i });
                i++;
                continue;
            default:
                i++;
                continue;
        }
    }

    return tokens;
}

function findLineEnd(source: string, offset: number): number {
    const newline = source.indexOf('\n', offset);
    return newline >= 0 ? newline + 1 : source.length;
}

function skipBlockComment(source: string, offset: number): number {
    let depth = 1;
    let i = offset + 2;

    while (i < source.length) {
        if (source[i] === '/' && source[i + 1] === '*') {
            depth++;
            i += 2;
            continue;
        }
        if (source[i] === '*' && source[i + 1] === '/') {
            depth--;
            i += 2;
            if (depth === 0) {
                return i;
            }
            continue;
        }
        i++;
    }

    return source.length;
}

function countNewlines(source: string, start: number, end: number, line: number): number {
    for (let i = start; i < end; i++) {
        if (source[i] === '\n') {
            line++;
        }
    }
    return line;
}

function parseRawStringStart(
    source: string,
    offset: number,
): { contentStart: number; hashes: number } | null {
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

    return { contentStart: cursor + 1, hashes };
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

function isCharacterLiteral(source: string, quoteIndex: number): boolean {
    if (source[quoteIndex] !== '\'') {
        return false;
    }

    const next = source[quoteIndex + 1];
    if (next === undefined || next === '\n' || next === '\r') {
        return false;
    }

    if (next === '\\') {
        for (let i = quoteIndex + 2; i < Math.min(source.length, quoteIndex + 12); i++) {
            if (source[i] === '\n' || source[i] === '\r') {
                return false;
            }
            if (source[i] === '\'') {
                return true;
            }
        }
        return false;
    }

    return source[quoteIndex + 2] === '\'';
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

export const __testing = {
    lexRust,
};
