/**
 * definition-provider.ts
 * Go-to-definition from HTML template → TS class member.
 * Ctrl+Click / F12 on this.property or this.method() navigates to the TS declaration.
 */

import * as vscode from 'vscode';
import { logError } from '../core/logger';
import { findBindingAtOffset, getAllLocalVars, getAllRepeatScopes, isEvaluatedBinding } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { parseExpression, findMemberAtOffset, getIdentifierAtOffset, maskNonCode } from '../core/expression-parser';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';
import { getChainIndexAtOffset } from '../core/utils';

export class nDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private analyzer: DecoratorAnalyzer) {}

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Definition | undefined {
        try {
            return this.computeDefinition(document, position);
        } catch (err) {
            // Swallow errors so a single broken code path cannot poison
            // VSCode's language-service state (which would cause go-to-def,
            // hover and TS navigation to hang or stop working across edits).
            logError(`definition(${document.uri?.fsPath ?? '<unknown>'}@${position.line}:${position.character})`, err);
            return undefined;
        }
    }

    private computeDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Definition | undefined {
        const offset = document.offsetAt(position);
        const parsed = parseTemplateCached(document);

        const hit = findBindingAtOffset(parsed, offset);
        if (!hit || !hit.inValue) return undefined;

        const { binding } = hit;

        // Handle @EntityName navigation for container/component/template.
        // nb-template resolves the RAW remainder after '@': Template.ts does a
        // plain substring(1) with no inner trim (only the outer attribute-value
        // trim applies), so `@ name` looks up ' name' and fails at runtime —
        // navigation must not resolve a name the runtime can't. Container /
        // component names go through ExpressionDetails, which trims after the
        // prefix, so a full trim models those correctly.
        if (binding.expressionPrefix === '@') {
            const entityName = binding.baseName === 'nb-template'
                ? binding.expression.trimEnd()
                : binding.expression.trim();
            if (entityName && (binding.baseName === 'nb-container' || binding.baseName === 'nb-component' || binding.baseName === 'nb-template')) {
                return this.navigateToEntity(entityName, binding.baseName);
            }
        }

        // '@' constants and '%' route slots are literal text at runtime —
        // a `this.member` inside them is prose, not a navigable reference
        // (same rule rename/references/CodeLens/highlight already apply).
        if (!isEvaluatedBinding(binding)) return undefined;

        const offsetInValue = offset - binding.valueSpan.start;
        const exprOffset = offsetInValue - binding.expressionOffset;

        if (exprOffset < 0) return undefined;

        const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);
        const memberRef = findMemberAtOffset(exprInfo, exprOffset);

        // If not on a this.X member, check if on an nb-var or nb-repeat variable.
        // The identifier is read from a MASKED copy (string/template text,
        // comments, regex literals blanked — offsets preserved): an 'item'
        // inside a string literal is prose, and navigating it to the
        // nb-repeat attribute blessed a non-reference (round-7 audit, R7-2).
        if (!memberRef) {
            const ident = getIdentifierAtOffset(maskNonCode(binding.expression), exprOffset);
            if (ident) {
                // Check nb-var locals. The consumer-aware overload applies
                // the runtime gating rules (an nb-repeat's own expression and
                // nb-case/nb-default expressions never see the element's own
                // vars; the first nb-var sees no sibling vars).
                const localVars = getAllLocalVars(parsed, binding.nameSpan.start, binding);
                const matchedVar = localVars.find(v => v.varName === ident.word);
                if (matchedVar) {
                    const pos = new vscode.Position(matchedVar.attr.nameSpan.line, matchedVar.attr.nameSpan.character);
                    return new vscode.Location(document.uri, pos);
                }

                // Check nb-repeat context params (item/index/count with optional prefix).
                // A prefixed scope injects ONLY the camelCase prefixed names
                // (outerItem, …) — the runtime never injects 'outeritem'.
                // The nb-repeat's OWN expression runs with the parent params,
                // so its own scope is excluded — `item` there navigates to an
                // OUTER repeat (or nowhere), never to itself.
                const ownRepeat = binding.baseName === 'nb-repeat' ? binding : undefined;
                const repeatScopes = getAllRepeatScopes(parsed, binding.nameSpan.start, ownRepeat);
                for (const scope of repeatScopes) {
                    const prefix = scope.prefix;
                    const params = prefix
                        ? [prefix + 'Item', prefix + 'Index', prefix + 'Count']
                        : ['item', 'index', 'count'];
                    if (params.includes(ident.word)) {
                        const pos = new vscode.Position(scope.repeatAttr.nameSpan.line, scope.repeatAttr.nameSpan.character);
                        return new vscode.Location(document.uri, pos);
                    }
                }

                // Check nb-bound / nb-event injected params — navigate to the
                // declaring attribute, but ONLY when the current binding is
                // the injecting expression itself. The runtime never
                // propagates these params to sibling bindings or descendants
                // (Events.bind / Bound.bind return the incoming params
                // unchanged), so `element` in an nb-value is a runtime
                // ReferenceError — walking ancestors to "resolve" it
                // navigated to an attribute that does not define it.
                const boundEventParams: Record<string, string[]> = {
                    'element': ['nb-bound', 'nb-event'],
                    'nativeElement': ['nb-bound', 'nb-event'],
                    'event': ['nb-event'],
                    'data': ['nb-event'],
                    'unSubscribe': ['nb-event'],
                    'router': ['nb-event'],
                };
                const targetBases = boundEventParams[ident.word];
                if (targetBases && targetBases.includes(binding.baseName)) {
                    const pos = new vscode.Position(binding.nameSpan.line, binding.nameSpan.character);
                    return new vscode.Location(document.uri, pos);
                }

                // Check transformer function names — navigate to the transform() method
                const transformer = this.analyzer.getTransformerByFunctionName(ident.word);
                if (transformer) {
                    const transformMethod = this.analyzer.findMemberInType(transformer.className, 'transform');
                    if (transformMethod) {
                        return new vscode.Location(
                            vscode.Uri.file(transformMethod.filePath),
                            new vscode.Position(transformMethod.line, transformMethod.character)
                        );
                    }
                    // Fallback: navigate to the transformer class file
                    return new vscode.Location(
                        vscode.Uri.file(transformer.tsFilePath),
                        new vscode.Position(0, 0)
                    );
                }
            }
            return undefined;
        }

        // Look up the member declaration in the associated TS class
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);

        // Determine which chain segment the cursor is on
        const chainIndex = getChainIndexAtOffset(memberRef.chain, memberRef.start, exprOffset, memberRef.separators);

        // If cursor is on a chained member (not root), try type-based navigation
        if (chainIndex > 0) {
            const targetMember = memberRef.chain[chainIndex];
            // Walk the chain to resolve the type at the previous level
            let currentType: string | undefined;
            for (const assoc of associations) {
                const rootMember = this.analyzer.findMember(assoc, memberRef.rootMember);
                if (rootMember) {
                    currentType = rootMember.type;
                    break;
                }
            }
            // Walk through intermediate chain members to get the type
            for (let i = 1; i < chainIndex && currentType; i++) {
                const found = this.analyzer.findMemberWithType(currentType, memberRef.chain[i]);
                if (!found) { currentType = undefined; break; }
                currentType = found.type;
            }
            if (currentType) {
                const found = this.analyzer.findMemberInType(currentType, targetMember);
                if (found) {
                    return new vscode.Location(
                        vscode.Uri.file(found.filePath),
                        new vscode.Position(found.line, found.character)
                    );
                }
            }
        }

        // Default: navigate to root member. Inherited members carry the path
        // of the base class file that actually declares them.
        for (const assoc of associations) {
            const member = this.analyzer.findMember(assoc, memberRef.rootMember);
            if (member) {
                const uri = vscode.Uri.file(member.declaredIn ?? assoc.tsFilePath);
                const pos = new vscode.Position(member.line, member.character);
                return new vscode.Location(uri, pos);
            }
        }

        return undefined;
    }

    private navigateToEntity(entityName: string, attrName: string): vscode.Location | undefined {
        const typeMap: Record<string, string> = {
            'nb-container': 'container',
            'nb-component': 'component',
            'nb-template': 'template',
        };
        const entityType = typeMap[attrName];
        if (!entityType) return undefined;

        const entities = this.analyzer.getEntitiesByType(entityType as any);
        // Match by the runtime-registered name first (custom names from the
        // ['name', template] decorator form), then by class name. Framework
        // entity lookup is case-insensitive throughout.
        const wanted = entityName.toLowerCase();
        const entity = entities.find(e =>
            e.name.toLowerCase() === wanted ||
            e.className.toLowerCase() === wanted
        );

        if (entity) {
            // Navigate to the class in the TS file
            const allAssocs = this.analyzer.getAllAssociations();
            const assoc = allAssocs.find(a =>
                a.className === entity.className && a.tsFilePath === entity.tsFilePath
            );
            if (assoc) {
                return new vscode.Location(
                    vscode.Uri.file(assoc.tsFilePath),
                    new vscode.Position(assoc.classLine, assoc.classCharacter)
                );
            }
            // Fallback: the entity's own recorded position (e.g. a
            // $Template(...) call site), or the start of the file.
            return new vscode.Location(
                vscode.Uri.file(entity.tsFilePath),
                new vscode.Position(entity.line ?? 0, entity.character ?? 0)
            );
        }

        return undefined;
    }
}
