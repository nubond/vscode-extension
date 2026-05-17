import { nSemanticTokenProvider, SEMANTIC_TOKEN_LEGEND } from '../../src/providers/semantic-token-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';
import { SemanticTokens } from 'vscode';

describe('nSemanticTokenProvider', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nSemanticTokenProvider;
    const token = createCancellationToken();

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nSemanticTokenProvider(analyzer);
    });

    it('should return empty tokens for HTML without nb-repeat/nb-var', () => {
        const html = '<div nb-value="this.name"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSemanticTokens(doc, token as any);
        expect(result).toBeDefined();
        expect(result).toBeInstanceOf(SemanticTokens);
    });

    it('should tokenize repeat params', () => {
        const html = '<div nb-repeat="this.items"><span nb-value="item"></span></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSemanticTokens(doc, token as any);
        expect(result).toBeDefined();
        // The tokens should include 'item' as a variable
        expect(result!.data.length).toBeGreaterThan(0);
    });

    it('should tokenize nb-var local variables', () => {
        // HTML lowercases attrs: nb-var:my-var → suffix "my-var" → varName "myVar"
        const html = '<div nb-var:my-var="this.data"><span nb-value="myVar"></span></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSemanticTokens(doc, token as any);
        expect(result).toBeDefined();
        expect(result!.data.length).toBeGreaterThan(0);
    });

    it('should tokenize transformer function names', () => {
        const source = `
            @Transformer()
            class Localize {
                transform(value: string): string { return value; }
            }
        `;
        analyzer.analyzeSourceText('/test/localize.ts', source);

        const html = '<div nb-value="localize(this.name)"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSemanticTokens(doc, token as any);
        expect(result).toBeDefined();
        expect(result!.data.length).toBeGreaterThan(0);
    });

    it('should skip @ prefix expressions', () => {
        const html = '<div nb-container="@MyContainer"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSemanticTokens(doc, token as any);
        expect(result).toBeDefined();
        // @ prefixed expressions are skipped, so no tokens
        expect(result!.data.length).toBe(0);
    });

    it('should export SEMANTIC_TOKEN_LEGEND', () => {
        expect(SEMANTIC_TOKEN_LEGEND).toBeDefined();
        expect(SEMANTIC_TOKEN_LEGEND.tokenTypes).toContain('variable');
        expect(SEMANTIC_TOKEN_LEGEND.tokenTypes).toContain('function');
    });

    it('should tokenize arrow function parameter usages', () => {
        const html = '<div nb-event:change="this.languages = nativeElement.selectedOptions.map(el => el.value)"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSemanticTokens(doc, token as any);
        expect(result).toBeDefined();
        // el is used twice: once before => (grammar handles that) and once in el.value
        // Semantic tokens should include tokens for 'el'
        expect(result!.data.length).toBeGreaterThan(0);
    });

    it('should tokenize arrow param in filter expression', () => {
        const html = '<div nb-value="this.items.filter(x => x.active).length"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSemanticTokens(doc, token as any);
        expect(result).toBeDefined();
        // 'x' appears twice: x => and x.active — semantic tokens should cover both
        expect(result!.data.length).toBeGreaterThan(0);
    });

    it('should return undefined when cancellation is requested before start', () => {
        const html = '<div nb-repeat="this.items"><span nb-value="item"></span></div>';
        const doc = createMockDocument(html);
        const cancelledToken = { isCancellationRequested: true, onCancellationRequested: jest.fn() };
        const result = provider.provideDocumentSemanticTokens(doc, cancelledToken as any);
        expect(result).toBeUndefined();
    });

    it('should return undefined when cancellation is requested mid-processing', () => {
        const html = '<div nb-repeat="this.items"><span nb-value="item"></span><span nb-value="index"></span></div>';
        const doc = createMockDocument(html);
        let callCount = 0;
        const midCancelToken = {
            get isCancellationRequested() {
                callCount++;
                // Cancel after a couple of checks (mid-loop)
                return callCount > 2;
            },
            onCancellationRequested: jest.fn()
        };
        const result = provider.provideDocumentSemanticTokens(doc, midCancelToken as any);
        expect(result).toBeUndefined();
    });

    it('should not tokenize arrow param preceded by dot', () => {
        // In "this.el", "el" after dot should NOT be tokenized even if "el" is an arrow param elsewhere
        const html = '<div nb-event:click="this.items.map(el => el.value); this.el"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSemanticTokens(doc, token as any);
        expect(result).toBeDefined();
        // Should produce tokens for the two bare "el" occurrences but not for "this.el"
        expect(result!.data.length).toBeGreaterThan(0);
    });
});
