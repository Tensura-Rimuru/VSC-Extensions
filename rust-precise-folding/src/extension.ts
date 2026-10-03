import * as vscode from 'vscode';
import { getCommentFoldingRanges, getRustFoldingRanges } from './folding';

class RustPreciseFoldingProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.FoldingRange[]> {
        const ranges: vscode.FoldingRange[] = [];
        for (const range of getCommentFoldingRanges(document.getText())) {
            ranges.push(
                new vscode.FoldingRange(
                    range.start,
                    range.end,
                    vscode.FoldingRangeKind.Comment,
                ),
            );
        }
        if (token.isCancellationRequested) {
            return ranges;
        }

        for (const range of getRustFoldingRanges(document.getText())) {
            ranges.push(new vscode.FoldingRange(range.start, range.end));
        }

        return ranges;
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const provider = new RustPreciseFoldingProvider();
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: 'rust' },
            provider,
        ),
    );
}

export function deactivate(): void {
    // Nothing to clean up. VS Code disposes the provider registration via the
    // extension context subscriptions.
}

export { RustPreciseFoldingProvider };
