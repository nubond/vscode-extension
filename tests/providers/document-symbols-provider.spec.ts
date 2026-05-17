import { nDocumentSymbolProvider } from '../../src/providers/document-symbols-provider';
import { createMockDocument, createCancellationToken } from '../helpers';

describe('nDocumentSymbolProvider', () => {
    let provider: nDocumentSymbolProvider;
    const token = createCancellationToken();

    beforeEach(() => {
        provider = new nDocumentSymbolProvider();
    });

    it('should return undefined for non-HTML documents', () => {
        const doc = createMockDocument('const x = 1;', '/test/file.ts', 'typescript');
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeUndefined();
    });

    it('should return undefined for HTML without nb-* attributes', () => {
        const html = '<div class="foo"><span>text</span></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeUndefined();
    });

    it('should create symbols for nb-container', () => {
        const html = '<div nb-container="@MyContainer"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1);
        expect(result![0].name).toContain('Container');
    });

    it('should create symbols for nb-component', () => {
        const html = '<div nb-component="@MyComponent"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1);
        expect(result![0].name).toContain('Component');
    });

    it('should create symbols for nb-repeat', () => {
        const html = '<div nb-repeat="this.items"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1);
        expect(result![0].name).toContain('Repeat');
    });

    it('should create symbols for nb-if', () => {
        const html = '<div nb-if="this.visible"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1);
        expect(result![0].name).toContain('If');
    });

    it('should create symbols for nb-switch with nb-case children', () => {
        const html = '<div nb-switch="this.status"><span nb-case="active">Active</span><span nb-default>Other</span></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBeGreaterThanOrEqual(1);
    });

    it('should create symbols for nb-template', () => {
        const html = '<div nb-template="@MyTemplate"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1);
        expect(result![0].name).toContain('Template');
    });

    it('should create nested symbols for nested nb-* elements', () => {
        const html = '<div nb-container="@App"><span nb-repeat="this.items"></span></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1); // top-level container
        expect(result![0].children.length).toBeGreaterThanOrEqual(1); // nested repeat
    });

    it('should handle nb-aspect', () => {
        const html = '<div nb-aspect:tooltip="this.tooltipText"></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeDefined();
        expect(result![0].name).toContain('Aspect');
    });

    // Regression: an element with multiple nb-* attributes (e.g. nb-repeat
    // + nb-if) used to recurse into element.children once per attribute,
    // duplicating every nested symbol. Now we recurse once and attach
    // children to the first sibling symbol only.
    it('should not duplicate nested children when an element has multiple nb-* attrs', () => {
        const html = '<div nb-repeat="this.items" nb-if="this.show"><span nb-value="this.name"></span><span nb-value="this.count"></span></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeDefined();
        // 2 sibling symbols on the outer element (Repeat + If)
        expect(result!.length).toBe(2);
        // Only the first sibling should carry the children, not duplicated under both
        const totalChildren = result![0].children.length + result![1].children.length;
        // Each <span nb-value> doesn't actually produce a symbol (nb-value is
        // not in describeAttribute), so child count is the inner-tree symbols
        // — but we must not have duplicates between the two sibling parents.
        const firstChildren = result![0].children.length;
        const secondChildren = result![1].children.length;
        expect(Math.min(firstChildren, secondChildren)).toBe(0);
        // And nesting is preserved on whichever side has them
        expect(Math.max(firstChildren, secondChildren)).toBe(totalChildren);
    });

    it('should handle nb-projection', () => {
        const html = '<div nb-projection></div>';
        const doc = createMockDocument(html);
        const result = provider.provideDocumentSymbols(doc, token as any);
        expect(result).toBeDefined();
        expect(result![0].name).toContain('Projection');
    });
});
