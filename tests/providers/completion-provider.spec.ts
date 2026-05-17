import { nCompletionProvider } from '../../src/providers/completion-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken, asCompletionItems } from '../helpers';
import { CompletionItem, CompletionItemKind, CompletionList, SnippetString } from 'vscode';

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
            expect(labels).toContain('visibilityAspect');
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

        it('should suggest component names for nb-component="@"', () => {
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
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('UserCard');
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
        it('should suggest model injections after this.', () => {
            const html = '<div nb-value="this."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('this.') + 5);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('changeDetector');
            expect(labels).toContain('elementManipulations');
            expect(labels).toContain('elementSubscriptions');
            expect(labels).toContain('eventDispatcher');
        });

        it('should suggest ChangeDetector members after this.changeDetector.', () => {
            const html = '<div nb-value="this.changeDetector."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('changeDetector.') + 'changeDetector.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('detect');
        });

        it('should suggest ElementManipulations members after this.elementManipulations.', () => {
            const html = '<div nb-value="this.elementManipulations."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('elementManipulations.') + 'elementManipulations.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('properties');
            expect(labels).toContain('attributes');
            expect(labels).toContain('styles');
            expect(labels).toContain('classes');
        });

        it('should suggest sub-members after this.elementManipulations.styles.', () => {
            const html = '<div nb-value="this.elementManipulations.styles."></div>';
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

        it('should suggest ElementSubscriptions members after this.elementSubscriptions.', () => {
            const html = '<div nb-value="this.elementSubscriptions."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('elementSubscriptions.') + 'elementSubscriptions.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('isSubscribed');
            expect(labels).toContain('isUnSubscribed');
            expect(labels).toContain('subscribe');
        });

        it('should suggest EventDispatcher members after this.eventDispatcher.', () => {
            const html = '<div nb-value="this.eventDispatcher."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('eventDispatcher.') + 'eventDispatcher.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('dispatch');
        });

        it('should provide method snippet for ChangeDetector.detect()', () => {
            const html = '<div nb-value="this.changeDetector."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('changeDetector.') + 'changeDetector.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const detectItem = result!.find(i => (i as CompletionItem).label === 'detect') as CompletionItem;
            expect(detectItem).toBeDefined();
            expect(detectItem.kind).toBe(CompletionItemKind.Method);
            expect((detectItem.insertText as SnippetString).value).toBe('detect(${1})');
        });

        it('should work with optional chaining this.changeDetector?.', () => {
            const html = '<div nb-value="this.changeDetector?."></div>';
            const doc = createDoc(html);
            const pos = doc.positionAt(html.indexOf('changeDetector?.') + 'changeDetector?.'.length);
            const result = asCompletionItems(provider.provideCompletionItems(doc, pos, token as any, context as any) as CompletionList | CompletionItem[] | undefined);
            expect(result).toBeDefined();
            const labels = result!.map(i => (i as CompletionItem).label);
            expect(labels).toContain('detect');
        });
    });
});
