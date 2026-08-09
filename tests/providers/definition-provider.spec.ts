import { nDefinitionProvider } from '../../src/providers/definition-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';
import { Location } from 'vscode';

// ---- Round 3 (L4): a repeat's own expression is outside its own scope ----
describe('nDefinitionProvider — repeat own-scope exclusion (round 3)', () => {
    const token = createCancellationToken();

    function setup() {
        const analyzer = new DecoratorAnalyzer();
        const provider = new nDefinitionProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer { items: string[] = []; }
        `);
        const htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
        return { provider, htmlPath };
    }

    it('item in a repeat\'s own expression with no outer scope resolves nowhere', () => {
        const { provider, htmlPath } = setup();
        const html = '<div nb-repeat="item.x"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('item'));
        // Previously this navigated to the repeat attribute ITSELF, although
        // the runtime evaluates the collection with the parent params.
        expect(provider.provideDefinition(doc, pos, token as any)).toBeUndefined();
    });

    it('item in a nested repeat\'s own expression navigates to the OUTER repeat', () => {
        const { provider, htmlPath } = setup();
        const html = '<div nb-repeat="this.items"><span nb-repeat="item.children"></span></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('item.children'));
        const result = provider.provideDefinition(doc, pos, token as any) as Location;
        expect(result).toBeDefined();
        // The provider returns a Location built from a Position — the mock
        // Location stores it as `range` verbatim. The OUTER nb-repeat
        // attribute is the first one in the document.
        expect((result as any).range.character).toBe(html.indexOf('nb-repeat'));
        expect((result as any).range.line).toBe(0);
    });
});

describe('nDefinitionProvider', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nDefinitionProvider;
    const token = createCancellationToken();

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

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nDefinitionProvider(analyzer);
    });

    it('should return undefined outside binding value', () => {
        const html = '<div>plain text</div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(7);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeUndefined();
    });

    it('should return undefined when hovering attribute name (not value)', () => {
        const html = '<div nb-value="this.name"></div>';
        const doc = createMockDocument(html);
        // Position on the attribute name "nb-value"
        const pos = doc.positionAt(5);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeUndefined();
    });

    // ---- Regression: prefixed nb-repeat scopes inject ONLY the camelCase
    // names (outerItem) — the lowercase 'outeritem' never exists at runtime
    // and must not navigate. ----
    it('should navigate camelCase prefixed repeat params to the declaring nb-repeat', () => {
        const html = '<div nb-repeat:outer="this.items"><span nb-value="outerItem"></span></div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(html.indexOf('outerItem"') + 2);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeDefined();
        expect(result).toBeInstanceOf(Location);
    });

    it('should not navigate lowercase prefixed variants that the runtime never injects', () => {
        const html = '<div nb-repeat:outer="this.items"><span nb-value="outeritem"></span></div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(html.indexOf('outeritem"') + 2);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeUndefined();
    });

    it('should navigate to TS member when clicking this.X', () => {
        const htmlPath = setupAssociation();
        if (!htmlPath) return;

        const html = '<div nb-value="this.name"></div>';
        const doc = createMockDocument(html, htmlPath);
        const nameOffset = html.indexOf('this.name') + 5;
        const pos = doc.positionAt(nameOffset);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeDefined();
        expect(result).toBeInstanceOf(Location);
    });

    it('should return undefined for member not in any association', () => {
        const html = '<div nb-value="this.nonExistent"></div>';
        const doc = createMockDocument(html);
        const nameOffset = html.indexOf('nonExistent');
        const pos = doc.positionAt(nameOffset);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeUndefined();
    });

    // ---- Regression: '@'-constant values are literal text — a `this.member`
    // inside one is prose, not a navigable reference (rename/references/
    // CodeLens already skip them; definition did not). ----
    it('should not navigate members inside @-constant literal values', () => {
        const htmlPath = setupAssociation();
        if (!htmlPath) return;

        const html = '<div nb-value="@this.name is literal text"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('this.name') + 5 + 1); // on 'name', +1 for '@'
        expect(provider.provideDefinition(doc, pos, token as any)).toBeUndefined();
    });

    it('should not navigate nb-var locals referenced inside @-constant values', () => {
        const html = '<div nb-var:my-local="1"><span nb-value="@myLocal here"></span></div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(html.indexOf('myLocal here') + 2);
        expect(provider.provideDefinition(doc, pos, token as any)).toBeUndefined();
    });

    it('should navigate to nb-var definition', () => {
        // HTML lowercases attribute names: nb-var:my-var → suffix "my-var" → varName "myVar"
        const html = '<div nb-var:my-var="this.items"><span nb-value="myVar"></span></div>';
        const doc = createMockDocument(html);
        const secondMyVar = html.indexOf('myVar', html.indexOf('nb-value'));
        const pos = doc.positionAt(secondMyVar + 1);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeDefined();
    });

    it('should navigate to nb-repeat when clicking on item', () => {
        const html = '<div nb-repeat="this.items"><span nb-value="item"></span></div>';
        const doc = createMockDocument(html);
        const itemOffset = html.lastIndexOf('item');
        const pos = doc.positionAt(itemOffset + 1);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeDefined();
    });

    it('should navigate to nb-repeat when clicking on index', () => {
        const html = '<div nb-repeat="this.items"><span nb-value="index"></span></div>';
        const doc = createMockDocument(html);
        const indexOffset = html.lastIndexOf('index');
        const pos = doc.positionAt(indexOffset + 1);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeDefined();
    });

    it('should navigate to nb-event attribute when clicking on event param', () => {
        const html = '<div nb-event:click="event.type"></div>';
        const doc = createMockDocument(html);
        const eventOffset = html.indexOf('"event') + 1; // on 'event'
        const pos = doc.positionAt(eventOffset + 1);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeDefined();
    });

    it('should navigate to nb-event when clicking element param', () => {
        const html = '<div nb-event:click="element.styles"></div>';
        const doc = createMockDocument(html);
        const elOffset = html.indexOf('"element') + 1;
        const pos = doc.positionAt(elOffset + 1);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeDefined();
    });

    it('should navigate to nb-bound when clicking nativeElement param', () => {
        const html = '<div nb-bound="nativeElement.id"></div>';
        const doc = createMockDocument(html);
        const offset = html.indexOf('nativeElement') + 1;
        const pos = doc.positionAt(offset);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeDefined();
    });

    it('should return undefined for unknown identifier', () => {
        const html = '<div nb-value="unknownVar"></div>';
        const doc = createMockDocument(html);
        const pos = doc.positionAt(html.indexOf('unknownVar') + 1);
        const result = provider.provideDefinition(doc, pos, token as any);
        expect(result).toBeUndefined();
    });

    describe('entity navigation', () => {
        it('should navigate to @Container entity', () => {
            const source = `
                import html from './container.html';
                @Container(html)
                class MyContainer { }
            `;
            analyzer.analyzeSourceText('/test/my-container.ts', source);

            const html = '<div nb-container="@MyContainer"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(html.indexOf('MyContainer'));
            const result = provider.provideDefinition(doc, pos, token as any);
            expect(result).toBeDefined();
            expect(result).toBeInstanceOf(Location);
        });

        it('should navigate to @Component entity', () => {
            const source = `
                import html from './card.html';
                @Component(html)
                class UserCard { }
            `;
            analyzer.analyzeSourceText('/test/card.ts', source);

            const html = '<div nb-component="@UserCard"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(html.indexOf('UserCard'));
            const result = provider.provideDefinition(doc, pos, token as any);
            expect(result).toBeDefined();
        });

        it('should return undefined for unknown entity', () => {
            const html = '<div nb-container="@NonExistent"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(html.indexOf('NonExistent'));
            const result = provider.provideDefinition(doc, pos, token as any);
            expect(result).toBeUndefined();
        });
    });

    describe('transformer navigation', () => {
        it('should navigate to transformer function', () => {
            const source = `
                @Transformer()
                class CurrencyFormatter {
                    transform(value: number): string { return '$' + value; }
                }
            `;
            analyzer.analyzeSourceText('/test/formatter.ts', source);

            const html = '<div nb-value="currencyFormatter(this.price)"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(html.indexOf('currencyFormatter') + 1);
            const result = provider.provideDefinition(doc, pos, token as any);
            expect(result).toBeDefined();
        });
    });
});


// ---- Round 4 fixes ----
describe('nDefinitionProvider — round 4 fixes', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nDefinitionProvider;
    let htmlPath: string;
    const token = createCancellationToken();

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nDefinitionProvider(analyzer);
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

    function definitionAt(html: string, needle: string) {
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf(needle));
        return provider.provideDefinition(doc, pos, token as any);
    }

    describe('M3: injected params resolve only inside the injecting expression', () => {
        it('declines element in an nb-value (runtime ReferenceError, not a reference)', () => {
            // Previously walked ancestors and navigated to the nb-bound.
            const html = '<div nb-bound="this.v = 1"><span nb-value="element"></span></div>';
            expect(definitionAt(html, 'element"')).toBeUndefined();
        });

        it('declines nativeElement in a SIBLING binding on the nb-bound element itself', () => {
            const html = '<div nb-bound="this.v = 1" nb-value="nativeElement"></div>';
            expect(definitionAt(html, 'nativeElement"')).toBeUndefined();
        });

        it('still navigates element to its own nb-bound expression', () => {
            const html = '<div nb-bound="this.v = element.attributes.get(1)"></div>';
            const result = definitionAt(html, 'element.attributes');
            expect(result).toBeDefined();
        });

        it('still navigates event to its own nb-event expression', () => {
            const html = '<button nb-event:click="this.v = event.type"></button>';
            const result = definitionAt(html, 'event.type');
            expect(result).toBeDefined();
        });
    });

    describe('M4: nb-var visibility gated by the consuming handler', () => {
        it('declines a same-element var referenced in the nb-repeat expression', () => {
            const html = '<div nb-var:limit="5" nb-repeat="this.items.slice(0, limit)"></div>';
            expect(definitionAt(html, 'limit)')).toBeUndefined();
        });

        it('still navigates the var from a sibling nb-value', () => {
            const html = '<div nb-var:limit="5" nb-value="limit"></div>';
            expect(definitionAt(html, 'limit"></div>')).toBeDefined();
        });

        it('declines the case element own var inside nb-case', () => {
            const html = '<div nb-switch="this.v"><span nb-case="cv" nb-var:cv="2"></span></div>';
            expect(definitionAt(html, 'cv"')).toBeUndefined();
        });
    });

    describe('M2: prefixed repeat params navigate via the runtime (lowercased) names', () => {
        it('navigates mylistItem to the nb-repeat:myList attribute', () => {
            const html = '<div nb-repeat:myList="this.items"><span nb-value="mylistItem"></span></div>';
            expect(definitionAt(html, 'mylistItem')).toBeDefined();
        });

        it('declines the source-cased myListItem', () => {
            const html = '<div nb-repeat:myList="this.items"><span nb-value="myListItem"></span></div>';
            expect(definitionAt(html, 'myListItem')).toBeUndefined();
        });
    });
});

// ---- Round 6 (E3): nb-template navigation resolves the runtime's RAW
// remainder after '@' — Template.ts does a plain substring(1) with no inner
// trim, so '@ name' looks up ' name' and errors at runtime. Navigation must
// not resolve names the runtime can't. ----
describe('nDefinitionProvider — nb-template raw-remainder name (round 6)', () => {
    const token = createCancellationToken();

    function setupWithTemplate() {
        const analyzer = new DecoratorAnalyzer();
        const provider = new nDefinitionProvider(analyzer);
        analyzer.analyzeSourceText('/test/main.ts', `
            import html from './template.html';
            @Container(html, [$Template('info-icon', '<svg></svg>')])
            class Main { }
        `);
        const htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
        return { provider, htmlPath };
    }

    function templateDefinitionAt(html: string) {
        const { provider, htmlPath } = setupWithTemplate();
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('info-icon'));
        return provider.provideDefinition(doc, pos, token as any);
    }

    it('navigates nb-template="@info-icon"', () => {
        expect(templateDefinitionAt('<div nb-template="@info-icon"></div>')).toBeDefined();
    });

    it('navigates with trailing whitespace (the runtime trims the outer attribute value)', () => {
        expect(templateDefinitionAt('<div nb-template="@info-icon  "></div>')).toBeDefined();
    });

    it('declines nb-template="@ info-icon" — the runtime looks up " info-icon" and fails', () => {
        expect(templateDefinitionAt('<div nb-template="@ info-icon"></div>')).toBeUndefined();
    });

    it('nb-container="@ Main" still navigates (ExpressionDetails trims after the prefix)', () => {
        const { provider, htmlPath } = setupWithTemplate();
        const html = '<div nb-container="@ Main"></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('Main'));
        expect(provider.provideDefinition(doc, pos, token as any)).toBeDefined();
    });
});

// ---- Round 7 (R7-2): string-literal content is prose, not a navigable ref ----
describe('nDefinitionProvider — round-7 masking of non-code text', () => {
    const token = createCancellationToken();

    function setup() {
        const analyzer = new DecoratorAnalyzer();
        const provider = new nDefinitionProvider(analyzer);
        analyzer.analyzeSourceText('/test/container.ts', `
            import html from './template.html';
            @Container(html)
            class TestContainer {
                items: string[] = [];
                t(v: string): string { return v; }
            }
        `);
        const htmlPath = analyzer.getAllAssociations()[0]!.htmlFilePath!;
        return { provider, htmlPath };
    }

    it('does not navigate from an identifier inside a string literal', () => {
        const { provider, htmlPath } = setup();
        const html = `<div nb-repeat="this.items"><span nb-value="this.t('item')">x</span></div>`;
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf(`'item'`) + 2);
        expect(provider.provideDefinition(doc, pos, token as any)).toBeUndefined();
    });

    it('still navigates from the real repeat param outside strings (regression)', () => {
        const { provider, htmlPath } = setup();
        const html = '<div nb-repeat="this.items"><span nb-value="item">x</span></div>';
        const doc = createMockDocument(html, htmlPath);
        const pos = doc.positionAt(html.indexOf('item">') + 1);
        expect(provider.provideDefinition(doc, pos, token as any)).toBeDefined();
    });
});
