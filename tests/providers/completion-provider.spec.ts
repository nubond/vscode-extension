import { nCompletionProvider } from '../../src/providers/completion-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken, asCompletionItems } from '../helpers';
import { CompletionItem, CompletionItemKind, CompletionList, SnippetString } from 'vscode';

// ---- Round 3 (M1): quoted '>' / '<' in attribute values killed stages 1–2 ----
// The old lastIndexOf('<')/'>' scan decided "not inside a tag" as soon as an
// earlier attribute value contained '>' (nb-if="a > b") — attribute-name and
// suffix completions went dead for the rest of the tag. The check now runs
// against the parsed (quote-aware) template.
describe('nCompletionProvider — tag detection with quoted angle brackets (round 3)', () => {
    let provider: nCompletionProvider;
    let htmlPath: string;
    const token = createCancellationToken();
    const context = { triggerKind: 0, triggerCharacter: undefined };

    beforeEach(() => {
        const analyzer = new DecoratorAnalyzer();
        provider = new nCompletionProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                count: number = 0;
                items: string[] = [];
            }
        `);
        htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
    });

    function completionsAt(html: string, offset?: number) {
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(offset ?? html.length);
        return asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as any);
    }

    it('suggests attribute names after a value containing ">"', () => {
        const result = completionsAt('<div nb-if="this.count > 5" nb');
        expect(result).toBeDefined();
        const labels = result!.map(i => i.label);
        expect(labels).toContain('nb-value');
        expect(labels).toContain('nb-repeat');
    });

    it('suggests event names after a value containing ">"', () => {
        const result = completionsAt('<div nb-if="this.count > 5" nb-event:');
        expect(result).toBeDefined();
        const labels = result!.map(i => i.label);
        expect(labels).toContain('click');
    });

    it('suggests attribute names after a value containing "<"', () => {
        const result = completionsAt('<div nb-if="this.count < 5" nb');
        expect(result).toBeDefined();
        const labels = result!.map(i => i.label);
        expect(labels).toContain('nb-value');
    });

    it('does not offer attribute names in text content after a closed tag', () => {
        const result = completionsAt('<div nb-if="this.count > 5"> nb');
        if (result) {
            const labels = result.map(i => i.label);
            expect(labels).not.toContain('nb-value');
        }
    });

    it('does not offer attribute names inside a quoted value that contains ">"', () => {
        const result = completionsAt('<div nb-value="a > b nb');
        if (result) {
            const labels = result.map(i => i.label);
            expect(labels).not.toContain('nb-value');
        }
    });
});

// ---- Round 3 (L4): a repeat's own expression is outside its own scope ----
describe('nCompletionProvider — repeat own-scope exclusion (round 3)', () => {
    let provider: nCompletionProvider;
    let htmlPath: string;
    const token = createCancellationToken();
    const context = { triggerKind: 0, triggerCharacter: undefined };

    beforeEach(() => {
        const analyzer = new DecoratorAnalyzer();
        provider = new nCompletionProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer { items: string[] = []; }
        `);
        htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
    });

    function labelsAt(html: string, offset: number): string[] {
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(offset);
        const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as any);
        return (result ?? []).map(i => String(i.label));
    }

    it('does not offer item/index/count inside the repeat\'s own expression (no outer scope)', () => {
        const html = '<div nb-repeat="x"></div>';
        const labels = labelsAt(html, html.indexOf('x') + 1);
        expect(labels).not.toContain('item');
        expect(labels).not.toContain('index');
        expect(labels).not.toContain('count');
    });

    it('offers the OUTER scope\'s params inside a nested repeat\'s expression', () => {
        const html = '<ul nb-repeat:outer="this.items"><li nb-repeat="x"></li></ul>';
        const labels = labelsAt(html, html.lastIndexOf('"x') + 2);
        expect(labels).toContain('outerItem');
        expect(labels).not.toContain('item');
    });
});

describe('nCompletionProvider', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nCompletionProvider;
    let htmlPath: string;
    const token = createCancellationToken();
    const context = { triggerKind: 0, triggerCharacter: undefined };

    const containerSource = `
        import html from './template.html';
        @Container(html)
        class TestContainer {
            name: string = '';
            count: number = 0;
            items: string[] = [];
        }
    `;

    function setupAssociation() {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        return analyzer.getAllAssociations()[0]?.htmlFilePath;
    }

    function createDoc(html: string, path?: string) {
        return createMockDocument(html, path ?? htmlPath);
    }

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nCompletionProvider(analyzer);
        htmlPath = setupAssociation()!;
    });

    describe('attribute name completions', () => {
        it('should suggest nb-* attributes in attribute name context', () => {
            const html = '<div nb';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            expect(result!.length).toBeGreaterThan(0);
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('nb-value');
            expect(labels).toContain('nb-if');
            expect(labels).toContain('nb-event');
        });

        it('should still suggest attribute names after a value containing an apostrophe', () => {
            // Regression: independent quote-parity counting treated the
            // apostrophe in "it's" as an open single-quoted string and
            // disabled attribute completion for the rest of the tag.
            const html = `<div nb-value="it's done" nb`;
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('nb-value');
            expect(labels).toContain('nb-if');
        });

        it('should not suggest attributes inside a quoted value', () => {
            const html = '<div nb-value="nb';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            // Inside quotes → not attribute name context
            if (result) {
                const labels = result.map(i => (i as CompletionItem).label);
                expect(labels).not.toContain('nb-value');
            }
        });
    });

    describe('suffix completions', () => {
        it('should suggest event names after nb-event:', () => {
            const html = '<div nb-event:';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            expect(result!.length).toBeGreaterThan(0);
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('click');
            expect(labels).toContain('input');
            expect(labels).toContain('keydown');
        });

        it('should suggest aspect names after nb-aspect:', () => {
            const aspectSource = `
                @Aspect()
                class VisibilityAspect {
                    onBound() {}
                }
            `;
            analyzer.analyzeSourceText('/test/visibility.ts', aspectSource);

            const html = '<div nb-aspect:';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            expect(result!.length).toBeGreaterThan(0);
            const labels = result!.map(i => (i as CompletionItem).label);
            // The runtime registers aspects under the kebab-case name
            // (Environment.addAspect) — camelCase suggestions never resolved.
            expect(labels).toContain('visibility-aspect');
        });

        it('should keep suggesting aspect names while typing past a hyphen', () => {
            const aspectSource = `
                @Aspect()
                class VisibilityAspect {
                    onBound() {}
                }
            `;
            analyzer.analyzeSourceText('/test/visibility.ts', aspectSource);

            // Kebab-case names contain '-' — the suffix-context regex must
            // still match after the user types it, or the list vanishes
            // mid-word.
            const html = '<div nb-aspect:visibility-';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('visibility-aspect');
        });

        it('should suggest HTML attributes after nb-attr:', () => {
            const html = '<input nb-attr:';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            expect(result!.length).toBeGreaterThan(0);
        });

        it('should suggest DOM properties after nb-prop:', () => {
            const html = '<input nb-prop:';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            expect(result!.length).toBeGreaterThan(0);
        });

        it('should suggest generic placeholder after nb-in:', () => {
            const html = '<div nb-in:';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            expect(result!.length).toBeGreaterThan(0);
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('propertyName');
        });

        it('should suggest generic placeholder after nb-in-ref:', () => {
            const html = '<div nb-in-ref:';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('propertyName');
        });
    });

    describe('skip ="" when already present', () => {
        it('should not include ="" in suffix completion when ="" follows cursor (nb-event)', () => {
            const html = '<div nb-event:="">';
            const cursorOffset = '<div nb-event:'.length;
            const doc = createDoc(html);
            const pos = doc.positionAt(cursorOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const clickItem = result!.find(i => (i as CompletionItem).label === 'click') as CompletionItem;
            expect(clickItem).toBeDefined();
            expect((clickItem.insertText as SnippetString).value).toBe('click');
        });

        it('should include ="" in suffix completion when no ="" follows cursor (nb-event)', () => {
            const html = '<div nb-event:';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const clickItem = result!.find(i => (i as CompletionItem).label === 'click') as CompletionItem;
            expect(clickItem).toBeDefined();
            expect((clickItem.insertText as SnippetString).value).toBe('click="${1}"');
        });

        it('should not include ="" in suffix completion when ="" follows cursor (nb-attr)', () => {
            const html = '<input nb-attr:="">';
            const cursorOffset = '<input nb-attr:'.length;
            const doc = createDoc(html);
            const pos = doc.positionAt(cursorOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const firstItem = result![0] as CompletionItem;
            expect(firstItem).toBeDefined();
            expect((firstItem.insertText as SnippetString).value).not.toContain('="${1}"');
        });

        it('should not include ="" in suffix completion when ="" follows cursor (nb-prop)', () => {
            const html = '<input nb-prop:="">';
            const cursorOffset = '<input nb-prop:'.length;
            const doc = createDoc(html);
            const pos = doc.positionAt(cursorOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const firstItem = result![0] as CompletionItem;
            expect(firstItem).toBeDefined();
            expect((firstItem.insertText as SnippetString).value).not.toContain('="${1}"');
        });

        it('should not include ="" in suffix completion when ="value" follows cursor (nb-event)', () => {
            const html = '<div nb-event:="this.handle()">';
            const cursorOffset = '<div nb-event:'.length;
            const doc = createDoc(html);
            const pos = doc.positionAt(cursorOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const clickItem = result!.find(i => (i as CompletionItem).label === 'click') as CompletionItem;
            expect(clickItem).toBeDefined();
            expect((clickItem.insertText as SnippetString).value).toBe('click');
        });

        it('should not include ="" in attribute name completion when ="" follows cursor', () => {
            const html = '<div nb-if="">';
            const cursorOffset = '<div nb-if'.length;
            const doc = createDoc(html);
            const pos = doc.positionAt(cursorOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const nbIfItem = result!.find(i => (i as CompletionItem).label === 'nb-if') as CompletionItem;
            expect(nbIfItem).toBeDefined();
            expect((nbIfItem.insertText as SnippetString).value).toBe('nb-if');
        });

        it('should include ="" in attribute name completion when no ="" follows cursor', () => {
            const html = '<div nb-if';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const nbIfItem = result!.find(i => (i as CompletionItem).label === 'nb-if') as CompletionItem;
            expect(nbIfItem).toBeDefined();
            expect((nbIfItem.insertText as SnippetString).value).toBe('nb-if="${1}"');
        });

        it('should not include ="" in nb-in suffix completion when ="" follows cursor', () => {
            const html = '<div nb-in:="">';
            const cursorOffset = '<div nb-in:'.length;
            const doc = createDoc(html);
            const pos = doc.positionAt(cursorOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const propItem = result!.find(i => (i as CompletionItem).label === 'propertyName') as CompletionItem;
            expect(propItem).toBeDefined();
            expect((propItem.insertText as SnippetString).value).not.toContain('="${2}"');
        });

        it('should not include ="" when cursor is mid-word in existing attribute (nb-|if="expr")', () => {
            const html = '<div nb-if="expr">';
            const cursorOffset = '<div nb-'.length;
            const doc = createDoc(html);
            const pos = doc.positionAt(cursorOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const nbIfItem = result!.find(i => (i as CompletionItem).label === 'nb-if') as CompletionItem;
            expect(nbIfItem).toBeDefined();
            expect((nbIfItem.insertText as SnippetString).value).toBe('nb-if');
        });

        it('should include ="" for fresh attribute typed before adjacent attribute without space', () => {
            const html = '<div nb-ifnb-value="expr">';
            const cursorOffset = '<div nb-if'.length;
            const doc = createDoc(html);
            const pos = doc.positionAt(cursorOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const nbIfItem = result!.find(i => (i as CompletionItem).label === 'nb-if') as CompletionItem;
            expect(nbIfItem).toBeDefined();
            expect((nbIfItem.insertText as SnippetString).value).toBe('nb-if="${1}"');
        });

        it('should include ="" for fresh attribute when cursor is inside closed tag', () => {
            const html = '<div nb-if>';
            const cursorOffset = '<div nb-if'.length;
            const doc = createDoc(html);
            const pos = doc.positionAt(cursorOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const nbIfItem = result!.find(i => (i as CompletionItem).label === 'nb-if') as CompletionItem;
            expect(nbIfItem).toBeDefined();
            expect((nbIfItem.insertText as SnippetString).value).toBe('nb-if="${1}"');
        });

        it('should not include ="" for suffix when cursor is mid-word in existing event (nb-event:cl|ick="handler")', () => {
            const html = '<div nb-event:click="handler">';
            const cursorOffset = '<div nb-event:cl'.length;
            const doc = createDoc(html);
            const pos = doc.positionAt(cursorOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const clickItem = result!.find(i => (i as CompletionItem).label === 'click') as CompletionItem;
            expect(clickItem).toBeDefined();
            expect((clickItem.insertText as SnippetString).value).toBe('click');
        });
    });

    describe('value completions', () => {
        it('should return undefined outside binding', () => {
            const html = '<div>some text</div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(7);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeUndefined();
        });

        it('should suggest this. as a starting point', () => {
            const html = '<div nb-value=""></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(15); // inside the quotes
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('this.');
        });

        it('should suggest class members after this.', () => {
            const html = '<div nb-value="this."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('this.') + 5);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            expect(result!.length).toBeGreaterThan(0);
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('name');
            expect(labels).toContain('count');
        });

        it('should suggest repeat params inside nb-repeat scope', () => {
            const html = '<div nb-repeat="this.items"><span nb-value=""></span></div>';
            const doc = createDoc(html);
            const valueOffset = html.lastIndexOf('""') + 1;
            const pos = doc.positionAt(valueOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('item');
            expect(labels).toContain('index');
            expect(labels).toContain('count');
        });

        it('should suggest prefixed repeat params inside nb-repeat with prefix', () => {
            const html = '<div nb-repeat:user="this.items"><span nb-value=""></span></div>';
            const doc = createDoc(html);
            const valueOffset = html.lastIndexOf('""') + 1;
            const pos = doc.positionAt(valueOffset);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('userItem');
            expect(labels).toContain('userIndex');
            expect(labels).toContain('userCount');
        });

        it('should suggest FocusEvent members for focus event', () => {
            const html = '<input nb-event:focus="event."></input>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('event.') + 6);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('relatedTarget');
        });

        it('should suggest event params inside nb-event', () => {
            const html = '<div nb-event:click=""></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('""') + 1);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('event');
            expect(labels).toContain('element');
        });

        it('should suggest nb-bound params', () => {
            const html = '<div nb-bound=""></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('""') + 1);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('element');
        });

        it('should suggest global objects', () => {
            const html = '<div nb-value=""></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(15);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('console');
            expect(labels).toContain('Math');
        });

        it('should suggest global object members after console.', () => {
            const html = '<div nb-exec="console."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('console.') + 8);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('log');
            expect(labels).toContain('warn');
        });

        it('should suggest Math members after Math.', () => {
            const html = '<div nb-value="Math."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('Math.') + 5);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('floor');
            expect(labels).toContain('ceil');
        });

        it('should suggest JSON members after JSON.', () => {
            const html = '<div nb-exec="JSON."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('JSON.') + 5);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('parse');
            expect(labels).toContain('stringify');
        });

        it('should suggest nb-var local variables in scope', () => {
            const html = '<div nb-var:my-name="this.items"><span nb-value=""></span></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.lastIndexOf('""') + 1);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('myName');
        });

        it('should return undefined for non-template HTML files', () => {
            const html = '<div class="container"><span>Hello</span></div>';
            const doc = createMockDocument(html, '/other/plain.html');
            const pos = doc.positionAt(html.indexOf('Hello'));
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeUndefined();
        });

        it('should provide completions for unassociated HTML with nb-* attributes (e.g. @AppRoot index.html)', () => {
            const html = '<div nb-value="this."></div>';
            const doc = createMockDocument(html, '/other/index.html');
            const pos = doc.positionAt(html.indexOf('this.') + 5);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
        });
    });

    describe('event member completions', () => {
        it('should suggest MouseEvent members after event. in nb-event:click', () => {
            const html = '<div nb-event:click="event."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('event.') + 6);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('clientX');
            expect(labels).toContain('clientY');
            expect(labels).toContain('button');
            // Base event members
            expect(labels).toContain('preventDefault');
            expect(labels).toContain('target');
        });

        it('should suggest KeyboardEvent members for keydown', () => {
            const html = '<div nb-event:keydown="event."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('event.') + 6);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('key');
            expect(labels).toContain('code');
        });

        it('should suggest InputEvent members for input', () => {
            const html = '<input nb-event:input="event."></input>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('event.') + 6);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('data');
            expect(labels).toContain('inputType');
        });

        it('should suggest WheelEvent members for wheel', () => {
            const html = '<div nb-event:wheel="event."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('event.') + 6);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('deltaX');
            expect(labels).toContain('deltaY');
            // WheelEvent also includes mouse members
            expect(labels).toContain('clientX');
        });

        it('should suggest DragEvent members for dragstart', () => {
            const html = '<div nb-event:dragstart="event."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('event.') + 6);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('dataTransfer');
        });

        it('should suggest TouchEvent members for touchstart', () => {
            const html = '<div nb-event:touchstart="event."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('event.') + 6);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('touches');
            expect(labels).toContain('targetTouches');
        });
    });

    describe('element member completions', () => {
        it('should suggest element top-level members in nb-event', () => {
            const html = '<div nb-event:click="element."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('element.') + 8);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('properties');
            expect(labels).toContain('attributes');
            expect(labels).toContain('styles');
            expect(labels).toContain('classes');
        });

        it('should suggest element top-level members in nb-bound', () => {
            const html = '<div nb-bound="element."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('element.') + 8);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('properties');
        });

        it('should suggest element.properties sub-members', () => {
            const html = '<div nb-event:click="element.properties."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('element.properties.') + 19);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('get');
            expect(labels).toContain('set');
        });

        it('should suggest element.attributes sub-members', () => {
            const html = '<div nb-event:click="element.attributes."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('element.attributes.') + 19);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('has');
            expect(labels).toContain('get');
            expect(labels).toContain('set');
            expect(labels).toContain('remove');
        });

        it('should suggest element.styles sub-members', () => {
            const html = '<div nb-event:click="element.styles."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('element.styles.') + 15);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('has');
            expect(labels).toContain('get');
            expect(labels).toContain('set');
        });

        it('should suggest element.classes sub-members', () => {
            const html = '<div nb-event:click="element.classes."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('element.classes.') + 16);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('has');
            expect(labels).toContain('add');
            expect(labels).toContain('remove');
            expect(labels).toContain('toggle');
        });

        it('should suggest nativeElement DOM members', () => {
            const html = '<div nb-event:click="nativeElement."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('nativeElement.') + 14);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('id');
            expect(labels).toContain('className');
            expect(labels).toContain('innerHTML');
            expect(labels).toContain('querySelector');
            expect(labels).toContain('focus');
        });
    });

    describe('entity name completions', () => {
        it('should suggest container names for nb-container="@"', () => {
            const source = `
                import html from './container.html';
                @Container(html)
                class MyContainer { }
            `;
            analyzer.analyzeSourceText('/test/my-container.ts', source);

            const html = '<div nb-container="@"></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('@') + 1);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('MyContainer');
        });

        it('should NOT suggest component names for nb-component="@" (round 4 L3: marker attribute, value ignored at runtime)', () => {
            const source = `
                import html from './comp.html';
                @Component(html)
                class UserCard { }
            `;
            analyzer.analyzeSourceText('/test/user-card.ts', source);

            const html = '<div nb-component="@"></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('@') + 1);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            // The runtime never reads a value from nb-component — components
            // are wired by their custom-element tag. Suggesting entity names
            // here invited dead markup.
            const labels = (result ?? []).map(i => (i as CompletionItem).label);
            expect(labels).not.toContain('user-card');
            expect(labels).not.toContain('UserCard');
        });

        it('should suggest container custom names from the [name, template] form', () => {
            const source = `
                import html from './card.html';
                @Container(['my-card', html])
                class CardController { }
            `;
            analyzer.analyzeSourceText('/test/card.ts', source);

            const html = '<div nb-container="@"></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('@') + 1);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('my-card');
        });

        it('should suggest globally registered template names for nb-template="@"', () => {
            // $Template('name', …) registers a global template — previously no
            // 'template' entities were ever produced and this list was empty.
            const source = `
                import html from './main.html';
                @Container(html, [$Template('info-icon', '<svg></svg>')])
                class Main { }
            `;
            analyzer.analyzeSourceText('/test/main.ts', source);

            const html = '<div nb-template="@"></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('@') + 1);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('info-icon');
        });
    });

    describe('transformer completions', () => {
        it('should suggest transformer functions', () => {
            const source = `
                @Transformer()
                class CurrencyFormatter {
                    transform(value: number): string { return '$' + value; }
                }
            `;
            analyzer.analyzeSourceText('/test/formatter.ts', source);

            const html = '<div nb-value=""></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('""') + 1);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('currencyFormatter');
        });
    });

    describe('model injection completions', () => {
        // DI is constructor-parameter based: the instance property is the
        // user's parameter name, and the injection is matched by its TYPE.
        // Param names deliberately differ from the conventional injection
        // names to prove by-type resolution.
        const diSource = `
            import html from './template.html';
            @Container(html)
            class DiContainer {
                constructor(private cd: ChangeDetector,
                            protected em: ElementManipulations,
                            private subs: ElementSubscriptions,
                            private dispatcher: EventDispatcher,
                            private appRouter: Router) {}
            }
        `;

        beforeEach(() => {
            analyzer.analyzeSourceText('/test/di-container.ts', diSource);
        });

        it('should NOT suggest conventional injection names after this. when members are analyzed', () => {
            const html = '<div nb-value="this."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('this.') + 5);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            // The class has no member named 'changeDetector' — suggesting it
            // would contradict diagnostics and produce a dead reference.
            expect(labels).not.toContain('changeDetector');
            expect(labels).not.toContain('elementManipulations');
            // Non-private DI params show up as regular members
            expect(labels).toContain('em');
        });

        it('should suggest conventional injection names after this. when no association exists', () => {
            const html = '<div nb-value="this."></div>';
            const doc = createDoc(html, '/test/orphan-template.html');
            const pos = doc.positionAt(html.indexOf('this.') + 5);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('changeDetector');
            expect(labels).toContain('elementManipulations');
            expect(labels).toContain('elementSubscriptions');
            expect(labels).toContain('eventDispatcher');
            expect(labels).toContain('router');
        });

        it('should resolve injection chain by name when no association exists', () => {
            const html = '<div nb-value="this.changeDetector."></div>';
            const doc = createDoc(html, '/test/orphan-template.html');
            const pos = doc.positionAt(html.indexOf('changeDetector.') + 'changeDetector.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('detect');
        });

        it('should suggest ChangeDetector members after a ChangeDetector-typed param chain', () => {
            const html = '<div nb-value="this.cd."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('this.cd.') + 'this.cd.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('detect');
        });

        it('should suggest ElementManipulations members after an ElementManipulations-typed param chain', () => {
            const html = '<div nb-value="this.em."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('this.em.') + 'this.em.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('properties');
            expect(labels).toContain('attributes');
            expect(labels).toContain('styles');
            expect(labels).toContain('classes');
        });

        it('should suggest sub-members after this.em.styles.', () => {
            const html = '<div nb-value="this.em.styles."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('styles.') + 'styles.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('has');
            expect(labels).toContain('get');
            expect(labels).toContain('set');
            expect(labels).toContain('remove');
        });

        it('should suggest ElementSubscriptions members after a typed param chain', () => {
            const html = '<div nb-value="this.subs."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('this.subs.') + 'this.subs.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('subscribe');
            expect(labels).not.toContain('isSubscribed');
            expect(labels).not.toContain('isUnSubscribed');
        });

        it('should suggest EventDispatcher members after a typed param chain', () => {
            const html = '<div nb-value="this.dispatcher."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('this.dispatcher.') + 'this.dispatcher.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('dispatch');
        });

        it('should suggest Router members after a Router-typed param chain', () => {
            const html = '<div nb-value="this.appRouter."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('this.appRouter.') + 'this.appRouter.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('go');
            expect(labels).toContain('goBack');
            expect(labels).toContain('state');
        });

        it('should provide method snippet for ChangeDetector.detect()', () => {
            const html = '<div nb-value="this.cd."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('this.cd.') + 'this.cd.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const detectItem = result!.find(i => (i as CompletionItem).label === 'detect') as CompletionItem;
            expect(detectItem).toBeDefined();
            expect(detectItem.kind).toBe(CompletionItemKind.Method);
            expect((detectItem.insertText as SnippetString).value).toBe('detect(${1})');
        });

        it('should work with optional chaining this.cd?.', () => {
            const html = '<div nb-value="this.cd?."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('this.cd?.') + 'this.cd?.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('detect');
        });
    });
});

// ---- Regressions: attribute-name insertion, W3C mode, item/var chains ----

describe('nCompletionProvider — insertion and chain regressions', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nCompletionProvider;
    let htmlPath: string;
    const token = createCancellationToken();
    const context = { triggerKind: 0, triggerCharacter: undefined };

    const containerSource = `
        import html from './template.html';
        interface User {
            firstName: string;
            address: Address;
        }
        interface Address {
            city: string;
        }
        @Container(html)
        class TestContainer {
            name: string = '';
            users: User[] = [];
            owner: User = { firstName: '', address: { city: '' } };
        }
    `;

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nCompletionProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
    });

    function complete(html: string, cursorOffset: number) {
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(cursorOffset);
        return asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
    }

    // Regression: `nb-value` was routed into the prefix-attribute branch
    // (`handler.isPrefix || attr === 'nb-value'`) and inserted an invalid
    // trailing colon (`nb-value:`) instead of `nb-value="…"`.
    describe('nb-value attribute completion (no trailing colon)', () => {
        it('inserts nb-value="${1}" — never nb-value:', () => {
            const html = '<div nb-val';
            const result = complete(html, html.length);
            expect(result).toBeDefined();
            const item = result!.find(i => (i as CompletionItem).label === 'nb-value') as CompletionItem;
            expect(item).toBeDefined();
            const inserted = (item.insertText as SnippetString).value;
            expect(inserted).toBe('nb-value="${1}"');
            expect(inserted).not.toContain('nb-value:');
            // No suffix-suggest command either — nb-value takes no suffix
            expect((item as any).command).toBeUndefined();
        });

        it('still inserts the colon + suggest command for real prefix attributes', () => {
            const html = '<div nb-ev';
            const result = complete(html, html.length);
            const item = result!.find(i => (i as CompletionItem).label === 'nb-event') as CompletionItem;
            expect(item).toBeDefined();
            expect((item.insertText as SnippetString).value).toBe('nb-event:');
            expect((item as any).command).toBeDefined();
        });
    });

    // Regression: W3C compliance mode (`data-nb-*` names, `--` separators)
    // produced no completions at all — attribute items were emitted only in
    // the `nb-*` form and the suffix regex only matched `nb-x:`.
    describe('W3C mode completions', () => {
        it('offers data-nb-* attribute names when the user types data-', () => {
            const html = '<div data-nb';
            const result = complete(html, html.length);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('data-nb-value');
            expect(labels).toContain('data-nb-if');
            expect(labels).toContain('data-nb-event');
        });

        it('uses the -- separator in W3C prefix-attribute insertions', () => {
            const html = '<div data-nb';
            const result = complete(html, html.length);
            const item = result!.find(i => (i as CompletionItem).label === 'data-nb-event') as CompletionItem;
            expect(item).toBeDefined();
            expect((item.insertText as SnippetString).value).toBe('data-nb-event--');
        });

        it('inserts data-nb-value="${1}" without a separator', () => {
            const html = '<div data-nb';
            const result = complete(html, html.length);
            const item = result!.find(i => (i as CompletionItem).label === 'data-nb-value') as CompletionItem;
            expect(item).toBeDefined();
            expect((item.insertText as SnippetString).value).toBe('data-nb-value="${1}"');
        });

        it('keeps plain nb-* items (no data- noise) when typing nb-', () => {
            const html = '<div nb-';
            const result = complete(html, html.length);
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('nb-value');
            expect(labels).not.toContain('data-nb-value');
        });

        it('suggests event names after data-nb-event--', () => {
            const html = '<div data-nb-event--';
            const result = complete(html, html.length);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('click');
            expect(labels).toContain('input');
        });

        it('keeps matching once suffix characters are typed (data-nb-event--cl)', () => {
            const html = '<div data-nb-event--cl';
            const result = complete(html, html.length);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('click');
        });
    });

    // Regression: hover inferred the repeat item type but completion offered
    // nothing after `item.` — the typed-chain strategy only matched
    // `this.`-rooted chains.
    describe('repeat item / nb-var member completions', () => {
        it('suggests item members from the nb-repeat collection element type', () => {
            const html = '<div nb-repeat="this.users"><span nb-value="item."></span></div>';
            const result = complete(html, html.indexOf('item.') + 'item.'.length);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('firstName');
            expect(labels).toContain('address');
        });

        it('resolves chained access through the item type (item.address.)', () => {
            const html = '<div nb-repeat="this.users"><span nb-value="item.address."></span></div>';
            const result = complete(html, html.indexOf('item.address.') + 'item.address.'.length);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('city');
        });

        it('supports prefixed repeat items (outerItem.)', () => {
            const html = '<div nb-repeat:outer="this.users"><span nb-value="outerItem."></span></div>';
            const result = complete(html, html.indexOf('outerItem.') + 'outerItem.'.length);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('firstName');
        });

        it('suggests members of an nb-var local resolved from its expression', () => {
            // The var's expression chain resolves via the association:
            // this.owner → User → firstName / address
            const html = '<div nb-var:someone="this.owner"><span nb-value="someone."></span></div>';
            const result = complete(html, html.indexOf('someone.') + 'someone.'.length);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('firstName');
            expect(labels).toContain('address');
        });

        it('does not fire for unknown bases (falls through to other strategies)', () => {
            const html = '<div><span nb-value="mystery."></span></div>';
            const result = complete(html, html.indexOf('mystery.') + 'mystery.'.length);
            // Must not throw and must not claim typed members; whatever comes
            // back (globals fallback or nothing) must not contain User members.
            const labels = (result ?? []).map(i => (i as CompletionItem).label);
            expect(labels).not.toContain('firstName');
        });
    });

    // ---- Regressions: completion firing in the wrong lexical context ----
    describe('completion-context guards', () => {
        it('does not offer class members after an identifier merely ENDING in "this."', () => {
            // `mythis.` matched the old /this\.\s*$/ — members of the class
            // were offered for a base object that is not the context.
            const html = '<div nb-value="mythis."></div>';
            const result = complete(html, html.indexOf('mythis.') + 'mythis.'.length);
            const labels = (result ?? []).map(i => (i as CompletionItem).label);
            expect(labels).not.toContain('name');
            expect(labels).not.toContain('users');
        });

        it('still offers class members after a real "this."', () => {
            const html = '<div nb-value="this."></div>';
            const result = complete(html, html.indexOf('this.') + 'this.'.length);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('name');
        });

        it('does not pop suffix completions inside a quoted attribute value', () => {
            // The prefix:suffix stage ran on the raw line with no tag/quote
            // guard — text ENDING in `nb-event:cl` popped DOM event names.
            const html = '<div nb-value="use nb-event:cl';
            const result = complete(html, html.length);
            const labels = (result ?? []).map(i => (i as CompletionItem).label);
            expect(labels).not.toContain('click');
        });

        it('does not pop suffix completions in plain text content', () => {
            const html = '<div>ends with nb-event:cl';
            const result = complete(html, html.length);
            const labels = (result ?? []).map(i => (i as CompletionItem).label);
            expect(labels).not.toContain('click');
        });

        it('still pops suffix completions when typing a real prefix attribute', () => {
            const html = '<div nb-event:cl';
            const result = complete(html, html.length);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('click');
        });
    });
});

// ---- Round 4 fixes ----
describe('nCompletionProvider — round 4 fixes', () => {
    let provider: nCompletionProvider;
    let analyzer: DecoratorAnalyzer;
    let htmlPath: string;
    const token = createCancellationToken();
    const context = { triggerKind: 0, triggerCharacter: undefined };

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nCompletionProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                items: string[] = [];
                v: string = '';
            }
        `);
        htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
    });

    function labelsAt(html: string, offset?: number): (string | { label: string })[] {
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(offset ?? html.length);
        const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as any);
        return (result ?? []).map(i => (i as CompletionItem).label);
    }

    describe('M1: nb-prop suffixes are offered in kebab-case (the only runtime-viable spelling)', () => {
        it('offers tab-index instead of tabIndex', () => {
            const labels = labelsAt('<input nb-prop:');
            expect(labels).toContain('tab-index');
            expect(labels).not.toContain('tabIndex');
        });

        it('offers text-content instead of textContent', () => {
            const labels = labelsAt('<div nb-prop:');
            expect(labels).toContain('text-content');
            expect(labels).not.toContain('textContent');
        });

        it('keeps single-word property names unchanged', () => {
            const labels = labelsAt('<input nb-prop:');
            expect(labels).toContain('value');
            expect(labels).toContain('checked');
        });

        it('inserts the kebab-case suffix', () => {
            const html = '<input nb-prop:';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as any);
            const item = result!.find(i => (i as CompletionItem).label === 'tab-index') as CompletionItem;
            expect(item).toBeDefined();
            expect((item.insertText as SnippetString).value).toBe('tab-index="${1}"');
        });
    });

    describe('L2: repeat-param completions include ALL enclosing scopes', () => {
        it('offers both inner unprefixed and outer prefixed params', () => {
            const html = '<div nb-repeat:outer="this.items"><span nb-repeat="outerItem.kids"><i nb-value=""></i></span></div>';
            const labels = labelsAt(html, html.indexOf('nb-value="') + 'nb-value="'.length);
            expect(labels).toContain('item');
            expect(labels).toContain('outerItem');
            expect(labels).toContain('outerIndex');
            expect(labels).toContain('outerCount');
        });

        it('dedupes nested unprefixed scopes (inner shadows outer)', () => {
            const html = '<div nb-repeat="this.items"><span nb-repeat="item.kids"><i nb-value=""></i></span></div>';
            const labels = labelsAt(html, html.indexOf('nb-value="') + 'nb-value="'.length);
            expect(labels.filter(l => l === 'item')).toHaveLength(1);
        });
    });

    describe('M2: prefixed repeat params are offered with the runtime (lowercased) prefix', () => {
        it('offers mylistItem for nb-repeat:myList', () => {
            const html = '<div nb-repeat:myList="this.items"><span nb-value=""></span></div>';
            const labels = labelsAt(html, html.indexOf('nb-value="') + 'nb-value="'.length);
            expect(labels).toContain('mylistItem');
            expect(labels).not.toContain('myListItem');
        });
    });

    describe('L4: router member completions in nb-event', () => {
        it('offers Router members after bare router.', () => {
            const html = '<button nb-event:click="router."></button>';
            const labels = labelsAt(html, html.indexOf('router.') + 'router.'.length);
            expect(labels).toContain('go');
            expect(labels).toContain('goBack');
            expect(labels).toContain('state');
            expect(labels).toContain('isConfigured');
        });

        it('does not offer router members outside nb-event', () => {
            const html = '<div nb-value="router."></div>';
            const labels = labelsAt(html, html.indexOf('router.') + 'router.'.length);
            expect(labels).not.toContain('goBack');
        });
    });

    describe('M4: nb-var visibility gated by the consuming handler', () => {
        it('does not offer same-element vars inside the nb-repeat expression', () => {
            const html = '<div nb-var:limit="5" nb-repeat="this.items.slice(0, )"></div>';
            const labels = labelsAt(html, html.indexOf('slice(0, ') + 'slice(0, '.length);
            expect(labels).not.toContain('limit');
        });

        it('offers the var in a sibling nb-value on the same element', () => {
            const html = '<div nb-var:limit="5" nb-value=""></div>';
            const labels = labelsAt(html, html.indexOf('nb-value="') + 'nb-value="'.length);
            expect(labels).toContain('limit');
        });

        it('does not offer the case element\'s own vars inside nb-case', () => {
            const html = '<div nb-switch="this.v" nb-var:sv="1"><span nb-case="" nb-var:cv="2"></span></div>';
            const labels = labelsAt(html, html.indexOf('nb-case="') + 'nb-case="'.length);
            expect(labels).not.toContain('cv');
            expect(labels).toContain('sv');
        });

        it('does not offer reserved-named vars anywhere', () => {
            const html = '<div nb-var:element="1" nb-value=""></div>';
            const labels = labelsAt(html, html.indexOf('nb-value="') + 'nb-value="'.length);
            expect(labels).not.toContain('element');
        });
    });
});

// ---- Round 7 (R7-2/R7-3): chain-regex this-boundary + non-code masking ----
describe('nCompletionProvider — round-7 fixes', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nCompletionProvider;
    let htmlPath: string;
    const token = createCancellationToken();
    const context = { triggerKind: 0, triggerCharacter: undefined };

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nCompletionProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            interface Address {
                city: string;
            }
            @Container(html)
            class TestContainer {
                address: Address = { city: '' };
                go(target: string): void { }
            }
        `);
        htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
    });

    function labelsAt(html: string, cursorOffset: number): (string | { label: string })[] {
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(cursorOffset);
        const items = asCompletionItems(
            provider.provideCompletionItems(doc, pos, token as any, context as any) as any) ?? [];
        return items.map(i => (typeof i.label === 'string' ? i.label : (i.label as any).label));
    }

    describe('R7-3: chained completions require a real `this` base', () => {
        it('mythis.address. does not offer the declared type\'s members', () => {
            const html = '<div nb-value="mythis.address."></div>';
            const labels = labelsAt(html, html.indexOf('mythis.address.') + 'mythis.address.'.length);
            expect(labels).not.toContain('city');
        });

        it('x.this.address. does not offer the declared type\'s members either', () => {
            const html = '<div nb-value="x.this.address."></div>';
            const labels = labelsAt(html, html.indexOf('this.address.') + 'this.address.'.length);
            expect(labels).not.toContain('city');
        });

        it('this.address. still offers the declared type\'s members (regression)', () => {
            const html = '<div nb-value="this.address."></div>';
            const labels = labelsAt(html, html.indexOf('this.address.') + 'this.address.'.length);
            expect(labels).toContain('city');
        });
    });

    describe('R7-2: dotted access inside string literals is prose', () => {
        it('element. inside a string literal offers no ElementManipulations members', () => {
            const html = `<button nb-event:click="this.go('element.')"></button>`;
            const labels = labelsAt(html, html.indexOf(`'element.`) + `'element.`.length);
            expect(labels).not.toContain('styles');
            expect(labels).not.toContain('classes');
        });

        it('element. in real code still offers ElementManipulations members (regression)', () => {
            const html = '<button nb-event:click="element."></button>';
            const labels = labelsAt(html, html.indexOf('element.') + 'element.'.length);
            expect(labels).toContain('styles');
            expect(labels).toContain('classes');
        });

        it('this.address. inside a string literal offers no typed members', () => {
            const html = `<div nb-value="this.go('this.address.')"></div>`;
            const labels = labelsAt(html, html.indexOf(`'this.address.`) + `'this.address.`.length);
            expect(labels).not.toContain('city');
        });
    });
});
