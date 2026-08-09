import { nHoverProvider } from '../../src/providers/hover-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';
import { Position, Hover, MarkdownString } from 'vscode';

// ---- Round 3 (L1/L2/L4): hover must not misattribute or over-bless ----
describe('nHoverProvider — round 3 fixes', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nHoverProvider;
    let htmlPath: string;
    const token = createCancellationToken();

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nHoverProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                name: string = '';
                items: string[] = [];
            }
        `);
        htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
    });

    it('L1: does not show the ROOT member info when a chained member fails to resolve', () => {
        // 'name: string' — 'string' has no indexed members, so `bar` cannot
        // resolve. Previously the hover fell through and rendered the root
        // member's info while the cursor sat on `bar`.
        const html = '<div nb-value="this.name.bar"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('bar'));
        expect(provider.provideHover(doc, pos, token as any)).toBeUndefined();
    });

    it('L1: still shows chained info when the cursor is on the root member', () => {
        const html = '<div nb-value="this.name.bar"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('name.bar'));
        expect(provider.provideHover(doc, pos, token as any)).toBeDefined();
    });

    it('L2: does not bless element.X member access inside nb-value', () => {
        // 'element' is only injected into nb-event / nb-bound expressions —
        // in nb-value it is a runtime ReferenceError.
        const html = '<div nb-value="element.styles.get(\'color\')"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('styles'));
        expect(provider.provideHover(doc, pos, token as any)).toBeUndefined();
    });

    it('L2: does not bless nativeElement.X member access inside nb-value', () => {
        const html = '<div nb-value="nativeElement.innerHTML"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('innerHTML'));
        expect(provider.provideHover(doc, pos, token as any)).toBeUndefined();
    });

    it('L2: still documents element.X inside nb-bound', () => {
        const html = '<div nb-bound="element.classes.add(\'on\')"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('classes'));
        expect(provider.provideHover(doc, pos, token as any)).toBeDefined();
    });

    it('L4: does not bless item inside the repeat\'s own expression (no outer scope)', () => {
        const html = '<div nb-repeat="item.x"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('item'));
        expect(provider.provideHover(doc, pos, token as any)).toBeUndefined();
    });

    it('L4: resolves outer repeat params inside a nested repeat\'s expression', () => {
        const html = '<ul nb-repeat:outer="this.items"><li nb-repeat="outerItem.children"></li></ul>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('outerItem'));
        expect(provider.provideHover(doc, pos, token as any)).toBeDefined();
    });
});

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

        // ---- Regression: '@'-constant values are literal text — hovering a
        // `this.member` inside one showed member docs for what is prose. ----
        it('should not show member info inside @-constant literal values', () => {
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

            const html = '<div nb-value="@this.name is literal text"></div>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('this.name') + 5 + 1); // on 'name', +1 for '@'
            expect(provider.provideHover(doc, pos, token as any)).toBeUndefined();
        });

        it('still shows attribute docs on the NAME of an @-valued binding', () => {
            const html = '<div nb-value="@literal"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(html.indexOf('nb-value') + 2);
            const result = provider.provideHover(doc, pos, token as any) as any;
            expect(result).toBeDefined();
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

        it('types the router param as plain Router (round 4b: the param does not exist when routing is unconfigured)', () => {
            // The framework only PUSHES the `router` parameter when the
            // router is configured (ExpressionExecParamsHelper) — without a
            // configured router, referencing `router` is a strict-mode
            // ReferenceError, never `undefined`. So the injected param's type
            // is plain `Router`.
            const html = '<div nb-event:click="router.go()"></div>';
            const doc = createMockDocument(html);
            const offset = html.indexOf('"router') + 1;
            const pos = doc.positionAt(offset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeDefined();
            const contents = (result!.contents as any).value ?? String(result!.contents);
            expect(contents).toContain('router: Router');
            expect(contents).not.toContain('Router | undefined');
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

        it('does NOT bless element in a sibling non-bound binding (runtime ReferenceError)', () => {
            // 'element' is injected only into the nb-event / nb-bound
            // expression itself — an nb-exec on the same element referencing
            // it throws at runtime, so hover must not document it as injected.
            const html = '<div nb-bound="element" nb-exec="element"></div>';
            const doc = createMockDocument(html);
            // Position on 'element' in nb-exec value
            const execOffset = html.lastIndexOf('"element') + 1;
            const pos = doc.positionAt(execOffset);
            const result = provider.provideHover(doc, pos, token as any);
            expect(result).toBeUndefined();
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

// ---- Round-2 regressions: model injections resolved by member TYPE ----

describe('nHoverProvider — model injection resolution', () => {
    const token = createCancellationToken();
    const diSource = `
        import html from './template.html';
        @Container(html)
        class DiContainer {
            constructor(private cd: ChangeDetector,
                        protected em: ElementManipulations,
                        private appRouter: Router) {}
        }
    `;

    function setup() {
        const analyzer = new DecoratorAnalyzer();
        const provider = new nHoverProvider(analyzer);
        analyzer.analyzeSourceText('/test/di-container.ts', diSource);
        const htmlPath = analyzer.getAssociationsForTs('/test/di-container.ts')[0].htmlFilePath!;
        return { analyzer, provider, htmlPath };
    }

    function hoverText(hover: Hover | undefined): string {
        if (!hover) return '';
        const contents: any = (hover as any).contents;
        const arr: any[] = Array.isArray(contents) ? contents : [contents];
        return arr.map(c => (c as MarkdownString)?.value ?? String(c)).join('\n');
    }

    it('resolves chained members through a ChangeDetector-typed param', () => {
        const { provider, htmlPath } = setup();
        const html = '<div nb-event:click="this.cd.detect()"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('detect'));
        const hover = provider.provideHover(doc, pos, token as any);
        expect(hover).toBeDefined();
        const text = hoverText(hover as Hover);
        expect(text).toContain('detect');
        expect(text).toContain('ChangeDetector');
    });

    it('resolves deep chains through an ElementManipulations-typed param', () => {
        const { provider, htmlPath } = setup();
        const html = '<div nb-event:click="this.em.styles.set(\'color\', \'red\')"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('set('));
        const hover = provider.provideHover(doc, pos, token as any);
        expect(hover).toBeDefined();
        expect(hoverText(hover as Hover)).toContain('set');
    });

    it('resolves Router members through a Router-typed param', () => {
        const { provider, htmlPath } = setup();
        const html = '<div nb-event:click="this.appRouter.goBack()"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('goBack'));
        const hover = provider.provideHover(doc, pos, token as any);
        expect(hover).toBeDefined();
        expect(hoverText(hover as Hover)).toContain('goBack');
    });

    it('does NOT bless conventional injection names the class does not declare', () => {
        const { provider, htmlPath } = setup();
        // No member named 'changeDetector' exists — diagnostics flags this
        // reference, so hover must not describe it as a valid injection.
        const html = '<div nb-value="this.changeDetector"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('changeDetector'));
        const hover = provider.provideHover(doc, pos, token as any);
        expect(hover).toBeUndefined();
    });

    it('falls back to conventional injection names when no association exists', () => {
        const analyzer = new DecoratorAnalyzer();
        const provider = new nHoverProvider(analyzer);
        const html = '<div nb-value="this.changeDetector"></div>';
        const doc = createMockDocument(html, '/test/orphan.html');
        const pos = doc.positionAt(html.indexOf('changeDetector'));
        const hover = provider.provideHover(doc, pos, token as any);
        expect(hover).toBeDefined();
        expect(hoverText(hover as Hover)).toContain('ChangeDetector');
    });
});

// ---- Round 4 fixes ----
describe('nHoverProvider — round 4 fixes', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nHoverProvider;
    let htmlPath: string;
    const token = createCancellationToken();

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nHoverProvider(analyzer);
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

    function hoverText(hover: Hover | undefined): string {
        if (!hover) return '';
        const contents: any = (hover as any).contents;
        const arr: any[] = Array.isArray(contents) ? contents : [contents];
        return arr.map(c => (c as MarkdownString)?.value ?? String(c)).join('\n');
    }

    function hoverAt(html: string, needle: string): Hover | undefined {
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf(needle));
        return provider.provideHover(doc, pos, token as any) as Hover | undefined;
    }

    describe('L4: bare router.X in nb-event', () => {
        it('documents router.go', () => {
            const html = '<button nb-event:click="router.go(\'home\')"></button>';
            const hover = hoverAt(html, 'go(');
            expect(hover).toBeDefined();
            expect(hoverText(hover)).toContain('Router');
        });

        it('does not bless router.X outside nb-event', () => {
            const html = '<div nb-value="router.go(\'home\')"></div>';
            expect(hoverAt(html, 'go(')).toBeUndefined();
        });
    });

    describe('M2: prefixed repeat params use the runtime (lowercased) prefix', () => {
        it('documents mylistItem inside nb-repeat:myList', () => {
            const html = '<div nb-repeat:myList="this.items"><span nb-value="mylistItem"></span></div>';
            const hover = hoverAt(html, 'mylistItem');
            expect(hover).toBeDefined();
            expect(hoverText(hover)).toContain('nb-repeat:mylist');
        });

        it('does not document the source-cased myListItem (a runtime ReferenceError)', () => {
            const html = '<div nb-repeat:myList="this.items"><span nb-value="myListItem"></span></div>';
            expect(hoverAt(html, 'myListItem')).toBeUndefined();
        });
    });

    describe('M4: nb-var visibility gated by the consuming handler', () => {
        it('does not document a same-element var inside the nb-repeat expression', () => {
            const html = '<div nb-var:limit="5" nb-repeat="this.items.slice(0, limit)"></div>';
            expect(hoverAt(html, 'limit)')).toBeUndefined();
        });

        it('documents the var in a sibling nb-value on the same element', () => {
            const html = '<div nb-var:limit="5" nb-value="limit"></div>';
            const hover = hoverAt(html, 'limit"></div>');
            expect(hover).toBeDefined();
            expect(hoverText(hover)).toContain('nb-var:limit');
        });

        it('does not document the case element\'s own var inside nb-case', () => {
            const html = '<div nb-switch="this.v" nb-var:sv="1"><span nb-case="cv" nb-var:cv="2"></span></div>';
            expect(hoverAt(html, 'cv"')).toBeUndefined();
        });
    });
});

// ---- W3C compliance mode: hover works through data-nb-* / -- names ----
// All hover paths consume the parser's normalized binding, so these lock the
// full chain (raw W3C source → normalized binding → handler/param docs).
describe('nHoverProvider — W3C mode (data-nb-* / -- separator)', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nHoverProvider;
    const token = createCancellationToken();

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nHoverProvider(analyzer);
    });

    function hoverIn(html: string, needle: string, htmlPath?: string) {
        const doc = createMockDocument(html, htmlPath);
        return provider.provideHover(doc, doc.positionAt(html.indexOf(needle)), token as any);
    }

    function hoverText(hover: Hover | undefined): string {
        if (!hover) return '';
        const contents: any = (hover as any).contents;
        const arr: any[] = Array.isArray(contents) ? contents : [contents];
        return arr.map(c => (c as MarkdownString)?.value ?? String(c)).join('\n');
    }

    it('shows handler docs when hovering inside the data- part of the name', () => {
        const result = hoverIn('<div data-nb-value="this.name"></div>', 'data-nb-value');
        expect(result).toBeDefined();
        expect(result).toBeInstanceOf(Hover);
    });

    it('resolves the handler through the -- separator (data-nb-event--click)', () => {
        const result = hoverIn('<button data-nb-event--click="this.onClick()"></button>', 'data-nb-event') as Hover;
        expect(result).toBeDefined();
        expect(hoverText(result)).toContain('Event Handler');
    });

    it('documents the injected event param inside a W3C event expression', () => {
        const result = hoverIn('<button data-nb-event--click="event.type"></button>', 'event.');
        expect(result).toBeDefined();
    });

    it('documents a prefixed repeat param injected by a W3C nb-repeat', () => {
        const html = '<ul data-nb-repeat--outer="this.items"><li data-nb-value="outerIndex"></li></ul>';
        const result = hoverIn(html, 'outerIndex"');
        expect(result).toBeDefined();
    });

    it('resolves class members inside W3C binding values', () => {
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                name: string = '';
            }
        `);
        const htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
        const result = hoverIn('<div data-nb-value="this.name"></div>', 'name"', htmlPath);
        expect(result).toBeDefined();
    });
});

// ---- Round 7 (R7-2): string-literal/comment content is prose, not code ----
describe('nHoverProvider — round-7 masking of non-code text', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nHoverProvider;
    let htmlPath: string;
    const token = createCancellationToken();

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nHoverProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                items: string[] = [];
                t(v: string): string { return v; }
            }
        `);
        analyzer.analyzeSourceText('/test/fmt.ts', `
            @Transformer()
            class Fmt { transform(v: any): string { return String(v); } }
        `);
        htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
    });

    function hoverAt(html: string, offset: number) {
        const doc = createMockDocument(html, htmlPath);
        return provider.provideHover(doc, doc.positionAt(offset), token as any);
    }

    it('does not bless a repeat param inside a string literal', () => {
        const html = `<div nb-repeat="this.items"><span nb-value="this.t('item')">x</span></div>`;
        expect(hoverAt(html, html.indexOf(`'item'`) + 2)).toBeUndefined();
    });

    it('still hovers the real repeat param outside strings (regression)', () => {
        const html = '<div nb-repeat="this.items"><span nb-value="item">x</span></div>';
        const hover = hoverAt(html, html.indexOf('item">') + 1);
        expect(hover).toBeDefined();
    });

    it('does not bless a transformer name inside a string literal', () => {
        const html = `<div nb-value="this.t('fmt')"></div>`;
        expect(hoverAt(html, html.indexOf(`'fmt'`) + 2)).toBeUndefined();
    });

    it('still hovers the real transformer call (regression)', () => {
        const html = '<div nb-value="fmt(1)"></div>';
        expect(hoverAt(html, html.indexOf('fmt(1)') + 1)).toBeDefined();
    });

    it('does not bless dotted access on an injected param inside a string literal', () => {
        const html = `<button nb-event:click="this.t('event.detail')"></button>`;
        expect(hoverAt(html, html.indexOf('detail') + 2)).toBeUndefined();
    });

    it('still hovers real event.X access in nb-event (regression)', () => {
        const html = '<button nb-event:click="this.t(event.type)"></button>';
        expect(hoverAt(html, html.indexOf('event.type') + 'event.'.length + 1)).toBeDefined();
    });
});
