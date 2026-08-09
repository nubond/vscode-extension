import { nRenameProvider } from '../../src/providers/rename-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';
import * as vscode from 'vscode';
import { WorkspaceEdit, Uri, Range, Position } from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
        jest.clearAllMocks();
        // Default: no TS rename provider available → declaration-only fallback
        (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
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
        it('should return undefined for invalid new names', async () => {
            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(html.indexOf('this.name') + 5);
            const result = await provider.provideRenameEdits(doc, pos, '123invalid', token as any);
            expect(result).toBeUndefined();
        });

        it('should return undefined outside binding', async () => {
            const html = '<div>text</div>';
            const doc = createMockDocument(html);
            const pos = doc.positionAt(5);
            const result = await provider.provideRenameEdits(doc, pos, 'newName', token as any);
            expect(result).toBeUndefined();
        });

        it('should produce edits for valid rename with associations', async () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html, htmlPath);
            const nameOffset = html.indexOf('this.name') + 5;
            const pos = doc.positionAt(nameOffset);
            const result = await provider.provideRenameEdits(doc, pos, 'newName', token as any);
            expect(result).toBeDefined();
        });

        it('should return undefined when not on member reference', async () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="someText"></div>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('someText'));
            const result = await provider.provideRenameEdits(doc, pos, 'newName', token as any);
            expect(result).toBeUndefined();
        });

        it('should accept valid JS identifiers with $ and _', async () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('this.name') + 5);
            const result = await provider.provideRenameEdits(doc, pos, '$_newName', token as any);
            expect(result).toBeDefined();
        });

        // Regression: the analyzer's htmlFilePath is forward-slash-normalized
        // while document.uri.fsPath is native (backslash on Windows). The old
        // `!==` comparison treated the current document as a *different* file
        // and added its edits a second time from disk — overlapping edits VS
        // Code refuses to apply. Each occurrence must be edited exactly once.
        it('should not produce duplicate edits for the current document (slash-style mismatch)', async () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html, htmlPath);

            // Simulate the disk readable at the analyzer's path so the old
            // duplicate path would have succeeded in re-adding the edits.
            const fsMod = require('fs');
            const readSpy = jest.spyOn(fsMod, 'readFileSync').mockReturnValue(html as any);
            try {
                const pos = doc.positionAt(html.indexOf('this.name') + 5);
                const result = await provider.provideRenameEdits(doc, pos, 'newName', token as any) as WorkspaceEdit;
                expect(result).toBeDefined();

                // Exactly ONE edit for the single occurrence in the template
                const htmlEntries = result.entries().filter(([uri]) => uri.path.endsWith('.html'));
                expect(htmlEntries.length).toBe(1);
                expect(htmlEntries[0][1].length).toBe(1);
            } finally {
                readSpy.mockRestore();
            }
        });

        // Regression: editing only the TS declaration left `this.member`
        // usages in method bodies pointing at the old name. The provider now
        // delegates to the TS rename provider at the declaration and merges
        // its .ts edits.
        it('should merge TS-side rename edits from the delegated TS rename provider', async () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            // The "TS rename provider" returns the declaration + a usage edit,
            // plus an HTML entry (as the ts-plugin would add) that must be
            // DROPPED — HTML is computed by this provider from live buffers.
            const delegated = new WorkspaceEdit();
            const tsUri = Uri.file('/test/container.ts');
            delegated.replace(tsUri, new Range(new Position(4, 12), new Position(4, 16)), 'newName');
            delegated.replace(tsUri, new Range(new Position(8, 20), new Position(8, 24)), 'newName');
            delegated.replace(Uri.file('/test/template.html'), new Range(new Position(0, 0), new Position(0, 4)), 'stale');
            (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(delegated);

            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('this.name') + 5);
            const result = await provider.provideRenameEdits(doc, pos, 'newName', token as any) as WorkspaceEdit;
            expect(result).toBeDefined();

            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
                'vscode.executeDocumentRenameProvider',
                expect.anything(),
                expect.anything(),
                'newName'
            );

            const tsEntry = result.entries().find(([uri]) => uri.path.endsWith('.ts'));
            expect(tsEntry).toBeDefined();
            // Both delegated TS edits merged — not just the declaration
            expect(tsEntry![1].length).toBe(2);

            // The delegated HTML edit was dropped; our own single HTML edit remains
            const htmlEntry = result.entries().find(([uri]) => uri.path.endsWith('.html'));
            expect(htmlEntry).toBeDefined();
            expect(htmlEntry![1].length).toBe(1);
            expect(htmlEntry![1][0].newText).toBe('newName');
        });

        it('should fall back to a declaration-only TS edit when no TS rename provider responds', async () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            (vscode.commands.executeCommand as jest.Mock).mockRejectedValue(new Error('no provider'));

            const html = '<div nb-value="this.name"></div>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('this.name') + 5);
            const result = await provider.provideRenameEdits(doc, pos, 'newName', token as any) as WorkspaceEdit;
            expect(result).toBeDefined();

            const tsEntry = result.entries().find(([uri]) => uri.path.endsWith('.ts'));
            expect(tsEntry).toBeDefined();
            expect(tsEntry![1].length).toBe(1);
            // The fallback edit targets the member NAME — assert the range
            // actually covers 'name' in the source (BUG: positions previously
            // pointed at the start of modifiers/decorators).
            const range = tsEntry![1][0].range;
            const lines = containerSource.split('\n');
            const targeted = lines[range.start.line].substring(range.start.character, range.end.character);
            expect(targeted).toBe('name');
        });
    });

    // ---- Regression: cursor on a CHAINED member must not rename the root ----
    // `this.name.length` with the cursor on `length` used to silently rename
    // `name` everywhere — the exact opposite of the user's intent.
    describe('chained member rename guard', () => {
        it('prepareRename rejects with a message when the cursor is on a chained member', () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.name.length"></div>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('.length') + 2); // on 'length'
            expect(() => provider.prepareRename(doc, pos, token as any))
                .toThrow(/chained member/);
            // The message must not promise that a TS-side rename updates
            // templates — chained members are not folded in by the ts-plugin.
            expect(() => provider.prepareRename(doc, pos, token as any))
                .toThrow(/update template usages manually/);
        });

        it('provideRenameEdits returns undefined for a chained member position', async () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.name.length"></div>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('.length') + 2);
            const result = await provider.provideRenameEdits(doc, pos, 'newName', token as any);
            expect(result).toBeUndefined();
        });

        it('still renames normally with the cursor on the root of a chain', async () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.name.length"></div>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('this.name') + 5); // on 'name'
            const result = await provider.provideRenameEdits(doc, pos, 'newName', token as any);
            expect(result).toBeDefined();
        });
    });

    // ---- Regression: '@' constant literals are not references ----
    // The runtime never evaluates '@'-prefixed values; renaming rewrote the
    // literal text, changing what the app displays.
    describe('constant-literal (@) handling', () => {
        it('does not edit this.member occurrences inside @ literals', async () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<div nb-value="this.name"></div><span nb-value="@this.name stays literal"></span>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('this.name') + 5);
            const result = await provider.provideRenameEdits(doc, pos, 'newName', token as any) as WorkspaceEdit;
            expect(result).toBeDefined();

            const htmlEntries = result.entries().filter(([uri]) => uri.path.endsWith('.html'));
            expect(htmlEntries).toHaveLength(1);
            // Only the evaluated binding is edited — the literal is untouched
            expect(htmlEntries[0][1]).toHaveLength(1);
        });

        it('refuses to start a rename from inside a @ literal', async () => {
            const htmlPath = setupAssociation();
            if (!htmlPath) return;

            const html = '<span nb-value="@this.name stays literal"></span>';
            const doc = createMockDocument(html, htmlPath);
            const pos = doc.positionAt(html.indexOf('this.name') + 5 + 1); // inside the literal, +1 for '@'
            expect(provider.prepareRename(doc, pos, token as any)).toBeUndefined();
            expect(await provider.provideRenameEdits(doc, pos, 'newName', token as any)).toBeUndefined();
        });
    });

    // ---- Regression: sibling subclasses' templates went stale ----
    // Renaming Base.title from CardA's template updated TS + CardA's template
    // but left CardB's template referencing the old name — silently broken at
    // runtime. The fan-out is now declaration-based.
    describe('base-class member fan-out', () => {
        it('edits every template whose class shares the member declaration', async () => {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubond-rename-m4-')).replace(/\\/g, '/');
            try {
                fs.writeFileSync(`${tmp}/base.ts`, `export class BaseCard { title: string = ''; }`, 'utf-8');
                fs.writeFileSync(`${tmp}/a.ts`, [
                    "import html from './a.html';",
                    "import { BaseCard } from './base';",
                    '@Container(html)',
                    'class CardA extends BaseCard {}',
                ].join('\n'), 'utf-8');
                fs.writeFileSync(`${tmp}/b.ts`, [
                    "import html from './b.html';",
                    "import { BaseCard } from './base';",
                    '@Container(html)',
                    'class CardB extends BaseCard {}',
                ].join('\n'), 'utf-8');
                const aHtml = '<div nb-value="this.title"></div>';
                const bHtml = '<span nb-value="this.title"></span><i nb-value="this.title"></i>';
                fs.writeFileSync(`${tmp}/a.html`, aHtml, 'utf-8');
                fs.writeFileSync(`${tmp}/b.html`, bHtml, 'utf-8');

                // Program path (with TypeChecker) so inherited members carry declaredIn
                analyzer.analyzeFiles([`${tmp}/base.ts`, `${tmp}/a.ts`, `${tmp}/b.ts`]);

                const doc = createMockDocument(aHtml, `${tmp}/a.html`);
                const pos = doc.positionAt(aHtml.indexOf('this.title') + 5); // on 'title'
                const result = await provider.provideRenameEdits(doc, pos, 'header', token as any) as WorkspaceEdit;
                expect(result).toBeDefined();

                const entryFor = (suffix: string) =>
                    result.entries().find(([uri]) => uri.path.toLowerCase().endsWith(suffix));

                // TS declaration edit lands in base.ts (declaration-only fallback)
                expect(entryFor('base.ts')).toBeDefined();
                // The initiating template is edited…
                expect(entryFor('a.html')).toBeDefined();
                expect(entryFor('a.html')![1]).toHaveLength(1);
                // …and CRUCIALLY the sibling subclass's template too
                expect(entryFor('b.html')).toBeDefined();
                expect(entryFor('b.html')![1]).toHaveLength(2);
                expect(entryFor('b.html')![1].every(e => e.newText === 'header')).toBe(true);
            } finally {
                try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp reaper */ }
            }
        });
    });

    // ---- Regression: fanned-out templates were read from DISK ----
    // A WorkspaceEdit applies to the BUFFER — for an open template with
    // unsaved changes, ranges computed from stale disk content landed at
    // wrong positions, silently corrupting the document.
    describe('open dirty templates (live buffers)', () => {
        it('computes fanned-out template edits from the open buffer, not stale disk content', async () => {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubond-rename-r2-')).replace(/\\/g, '/');
            try {
                fs.writeFileSync(`${tmp}/base.ts`, `export class BaseCard { title: string = ''; }`, 'utf-8');
                fs.writeFileSync(`${tmp}/a.ts`, [
                    "import html from './a.html';",
                    "import { BaseCard } from './base';",
                    '@Container(html)',
                    'class CardA extends BaseCard {}',
                ].join('\n'), 'utf-8');
                fs.writeFileSync(`${tmp}/b.ts`, [
                    "import html from './b.html';",
                    "import { BaseCard } from './base';",
                    '@Container(html)',
                    'class CardB extends BaseCard {}',
                ].join('\n'), 'utf-8');
                const aHtml = '<div nb-value="this.title"></div>';
                const bDisk = '<span nb-value="this.title"></span>';
                fs.writeFileSync(`${tmp}/a.html`, aHtml, 'utf-8');
                fs.writeFileSync(`${tmp}/b.html`, bDisk, 'utf-8');

                analyzer.analyzeFiles([`${tmp}/base.ts`, `${tmp}/a.ts`, `${tmp}/b.ts`]);

                // b.html is open with an unsaved line ABOVE the binding — its
                // buffer positions are one line below the disk positions.
                const bBuffer = '<!-- unsaved note -->\n' + bDisk;
                const bDoc = createMockDocument(bBuffer, `${tmp}/b.html`);
                (vscode.workspace as any).textDocuments = [bDoc];

                const doc = createMockDocument(aHtml, `${tmp}/a.html`);
                const pos = doc.positionAt(aHtml.indexOf('this.title') + 5); // on 'title'
                const result = await provider.provideRenameEdits(doc, pos, 'header', token as any) as WorkspaceEdit;
                expect(result).toBeDefined();

                const bEntry = result.entries().find(([uri]) => uri.path.toLowerCase().endsWith('b.html'));
                expect(bEntry).toBeDefined();
                expect(bEntry![1]).toHaveLength(1);
                // The edit must target the BUFFER's line 1, not disk's line 0.
                expect(bEntry![1][0].range.start.line).toBe(1);
                expect(bEntry![1][0].range.start.character).toBe(bDisk.indexOf('this.title') + 'this.'.length);
            } finally {
                (vscode.workspace as any).textDocuments = [];
                try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp reaper */ }
            }
        });
    });
});
