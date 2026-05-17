import { nDefinitionProvider } from '../../src/providers/definition-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';
import { Location } from 'vscode';

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
