import { nRenameProvider } from '../../src/providers/rename-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';
import { Range, WorkspaceEdit } from 'vscode';

describe('nRenameProvider', () => {
    let analyzer: DecoratorAnalyzer;
    let provider: nRenameProvider;
    const token = createCancellationToken();

    const containerSource = `
        import html from './template.html';
        @Container(html)
        class TestContainer {
            name: string = '';
            count: number = 0;
        }
    `;

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
        provider = new nRenameProvider(analyzer);
    });

    function setupAssociation() {
        analyzer.analyzeSourceText('/test/container.ts', containerSource);
        const allAssocs = analyzer.getAllAssociations();
        return allAssocs[0]?.htmlFilePath;
    }

    describe('prepareRename', () => {
        it('should return undefined outside binding value', () => {
            const html = '<div>text</div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(5);
            const result = provider.prepareRename(doc, pos, token as any);
            expect(result).toBeUndefined();
        });

        it('should return undefined when not on a member reference', () => {
            const html = '<div nb-value="someText"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(html.indexOf('someText'));
            const result = provider.prepareRename(doc, pos, token as any);
            expect(result).toBeUndefined();
        });

        it('should return range and placeholder for valid this.X member', () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html, htmlPath);
            const nameOffset = html.indexOf('this.name') + 5; // cursor on 'name'
            const pos = doc.positionAt(nameOffset);
            const result = provider.prepareRename(doc, pos, token as any);
            expect(result).toBeDefined();
            expect((result as any).placeholder).toBe('name');
        });

        it('should return undefined for member not on association', () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.unknown"></div>';
            const doc = createMockDocument(html, htmlPath);
            const offset = html.indexOf('this.unknown') + 5;
            const pos = doc.positionAt(offset);
            const result = provider.prepareRename(doc, pos, token as any);
            expect(result).toBeUndefined();
        });
    });

    describe('provideRenameEdits', () => {
        it('should return undefined for invalid new names', () => {
            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(html.indexOf('this.name') + 5);
            const result = provider.provideRenameEdits(doc, pos, '123invalid', token as any);
            expect(result).toBeUndefined();
        });

        it('should return undefined outside binding', () => {
            const html = '<div>text</div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(5);
            const result = provider.provideRenameEdits(doc, pos, 'newName', token as any);
            expect(result).toBeUndefined();
        });

        it('should produce edits for valid rename with associations', () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html, htmlPath);
            const nameOffset = html.indexOf('this.name') + 5;
            const pos = doc.positionAt(nameOffset);
            const result = provider.provideRenameEdits(doc, pos, 'newName', token as any);
            expect(result).toBeDefined();
        });

        it('should return undefined when not on member reference', () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="someText"></div>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('someText'));
            const result = provider.provideRenameEdits(doc, pos, 'newName', token as any);
            expect(result).toBeUndefined();
        });

        it('should accept valid JS identifiers with $ and _', () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('this.name') + 5);
            const result = provider.provideRenameEdits(doc, pos, '$_newName', token as any);
            expect(result).toBeDefined();
        });
    });
});
