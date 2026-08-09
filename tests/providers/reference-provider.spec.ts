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

// ---- Round 3 (M3): references on a CHAINED member must not report the root ----
describe('nReferenceProvider — chained members (round 3)', () => {
    const token = createCancellationToken();

    function setup() {
        const analyzer = new DecoratorAnalyzer();
        const provider = new nReferenceProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                user: string = '';
            }
        `);
        const htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
        return { provider, htmlPath };
    }

    it('declines when the cursor is on a chained segment', () => {
        const { provider, htmlPath } = setup();
        const html = '<div nb-value="this.user.name" nb-if="this.user"></div>';
        const doc = createMockDocument(html, htmlPath);
        // With the cursor on `name`, answering with `user`'s occurrences
        // reported the wrong symbol confidently — decline instead.
        const pos = doc.positionAt(html.indexOf('name"'));
        const result = provider.provideReferences(doc, pos, { includeDeclaration: true } as any, token as any);
        expect(result).toBeUndefined();
    });

    it('still reports the root member\'s references from the root segment', () => {
        const { provider, htmlPath } = setup();
        const html = '<div nb-value="this.user.name" nb-if="this.user"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('user.name'));
        const result = provider.provideReferences(doc, pos, { includeDeclaration: false } as any, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(2); // both template occurrences of `user`
    });
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

    // The fan-out is DECLARATION-based: two unrelated classes in one TS file
    // that both declare `name` own two DIFFERENT members. Referencing (or
    // renaming) A.name from A's template must NOT surface B's template — the
    // TS-side rename only touches A.name, so editing B's template would break
    // class B at runtime. (The old file-based fan-out did exactly that.)
    it('does not leak references across unrelated classes sharing a TS file', () => {
        const sourceWith2Templates = `
            import primary from './primary.html';
            import secondary from './secondary.html';
            @Container(primary)
            class A { name: string = ''; }
            @Container(secondary)
            class B { name: string = ''; }
        `;
        analyzer.analyzeSourceText('/test/multi.ts', sourceWith2Templates);

        // Both templates use this.name — but they are different declarations.
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
        // Only A's own template — B.name is a different member
        expect(result!.length).toBe(1);
    });

    it('should prefer open buffer over disk for sibling HTMLs sharing a declaration', () => {
        // Legitimate sibling case: two subclasses inherit `title` from one
        // base declaration — the fan-out reaches both templates, and the
        // sibling's LIVE buffer must win over stale disk content.
        const fsActual = jest.requireActual('fs') as typeof import('fs');
        const nodePath = require('path');
        const os = require('os');
        const tmp = fsActual.mkdtempSync(nodePath.join(os.tmpdir(), 'nubond-refs-buffer-')).replace(/\\/g, '/');
        try {
            fsActual.writeFileSync(`${tmp}/base.ts`, `export class BaseCard { title: string = ''; }`, 'utf-8');
            fsActual.writeFileSync(`${tmp}/a.ts`, [
                "import html from './a.html';",
                "import { BaseCard } from './base';",
                '@Container(html)',
                'class CardA extends BaseCard {}',
            ].join('\n'), 'utf-8');
            fsActual.writeFileSync(`${tmp}/b.ts`, [
                "import html from './b.html';",
                "import { BaseCard } from './base';",
                '@Container(html)',
                'class CardB extends BaseCard {}',
            ].join('\n'), 'utf-8');
            const aHtml = '<div nb-value="this.title"></div>';
            fsActual.writeFileSync(`${tmp}/a.html`, aHtml, 'utf-8');
            // Disk says NO refs in b.html; the live buffer has 2.
            fsActual.writeFileSync(`${tmp}/b.html`, '<div></div>', 'utf-8');

            analyzer.analyzeFiles([`${tmp}/base.ts`, `${tmp}/a.ts`, `${tmp}/b.ts`]);

            const liveSecondary = createMockDocument(
                '<span nb-html="this.title"></span><p nb-if="this.title"></p>',
                `${tmp}/b.html`,
                'html'
            );
            (vscode.workspace as any).textDocuments = [liveSecondary];

            const doc = createMockDocument(aHtml, `${tmp}/a.html`);
            const pos = doc.positionAt(aHtml.indexOf('this.title') + 5);
            const result = provider.provideReferences(doc, pos, { includeDeclaration: false }, token as any);
            expect(result).toBeDefined();
            // 1 in a.html + 2 in b.html's live buffer (0 on disk)
            expect(result!.length).toBe(3);
        } finally {
            try { fsActual.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp reaper */ }
        }
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

// ---- Round-2 regressions ----

describe('nReferenceProvider — inherited member declaration location', () => {
    it('reports the declaration in the declaring (base) file, not the derived file', () => {
        const analyzer = new DecoratorAnalyzer();
        const provider = new nReferenceProvider(analyzer);
        const token = createCancellationToken();
        const containerSource = `
            import html from './template.html';
            @Container(html)
            class DerivedContainer {
                own: string = '';
            }
        `;
        analyzer.analyzeSourceText('/test/derived.ts', containerSource);
        const assoc = analyzer.getAssociationsForTs('/test/derived.ts')[0];
        // Simulate a checker-collected inherited member: coordinates belong
        // to the BASE file, recorded via declaredIn.
        assoc.members.push({
            name: 'inheritedProp',
            kind: 'property',
            type: 'string',
            line: 7,
            character: 12,
            offset: 0,
            isPublic: true,
            declaredIn: '/test/base.ts',
        });

        const html = '<div nb-value="this.inheritedProp"></div>';
        const doc = createMockDocument(html, assoc.htmlFilePath!);
        const pos = doc.positionAt(html.indexOf('inheritedProp'));
        const result = provider.provideReferences(doc, pos, { includeDeclaration: true }, token as any)!;
        expect(result).toBeDefined();

        const declaration = result.find(loc =>
            loc.uri.fsPath.replace(/\\/g, '/').endsWith('/test/base.ts'));
        expect(declaration).toBeDefined();
        // And nothing points base-file coordinates at the derived file
        const wrong = result.find(loc =>
            loc.uri.fsPath.replace(/\\/g, '/').endsWith('/test/derived.ts'));
        expect(wrong).toBeUndefined();
    });
});

// ---- Regression: '@' constant literals are not references ----

describe("nReferenceProvider — '@' constant literals", () => {
    const containerSource = `
        import html from './template.html';
        @Container(html)
        class TestContainer {
            name: string = '';
        }
    `;

    function setup() {
        const analyzer = new DecoratorAnalyzer();
        const provider = new nReferenceProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        const htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
        return { provider, htmlPath };
    }

    it('does not count occurrences inside @ literals', () => {
        const { provider, htmlPath } = setup();
        const token = createCancellationToken();
        const html = '<div nb-value="this.name"></div><span nb-value="@this.name literal"></span>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('this.name') + 5);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: false }, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1); // only the evaluated binding
    });

    it('returns undefined when invoked on a member inside a @ literal', () => {
        const { provider, htmlPath } = setup();
        const token = createCancellationToken();
        const html = '<span nb-value="@this.name literal"></span>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('this.name') + 5);
        const result = provider.provideReferences(doc, pos, { includeDeclaration: true }, token as any);
        expect(result).toBeUndefined();
    });
});

// ---- Regression: fan-out across subclasses sharing a base declaration ----

describe('nReferenceProvider — base-class member fan-out', () => {
    const fsActual = jest.requireActual('fs') as typeof import('fs');
    const nodePath = require('path');
    const os = require('os');

    it('finds references in sibling subclass templates (symmetric with rename)', () => {
        const tmp = fsActual.mkdtempSync(nodePath.join(os.tmpdir(), 'nubond-refs-m4-')).replace(/\\/g, '/');
        try {
            fsActual.writeFileSync(`${tmp}/base.ts`, `export class BaseCard { title: string = ''; }`, 'utf-8');
            fsActual.writeFileSync(`${tmp}/a.ts`, [
                "import html from './a.html';",
                "import { BaseCard } from './base';",
                '@Container(html)',
                'class CardA extends BaseCard {}',
            ].join('\n'), 'utf-8');
            fsActual.writeFileSync(`${tmp}/b.ts`, [
                "import html from './b.html';",
                "import { BaseCard } from './base';",
                '@Container(html)',
                'class CardB extends BaseCard {}',
            ].join('\n'), 'utf-8');
            const aHtml = '<div nb-value="this.title"></div>';
            const bHtml = '<span nb-value="this.title"></span>';
            fsActual.writeFileSync(`${tmp}/a.html`, aHtml, 'utf-8');
            fsActual.writeFileSync(`${tmp}/b.html`, bHtml, 'utf-8');

            const analyzer = new DecoratorAnalyzer();
            const provider = new nReferenceProvider(analyzer);
            const token = createCancellationToken();
            // Program path (with TypeChecker) so inherited members carry declaredIn
            analyzer.analyzeFiles([`${tmp}/base.ts`, `${tmp}/a.ts`, `${tmp}/b.ts`]);

            const doc = createMockDocument(aHtml, `${tmp}/a.html`);
            const pos = doc.positionAt(aHtml.indexOf('this.title') + 5);
            const result = provider.provideReferences(doc, pos, { includeDeclaration: false }, token as any);
            expect(result).toBeDefined();
            const files = result!.map(loc => loc.uri.fsPath.replace(/\\/g, '/').toLowerCase());
            expect(files.some(f => f.endsWith('a.html'))).toBe(true);
            expect(files.some(f => f.endsWith('b.html'))).toBe(true);
        } finally {
            try { fsActual.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp reaper */ }
        }
    });
});
