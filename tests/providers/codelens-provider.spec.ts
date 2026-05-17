import { nCodeLensProvider } from '../../src/providers/codelens-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';
import * as vscode from 'vscode';

// Track mock HTML content per path
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

describe('nCodeLensProvider', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nCodeLensProvider;
    const token = createCancellationToken();

    const containerSource = `
        import html from './template.html';
        @Container(html)
        class TestContainer {
            name: string = '';
            count: number = 0;
        }
    `;

    beforeEach(() => {
        // Clear any mock HTML files
        Object.keys(htmlMocks).forEach(k => delete htmlMocks[k]);
        analyzer = new DecoratorAnalyzer();
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string, defaultValue?: any) => defaultValue),
        });
        provider = new nCodeLensProvider(analyzer);
    });

    it('should return undefined for non-TypeScript documents', () => {
        const html = '<div>text</div>';
        const doc = createMockDocument(html, '/test/file.html', 'html');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeUndefined();
    });

    it('should return undefined when no associations exist', () => {
        const tsContent = 'class Foo {}';
        const doc = createMockDocument(tsContent, '/test/file.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeUndefined();
    });

    it('should provide CodeLenses for associated TS class', () => {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);

        const doc = createMockDocument(containerSource, '/test/container.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBeGreaterThanOrEqual(1);
    });

    it('should resolve CodeLens pass-through', () => {
        const lens = new vscode.CodeLens(
            new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5)),
            { title: 'test', command: 'test.command' }
        );
        const result = provider.resolveCodeLens(lens, token as any);
        expect(result).toBe(lens);
    });

    it('should support refresh', () => {
        expect(() => provider.refresh()).not.toThrow();
    });

    it('should return undefined when codeLens disabled', () => {
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string, defaultValue?: any) => {
                if (key === 'codeLens.enable') return false;
                return defaultValue;
            }),
        });
        provider = new nCodeLensProvider(analyzer);

        analyzer.analyzeSourceText('/test/container.ts', containerSource);

        const doc = createMockDocument(containerSource, '/test/container.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeUndefined();
    });

    it('should create class CodeLens with template path', () => {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);

        const doc = createMockDocument(containerSource, '/test/container.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeDefined();
        const classLens = result!.find(l => l.command?.title?.includes('Template:'));
        expect(classLens).toBeDefined();
    });

    it('should create member CodeLens with reference count when HTML exists', () => {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        htmlMocks[htmlPath] = '<div nb-value="this.name"></div><span nb-value="this.name"></span>';
        const doc = createMockDocument(containerSource, '/test/container.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeDefined();
        const memberLens = result!.find(l => l.command?.title?.includes('template reference'));
        expect(memberLens).toBeDefined();
        expect(memberLens!.command!.title).toContain('2');
    });

    it('should use plural for multiple references', () => {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        htmlMocks[htmlPath] = '<div nb-value="this.name"></div><span nb-if="this.name"></span><p nb-html="this.name"></p>';
        const doc = createMockDocument(containerSource, '/test/container.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeDefined();
        const memberLens = result!.find(l => l.command?.title?.includes('references'));
        expect(memberLens).toBeDefined();
        expect(memberLens!.command!.title).toContain('3');
        expect(memberLens!.command!.title).toMatch(/references/);
    });

    it('should use singular for single reference', () => {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        htmlMocks[htmlPath] = '<div nb-value="this.name"></div>';
        const doc = createMockDocument(containerSource, '/test/container.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeDefined();
        const memberLens = result!.find(l => l.command?.title?.includes('template reference'));
        expect(memberLens).toBeDefined();
        expect(memberLens!.command!.title).toMatch(/1 template reference(?!s)/);
    });

    it('should not create member lens for unused members', () => {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        htmlMocks[htmlPath] = '<div nb-value="this.name"></div>';
        const doc = createMockDocument(containerSource, '/test/container.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeDefined();
        const memberLenses = result!.filter(l => l.command?.title?.includes('template reference'));
        expect(memberLenses.length).toBe(1);
    });

    it('should handle missing HTML file gracefully', () => {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        htmlMocks[htmlPath] = new Error('File not found');
        const doc = createMockDocument(containerSource, '/test/container.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeDefined();
        const memberLenses = result!.filter(l => l.command?.title?.includes('template reference'));
        expect(memberLenses.length).toBe(0);
    });

    it('should use relative path when workspace folders configured', () => {
        (vscode.workspace as any).workspaceFolders = [
            { uri: { fsPath: '/workspace' }, name: 'root', index: 0 }
        ];

        const source = `
            import html from './views/template.html';
            @Container(html)
            class TestContainer {
                title: string = '';
            }
        `;
        analyzer.analyzeSourceText('/workspace/src/container.ts', source);

        const doc = createMockDocument(source, '/workspace/src/container.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeDefined();
        const classLens = result!.find(l => l.command?.title?.includes('Template:'));
        expect(classLens).toBeDefined();
        expect(classLens!.command!.title).not.toContain('/workspace/');

        // Clean up
        (vscode.workspace as any).workspaceFolders = undefined;
    });

    it('should use basename when file is outside workspace', () => {
        (vscode.workspace as any).workspaceFolders = [
            { uri: { fsPath: '/workspace' }, name: 'root', index: 0 }
        ];

        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                name: string = '';
            }
        `;
        analyzer.analyzeSourceText('/other/path/container.ts', source);

        const doc = createMockDocument(source, '/other/path/container.ts', 'typescript');
        const result = provider.provideCodeLenses(doc, token as any);
        expect(result).toBeDefined();
        const classLens = result!.find(l => l.command?.title?.includes('Template:'));
        expect(classLens).toBeDefined();

        // Clean up
        (vscode.workspace as any).workspaceFolders = undefined;
    });

    // ---- Regression: open editor buffer is preferred over disk ----
    // Before fix: findAllTemplateReferences always read from fs.readFileSync,
    // so unsaved edits weren't reflected in the "N template references" count.
    // After fix: when the HTML doc is open in VSCode, getText() is used.
    it('should use the open document buffer over disk for HTML content', () => {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        // Disk content has 1 reference; open buffer has 3 — buffer must win.
        htmlMocks[htmlPath] = '<div nb-value="this.name"></div>';
        const liveBuffer = '<div nb-value="this.name"></div><span nb-if="this.name"></span><p nb-html="this.name"></p>';
        const openDoc = createMockDocument(liveBuffer, htmlPath, 'html');
        (vscode.workspace as any).textDocuments = [openDoc];

        const fsMod = require('fs');
        const readSpy = jest.spyOn(fsMod, 'readFileSync');

        try {
            const doc = createMockDocument(containerSource, '/test/container.ts', 'typescript');
            const result = provider.provideCodeLenses(doc, token as any);
            const memberLens = result!.find(l => l.command?.title?.includes('template reference'));
            expect(memberLens).toBeDefined();
            expect(memberLens!.command!.title).toContain('3');

            // Disk should not have been read for that path
            const htmlReadCalls = readSpy.mock.calls.filter(
                (args: any[]) => typeof args[0] === 'string' && args[0] === htmlPath
            );
            expect(htmlReadCalls.length).toBe(0);
        } finally {
            readSpy.mockRestore();
            (vscode.workspace as any).textDocuments = [];
        }
    });

    // ---- Regression: Fix #1 — single HTML read per association ----
    // Before fix: findTemplateReferences was called once PER member (N×readSync).
    // After fix: findAllTemplateReferences reads & parses HTML exactly once, regardless
    // of how many public members the class has, preventing Extension Host blocking.
    it('should read HTML file exactly once regardless of the number of public members', () => {
        const manyMembersSource = `
            import html from './template.html';
            @Container(html)
            class BigContainer {
                a: string = '';
                b: string = '';
                c: string = '';
                d: string = '';
                e: string = '';
            }
        `;
        analyzer.analyzeSourceText('/test/big.ts', manyMembersSource);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        htmlMocks[htmlPath] = '<div nb-value="this.a"></div><span nb-value="this.b"></span>';

        // Spy on the mocked readFileSync to count how many times the HTML is read
        const fsMod = require('fs');
        const readSpy = jest.spyOn(fsMod, 'readFileSync');

        try {
            const doc = createMockDocument(manyMembersSource, '/test/big.ts', 'typescript');
            provider.provideCodeLenses(doc, token as any);

            // The HTML file must be read exactly once, regardless of 5 public members
            const htmlReadCalls = readSpy.mock.calls.filter(
                (args: any[]) => typeof args[0] === 'string' && args[0] === htmlPath
            );
            expect(htmlReadCalls.length).toBe(1);
        } finally {
            readSpy.mockRestore();
        }
    });
});
