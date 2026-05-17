/**
 * Shared test helpers for provider tests.
 */
import { CompletionItem, CompletionList, Position, Range, Uri } from 'vscode';

/**
 * Normalize a completion-provider return value (either `CompletionItem[]`,
 * `CompletionList`, or `undefined`) into a plain items array. The provider
 * returns `CompletionList` with `isIncomplete: true` to force VSCode to
 * re-invoke on every keystroke, but tests want to inspect items directly.
 */
export function asCompletionItems(
    result: CompletionItem[] | CompletionList | undefined | null
): CompletionItem[] | undefined {
    if (!result) return undefined;
    if (Array.isArray(result)) return result;
    return (result as CompletionList).items;
}

/** Minimal mock TextDocument suitable for provider testing. */
export function createMockDocument(
    content: string,
    filePath: string = '/test/template.html',
    languageId: string = 'html'
) {
    const lines = content.split('\n');

    function positionAt(offset: number): Position {
        let line = 0;
        let remaining = offset;
        for (let i = 0; i < lines.length; i++) {
            const lineLen = lines[i].length + 1; // +1 for \n
            if (remaining < lineLen || i === lines.length - 1) {
                return new Position(i, remaining);
            }
            remaining -= lineLen;
            line = i + 1;
        }
        return new Position(line, remaining);
    }

    function offsetAt(position: Position): number {
        let offset = 0;
        for (let i = 0; i < position.line && i < lines.length; i++) {
            offset += lines[i].length + 1;
        }
        offset += position.character;
        return offset;
    }

    return {
        uri: Uri.file(filePath),
        getText: () => content,
        languageId,
        version: 1,
        offsetAt,
        positionAt,
        lineAt: (lineOrPosition: number | Position) => {
            const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
            return {
                text: lines[line] || '',
                range: new Range(new Position(line, 0), new Position(line, (lines[line] || '').length)),
                lineNumber: line,
                isEmptyOrWhitespace: !(lines[line] || '').trim(),
            };
        },
        lineCount: lines.length,
    } as any;
}

/** Create a minimal CancellationToken mock. */
export function createCancellationToken() {
    return {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(),
    };
}
