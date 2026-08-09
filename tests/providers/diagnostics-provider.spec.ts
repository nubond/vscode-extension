import { nDiagnosticsProvider } from '../../src/providers/diagnostics-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument } from '../helpers';
import * as vscode from 'vscode';
import { Constants } from '../../src/constants';

// Reset mocks before each test
beforeEach(() => {
    jest.clearAllMocks();
    // Make onDidOpenTextDocument/onDidChangeTextDocument/onDidCloseTextDocument return disposables
    (vscode.workspace as any).onDidOpenTextDocument = jest.fn(() => ({ dispose: jest.fn() }));
    (vscode.workspace as any).onDidChangeTextDocument = jest.fn(() => ({ dispose: jest.fn() }));
    (vscode.workspace as any).onDidCloseTextDocument = jest.fn(() => ({ dispose: jest.fn() }));
    (vscode.workspace as any).textDocuments = [];
});

// ---- Round 3 (L4/L5): repeat own-scope + regex-literal masking ----
describe('nDiagnosticsProvider — repeat own-scope and regex masking (round 3)', () => {
    let analyzer: DecoratorAnalyzer;
    let diagnosticSet: jest.Mock;

    function createProvider() {
        const mockCollection = {
            name: Constants.INTERNAL_NAME,
            set: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn(),
            forEach: jest.fn(),
            get: jest.fn(),
            has: jest.fn(),
        };
        diagnosticSet = mockCollection.set;
        (vscode.languages.createDiagnosticCollection as jest.Mock).mockReturnValue(mockCollection);
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string, defaultValue?: any) => defaultValue),
        });
        return new nDiagnosticsProvider(analyzer);
    }

    function setupAssoc(): string {
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer { items: string[] = []; v: string = ''; }
        `);
        return analyzer.getAllAssociations()[0]!.htmlFilePath!;
    }

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
    });

    it('L4: flags item used in a repeat\'s own expression with no outer scope', () => {
        // The collection expression runs with the PARENT params — bare `item`
        // here is a runtime ReferenceError, previously unflagged because the
        // element's own scope suppressed the check.
        const htmlPath = setupAssoc();
        const provider = createProvider();
        const doc = createMockDocument('<div nb-repeat="item.x"></div>', htmlPath);
        provider.validate(doc);
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.some((d: any) => d.message.includes("'item'") && d.message.includes('repeat parameter'))).toBe(true);
    });

    it('L4: does not flag item in a nested repeat\'s expression when an outer scope provides it', () => {
        const htmlPath = setupAssoc();
        const provider = createProvider();
        const doc = createMockDocument(
            '<div nb-repeat="this.items"><span nb-repeat="item.children"></span></div>', htmlPath);
        provider.validate(doc);
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.filter((d: any) => d.message.includes('repeat parameter'))).toHaveLength(0);
    });

    it('L5: does not flag item that appears only inside a regex literal', () => {
        const htmlPath = setupAssoc();
        const provider = createProvider();
        const doc = createMockDocument('<div nb-exec="this.v.match(/item/)"></div>', htmlPath);
        provider.validate(doc);
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.filter((d: any) => d.message.includes('repeat parameter'))).toHaveLength(0);
    });

    it('L5: member references AFTER a regex literal with quotes are still validated', () => {
        // The quote inside /["]/ used to derail the scanner and hide the
        // dead reference that follows. (Single-quoted HTML attribute so the
        // expression may legally contain double quotes.)
        const htmlPath = setupAssoc();
        const provider = createProvider();
        const doc = createMockDocument(
            "<div nb-exec='this.v.replace(/[\"]/g, \"x\") + this.nonExistent'></div>", htmlPath);
        provider.validate(doc);
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.some((d: any) => d.message.includes("'nonExistent'"))).toBe(true);
    });
});

describe('nDiagnosticsProvider', () => {
    let analyzer: DecoratorAnalyzer;
    let diagnosticSet: jest.Mock;

    function createProvider() {
        const mockCollection = {
            name: Constants.INTERNAL_NAME,
            set: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn(),
            forEach: jest.fn(),
            get: jest.fn(),
            has: jest.fn(),
        };
        diagnosticSet = mockCollection.set;
        (vscode.languages.createDiagnosticCollection as jest.Mock).mockReturnValue(mockCollection);

        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string, defaultValue?: any) => defaultValue),
        });

        return new nDiagnosticsProvider(analyzer);
    }

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
    });

    it('should create without errors', () => {
        const provider = createProvider();
        expect(provider).toBeDefined();
    });

    it('should skip non-HTML documents', () => {
        const provider = createProvider();
        const doc = createMockDocument('const x = 1;', '/test/file.ts', 'typescript');
        provider.validate(doc);
        expect(diagnosticSet).not.toHaveBeenCalled();
    });

    it('should produce diagnostics for unknown nb attributes', () => {
        const provider = createProvider();
        const html = '<div nb-unknown="this.name"></div>';
        const doc = createMockDocument(html);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.length).toBeGreaterThan(0);
        expect(diags[0].message).toContain(`Unknown ${Constants.DISPLAY_NAME} attribute`);
    });

    it('should produce diagnostics for non-existent members (no template association)', () => {
        // Without a proper template association, members won't be validated
        const provider = createProvider();
        const html = '<div nb-value="this.nonExistent"></div>';
        const doc = createMockDocument(html);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        // No associations, so no member validation
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.length).toBe(0);
    });

    it('should not produce diagnostics for valid members', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                name: string = '';
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        const html = '<div nb-value="this.name"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.length).toBe(0);
    });

    it('should produce diagnostics for non-existent members with association', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                name: string = '';
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        const html = '<div nb-value="this.nonExistent"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.length).toBeGreaterThan(0);
        expect(diags[0].message).toContain("does not exist on");
    });

    it('should produce warnings for nb-case without nb-switch', () => {
        const provider = createProvider();
        const html = '<div nb-case="1"></div>';
        const doc = createMockDocument(html);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const switchDiag = diags.find((d: any) => d.message.includes('nb-switch'));
        expect(switchDiag).toBeDefined();
    });

    it('should dispose correctly', () => {
        const provider = createProvider();
        provider.dispose();
    });

    it('should clear diagnostics when diagnostics are disabled', () => {
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string) => {
                if (key === 'diagnostics.enable') return false;
                return true;
            }),
        });
        const provider = createProvider();
        const html = '<div nb-unknown="foo"></div>';
        const doc = createMockDocument(html);
        provider.validate(doc);
        // When disabled, diagnostics should be deleted, not set
    });

    it('should warn about repeat params outside nb-repeat scope', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                items: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        // 'item' used outside nb-repeat
        const html = '<div nb-value="item"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeDefined();
    });

    it('should not warn about repeat params inside nb-repeat scope', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                items: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        const html = '<div nb-repeat="this.items"><span nb-value="item"></span></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeUndefined();
    });

    it('should handle nb-default without nb-switch', () => {
        const provider = createProvider();
        const html = '<div nb-default></div>';
        const doc = createMockDocument(html);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const switchDiag = diags.find((d: any) => d.message.includes('nb-switch'));
        expect(switchDiag).toBeDefined();
    });

    it('should not warn about nb-case inside nb-switch', () => {
        const provider = createProvider();
        const html = '<div nb-switch="this.val"><span nb-case="1">one</span></div>';
        const doc = createMockDocument(html);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const switchDiag = diags.find((d: any) => d.message.includes('nb-switch'));
        expect(switchDiag).toBeUndefined();
    });

    it('should validate on refresh with open text documents', () => {
        const provider = createProvider();
        const doc = createMockDocument('<div nb-value="this.test"></div>');
        (vscode.workspace as any).textDocuments = [doc];
        provider.refresh();
        // validate should have been called for the open document
        expect(diagnosticSet).toHaveBeenCalled();
    });

    it('should handle expressions with string literals (no false positives)', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                items: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        // 'item' is inside a single-quoted string — extractCodeParts should strip it
        const html = '<div nb-value="this.items.join(\'item\')"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeUndefined();
    });

    it('should handle double-quoted strings in expressions', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                data: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        // "count" in a double-quoted string should not trigger warning
        const html = `<div nb-exec="this.data.push('count')"></div>`;
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeUndefined();
    });

    it('should not warn about repeat params that are class members', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                count: number = 0;
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        // 'count' is also a class member, should not warn
        const html = '<div nb-value="count"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeUndefined();
    });

    it('should not warn about repeat params that are nb-var locals', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                data: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        // Round 4 (M4): 'item' is a RESERVED context name — the runtime
        // refuses to create the nb-var, so it must NOT suppress the
        // repeat-param warning (and the var itself gets flagged).
        const html = '<div nb-var:item="this.data"><span nb-value="item"></span></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.some((d: any) => d.message.includes('repeat parameter'))).toBe(true);
        expect(diags.some((d: any) => d.message.includes('reserved'))).toBe(true);
    });

    it('should delete diagnostics for disabled config', () => {
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string) => {
                if (key === 'diagnostics.enable') return false;
                return true;
            }),
        });

        const mockCollection = {
            name: Constants.INTERNAL_NAME,
            set: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn(),
            forEach: jest.fn(),
            get: jest.fn(),
            has: jest.fn(),
        };
        (vscode.languages.createDiagnosticCollection as jest.Mock).mockReturnValue(mockCollection);

        const provider = new nDiagnosticsProvider(analyzer);
        const doc = createMockDocument('<div nb-unknown="foo"></div>');
        provider.validate(doc);
        expect(mockCollection.delete).toHaveBeenCalled();
        expect(mockCollection.set).not.toHaveBeenCalled();
    });

    it('should register event listeners in constructor', () => {
        createProvider();
        expect(vscode.workspace.onDidOpenTextDocument).toHaveBeenCalled();
        expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalled();
        expect(vscode.workspace.onDidCloseTextDocument).toHaveBeenCalled();
    });

    it('should debounce validation on document changes', () => {
        jest.useFakeTimers();
        const provider = createProvider();
        const doc = createMockDocument('<div nb-unknown="foo"></div>');

        // Capture the onDidChangeTextDocument callback
        const changeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock).mock.calls[0][0];

        // Simulate rapid changes (like paste)
        changeCallback({ document: doc });
        changeCallback({ document: doc });
        changeCallback({ document: doc });

        // No validation yet — still within debounce window
        expect(diagnosticSet).not.toHaveBeenCalled();

        // Advance past debounce interval
        jest.advanceTimersByTime(nDiagnosticsProvider.DEBOUNCE_MS);

        // Now validation should have fired exactly once
        expect(diagnosticSet).toHaveBeenCalledTimes(1);

        jest.useRealTimers();
    });

    it('should cancel pending debounce on document close', () => {
        jest.useFakeTimers();
        const provider = createProvider();
        const doc = createMockDocument('<div nb-unknown="foo"></div>');

        const changeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock).mock.calls[0][0];
        const closeCallback = (vscode.workspace.onDidCloseTextDocument as jest.Mock).mock.calls[0][0];

        // Trigger a change then immediately close
        changeCallback({ document: doc });
        closeCallback(doc);

        // Advance past debounce — validation should NOT fire
        jest.advanceTimersByTime(nDiagnosticsProvider.DEBOUNCE_MS);
        expect(diagnosticSet).not.toHaveBeenCalled();

        jest.useRealTimers();
    });

    it('should validate immediately on document open (no debounce)', () => {
        const provider = createProvider();
        const doc = createMockDocument('<div nb-unknown="foo"></div>');

        const openCallback = (vscode.workspace.onDidOpenTextDocument as jest.Mock).mock.calls[0][0];
        openCallback(doc);

        // Should validate immediately without debounce
        expect(diagnosticSet).toHaveBeenCalled();
    });

    it('should cancel a pending timer when the timer is an object (Node Timeout)', () => {
        // Regression: in production, setTimeout returns a Timeout object, not a
        // number. A previous `typeof === 'number'` guard silently disabled the
        // debounce by skipping the clearTimeout branch. This test installs a
        // setTimeout shim that returns an object handle to verify cancel works.
        const realSetTimeout = global.setTimeout;
        const realClearTimeout = global.clearTimeout;
        const cleared: any[] = [];
        const fired = jest.fn();
        const handles = new Map<object, NodeJS.Timeout>();

        (global as any).setTimeout = (cb: any, ms: number) => {
            const handle = { __nodeLikeTimeoutHandle: true } as any;
            const real = realSetTimeout(() => { fired(); cb(); }, ms);
            handles.set(handle, real);
            return handle;
        };
        (global as any).clearTimeout = (handle: any) => {
            cleared.push(handle);
            const real = handles.get(handle);
            if (real) realClearTimeout(real);
        };

        try {
            const provider = createProvider();
            const doc = createMockDocument('<div nb-unknown="foo"></div>');
            const changeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock).mock.calls[0][0];

            changeCallback({ document: doc });
            changeCallback({ document: doc });

            // Two changes scheduled → first should be cancelled, leaving one
            expect(cleared.length).toBe(1);
            expect(typeof cleared[0]).toBe('object');

            provider.dispose();
        } finally {
            (global as any).setTimeout = realSetTimeout;
            (global as any).clearTimeout = realClearTimeout;
        }
    });

    it('should clear pending timers on dispose', () => {
        jest.useFakeTimers();
        const provider = createProvider();
        const doc = createMockDocument('<div nb-unknown="foo"></div>');

        const changeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock).mock.calls[0][0];
        changeCallback({ document: doc });

        // Dispose before debounce fires
        provider.dispose();

        // Advance past debounce — validation should NOT fire
        jest.advanceTimersByTime(nDiagnosticsProvider.DEBOUNCE_MS);
        expect(diagnosticSet).not.toHaveBeenCalled();

        jest.useRealTimers();
    });

    it('should skip scheduling debounce for non-HTML documents', () => {
        jest.useFakeTimers();
        const provider = createProvider();
        const tsDoc = createMockDocument('const x = 1;', '/test/file.ts', 'typescript');

        const changeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock).mock.calls[0][0];

        // Simulate edits in a TypeScript document
        changeCallback({ document: tsDoc });

        // Advance past debounce — no validation should fire for TS docs
        jest.advanceTimersByTime(nDiagnosticsProvider.DEBOUNCE_MS);
        expect(diagnosticSet).not.toHaveBeenCalled();

        jest.useRealTimers();
    });

    it('should handle template literal expressions (extractCodeParts backtick branch)', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                data: string[] = [];
                name: string = '';
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        // Template literal with ${...}: 'item' in plain text of template should not warn
        // but 'item' inside ${} should warn if outside repeat scope
        const html = '<div nb-exec="`hello ${item}`"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeDefined();
    });

    it('should handle block comments in expressions (extractCodeParts comment branch)', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                data: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        // 'item' inside a block comment should be stripped by extractCodeParts
        const html = '<div nb-exec="/* item */ this.data"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeUndefined();
    });

    it('should warn about repeat param used outside repeat scope', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                data: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        const html = '<div nb-value="item"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeDefined();
        expect(repeatDiag.message).toContain('item');
        expect(repeatDiag.message).toContain('nb-repeat');
    });

    it('should validate non-existent member references', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                name: string = '';
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        const html = '<div nb-value="this.nonExistent"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const memberDiag = diags.find((d: any) => d.message.includes('nonExistent'));
        expect(memberDiag).toBeDefined();
        expect(memberDiag.message).toContain('does not exist');
    });

    it('should dispose all internal disposables', () => {
        const provider = createProvider();
        provider.dispose();
        // Should not throw
    });

    it('should not false-positive on escaped single quotes in strings', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                data: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        // 'item' appears after an escaped quote inside a string — should NOT be treated as code
        const html = `<div nb-exec="this.data.push('it\\'s an item')"></div>`;
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeUndefined();
    });

    it('should not false-positive on escaped double quotes in strings', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                data: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        // escaped double quote followed by 'item' — should remain inside the string
        const html = '<div nb-exec="this.data.join(\'\\\"item\\\"\')"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeUndefined();
    });

    // ---- Regression: '@' constant literals are never evaluated — validating
    // them produced warnings for literals that merely contain 'this.' ----
    it('should not validate member references in @ constant literals', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                name: string = '';
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const htmlPath = analyzer.getAllAssociations()[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        const html = '<div nb-value="@Use this.something literally"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.find((d: any) => d.message.includes('does not exist'))).toBeUndefined();
    });

    // ---- Regression: a prefixed nb-repeat scope injects ONLY the prefixed
    // names — bare 'item' inside nb-repeat:outer is not available, but any
    // ancestor nb-repeat used to silence the warning. ----
    it('should warn about bare item inside a prefixed-only nb-repeat scope', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                items: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const htmlPath = analyzer.getAllAssociations()[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        const html = '<div nb-repeat:outer="this.items"><span nb-value="item"></span></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeDefined();
    });

    it('should not warn about prefixed params inside their prefixed scope', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                items: string[] = [];
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const htmlPath = analyzer.getAllAssociations()[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        const html = '<div nb-repeat:outer="this.items"><span nb-value="outerItem"></span></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeUndefined();
    });

    // ---- Regression: commented-out markup produced live diagnostics ----
    it('should not report diagnostics for commented-out bindings', () => {
        const provider = createProvider();
        const html = '<!-- <div nb-unknownx="this.gone"></div> --><div></div>';
        const doc = createMockDocument(html);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.length).toBe(0);
    });

    it('should not false-positive on escaped backtick in template literal', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                data: string[] = [];
                name: string = '';
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const allAssocs = analyzer.getAllAssociations();
        const htmlPath = allAssocs[0]?.htmlFilePath;
        if (!htmlPath) return;

        const provider = createProvider();
        // escaped backtick inside template literal — should not break out of the literal
        // 'item' appears in the template text after the escaped backtick, NOT as code
        const html = '<div nb-exec="`text with \\` and item`"></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
        const diags = diagnosticSet.mock.calls[0][1];
        const repeatDiag = diags.find((d: any) => d.message.includes('repeat parameter'));
        expect(repeatDiag).toBeUndefined();
    });
});

// ---- Round-2 regressions ----

describe('nDiagnosticsProvider — round-2 regressions', () => {
    let analyzer: DecoratorAnalyzer;
    let diagnosticSet: jest.Mock;

    function createProvider() {
        const mockCollection = {
            name: Constants.INTERNAL_NAME,
            set: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn(),
            forEach: jest.fn(),
            get: jest.fn(),
            has: jest.fn(),
        };
        diagnosticSet = mockCollection.set;
        (vscode.languages.createDiagnosticCollection as jest.Mock).mockReturnValue(mockCollection);
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string, defaultValue?: any) => defaultValue),
        });
        return new nDiagnosticsProvider(analyzer);
    }

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
    });

    it('does not flag references to private constructor parameter properties', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                constructor(private changeDetector: ChangeDetector) {}
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const provider = createProvider();
        const html = '<div nb-event:click="this.changeDetector.detect()"></div>';
        const htmlPath = analyzer.getAllAssociations()[0].htmlFilePath!;
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags).toHaveLength(0);
    });

    it('does not flag this.X inside string literals', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                log(msg: string): void {}
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const provider = createProvider();
        const html = '<div nb-event:click="this.log(\'about this.ghost\')"></div>';
        const htmlPath = analyzer.getAllAssociations()[0].htmlFilePath!;
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags).toHaveLength(0);
    });

    it('does not flag repeat params used as object-literal keys', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                name: string = '';
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const provider = createProvider();
        // nb-container included so the round-6 "input never consumed"
        // element-trap check stays silent — this test is about object-literal
        // keys, not input delivery.
        const html = '<div nb-container="@Child" nb-in:config="{item: this.name, index: 2}"></div>';
        const htmlPath = analyzer.getAllAssociations()[0].htmlFilePath!;
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags).toHaveLength(0);
    });

    it('still flags repeat params used as values (ternary)', () => {
        const source = `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                flag: boolean = false;
                name: string = '';
            }
        `;
        analyzer.analyzeSourceText('/test/container.ts', source);
        const provider = createProvider();
        const html = '<div nb-value="this.flag ? item : this.name"></div>';
        const htmlPath = analyzer.getAllAssociations()[0].htmlFilePath!;
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        const diags = diagnosticSet.mock.calls[0][1];
        expect(diags.some((d: any) => d.message.includes("'item' is a repeat parameter"))).toBe(true);
    });

    // ---- Regression: arrow-function parameters shadow the injected repeat
    // names — `rows.forEach(item => …)` outside any nb-repeat was flagged ----
    describe('arrow-function parameters are not repeat params', () => {
        function setupNamed() {
            const source = `
                import html from './template.html';
                @Container(html)
                class TestContainer {
                    rows: string[] = [];
                    select(x: string): void {}
                }
            `;
            analyzer.analyzeSourceText('/test/container.ts', source);
            return analyzer.getAllAssociations()[0].htmlFilePath!;
        }

        it('does not flag a bare arrow param named item', () => {
            const htmlPath = setupNamed();
            const provider = createProvider();
            const html = '<div nb-event:click="this.rows.forEach(item => this.select(item))"></div>';
            const doc = createMockDocument(html, htmlPath);
            provider.validate(doc);
            const diags = diagnosticSet.mock.calls[0][1];
            expect(diags.filter((d: any) => d.message.includes('repeat parameter'))).toHaveLength(0);
        });

        it('does not flag parenthesized arrow params', () => {
            const htmlPath = setupNamed();
            const provider = createProvider();
            const html = '<div nb-exec="this.rows.map((item, index) => item + index)"></div>';
            const doc = createMockDocument(html, htmlPath);
            provider.validate(doc);
            const diags = diagnosticSet.mock.calls[0][1];
            expect(diags.filter((d: any) => d.message.includes('repeat parameter'))).toHaveLength(0);
        });

        it('still flags a repeat param that is NOT an arrow param in the expression', () => {
            const htmlPath = setupNamed();
            const provider = createProvider();
            const html = '<div nb-exec="this.rows.forEach(x => this.select(x)); this.select(item)"></div>';
            const doc = createMockDocument(html, htmlPath);
            provider.validate(doc);
            const diags = diagnosticSet.mock.calls[0][1];
            expect(diags.some((d: any) => d.message.includes("'item' is a repeat parameter"))).toBe(true);
        });
    });

    // ---- Regression: the runtime requires nb-case/nb-default to be a DIRECT
    // nuBond child of the nb-switch element (TreeBuilder skips nb-less
    // elements) — any-ancestor acceptance validated markup dead at runtime ----
    describe('nb-case must be a direct nuBond child of nb-switch', () => {
        it('flags nb-case separated from nb-switch by another nb-element', () => {
            const provider = createProvider();
            const html = '<div nb-switch="this.val"><section nb-if="this.x"><span nb-case="1">one</span></section></div>';
            const doc = createMockDocument(html);
            provider.validate(doc);
            const diags = diagnosticSet.mock.calls[0][1];
            const switchDiag = diags.find((d: any) => d.message.includes('nb-switch'));
            expect(switchDiag).toBeDefined();
            expect(switchDiag.message).toContain('direct child');
        });

        it('accepts nb-case separated only by plain (nb-less) elements', () => {
            // A plain element creates no NElement — the case's nuBond parent
            // is still the switch, exactly like at runtime.
            const provider = createProvider();
            const html = '<div nb-switch="this.val"><section class="wrap"><span nb-case="1">one</span></section></div>';
            const doc = createMockDocument(html);
            provider.validate(doc);
            const diags = diagnosticSet.mock.calls[0][1];
            expect(diags.find((d: any) => d.message.includes('nb-switch'))).toBeUndefined();
        });

        it('flags nb-default nested under an intermediate nb-element too', () => {
            const provider = createProvider();
            const html = '<div nb-switch="this.val"><section nb-if="this.x"><span nb-default>fallback</span></section></div>';
            const doc = createMockDocument(html);
            provider.validate(doc);
            const diags = diagnosticSet.mock.calls[0][1];
            expect(diags.find((d: any) => d.message.includes('nb-switch'))).toBeDefined();
        });
    });

    // ---- Regression (L7): sibling nb-vars evaluate left-to-right. The first
    // var's expression has NO sibling var parameters (ReferenceError); later
    // vars see every sibling name, but not-yet-evaluated ones are undefined ----
    describe('nb-var evaluation order', () => {
        function validateHtml(html: string) {
            const provider = createProvider();
            const doc = createMockDocument(html);
            provider.validate(doc);
            return diagnosticSet.mock.calls[0][1] as any[];
        }

        it('warns when the FIRST nb-var references a later sibling (ReferenceError)', () => {
            const diags = validateHtml('<div nb-var:a="b + 1" nb-var:b="2"></div>');
            const diag = diags.find(d => d.message.includes('not visible'));
            expect(diag).toBeDefined();
            expect(diag.message).toContain('ReferenceError');
            expect(diag.severity).toBe(vscode.DiagnosticSeverity.Warning);
        });

        it('warns when a single nb-var references itself', () => {
            const diags = validateHtml('<div nb-var:a="a + 1"></div>');
            const diag = diags.find(d => d.message.includes('ReferenceError'));
            expect(diag).toBeDefined();
            expect(diag.message).toContain('own value');
        });

        it('accepts a later var referencing an earlier sibling', () => {
            const diags = validateHtml('<div nb-var:a="2" nb-var:b="a + 1"></div>');
            expect(diags).toHaveLength(0);
        });

        it('reports Information when a later var references a not-yet-evaluated sibling', () => {
            const diags = validateHtml('<div nb-var:a="1" nb-var:b="c" nb-var:c="2"></div>');
            const diag = diags.find(d => d.message.includes('still undefined'));
            expect(diag).toBeDefined();
            expect(diag.severity).toBe(vscode.DiagnosticSeverity.Information);
        });

        it('reports Information for a non-first var reading its own value', () => {
            const diags = validateHtml('<div nb-var:a="1" nb-var:b="b + 1"></div>');
            const diag = diags.find(d => d.message.includes('own value'));
            expect(diag).toBeDefined();
            expect(diag.severity).toBe(vscode.DiagnosticSeverity.Information);
        });

        it('does not warn when the name is declared by an ancestor nb-var', () => {
            // The first var's params are the untouched parent params — the
            // ancestor's `b` resolves even though a sibling `b` also exists
            // (declared later on the same element).
            const diags = validateHtml('<div nb-var:b="1"><span nb-var:a="b + 1" nb-var:b="3"></span></div>');
            expect(diags).toHaveLength(0);
        });

        it('does not warn for sibling names that are bare window globals', () => {
            // `name` is window.name inside a new Function body — no
            // ReferenceError even though the sibling var is not yet visible.
            const diags = validateHtml('<div nb-var:a="name + 1" nb-var:name="2"></div>');
            expect(diags.filter(d => d.message.includes('ReferenceError'))).toHaveLength(0);
        });

        it('ignores sibling names inside string literals', () => {
            const diags = validateHtml('<div nb-var:a="\'use b later\'" nb-var:b="2"></div>');
            expect(diags).toHaveLength(0);
        });

        it('ignores arrow-function parameters shadowing a sibling name', () => {
            const diags = validateHtml('<div nb-var:a="[1, 2].map(b => b)" nb-var:b="2"></div>');
            expect(diags).toHaveLength(0);
        });

        it('does not confuse member access (this.b) with a sibling reference', () => {
            const diags = validateHtml('<div nb-var:a="this.b" nb-var:b="2"></div>');
            expect(diags).toHaveLength(0);
        });

        it('skips @-constant nb-var values (never evaluated)', () => {
            const diags = validateHtml('<div nb-var:a="@b + 1" nb-var:b="2"></div>');
            expect(diags).toHaveLength(0);
        });

        it('excludes reserved-named siblings (the runtime never creates them)', () => {
            // nb-var:item is rejected by the Variables handler — 'item' in
            // the first var is a repeat-param/scope question, not var order.
            const diags = validateHtml('<div nb-var:a="item" nb-var:item="2"></div>');
            expect(diags.filter(d => d.message.includes('ReferenceError'))).toHaveLength(0);
        });

        it('excludes transformer-named siblings (rejected at runtime, resolve as functions)', () => {
            const transformerSource = `
                @Transformer()
                class Localize {
                    transform(value: string): string { return value; }
                }
            `;
            analyzer.analyzeSourceText('/test/localize.ts', transformerSource);
            const diags = validateHtml('<div nb-var:a="localize(1)" nb-var:localize="2"></div>');
            expect(diags.filter(d => d.message.includes('ReferenceError'))).toHaveLength(0);
        });

        it('anchors the diagnostic on the referenced identifier', () => {
            const html = '<div nb-var:a="1 + b" nb-var:b="2"></div>';
            const diags = validateHtml(html);
            const diag = diags.find(d => d.message.includes('ReferenceError'));
            expect(diag).toBeDefined();
            // Value starts after `nb-var:a="`; 'b' is at offset 4 within it
            const doc = createMockDocument(html);
            const expectedStart = doc.positionAt(html.indexOf('1 + b') + 4);
            expect(diag.range.start.line).toBe(expectedStart.line);
            expect(diag.range.start.character).toBe(expectedStart.character);
        });

        it('resolves kebab-case var names to camelCase before matching', () => {
            const diags = validateHtml('<div nb-var:a="myValue" nb-var:my-value="2"></div>');
            const diag = diags.find(d => d.message.includes('ReferenceError'));
            expect(diag).toBeDefined();
            expect(diag.message).toContain("'myValue'");
        });

        // The first var's params include the enclosing repeat's context
        // params — a sibling var shadowing a prefixed repeat param name is
        // legally readable by the first var (it sees the repeat's value).
        it('does not warn when the name matches an enclosing prefixed repeat param', () => {
            const diags = validateHtml(
                '<div nb-repeat:outer="this.items"><span nb-var:a="outerItem" nb-var:outer-item="2"></span></div>'
            );
            expect(diags.filter(d => d.message.includes('ReferenceError'))).toHaveLength(0);
        });

        it('does not warn when the repeat is on the SAME element as the vars', () => {
            // The repeat clones the element; the clone's vars receive the
            // repeat params, so the first var reads outerIndex legally.
            const diags = validateHtml(
                '<li nb-repeat:outer="this.items" nb-var:a="outerIndex" nb-var:outer-index="0"></li>'
            );
            expect(diags.filter(d => d.message.includes('ReferenceError'))).toHaveLength(0);
        });

        it('still warns for repeat-param-like names with no enclosing repeat', () => {
            const diags = validateHtml('<span nb-var:a="outerItem" nb-var:outer-item="2"></span>');
            const diag = diags.find(d => d.message.includes('ReferenceError'));
            expect(diag).toBeDefined();
        });

        it('still reports Information for non-first vars shadowed by the pre-seeded map', () => {
            // From the second var on, the element's var map REPLACES
            // same-named params — outerItem is defined-but-undefined there.
            const diags = validateHtml(
                '<div nb-repeat:outer="this.items"><span nb-var:a="1" nb-var:b="outerItem" nb-var:outer-item="2"></span></div>'
            );
            const diag = diags.find(d => d.message.includes('still undefined'));
            expect(diag).toBeDefined();
            expect(diag.severity).toBe(vscode.DiagnosticSeverity.Information);
        });
    });
});

// ---- Round 4: runtime-shape checks + trim-aware prefixes ----
describe('nDiagnosticsProvider — round 4 fixes', () => {
    let analyzer: DecoratorAnalyzer;
    let diagnosticSet: jest.Mock;

    function createProvider() {
        const mockCollection = {
            name: Constants.INTERNAL_NAME,
            set: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn(),
            forEach: jest.fn(),
            get: jest.fn(),
            has: jest.fn(),
        };
        diagnosticSet = mockCollection.set;
        (vscode.languages.createDiagnosticCollection as jest.Mock).mockReturnValue(mockCollection);
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string, defaultValue?: any) => defaultValue),
        });
        return new nDiagnosticsProvider(analyzer);
    }

    function setupAssoc(): string {
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer { items: string[] = []; v: string = ''; }
        `);
        return analyzer.getAllAssociations()[0]!.htmlFilePath!;
    }

    function diagsFor(html: string, withAssoc = true): any[] {
        const htmlPath = withAssoc ? setupAssoc() : '/test/template.html';
        const provider = createProvider();
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        return diagnosticSet.mock.calls[0][1];
    }

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
    });

    describe('L1: runtime trims values before prefix detection', () => {
        it('treats " @literal" as a constant — no member warnings inside it', () => {
            const diags = diagsFor('<div nb-value=" @this.nonExistent is prose"></div>');
            expect(diags.filter(d => d.message.includes('nonExistent'))).toHaveLength(0);
        });

        it('treats " @item" as a constant — no repeat-param warning', () => {
            const diags = diagsFor('<div nb-value=" @item"></div>');
            expect(diags.filter(d => d.message.includes('repeat parameter'))).toHaveLength(0);
        });

        it('still validates " #expr" (single-bind stays evaluated) with an exact range', () => {
            const html = '<div nb-value=" #this.nonExistent"></div>';
            const diags = diagsFor(html);
            const diag = diags.find(d => d.message.includes('nonExistent'));
            expect(diag).toBeDefined();
            // Range must point at `this.nonExistent`, honoring the
            // whitespace+prefix offset (valueSpan.start + expressionOffset).
            expect(diag.range.start.character).toBe(html.indexOf('this.nonExistent'));
        });
    });

    describe('L8: shape checks for silent/fatal runtime patterns', () => {
        it('warns on an nb-repeat prefix that is not a valid identifier after lowercasing', () => {
            const diags = diagsFor('<div nb-repeat:my-list="this.items"></div>');
            const diag = diags.find(d => d.message.includes('not valid JavaScript identifiers'));
            expect(diag).toBeDefined();
            expect(diag.severity).toBe(vscode.DiagnosticSeverity.Warning);
            expect(diag.message).toContain('my-listItem');
        });

        it('informs about browser lowercasing for a camelCase nb-repeat prefix', () => {
            const diags = diagsFor('<div nb-repeat:myList="this.items"></div>');
            const diag = diags.find(d => d.message.includes('lowercased by the browser'));
            expect(diag).toBeDefined();
            expect(diag.severity).toBe(vscode.DiagnosticSeverity.Information);
            expect(diag.message).toContain('mylistItem');
        });

        it('does not flag an all-lowercase nb-repeat prefix', () => {
            const diags = diagsFor('<div nb-repeat:outer="this.items"></div>');
            expect(diags.filter(d => d.message.includes('lowercased by the browser'))).toHaveLength(0);
            expect(diags.filter(d => d.message.includes('not valid JavaScript identifiers'))).toHaveLength(0);
        });

        it('warns on a camelCase nb-event suffix (subscription can never match the camelCase dispatch)', () => {
            const diags = diagsFor('<div nb-event:myEvent="this.v = \'1\'"></div>');
            const diag = diags.find(d => d.message.includes("subscribes to 'myevent'"));
            expect(diag).toBeDefined();
            expect(diag.severity).toBe(vscode.DiagnosticSeverity.Warning);
        });

        it('warns on a non-numeric debounce segment', () => {
            const diags = diagsFor('<div nb-event:click:abc="this.v = \'1\'"></div>');
            const diag = diags.find(d => d.message.includes('not a valid debounce value'));
            expect(diag).toBeDefined();
        });

        it('warns on a trailing empty debounce segment (nb-event:click:)', () => {
            const diags = diagsFor('<div nb-event:click:="this.v = \'1\'"></div>');
            expect(diags.some(d => d.message.includes('not a valid debounce value'))).toBe(true);
        });

        it('accepts a numeric debounce segment', () => {
            const diags = diagsFor('<div nb-event:click:300="this.v = \'1\'"></div>');
            expect(diags.filter(d => d.message.includes('debounce'))).toHaveLength(0);
        });

        it('warns on nb-default with a value (silently ignored by the runtime)', () => {
            const diags = diagsFor('<div nb-switch="this.v"><span nb-default="x"></span></div>');
            expect(diags.some(d => d.message.includes("'nb-default' must have no value"))).toBe(true);
        });

        it('does not warn on a bare nb-default', () => {
            const diags = diagsFor('<div nb-switch="this.v"><span nb-default></span></div>');
            expect(diags.filter(d => d.message.includes('must have no value'))).toHaveLength(0);
        });

        it('warns on a reserved nb-var name', () => {
            const diags = diagsFor('<div nb-var:element="1"></div>');
            expect(diags.some(d => d.message.includes('reserved context name'))).toBe(true);
        });

        it('warns on an nb-var name colliding with a transformer (case-insensitive)', () => {
            analyzer.analyzeSourceText('/test/container.ts', `
                import html from './template.html';
                @Container(html)
                class TestContainer { v: string = ''; }
            `);
            analyzer.analyzeSourceText('/test/fmt.ts', `
                @Transformer()
                class Fmt { transform(value: any) { return value; } }
            `);
            const htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
            const provider = createProvider();
            const doc = createMockDocument('<div nb-var:fmt="1"></div>', htmlPath);
            provider.validate(doc);
            const diags = diagnosticSet.mock.calls[0][1];
            expect(diags.some((d: any) => d.message.includes('collides with a registered @Transformer'))).toBe(true);
        });

        it('warns on an nb-var name that is not a valid identifier', () => {
            const diags = diagsFor('<div nb-var:my-2nd="1"></div>');
            const diag = diags.find(d => d.message.includes('not a valid JavaScript identifier'));
            expect(diag).toBeDefined();
            expect(diag.message).toContain('my-2nd');
        });
    });

    describe('M2: repeat prefixes in the var-order check use the runtime (lowercased) names', () => {
        it('a first var shadowing a LOWERCASED prefixed repeat param is not a ReferenceError', () => {
            // Runtime params of nb-repeat:myList are mylistItem/… — a sibling
            // var shadowing 'mylistItem' legally reads the repeat value.
            const diags = diagsFor(
                '<div nb-repeat:myList="this.items"><span nb-var:mylist-item="mylistItem" nb-var:b="1"></span></div>');
            expect(diags.filter(d => d.message.includes('ReferenceError'))).toHaveLength(0);
        });
    });
});

// ---- W3C compliance mode: full-chain diagnostics parity ----
// Every check consumes the parser's normalized binding, so these lock the
// whole raw-W3C-source → normalized-binding → diagnostic pipeline.
describe('nDiagnosticsProvider — W3C mode (data-nb-* / -- separator)', () => {
    let analyzer: DecoratorAnalyzer;
    let diagnosticSet: jest.Mock;

    function createProvider() {
        const mockCollection = {
            name: Constants.INTERNAL_NAME,
            set: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn(),
            forEach: jest.fn(),
            get: jest.fn(),
            has: jest.fn(),
        };
        diagnosticSet = mockCollection.set;
        (vscode.languages.createDiagnosticCollection as jest.Mock).mockReturnValue(mockCollection);
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string, defaultValue?: any) => defaultValue),
        });
        return new nDiagnosticsProvider(analyzer);
    }

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
    });

    function diagsFor(html: string, htmlPath?: string): any[] {
        const provider = createProvider();
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        return diagnosticSet.mock.calls[0][1];
    }

    function setupAssoc(): string {
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                name: string = '';
                items: string[] = [];
            }
        `);
        return analyzer.getAllAssociations()[0]!.htmlFilePath!;
    }

    it('flags unknown data-nb-* attributes', () => {
        const diags = diagsFor('<div data-nb-vlue="this.name"></div>');
        expect(diags.some(d => d.message.includes(`Unknown ${Constants.DISPLAY_NAME} attribute`))).toBe(true);
    });

    it('accepts a valid W3C template without warnings', () => {
        const htmlPath = setupAssoc();
        const diags = diagsFor(
            '<ul data-nb-repeat="this.items"><li data-nb-value="item" data-nb-event--click--300="this.name"></li></ul>',
            htmlPath);
        expect(diags).toHaveLength(0);
    });

    it('warns on data-nb-case without a parent switch', () => {
        const diags = diagsFor('<div data-nb-case="@a"></div>');
        expect(diags.some(d => d.message.includes('nb-switch'))).toBe(true);
    });

    it('warns on data-nb-default carrying a value', () => {
        const diags = diagsFor('<div data-nb-switch="this.x"><span data-nb-default="x"></span></div>');
        expect(diags.some(d => d.message.includes("must have no value"))).toBe(true);
    });

    it('flags an invalid W3C debounce segment (data-nb-event--click--x30)', () => {
        const diags = diagsFor('<div data-nb-event--click--x30="this.name"></div>');
        expect(diags.some(d => d.message.includes('not a valid debounce value'))).toBe(true);
    });

    it('flags bare item inside a PREFIXED W3C repeat (only outerItem exists)', () => {
        const htmlPath = setupAssoc();
        const diags = diagsFor('<ul data-nb-repeat--outer="this.items"><li data-nb-value="item"></li></ul>', htmlPath);
        expect(diags.some(d => d.message.includes("not inside an 'nb-repeat' scope"))).toBe(true);
    });

    it('accepts the prefixed params of a W3C repeat (outerItem)', () => {
        const htmlPath = setupAssoc();
        const diags = diagsFor('<ul data-nb-repeat--outer="this.items"><li data-nb-value="outerItem"></li></ul>', htmlPath);
        expect(diags).toHaveLength(0);
    });

    it('applies the var evaluation-order rule through W3C names', () => {
        const diags = diagsFor('<div data-nb-var--a="b" data-nb-var--b="1"></div>');
        const diag = diags.find(d => d.message.includes('ReferenceError'));
        expect(diag).toBeDefined();
        expect(diag.message).toContain("Move 'nb-var:a' after 'nb-var:b'");
    });

    it('flags a non-identifier W3C repeat prefix', () => {
        const diags = diagsFor('<div data-nb-repeat--my-2nd="this.name"></div>');
        expect(diags.some(d => d.message.includes('not valid JavaScript identifiers'))).toBe(true);
    });
});

// ---- Round 6: binding-shape (E1/E2/E3/E8) + element-trap (E9) diagnostics ----
describe('nDiagnosticsProvider — round-6 shape and trap checks', () => {
    let analyzer: DecoratorAnalyzer;
    let diagnosticSet: jest.Mock;

    function createProvider() {
        const mockCollection = {
            name: Constants.INTERNAL_NAME,
            set: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn(),
            forEach: jest.fn(),
            get: jest.fn(),
            has: jest.fn(),
        };
        diagnosticSet = mockCollection.set;
        (vscode.languages.createDiagnosticCollection as jest.Mock).mockReturnValue(mockCollection);
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string, defaultValue?: any) => defaultValue),
        });
        return new nDiagnosticsProvider(analyzer);
    }

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
    });

    function diagsFor(html: string): any[] {
        const provider = createProvider();
        const doc = createMockDocument(html);
        provider.validate(doc);
        return diagnosticSet.mock.calls[0][1];
    }

    describe('E2: dead suffix on non-suffix handlers', () => {
        it('flags nb-value:foo — the runtime drops the attribute entirely', () => {
            const diags = diagsFor('<div nb-value:foo="this.v"></div>');
            expect(diags.some(d => d.message.includes("does not take a ':' suffix"))).toBe(true);
        });

        it('flags every non-suffix handler carrying a suffix', () => {
            for (const name of ['nb-if', 'nb-html', 'nb-class', 'nb-style', 'nb-exec',
                                'nb-bound', 'nb-container', 'nb-switch', 'nb-case',
                                'nb-default', 'nb-template']) {
                const diags = diagsFor(`<div ${name}:x="v"></div>`);
                expect(diags.some(d => d.message.includes("does not take a ':' suffix"))).toBe(true);
            }
        });

        it('does not flag suffixes on real prefix handlers', () => {
            const diags = diagsFor(
                '<div nb-container="@Child" nb-event:click="this.f()" nb-repeat:outer="this.rows" nb-in:user="this.u" nb-var:total="1" nb-aspect:tooltip="@hi" nb-attr:disabled="this.d" nb-prop:checked="this.c"></div>');
            expect(diags.filter(d => d.message.includes("does not take a ':' suffix"))).toHaveLength(0);
        });

        it('the dead attribute produces no follow-up shape diagnostics', () => {
            // nb-template:x with a non-'@' value: only the dead-suffix warning,
            // not the missing-'@' warning — the runtime never routes the value
            // to the Template handler at all.
            const diags = diagsFor('<div nb-template:x="this.v"></div>');
            expect(diags).toHaveLength(1);
        });
    });

    describe('E9: empty values', () => {
        it('flags empty-valued handlers the runtime drops with "should have value"', () => {
            for (const attr of ['nb-value=""', 'nb-if=""', 'nb-in:x=""', 'nb-event:click=""',
                                'nb-container=""', 'nb-repeat=""', 'nb-exec']) {
                const diags = diagsFor(`<div ${attr}></div>`);
                expect(diags.some(d => d.message.includes('should have value'))).toBe(true);
            }
        });

        it('does not flag the value-less-allowed attributes', () => {
            const diags = diagsFor('<div nb-default nb-projection nb-project-to nb-project-instead nb-component nb-aspect:tooltip></div>');
            expect(diags.filter(d => d.message.includes('should have value'))).toHaveLength(0);
        });
    });

    describe('E1: invalid expression prefixes', () => {
        it("flags nb-bound=\"@ping\" — the runtime's unconditional '#' makes '#@ping', which never compiles", () => {
            const diags = diagsFor('<div nb-bound="@ping"></div>');
            expect(diags.some(d => d.message.includes('never compiles'))).toBe(true);
        });

        it('does not flag plain or #-prefixed nb-bound', () => {
            expect(diagsFor('<div nb-bound="this.el = nativeElement"></div>')).toHaveLength(0);
            expect(diagsFor('<div nb-bound="#this.init()"></div>')).toHaveLength(0);
        });

        it('flags a whole-value # on nb-style (folds into the first property name)', () => {
            const diags = diagsFor('<div nb-style="#opacity: 1"></div>');
            expect(diags.some(d => d.message.includes('whole-value prefix'))).toBe(true);
        });

        it('does not flag the per-entry # syntax on nb-style', () => {
            expect(diagsFor('<div nb-style="opacity: #this.o; color: red"></div>')).toHaveLength(0);
        });

        it('flags # before the nb-class array form', () => {
            const diags = diagsFor('<div nb-class="#[this.a; this.b]"></div>');
            expect(diags.some(d => d.message.includes('format detection'))).toBe(true);
        });

        it('flags @ before the nb-class conditional form', () => {
            const diags = diagsFor('<div nb-class="@{active: true}"></div>');
            expect(diags.some(d => d.message.includes('format detection'))).toBe(true);
        });

        it('does not flag prefixes on the nb-class simple form', () => {
            expect(diagsFor('<div nb-class="#this.cls"></div>')).toHaveLength(0);
            expect(diagsFor('<div nb-class="@my-static-class"></div>')).toHaveLength(0);
        });

        it("flags '%' on non-container handlers (guaranteed SyntaxError)", () => {
            for (const attr of ['nb-value="%foo"', 'nb-if="%slot"', 'nb-exec=" %x"']) {
                const diags = diagsFor(`<div ${attr}></div>`);
                expect(diags.some(d => d.message.includes('route slot'))).toBe(true);
            }
        });

        it("does not flag '%' on nb-container or modulo expressions", () => {
            expect(diagsFor('<div nb-container="%tab"></div>')).toHaveLength(0);
            expect(diagsFor('<div nb-value="this.a % 2"></div>')).toHaveLength(0);
        });
    });

    describe('E3: nb-template requires @', () => {
        it('flags nb-template with an expression value — the runtime never evaluates it', () => {
            const diags = diagsFor('<div nb-template="this.tpl"></div>');
            expect(diags.some(d => d.message.includes("template name should start with '@'"))).toBe(true);
        });

        it('does not flag nb-template="@icon"', () => {
            expect(diagsFor('<div nb-template="@icon"></div>')).toHaveLength(0);
        });
    });

    describe('E8: blocked nb-attr / nb-prop targets', () => {
        it('flags nb-attr:class and nb-attr:style', () => {
            expect(diagsFor('<div nb-attr:class="this.c"></div>')
                .some(d => d.message.includes("use 'nb-class'"))).toBe(true);
            expect(diagsFor('<div nb-attr:style="this.s"></div>')
                .some(d => d.message.includes("use 'nb-style'"))).toBe(true);
        });

        it('flags framework-reserved nb-attr targets (both spellings)', () => {
            expect(diagsFor('<div nb-attr:nb-value="this.v"></div>')
                .some(d => d.message.includes('framework-reserved'))).toBe(true);
            expect(diagsFor('<div nb-attr:data-nb-if="this.v"></div>')
                .some(d => d.message.includes('framework-reserved'))).toBe(true);
        });

        it('does not flag ordinary nb-attr targets', () => {
            expect(diagsFor('<div nb-attr:disabled="this.d" nb-attr:aria-label="this.l"></div>')).toHaveLength(0);
        });

        it('flags every blocked nb-prop target including outerHTML', () => {
            for (const suffix of ['class-name', 'class-list', 'style', 'text-content',
                                  'inner-text', 'inner-h-t-m-l', 'outer-h-t-m-l', 'innerhtml']) {
                const diags = diagsFor(`<div nb-prop:${suffix}="this.v"></div>`);
                expect(diags.some(d => d.message.includes('runtime rejects'))).toBe(true);
            }
        });

        it('does not flag ordinary nb-prop targets', () => {
            expect(diagsFor('<div nb-prop:value="this.v" nb-prop:selected-index="this.i"></div>')).toHaveLength(0);
        });
    });

    describe('E9: element-level traps', () => {
        it('flags duplicate nb-event subscriptions (debounce variant collides too)', () => {
            const diags = diagsFor('<button nb-event:click="this.a()" nb-event:click:300="this.b()"></button>');
            expect(diags.filter(d => d.message.includes("subscribe to 'click'"))).toHaveLength(2);
        });

        it('does not flag different events on one element', () => {
            const diags = diagsFor('<button nb-event:click="this.a()" nb-event:input="this.b()"></button>');
            expect(diags.filter(d => d.message.includes('subscribe to'))).toHaveLength(0);
        });

        it('flags nb-in + nb-in-ref for the same (camelCased) input — nb-in silently loses', () => {
            const diags = diagsFor('<div nb-container="@C" nb-in:user-data="this.a" nb-in-ref:user-data="this.b"></div>');
            const collisions = diags.filter(d => d.message.includes("also bound with 'nb-in-ref'"));
            expect(collisions).toHaveLength(1);
            expect(collisions[0].message).toContain("'userData'");
        });

        it('does not flag distinct input names', () => {
            const diags = diagsFor('<div nb-container="@C" nb-in:a="this.a" nb-in-ref:b="this.b"></div>');
            expect(diags.filter(d => d.message.includes("also bound with 'nb-in-ref'"))).toHaveLength(0);
        });

        it('flags inputs on a plain element with no container and no component', () => {
            const diags = diagsFor('<div nb-in:user="this.u"></div>');
            expect(diags.some(d => d.message.includes('never consumed'))).toBe(true);
        });

        it('does not flag inputs next to nb-container or on dashed custom-element tags', () => {
            expect(diagsFor('<div nb-container="@Child" nb-in:user="this.u"></div>')).toHaveLength(0);
            expect(diagsFor('<user-card nb-in:user="this.u"></user-card>')).toHaveLength(0);
        });

        it('does not flag inputs on a registered dash-less component tag', () => {
            analyzer.analyzeSourceText('/test/widget.ts', `
                @Component('<div></div>')
                class Widget { }
            `);
            const provider = createProvider();
            const doc = createMockDocument('<widget nb-in:user="this.u"></widget>');
            provider.validate(doc);
            const diags = diagnosticSet.mock.calls[0][1];
            expect(diags.filter((d: any) => d.message.includes('never consumed'))).toHaveLength(0);
        });
    });
});

// ---- Round 7: N-applicability parent rule + bare prefix-handler suffixes ----
describe('nDiagnosticsProvider — round-7 fixes', () => {
    let analyzer: DecoratorAnalyzer;
    let diagnosticSet: jest.Mock;

    function createProvider() {
        const mockCollection = {
            name: Constants.INTERNAL_NAME,
            set: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn(),
            forEach: jest.fn(),
            get: jest.fn(),
            has: jest.fn(),
        };
        diagnosticSet = mockCollection.set;
        (vscode.languages.createDiagnosticCollection as jest.Mock).mockReturnValue(mockCollection);
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn((key: string, defaultValue?: any) => defaultValue),
        });
        return new nDiagnosticsProvider(analyzer);
    }

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
    });

    function diagsFor(html: string): any[] {
        const provider = createProvider();
        const doc = createMockDocument(html);
        provider.validate(doc);
        return diagnosticSet.mock.calls[0][1];
    }

    const directChildDiags = (diags: any[]) =>
        diags.filter((d: any) => d.message.includes('direct child'));

    describe('R7-1: nb-case parent must be the nearest N-APPLICABLE ancestor', () => {
        it('a projection-slot wrapper (nb-project-to) is transparent — no false positive', () => {
            // The projection trio lives in KNOWN_HANDLER_EXTENSIONS, which
            // Attributes.isNApplicable never consults — at runtime the case's
            // NElement parent IS the switch and the markup works.
            const diags = diagsFor(
                '<div nb-switch="this.v"><div nb-project-to="@s"><span nb-case="@1">a</span></div></div>');
            expect(directChildDiags(diags)).toHaveLength(0);
        });

        it('an nb-projection wrapper is transparent too', () => {
            const diags = diagsFor(
                '<div nb-switch="this.v"><div nb-projection><span nb-case="@1">a</span></div></div>');
            expect(directChildDiags(diags)).toHaveLength(0);
        });

        it('a registered component tag between switch and case makes the case inert — flagged', () => {
            analyzer.analyzeSourceText('/test/comp.ts', `
                @Component(['my-comp', '<div></div>'])
                class MyComp { }
            `);
            const diags = diagsFor(
                '<div nb-switch="this.v"><my-comp><span nb-case="@1">a</span></my-comp></div>');
            expect(directChildDiags(diags)).toHaveLength(1);
        });

        it('a component host CARRYING nb-switch is a valid parent — not flagged', () => {
            analyzer.analyzeSourceText('/test/comp.ts', `
                @Component(['my-comp', '<div></div>'])
                class MyComp { }
            `);
            const diags = diagsFor(
                '<my-comp nb-switch="this.v"><span nb-case="@1">a</span></my-comp>');
            expect(directChildDiags(diags)).toHaveLength(0);
        });

        it('an UNREGISTERED dashed tag is transparent (conservative, matches the components registry)', () => {
            const diags = diagsFor(
                '<div nb-switch="this.v"><swiper-thing><span nb-case="@1">a</span></swiper-thing></div>');
            expect(directChildDiags(diags)).toHaveLength(0);
        });

        it('an unknown attribute that startsWith a prefix handler still grants applicability (runtime quirk)', () => {
            // 'nb-index'.indexOf('nb-in') === 0 — the runtime's plain
            // startsWith check makes this wrapper applicable, so the case IS
            // inert. (The wrapper also gets its own unknown-attribute warning.)
            const diags = diagsFor(
                '<div nb-switch="this.v"><div nb-index="x"><span nb-case="@1">a</span></div></div>');
            expect(directChildDiags(diags)).toHaveLength(1);
        });

        it('an unknown attribute with no prefix-handler match does NOT grant applicability', () => {
            const diags = diagsFor(
                '<div nb-switch="this.v"><div nb-zoo="x"><span nb-case="@1">a</span></div></div>');
            expect(directChildDiags(diags)).toHaveLength(0);
        });

        it('a dead suffixed spelling (nb-value:foo) does not grant applicability', () => {
            // The runtime drops 'nb-value:foo' entirely (E2) — it is not in
            // KNOWN_HANDLERS_SET and matches no prefix handler, so the
            // wrapper stays transparent and the case works.
            const diags = diagsFor(
                '<div nb-switch="this.v"><div nb-value:foo="x"><span nb-case="@1">a</span></div></div>');
            expect(directChildDiags(diags)).toHaveLength(0);
        });

        it('still flags a case separated by a genuinely applicable element (regression)', () => {
            const diags = diagsFor(
                '<div nb-switch="this.v"><section nb-if="this.x"><span nb-case="@1">a</span></section></div>');
            expect(directChildDiags(diags)).toHaveLength(1);
        });

        it('W3C spellings behave identically (data-nb-project-to transparent)', () => {
            const diags = diagsFor(
                '<div data-nb-switch="this.v"><div data-nb-project-to="@s"><span data-nb-case="@1">a</span></div></div>');
            expect(directChildDiags(diags)).toHaveLength(0);
        });
    });

    describe('R7-4: prefix handlers without a suffix are silently dead', () => {
        const missingSuffix = (diags: any[]) =>
            diags.filter((d: any) => d.message.includes('missing its'));

        it('flags bare nb-event (forgotten event name)', () => {
            const diags = diagsFor('<button nb-event="this.onClick()"></button>');
            const flagged = missingSuffix(diags);
            expect(flagged).toHaveLength(1);
            expect(flagged[0].message).toContain("'nb-event:click");
        });

        it('flags bare nb-in / nb-in-ref / nb-prop / nb-attr / nb-var', () => {
            const diags = diagsFor(
                '<div nb-in="this.a" nb-in-ref="this.b" nb-prop="this.c" nb-attr="this.d" nb-var="this.e"></div>');
            expect(missingSuffix(diags)).toHaveLength(5);
        });

        it('flags bare nb-aspect with and without a value (no aspect is named)', () => {
            expect(missingSuffix(diagsFor('<div nb-aspect="this.cfg"></div>'))).toHaveLength(1);
            expect(missingSuffix(diagsFor('<div nb-aspect></div>'))).toHaveLength(1);
        });

        it('does not flag bare nb-repeat (the one prefix handler that accepts it)', () => {
            expect(missingSuffix(diagsFor('<div nb-repeat="this.items"></div>'))).toHaveLength(0);
        });

        it('does not flag suffixed spellings (regression: nb-aspect:tooltip value-less)', () => {
            expect(missingSuffix(diagsFor('<div nb-aspect:tooltip nb-event:click="this.a()"></div>'))).toHaveLength(0);
        });

        it('empty value takes precedence — nb-event="" reports the empty value, not the suffix', () => {
            const diags = diagsFor('<button nb-event=""></button>');
            expect(missingSuffix(diags)).toHaveLength(0);
            expect(diags.some((d: any) => d.message.includes('empty value'))).toBe(true);
        });

        it('flags the W3C spelling too (data-nb-event)', () => {
            expect(missingSuffix(diagsFor('<button data-nb-event="this.a()"></button>'))).toHaveLength(1);
        });
    });
});
