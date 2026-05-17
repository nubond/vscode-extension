/**
 * Reproduction tests for: "after picking nb-event, no event suggestions appear
 * and subsequent completion/hover break".
 */
import { nCompletionProvider } from '../../src/providers/completion-provider';
import { nHoverProvider } from '../../src/providers/hover-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken, asCompletionItems } from '../helpers';
import { CompletionItem, CompletionList } from 'vscode';

describe('Bug repro: nb-event: completion', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nCompletionProvider;
    let hoverProvider: nHoverProvider;
    let htmlPath: string;
    const token = createCancellationToken();
    const context = { triggerKind: 0, triggerCharacter: undefined };

    const containerSource = `
        import html from './template.html';
        @Container(html)
        class TestContainer {
            name: string = '';
        }
    `;

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nCompletionProvider(analyzer);
        hoverProvider = new nHoverProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
    });

    function completions(html: string, cursorOffset: number): CompletionItem[] | undefined {
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(cursorOffset);
        const result = provider.provideCompletionItems(doc, pos, token as any, context as any);
        return asCompletionItems(result as CompletionList | CompletionItem[] | undefined);
    }

    it('realistic template: <button nb-event:>Submit</button> cursor after :', () => {
        const html = '<button nb-event:>Submit</button>';
        const cursorOffset = '<button nb-event:'.length;
        const items = completions(html, cursorOffset);
        expect(items).toBeDefined();
        const labels = items!.map(i => i.label);
        expect(labels).toContain('click');
        expect(labels).toContain('input');
    });

    it('multi-line template with realistic content', () => {
        const html = [
            '<!DOCTYPE html>',
            '<html>',
            '  <body>',
            '    <button nb-event:>Submit</button>',
            '  </body>',
            '</html>',
        ].join('\n');
        const cursorOffset = html.indexOf('nb-event:') + 'nb-event:'.length;
        const items = completions(html, cursorOffset);
        expect(items).toBeDefined();
        const labels = items!.map(i => i.label);
        expect(labels).toContain('click');
    });

    it('cursor after : with other attributes already on element', () => {
        const html = '<button class="btn" nb-event: id="save">Save</button>';
        const cursorOffset = html.indexOf('nb-event:') + 'nb-event:'.length;
        const items = completions(html, cursorOffset);
        expect(items).toBeDefined();
        const labels = items!.map(i => i.label);
        expect(labels).toContain('click');
    });

    it('cursor immediately after : with tab/newline continuation', () => {
        const html = '<button\n  nb-event:\n>Submit</button>';
        const cursorOffset = html.indexOf('nb-event:') + 'nb-event:'.length;
        const items = completions(html, cursorOffset);
        expect(items).toBeDefined();
        const labels = items!.map(i => i.label);
        expect(labels).toContain('click');
    });

    it('provider does NOT throw on hover after the problematic state', () => {
        const html = '<button nb-event:>Submit</button>';
        const doc = createMockDocument(html, htmlPath);

        // Hover over the "nb-event" attribute name
        const pos = doc.positionAt('<button nb-ev'.length);
        expect(() => {
            hoverProvider.provideHover(doc, pos, token as any);
        }).not.toThrow();
    });

    it('provider does NOT throw on completion in same doc', () => {
        const html = '<button nb-event:>Submit</button>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt('<button nb-event:'.length);
        expect(() => {
            provider.provideCompletionItems(doc, pos, token as any, context as any);
        }).not.toThrow();
    });

    // ---- After user picks an event name (nb-event:click=""), the follow-up edits shouldn't break hover/completion ----
    it('hover works on nb-event:click after event selected', () => {
        const html = '<button nb-event:click="this.handle()">Submit</button>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt('<button nb-ev'.length);
        const hover = hoverProvider.provideHover(doc, pos, token as any);
        expect(hover).toBeDefined();
    });

    // ---- Fix verification: completion returns CompletionList with isIncomplete: true ----
    it('returns a CompletionList with isIncomplete=true so VSCode re-invokes on each keystroke', () => {
        const html = '<button nb-event:>Submit</button>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt('<button nb-event:'.length);
        const result = provider.provideCompletionItems(doc, pos, token as any, context as any);
        expect(result).toBeDefined();
        // Must be a CompletionList (not a plain array) so isIncomplete can be set
        expect(Array.isArray(result)).toBe(false);
        const list = result as CompletionList;
        expect(list.isIncomplete).toBe(true);
        expect(list.items.length).toBeGreaterThan(0);
    });

    it('attribute-name context also returns isIncomplete list', () => {
        const html = '<button nb-e>Submit</button>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt('<button nb-e'.length);
        const result = provider.provideCompletionItems(doc, pos, token as any, context as any);
        expect(result).toBeDefined();
        const list = result as CompletionList;
        expect(list.isIncomplete).toBe(true);
    });

    // ---- Regression: nb-in-ref: must match as 'nb-in-ref' (not 'nb-in' with suffix '-ref') ----
    it('nb-in-ref: suggests propertyName completions (longer alternative wins)', () => {
        const html = '<div nb-in-ref:>content</div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt('<div nb-in-ref:'.length);
        const result = provider.provideCompletionItems(doc, pos, token as any, context as any);
        const items = asCompletionItems(result as CompletionList | CompletionItem[] | undefined);
        expect(items).toBeDefined();
        const labels = items!.map(i => i.label);
        // nb-in-ref and nb-in both surface a "propertyName" placeholder; the
        // important bit is that matching happens and suggestions are produced
        // (pre-fix the regex bound nb-in first and "-ref" would have been
        // parsed as the suffix, so no match would have been returned here).
        expect(labels).toContain('propertyName');
    });

    // ---- Defensive: provider must not throw/leak exceptions on weird input ----
    it('never throws on broken tag with trailing colon (defensive wrapping)', () => {
        const html = '<div nb-event:'; // no closing '>'
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.length);
        expect(() => {
            provider.provideCompletionItems(doc, pos, token as any, context as any);
        }).not.toThrow();
        expect(() => {
            hoverProvider.provideHover(doc, pos, token as any);
        }).not.toThrow();
    });

    // Regression: completion inside a large template with many preceding tags
    // must return quickly. The previous implementation scanned
    // `textBeforeCursor` with `<(\w[\w-]*)(?:\s|[^>])*$` — the `\s|[^>]`
    // alternation is ambiguous (every whitespace matches both sides), which
    // produced exponential backtracking and froze the whole extension.
    it('completion at nb-event: inside a long template returns in <200ms', () => {
        // Build a large template with many whitespace-heavy tags before the
        // broken `<div nb-event:`. 50 tags * ~100 chars each = ~5kB — enough
        // to trigger the catastrophic case.
        const filler = Array.from({ length: 50 }, (_, i) =>
            `    <div class="row row-${i}" id="r${i}" data-index="${i}" role="listitem">content ${i}</div>`
        ).join('\n');
        const html = `<section>\n${filler}\n    <div nb-event: class="body">x</div>\n</section>`;
        const doc = createMockDocument(html, htmlPath);
        const cursorOffset = html.indexOf('<div nb-event:') + '<div nb-event:'.length;

        const start = Date.now();
        const result = provider.provideCompletionItems(
            doc, doc.positionAt(cursorOffset), token as any, context as any
        );
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(200);
        const items = asCompletionItems(result as CompletionList | CompletionItem[] | undefined);
        expect(items).toBeDefined();
        expect(items!.map(i => i.label)).toContain('click');
    });
});
