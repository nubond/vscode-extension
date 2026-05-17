/**
 * Isolation tests: every provider must swallow internal errors rather than
 * letting them propagate to the extension host. A thrown exception from one
 * provider can leave VSCode's language-service state wedged (hover hangs,
 * completion stops firing, TS highlighting drifts) across the whole session,
 * so the contract here is: providers return `undefined`/empty when something
 * goes wrong, never throw.
 */

import * as vscode from 'vscode';
import { nCompletionProvider } from '../../src/providers/completion-provider';
import { nHoverProvider } from '../../src/providers/hover-provider';
import { nDefinitionProvider } from '../../src/providers/definition-provider';
import { nReferenceProvider } from '../../src/providers/reference-provider';
import { nRenameProvider } from '../../src/providers/rename-provider';
import { nDocumentHighlightProvider } from '../../src/providers/document-highlight-provider';
import { nDocumentSymbolProvider } from '../../src/providers/document-symbols-provider';
import { nSemanticTokenProvider } from '../../src/providers/semantic-token-provider';
import { nCodeLensProvider } from '../../src/providers/codelens-provider';
import { nDiagnosticsProvider } from '../../src/providers/diagnostics-provider';
import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { createMockDocument, createCancellationToken } from '../helpers';

const BROKEN_TEMPLATES = [
    // The exact mid-edit bug the user reported: nb-event: with no suffix on a div.
    '<div nb-event: class="body">content</div>',
    // nb-var: with no suffix — potential infinite loop in semantic tokens.
    '<div nb-var:>content</div>',
    // Dangling tag with trailing colon.
    '<div nb-event:',
    // Many attributes before a broken one.
    '<fluent-tab nb-repeat="@2" nb-attr:disabled="null" slot="tab" role="tab" data-animate="true">\n  <div nb-event: class="x"></div>\n</fluent-tab>',
    // nb-prop with half-typed colon.
    '<button nb-prop:>ok</button>',
    // nb-in-ref half-typed.
    '<my-comp nb-in-ref:>x</my-comp>',
    // nb-repeat without suffix.
    '<ul><li nb-repeat="">{{item}}</li></ul>',
];

describe('provider isolation — broken mid-edit HTML must not throw', () => {
    let analyzer: DecoratorAnalyzer;
    const token = createCancellationToken();
    const context = { triggerKind: 0, triggerCharacter: ':' };

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
    });

    for (const html of BROKEN_TEMPLATES) {
        describe(`template: ${JSON.stringify(html.slice(0, 60))}`, () => {
            it('completion provider never throws at any offset', () => {
                const provider = new nCompletionProvider(analyzer);
                const doc = createMockDocument(html);
                for (let off = 0; off <= html.length; off++) {
                    expect(() =>
                        provider.provideCompletionItems(
                            doc, doc.positionAt(off), token as any, context as any
                        )
                    ).not.toThrow();
                }
            });

            it('hover provider never throws at any offset', () => {
                const provider = new nHoverProvider(analyzer);
                const doc = createMockDocument(html);
                for (let off = 0; off <= html.length; off++) {
                    expect(() =>
                        provider.provideHover(doc, doc.positionAt(off), token as any)
                    ).not.toThrow();
                }
            });

            it('definition provider never throws at any offset', () => {
                const provider = new nDefinitionProvider(analyzer);
                const doc = createMockDocument(html);
                for (let off = 0; off <= html.length; off++) {
                    expect(() =>
                        provider.provideDefinition(doc, doc.positionAt(off), token as any)
                    ).not.toThrow();
                }
            });

            it('reference provider never throws at any offset', () => {
                const provider = new nReferenceProvider(analyzer);
                const doc = createMockDocument(html);
                for (let off = 0; off <= html.length; off++) {
                    expect(() =>
                        provider.provideReferences(
                            doc, doc.positionAt(off), { includeDeclaration: true }, token as any
                        )
                    ).not.toThrow();
                }
            });

            it('rename provider never throws at any offset', () => {
                const provider = new nRenameProvider(analyzer);
                const doc = createMockDocument(html);
                for (let off = 0; off <= html.length; off++) {
                    expect(() =>
                        provider.prepareRename(doc, doc.positionAt(off), token as any)
                    ).not.toThrow();
                    expect(() =>
                        provider.provideRenameEdits(doc, doc.positionAt(off), 'newName', token as any)
                    ).not.toThrow();
                }
            });

            it('document highlight provider never throws', () => {
                const provider = new nDocumentHighlightProvider();
                const doc = createMockDocument(html);
                for (let off = 0; off <= html.length; off++) {
                    expect(() =>
                        provider.provideDocumentHighlights(doc, doc.positionAt(off), token as any)
                    ).not.toThrow();
                }
            });

            it('document symbols provider never throws', () => {
                const provider = new nDocumentSymbolProvider();
                const doc = createMockDocument(html);
                expect(() =>
                    provider.provideDocumentSymbols(doc, token as any)
                ).not.toThrow();
            });

            it('semantic tokens provider never throws', () => {
                const provider = new nSemanticTokenProvider(analyzer);
                const doc = createMockDocument(html);
                expect(() =>
                    provider.provideDocumentSemanticTokens(doc, token as any)
                ).not.toThrow();
            });

            it('diagnostics provider never throws', () => {
                const provider = new nDiagnosticsProvider(analyzer);
                const doc = createMockDocument(html);
                expect(() => provider.validate(doc as any)).not.toThrow();
            });
        });
    }
});
