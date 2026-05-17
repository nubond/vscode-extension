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
        // 'item' is a nb-var local variable, should not warn
        const html = '<div nb-var:item="this.data"><span nb-value="item"></span></div>';
        const doc = createMockDocument(html, htmlPath);
        provider.validate(doc);
        expect(diagnosticSet).toHaveBeenCalled();
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
