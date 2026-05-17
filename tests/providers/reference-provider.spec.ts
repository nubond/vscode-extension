import { nReferenceProvider } from '../../src/providers/reference-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';
import { Location } from 'vscode';
import * as vscode from 'vscode';

// Track mock HTML content per path for off-disk tests
const htmlMocks: Record<string, string | Error> = {};

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        readFileSync: (p: any, enc: any) => {
            if (typeof p === 'string' && p in htmlMocks) {
                const val = htmlMocks[p];
                if (val instanceof Error) throw val;
                return val;
            }
            return actual.readFileSync(p, enc);
        },
    };
});

beforeEach(() => {
    Object.keys(htmlMocks).forEach(k => delete htmlMocks[k]);
    (vscode.workspace as any).textDocuments = [];
});

describe('nReferenceProvider', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nReferenceProvider;
    const token = createCancellationToken();

    const containerSource = `
        import html from './template.html';
        @Container(html)
        class TestContainer {
            name: string = '';
            count: number = 0;
        }
    `;

    function setupAssociation() {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        return analyzer.getAllAssociations()[0]?.htmlFilePath;
    }

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nReferenceProvider(analyzer);
    });

    it('should return undefined outside binding value', () => {
        const html = '<div>text</div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(5);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: true }, token as any);
        expect(result).toBeUndefined();
    });

    it('should return undefined when not on a this.X member', () => {
        const html = '<div nb-value="some text"></div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(html.indexOf('some'));
        const result = provider.provideReferences(doc, pos, { includeDeclaration: true }, token as any);
        expect(result).toBeUndefined();
    });

    it('should find HTML references for this.member with associations', () => {
        const htmlPath = setupAssociation();
        if (!htmlPath) return;

        const html = '<div nb-value="this.name"></div><span nb-html="this.name"></span>';
        const doc = createMockDocument(html, htmlPath);
        const nameOffset = html.indexOf('this.name') + 5; // 'name' in value
        const pos = doc.positionAt(nameOffset);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: false }, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(2); // two usages of this.name
    });

    it('should include TS declaration when includeDeclaration is true', () => {
        const htmlPath = setupAssociation();
        if (!htmlPath) return;

        const html = '<div nb-value="this.name"></div>';
        const doc = createMockDocument(html, htmlPath);
        const nameOffset = html.indexOf('this.name') + 5;
        const pos = doc.positionAt(nameOffset);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: true }, token as any);
        expect(result).toBeDefined();
        // Should include both: 1 TS declaration + 1 HTML reference
        expect(result!.length).toBeGreaterThanOrEqual(2);
    });

    it('should return undefined for member with no associations', () => {
        const html = '<div nb-value="this.unknown"></div>';
        const doc = createMockDocument(html);
        const offset = html.indexOf('unknown');
        const pos = doc.positionAt(offset);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: true }, token as any);
        // No associations set up → empty loop → undefined
        expect(result).toBeUndefined();
    });

    it('should find multiple references of same member in different bindings', () => {
        const htmlPath = setupAssociation();
        if (!htmlPath) return;

        const html = '<div nb-value="this.name"></div><span nb-if="this.name"></span><p nb-html="this.name"></p>';
        const doc = createMockDocument(html, htmlPath);
        const nameOffset = html.indexOf('this.name') + 5;
        const pos = doc.positionAt(nameOffset);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: false }, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(3); // three usages of this.name
    });

    it('should find only references for the exact member', () => {
        const htmlPath = setupAssociation();
        if (!htmlPath) return;

        const html = '<div nb-value="this.name"></div><span nb-value="this.count"></span>';
        const doc = createMockDocument(html, htmlPath);
        const nameOffset = html.indexOf('this.name') + 5;
        const pos = doc.positionAt(nameOffset);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: false }, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1); // only name, not count
    });

    // Regression: reference-provider must walk all HTMLs associated with the
    // same TS class — not just the current document. Otherwise find-references
    // is asymmetric with rename and reports fewer hits than the actual edits.
    it('should include references from sibling HTML files associated with the same TS class', () => {
        const sourceWith2Templates = `
            import primary from './primary.html';
            import secondary from './secondary.html';
            @Container(primary)
            class A { name: string = ''; }
            @Container(secondary)
            class B { name: string = ''; }
        `;
        analyzer.analyzeSourceText('/test/multi.ts', sourceWith2Templates);

        // Both templates use this.name — but only `primary.html` is open.
        const primaryHtml = '<div nb-value="this.name"></div>';
        const secondaryHtml = '<span nb-html="this.name"></span><p nb-if="this.name"></p>';
        const allAssocs = analyzer.getAllAssociations();
        const primaryPath = allAssocs.find(a => a.className === 'A')?.htmlFilePath;
        const secondaryPath = allAssocs.find(a => a.className === 'B')?.htmlFilePath;
        if (!primaryPath || !secondaryPath) return;

        htmlMocks[secondaryPath] = secondaryHtml;

        const doc = createMockDocument(primaryHtml, primaryPath);
        const pos = doc.positionAt(primaryHtml.indexOf('this.name') + 5);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: false }, token as any);

        expect(result).toBeDefined();
        // 1 in primary + 2 in secondary = 3 total references across templates
        expect(result!.length).toBe(3);
    });

    it('should prefer open buffer over disk for sibling HTMLs', () => {
        const sourceWith2Templates = `
            import primary from './primary.html';
            import secondary from './secondary.html';
            @Container(primary)
            class A { name: string = ''; }
            @Container(secondary)
            class B { name: string = ''; }
        `;
        analyzer.analyzeSourceText('/test/multi.ts', sourceWith2Templates);
        const allAssocs = analyzer.getAllAssociations();
        const primaryPath = allAssocs.find(a => a.className === 'A')?.htmlFilePath;
        const secondaryPath = allAssocs.find(a => a.className === 'B')?.htmlFilePath;
        if (!primaryPath || !secondaryPath) return;

        // Disk would say there are no refs in secondary; the live buffer has 2.
        htmlMocks[secondaryPath] = '<div></div>';
        const liveSecondary = createMockDocument(
            '<span nb-html="this.name"></span><p nb-if="this.name"></p>',
            secondaryPath,
            'html'
        );
        (vscode.workspace as any).textDocuments = [liveSecondary];

        const primaryHtml = '<div nb-value="this.name"></div>';
        const doc = createMockDocument(primaryHtml, primaryPath);
        const pos = doc.positionAt(primaryHtml.indexOf('this.name') + 5);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: false }, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(3);
    });

    it('should return undefined when cursor is before expression prefix', () => {
        const html = '<div nb-container="@MyContainer"></div>';
        const doc = createMockDocument(html);
        // Position before @
        const pos = doc.positionAt(html.indexOf('"@') + 1);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: true }, token as any);
        // exprOffset < 0 → undefined
        expect(result).toBeUndefined();
    });
});
