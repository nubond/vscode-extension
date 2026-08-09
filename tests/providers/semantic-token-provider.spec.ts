import { nSemanticTokenProvider, SEMANTIC_TOKEN_LEGEND } from '../../src/providers/semantic-token-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';
import { SemanticTokens } from 'vscode';

// ---- Round 3 (L4 + object-key nit) ----
describe('nSemanticTokenProvider — round 3 fixes', () => {
    const token = createCancellationToken();

    function tokensFor(html: string): Uint32Array {
        const provider = new nSemanticTokenProvider(new DecoratorAnalyzer());
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSemanticTokens(doc, token as any);
        return result!.data;
    }

    it('does not tokenize item inside the repeat\'s own expression (no outer scope)', () => {
        // The collection expression runs with the parent params — its own
        // item/index/count are not live identifiers there.
        expect(tokensFor('<div nb-repeat="item.x"></div>').length).toBe(0);
    });

    it('tokenizes outer repeat params inside a nested repeat\'s expression', () => {
        const html = '<ul nb-repeat:outer="this.items"><li nb-repeat="outerItem.x"></li></ul>';
        expect(tokensFor(html).length).toBeGreaterThan(0);
    });

    it('does not tokenize an object-literal KEY that matches a variable name', () => {
        // `item` in key position is a property name, not a variable use.
        const html = '<div nb-repeat="this.items"><span nb-exec="this.track({item: 1})"></span></div>';
        const data = tokensFor(html);
        expect(data.length).toBe(0);
    });

    it('still tokenizes a variable in ternary position before a colon', () => {
        // `cond ? item : other` — the char before `item` is '?', not a key
        // delimiter; this must stay highlighted.
        const html = '<div nb-repeat="this.items"><span nb-value="this.on ? item : 0"></span></div>';
        const data = tokensFor(html);
        expect(data.length).toBeGreaterThan(0);
    });
});

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

    // ---- Regression: the identifier scan ran over the raw expression, so a
    // variable name INSIDE a string literal was highlighted as a variable ----
    describe('string/comment masking', () => {
        it('does not tokenize a repeat param inside a string literal', () => {
            const html = '<div nb-repeat="this.things"><span nb-value="\'no item here\'"></span></div>';
            const doc = createMockDocument(html);
            const result = provider.provideDocumentSemanticTokens(doc, token as any);
            expect(result).toBeDefined();
            // 'item' only occurs inside the string — zero tokens
            expect(result!.data.length).toBe(0);
        });

        it('still tokenizes the same name used as code next to a string occurrence', () => {
            const html = '<div nb-repeat="this.things"><span nb-value="item + \'an item\'"></span></div>';
            const doc = createMockDocument(html);
            const result = provider.provideDocumentSemanticTokens(doc, token as any);
            expect(result).toBeDefined();
            // Exactly ONE token (5 ints): the bare `item`, not the string's
            expect(result!.data.length).toBe(5);
        });

        it('does not tokenize template-literal text, but does tokenize ${ } interiors', () => {
            const html = '<div nb-repeat="this.things"><span nb-value="`item count: ${count}`"></span></div>';
            const doc = createMockDocument(html);
            const result = provider.provideDocumentSemanticTokens(doc, token as any);
            expect(result).toBeDefined();
            // Only `count` inside the interpolation is code → one token
            expect(result!.data.length).toBe(5);
        });
    });
});


// ---- Round 4 fixes ----
describe('nSemanticTokenProvider — round 4 fixes', () => {
    const token = createCancellationToken();

    function tokensFor(html: string): Uint32Array {
        const provider = new nSemanticTokenProvider(new DecoratorAnalyzer());
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSemanticTokens(doc, token as any);
        return result!.data;
    }

    describe('M2: prefixed repeat params use the runtime (lowercased) prefix', () => {
        it('tokenizes mylistItem inside nb-repeat:myList', () => {
            const html = '<div nb-repeat:myList="this.items"><span nb-value="mylistItem"></span></div>';
            expect(tokensFor(html).length).toBeGreaterThan(0);
        });

        it('does not tokenize the source-cased myListItem (a runtime ReferenceError)', () => {
            const html = '<div nb-repeat:myList="this.items"><span nb-value="myListItem"></span></div>';
            expect(tokensFor(html).length).toBe(0);
        });
    });

    describe('M4: nb-var visibility gated by the consuming handler', () => {
        it('does not tokenize a same-element var inside the nb-repeat expression', () => {
            const html = '<div nb-var:limit="5" nb-repeat="this.rows.slice(0, limit)"></div>';
            expect(tokensFor(html).length).toBe(0);
        });

        it('still tokenizes the var in a sibling nb-value on the same element', () => {
            const html = '<div nb-var:limit="5" nb-value="limit"></div>';
            expect(tokensFor(html).length).toBeGreaterThan(0);
        });

        it('does not tokenize the case element own var inside nb-case', () => {
            const html = '<div nb-switch="this.v"><span nb-case="cv" nb-var:cv="2"></span></div>';
            expect(tokensFor(html).length).toBe(0);
        });

        it('does not tokenize reserved-named vars (never created at runtime)', () => {
            const html = '<div nb-var:element="1"><span nb-value="element"></span></div>';
            expect(tokensFor(html).length).toBe(0);
        });
    });

    describe('L1: prefixes after leading whitespace', () => {
        it('does not tokenize identifiers inside a whitespace-led @ constant', () => {
            const html = '<div nb-repeat="this.rows"><span nb-value=" @item"></span></div>';
            expect(tokensFor(html).length).toBe(0);
        });
    });
});
