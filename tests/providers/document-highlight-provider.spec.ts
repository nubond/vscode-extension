import { nDocumentHighlightProvider } from '../../src/providers/document-highlight-provider';
import { createMockDocument, createCancellationToken } from '../helpers';
import { DocumentHighlight, DocumentHighlightKind } from 'vscode';

// ---- Round 3 (M3): highlight on a CHAINED member must not mark the root ----
describe('nDocumentHighlightProvider — chained members (round 3)', () => {
    const token = createCancellationToken();

    it('declines when the cursor is on a chained segment', () => {
        const provider = new nDocumentHighlightProvider();
        const html = '<div nb-value="this.user.name" nb-if="this.user"></div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(html.indexOf('name"'));
        expect(provider.provideDocumentHighlights(doc, pos, token as any)).toBeUndefined();
    });

    it('still highlights all root occurrences from the root segment', () => {
        const provider = new nDocumentHighlightProvider();
        const html = '<div nb-value="this.user.name" nb-if="this.user"></div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(html.indexOf('user.name'));
        const result = provider.provideDocumentHighlights(doc, pos, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(2);
    });
});

describe('nDocumentHighlightProvider', () => {
    let provider: nDocumentHighlightProvider;
    const token = createCancellationToken();

    beforeEach(() => {
        provider = new nDocumentHighlightProvider();
    });

    it('should return undefined outside binding value', () => {
        const html = '<div>text</div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(5);
        const result = provider.provideDocumentHighlights(doc, pos, token as any);
        expect(result).toBeUndefined();
    });

    it('should return undefined when not on a this.X member', () => {
        const html = '<div nb-value="some text"></div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(html.indexOf('some'));
        const result = provider.provideDocumentHighlights(doc, pos, token as any);
        expect(result).toBeUndefined();
    });

    it('should highlight all occurrences of the same member', () => {
        const html = '<div nb-value="this.name"></div><span nb-html="this.name"></span>';
        const doc = createMockDocument(html);
        const nameOffset = html.indexOf('name"');
        const pos = doc.positionAt(nameOffset);
        const result = provider.provideDocumentHighlights(doc, pos, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(2);
        result!.forEach(h => {
            expect(h).toBeInstanceOf(DocumentHighlight);
            expect(h.kind).toBe(DocumentHighlightKind.Read);
        });
    });

    it('should not highlight different members', () => {
        const html = '<div nb-value="this.name"></div><span nb-html="this.count"></span>';
        const doc = createMockDocument(html);
        const nameOffset = html.indexOf('name"');
        const pos = doc.positionAt(nameOffset);
        const result = provider.provideDocumentHighlights(doc, pos, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1);
    });

    it('should return undefined when hovering on attribute name', () => {
        const html = '<div nb-value="this.name"></div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(5);
        const result = provider.provideDocumentHighlights(doc, pos, token as any);
        expect(result).toBeUndefined();
    });

    // ---- Regression: '@' constant literals are not references ----
    it('does not highlight occurrences inside @ constant literals', () => {
        const html = '<div nb-value="this.name"></div><span nb-value="@this.name literal"></span>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(html.indexOf('this.name') + 5);
        const result = provider.provideDocumentHighlights(doc, pos, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1); // the literal occurrence is skipped
    });

    it('returns undefined when the cursor is inside a @ constant literal', () => {
        const html = '<span nb-value="@this.name literal"></span>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(html.indexOf('this.name') + 5);
        const result = provider.provideDocumentHighlights(doc, pos, token as any);
        expect(result).toBeUndefined();
    });
});
