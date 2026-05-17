import { nHoverProvider } from '../../src/providers/hover-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';
import { Position, Hover, MarkdownString } from 'vscode';

describe('nHoverProvider', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nHoverProvider;
    const token = createCancellationToken();

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nHoverProvider(analyzer);
    });

    describe('hover on attribute name', () => {
        it('should show handler docs when hovering on nb-value', () => {
            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(5);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
            expect(result).toBeInstanceOf(Hover);
        });

        it('should return undefined for non-nb attributes', () => {
            const html = '<div class="foo"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(5);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeUndefined();
        });

        it('should show handler docs for nb-if', () => {
            const html = '<div nb-if="this.visible"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(5);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show handler docs for nb-repeat', () => {
            const html = '<div nb-repeat="this.items"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(5);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show handler docs for nb-event:click', () => {
            const html = '<div nb-event:click="handler()"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(5);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });
    });

    describe('hover on root member (this.X)', () => {
        it('should show member info with known association', () => {
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

            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html, htmlPath);
            const nameOffset = html.indexOf('this.name') + 5; // cursor on 'name'
            const pos = doc.positionAt(nameOffset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should return undefined when hovering outside binding', () => {
            const html = '<div>plain text</div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(10);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeUndefined();
        });

        it('should return undefined when no associations exist', () => {
            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html);
            const nameOffset = html.indexOf('this.name') + 5;
            const pos = doc.positionAt(nameOffset);
            const result = provider.provideHover(doc, pos, token as any);
            // No associations → falls through to injected param check
            expect(result).toBeUndefined();
        });
    });

    describe('hover on injected params', () => {
        it('should show event type when hovering on event in nb-event', () => {
            const html = '<div nb-event:click="event.preventDefault()"></div>';
            const doc = createMockDocument(html);
            const eventOffset = html.indexOf('"event') + 1; // cursor on 'event'
            const pos = doc.positionAt(eventOffset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show element type when hovering on element in nb-event', () => {
            const html = '<div nb-event:click="element.classes"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"element') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show nativeElement type in nb-event', () => {
            const html = '<div nb-event:click="nativeElement.tagName"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"nativeElement') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show data param in nb-event', () => {
            const html = '<div nb-event:click="data"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"data') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show unSubscribe param in nb-event', () => {
            const html = '<div nb-event:click="unSubscribe()"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"unSubscribe') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show router param in nb-event', () => {
            const html = '<div nb-event:click="router.navigate()"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"router') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show element type in nb-bound', () => {
            const html = '<div nb-bound="element.classes.add(\'active\')"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"element') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show nativeElement type in nb-bound', () => {
            const html = '<input nb-bound="nativeElement.value" />';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"nativeElement') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should resolve element in non-bound binding with nb-bound sibling', () => {
            // 'element' used in nb-exec but the element also has nb-bound
            const html = '<div nb-bound="element" nb-exec="element"></div>';
            const doc = createMockDocument(html);
            // Position on 'element' in nb-exec value
            const execOffset = html.lastIndexOf('"element') + 1;
            const pos = doc.positionAt(execOffset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show item type when hovering on item in nb-repeat', () => {
            const html = '<div nb-repeat="this.items"><span nb-value="item"></span></div>';
            const doc = createMockDocument(html);
            const itemOffset = html.lastIndexOf('item');
            const pos = doc.positionAt(itemOffset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show index type in nb-repeat', () => {
            const html = '<div nb-repeat="this.items"><span nb-value="index"></span></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"index') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show count type in nb-repeat', () => {
            const html = '<div nb-repeat="this.items"><span nb-value="count"></span></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"count') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show nb-var local variable', () => {
            const html = '<div nb-var:my-var="this.data"><span nb-value="myVar"></span></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"myVar') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });
    });

    describe('hover on dotted access', () => {
        it('should show event.clientX info', () => {
            const html = '<div nb-event:click="event.clientX"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('clientX');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            // clientX is a MouseEvent member, and click gives MouseEvent
            expect(result).toBeDefined();
        });

        it('should show event?.clientX info with optional chaining', () => {
            const html = '<div nb-event:click="event?.clientX"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('clientX');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show nativeElement?.tagName info with optional chaining', () => {
            const html = '<div nb-event:click="nativeElement?.tagName"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('tagName');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show element?.styles?.get info with double optional chaining', () => {
            const html = `<div nb-event:click="element?.styles?.get('color')"></div>`;
            const doc = createMockDocument(html);
            const offset = html.indexOf('.get') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show nativeElement.tagName info', () => {
            const html = '<div nb-event:click="nativeElement.tagName"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('tagName');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show element.properties info', () => {
            const html = '<div nb-event:click="element.properties"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('properties');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show element.styles.get info', () => {
            const html = '<div nb-event:click="element.styles.get(\'color\')"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('.get') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should show element.classes info', () => {
            const html = '<div nb-event:click="element.classes"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('classes');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });
    });

    describe('hover on transformer function', () => {
        it('should show transformer info', () => {
            const source = `
                @Transformer()
                class DateFormat {
                    transform(value: Date, format?: string): string { return ''; }
                }
            `;
            analyzer.analyzeSourceText('/test/formatter.ts', source);

            const html = '<div nb-value="dateFormat(this.date)"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('dateFormat');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
        });
    });

    describe('hover on model injections', () => {
        it('should show hover for this.changeDetector', () => {
            const html = '<div nb-value="this.changeDetector"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('changeDetector');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
            const contents = (result!.contents as any).value;
            expect(contents).toContain('ChangeDetector');
            expect(contents).toContain('injection');
        });

        it('should show hover for this.elementManipulations', () => {
            const html = '<div nb-value="this.elementManipulations"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('elementManipulations');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
            const contents = (result!.contents as any).value;
            expect(contents).toContain('ElementManipulations');
        });

        it('should show hover for this.elementSubscriptions', () => {
            const html = '<div nb-value="this.elementSubscriptions"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('elementSubscriptions');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
            const contents = (result!.contents as any).value;
            expect(contents).toContain('ElementSubscriptions');
        });

        it('should show hover for this.eventDispatcher', () => {
            const html = '<div nb-value="this.eventDispatcher"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('eventDispatcher');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
            const contents = (result!.contents as any).value;
            expect(contents).toContain('EventDispatcher');
        });

        it('should show hover for chained member this.changeDetector.detect', () => {
            const html = '<div nb-event:click="this.changeDetector.detect()"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('detect');
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
            const contents = (result!.contents as any).value;
            expect(contents).toContain('detect');
            expect(contents).toContain('void');
        });

        it('should show hover for this.elementManipulations.styles', () => {
            const html = '<div nb-value="this.elementManipulations.styles"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('.styles') + 1; // position on 'styles'
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
            const contents = (result!.contents as any).value;
            expect(contents).toContain('ElementStylesManipulations');
        });
    });
});
