/**
 * hover-provider.ts
 * Shows rich documentation when hovering over nb-* attributes in HTML templates.
 * Also shows type info when hovering over this.member expressions.
 */

import * as vscode from 'vscode';
import { logError } from '../core/logger';
import { getHandlerInfo, buildHandlerDocumentation } from '../core/attribute-registry';
import { findBindingAtOffset, getAllRepeatScopes, getAllLocalVars, findElementAtOffset, isEvaluatedBinding } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import type { TemplateAttribute, ParsedTemplate } from '../core/template-parser';
import { parseExpression, findMemberAtOffset, maskNonCode, MemberReference } from '../core/expression-parser';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';
import type { TemplateAssociation } from '../core/decorator-analyzer';
import { inferItemType, getEventType, getElementType, getChainIndexAtOffset, resolveChainType, getEventMemberInfo, getDomMemberInfo, getElementManipulationMemberInfo } from '../core/utils';
import type { MemberInfo } from '../core/utils';
import { getModelInjection, getModelInjectionByType } from '../core/model-injections-registry';

export class nHoverProvider implements vscode.HoverProvider {
    constructor(private analyzer: DecoratorAnalyzer) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.Hover | undefined {
        try {
            return this.computeHover(document, position, token);
        } catch (err) {
            // Swallow errors so a broken code path cannot leave the hover
            // popup stuck in a "Loading..." state across subsequent edits.
            // But log so the bug doesn't stay invisible.
            logError(`hover(${document.uri?.fsPath ?? '<unknown>'}@${position.line}:${position.character})`, err);
            return undefined;
        }
    }

    private computeHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | undefined {
        const offset = document.offsetAt(position);
        const parsed = parseTemplateCached(document);

        const hit = findBindingAtOffset(parsed, offset);
        if (!hit) return undefined;

        const { binding, inValue } = hit;

        if (!inValue) {
            // Hovering over the attribute name → show handler documentation
            const handler = getHandlerInfo(binding.fullName);
            if (!handler) return undefined;

            const markdown = buildHandlerDocumentation(handler, binding.fullName);
            const md = new vscode.MarkdownString(markdown);
            md.isTrusted = true;

            const nameRange = new vscode.Range(
                document.positionAt(binding.nameSpan.start),
                document.positionAt(binding.nameSpan.end)
            );
            return new vscode.Hover(md, nameRange);
        }

        // '@' constants and '%' route slots are literal text at runtime — a
        // `this.member` or identifier inside them is prose, not a resolvable
        // reference (same rule rename/references/definition already apply).
        if (!isEvaluatedBinding(binding)) return undefined;

        // Hovering inside the attribute value → show member info if on this.X
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);

        const offsetInValue = offset - binding.valueSpan.start;
        // Offset of the expression inside the raw value (prefix may sit after
        // leading whitespace — the runtime trims before prefix detection).
        const prefixLen = binding.expressionOffset;
        const exprOffset = offsetInValue - prefixLen;

        if (exprOffset < 0) return undefined;

        const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);
        const memberRef = findMemberAtOffset(exprInfo, exprOffset);

        if (memberRef) {
            const chainIndex = getChainIndexAtOffset(memberRef.chain, memberRef.start, exprOffset, memberRef.separators);

            if (chainIndex > 0 && associations.length > 0) {
                // Chained member — walk the chain resolving types (class members)
                const result = this.resolveChainedMember(memberRef, chainIndex, associations);
                if (result) {
                    const md = new vscode.MarkdownString();
                    md.appendCodeblock(
                        `(${result.kind}) ${result.ownerType}.${result.name}: ${result.type}`,
                        'typescript'
                    );
                    md.appendMarkdown(`\n\nDefined in \`${result.ownerType}\``);

                    const valueRange = new vscode.Range(
                        document.positionAt(binding.valueSpan.start + prefixLen + memberRef.start),
                        document.positionAt(binding.valueSpan.start + prefixLen + memberRef.end)
                    );
                    return new vscode.Hover(md, valueRange);
                }
                // Unresolvable chained member: no hover. Falling through
                // rendered the ROOT member's info while the cursor sat on
                // `bar` in `this.foo.bar` — wrong symbol, shown confidently.
                return undefined;
            }

            // Root member hover — check class members first
            for (const assoc of associations) {
                const member = this.analyzer.findMember(assoc, memberRef.rootMember);
                if (member) {
                    const md = new vscode.MarkdownString();
                    md.appendCodeblock(
                        `(${member.kind}) ${assoc.className}.${member.name}: ${member.type}`,
                        'typescript'
                    );
                    md.appendMarkdown(`\n\nDefined in \`${assoc.className}\``);

                    const valueRange = new vscode.Range(
                        document.positionAt(binding.valueSpan.start + prefixLen + memberRef.start),
                        document.positionAt(binding.valueSpan.start + prefixLen + memberRef.end)
                    );
                    return new vscode.Hover(md, valueRange);
                }
            }

            // Check model injections by conventional name — ONLY when no
            // analysis data exists for this template. DI is constructor-param
            // based (the instance property is whatever the user named the
            // param), so when associations exist a missing member means the
            // reference is dead and diagnostics flags it; blessing it here
            // contradicted the diagnostics provider. Members whose declared
            // TYPE is an injection are handled in resolveChainedMember.
            const injection = associations.length === 0 ? getModelInjection(memberRef.rootMember) : undefined;
            if (injection) {
                if (chainIndex > 0) {
                    // Deep chain: e.g. this.changeDetector.detect — resolve from chain[1]+
                    const result = this.resolveInjectionChainedMember(memberRef, chainIndex, injection);
                    if (result) {
                        const md = new vscode.MarkdownString();
                        md.appendCodeblock(
                            `(${result.kind}) ${result.ownerType}.${result.name}: ${result.type}`,
                            'typescript'
                        );
                        md.appendMarkdown(`\n\n${result.desc}`);

                        const valueRange = new vscode.Range(
                            document.positionAt(binding.valueSpan.start + prefixLen + memberRef.start),
                            document.positionAt(binding.valueSpan.start + prefixLen + memberRef.end)
                        );
                        return new vscode.Hover(md, valueRange);
                    }
                }

                // Hovering on the injection name itself (chainIndex === 0): this.changeDetector
                const md = new vscode.MarkdownString();
                md.appendCodeblock(
                    `(injection) ${injection.name}: ${injection.type}`,
                    'typescript'
                );
                md.appendMarkdown(`\n\n${injection.desc}`);

                const valueRange = new vscode.Range(
                    document.positionAt(binding.valueSpan.start + prefixLen + memberRef.start),
                    document.positionAt(binding.valueSpan.start + prefixLen + memberRef.end)
                );
                return new vscode.Hover(md, valueRange);
            }
        }

        // Check for injected parameter hover (item, index, count, element, event, etc.)
        // Scanned on a MASKED copy (string/template-literal text, comments,
        // regex literals blanked — offsets preserved): an 'item' inside
        // `this.t('item')` is prose, and hovering it as a repeat parameter
        // documented an identifier the runtime never resolves there
        // (round-7 audit, R7-2). parseExpression masks internally, but these
        // fallback word/dotted-access scans previously ran on the raw text.
        const maskedExpression = maskNonCode(binding.expression);
        const wordAtOffset = getWordAtOffset(maskedExpression, exprOffset);
        if (wordAtOffset) {
            const element = findElementAtOffset(parsed, binding.nameSpan.start);
            const tagName = element?.tagName;
            const paramInfo = resolveInjectedParam(wordAtOffset.word, binding, parsed, offset, associations, this.analyzer, tagName);
            if (paramInfo) {
                const md = new vscode.MarkdownString();
                md.appendCodeblock(
                    `(parameter) ${paramInfo.name}: ${paramInfo.type}`,
                    'typescript'
                );
                md.appendMarkdown(`\n\nInjected by \`${paramInfo.source}\``);

                const valueRange = new vscode.Range(
                    document.positionAt(binding.valueSpan.start + prefixLen + wordAtOffset.start),
                    document.positionAt(binding.valueSpan.start + prefixLen + wordAtOffset.end)
                );
                return new vscode.Hover(md, valueRange);
            }

            // Check transformer functions
            const transformer = this.analyzer.getTransformerByFunctionName(wordAtOffset.word);
            if (transformer) {
                const md = new vscode.MarkdownString();
                const sig = this.analyzer.getMethodSignature(transformer.className, 'transform');
                if (sig) {
                    md.appendCodeblock(
                        `(transformer) ${wordAtOffset.word}${sig}`,
                        'typescript'
                    );
                } else {
                    md.appendCodeblock(
                        `(transformer) ${wordAtOffset.word}(...args: any[]): any`,
                        'typescript'
                    );
                }
                md.appendMarkdown(`\n\n\`@Transformer()\` class \`${transformer.className}\``);

                const valueRange = new vscode.Range(
                    document.positionAt(binding.valueSpan.start + prefixLen + wordAtOffset.start),
                    document.positionAt(binding.valueSpan.start + prefixLen + wordAtOffset.end)
                );
                return new vscode.Hover(md, valueRange);
            }
        }

        // Check for dotted access on injected parameters (event.X, nativeElement.X, element.X)
        // Same masking rule as above — `event.detail` inside a string literal
        // is prose, not a member access.
        const dottedAccess = findDottedAccessAtOffset(maskedExpression, exprOffset);
        if (dottedAccess) {
            const element = findElementAtOffset(parsed, binding.nameSpan.start);
            const tagName = element?.tagName;
            const resolved = resolveInjectedMemberHover(dottedAccess, binding, tagName);
            if (resolved) {
                const md = new vscode.MarkdownString();
                md.appendCodeblock(
                    `(${resolved.info.kind}) ${resolved.ownerType}.${dottedAccess.member}: ${resolved.info.type}`,
                    'typescript'
                );
                md.appendMarkdown(`\n\n${resolved.info.desc}`);

                const memberOffset = dottedAccess.memberStart;
                const memberEnd = dottedAccess.memberEnd;
                const valueRange = new vscode.Range(
                    document.positionAt(binding.valueSpan.start + prefixLen + memberOffset),
                    document.positionAt(binding.valueSpan.start + prefixLen + memberEnd)
                );
                return new vscode.Hover(md, valueRange);
            }
        }

        return undefined;
    }

    private resolveChainedMember(
        memberRef: MemberReference,
        chainIndex: number,
        associations: import('../core/decorator-analyzer').TemplateAssociation[]
    ): { name: string; type: string; kind: string; ownerType: string } | undefined {
        // Resolve root member type from the association
        let currentType: string | undefined;
        for (const assoc of associations) {
            const rootMember = this.analyzer.findMember(assoc, memberRef.rootMember);
            if (rootMember) {
                currentType = rootMember.type;
                break;
            }
        }

        // No name-based injection fallback here: with associations present, a
        // missing root member is a dead reference (diagnostics flags it).
        if (!currentType) return undefined;

        // Root member's declared type is a framework injection
        // (`constructor(private cd: ChangeDetector)` → `this.cd.detect`):
        // walk the injection's member tree instead of the type index, which
        // can't see framework types living in node_modules.
        const injectionForType = getModelInjectionByType(currentType);
        if (injectionForType) {
            let members = injectionForType.members;
            for (let i = 1; i <= chainIndex; i++) {
                const found = members.find(m => m.name === memberRef.chain[i]);
                if (!found) return undefined;
                if (i === chainIndex) {
                    return { name: found.name, type: found.type, kind: found.kind, ownerType: injectionForType.type };
                }
                members = found.subMembers ?? [];
            }
            return undefined;
        }

        // Walk intermediate chain members to resolve their types
        for (let i = 1; i < chainIndex; i++) {
            const found = this.analyzer.findMemberWithType(currentType, memberRef.chain[i]);
            if (!found) return undefined;
            currentType = found.type;
        }

        // Resolve the target member
        const target = this.analyzer.findMemberWithType(currentType, memberRef.chain[chainIndex]);
        if (!target) return undefined;

        const ownerType = currentType.replace(/<.*>/, '').replace(/\[\]$/, '').trim();
        return { name: memberRef.chain[chainIndex], type: target.type, kind: target.kind, ownerType };
    }

    private resolveInjectionChainedMember(
        memberRef: MemberReference,
        chainIndex: number,
        injection: import('../core/model-injections-registry').ModelInjection
    ): { name: string; type: string; kind: string; ownerType: string; desc: string } | undefined {
        // chain: ['changeDetector', 'detect', ...] — walk from chain[1]
        let members = injection.members;
        for (let i = 1; i <= chainIndex; i++) {
            const found = members.find(m => m.name === memberRef.chain[i]);
            if (!found) return undefined;
            if (i === chainIndex) {
                return { name: found.name, type: found.type, kind: found.kind, ownerType: injection.type, desc: found.desc };
            }
            members = found.subMembers ?? [];
        }
        return undefined;
    }
}

function getWordAtOffset(expression: string, offset: number): { word: string; start: number; end: number } | undefined {
    // Walk backwards to find word start
    let start = offset;
    while (start > 0 && /[\w$]/.test(expression[start - 1])) start--;
    // Walk forward to find word end
    let end = offset;
    while (end < expression.length && /[\w$]/.test(expression[end])) end++;

    if (start === end) return undefined;
    // Don't match if preceded by dot (property access, not a standalone param)
    if (start > 0 && expression[start - 1] === '.') return undefined;

    return { word: expression.substring(start, end), start, end };
}

interface ResolvedParam {
    name: string;
    type: string;
    source: string;
}

/**
 * Resolve the full type of a member reference by walking its chain.
 */
function resolveChainTypeForRef(
    ref: MemberReference,
    associations: TemplateAssociation[],
    analyzer: DecoratorAnalyzer
): string | undefined {
    return resolveChainType(
        ref.chain,
        associations,
        (assoc, name) => analyzer.findMember(assoc, name),
        (typeName, memberName) => analyzer.findMemberWithType(typeName, memberName)
    );
}

function resolveInjectedParam(
    word: string,
    binding: TemplateAttribute,
    parsed: ParsedTemplate,
    offset: number,
    associations: TemplateAssociation[],
    analyzer: DecoratorAnalyzer,
    tagName?: string
): ResolvedParam | undefined {
    // Check nb-event injected params (available in the event expression itself)
    if (binding.baseName === 'nb-event') {
        const eventType = binding.suffix ? getEventType(binding.suffix) : 'Event';
        const nativeType = tagName ? getElementType(tagName) : 'Element';
        const eventParams: Record<string, string> = {
            'event': eventType,
            'element': 'ElementManipulations',
            'nativeElement': nativeType,
            'data': 'any',
            'unSubscribe': '() => void',
            // Only injected when routing is configured — without a configured
            // router the parameter does not exist at all (referencing it is a
            // ReferenceError, not `undefined`), so the type is plain Router.
            'router': 'Router',
        };
        if (word in eventParams) {
            return { name: word, type: eventParams[word], source: `nb-event:${binding.suffix || ''}` };
        }
    }

    // Check nb-bound injected params
    if (binding.baseName === 'nb-bound') {
        const nativeType = tagName ? getElementType(tagName) : 'Element';
        const boundParams: Record<string, string> = {
            'element': 'ElementManipulations',
            'nativeElement': nativeType,
        };
        if (word in boundParams) {
            return { name: word, type: boundParams[word], source: 'nb-bound' };
        }
    }

    // Check nb-repeat injected params (available in descendant bindings and
    // sibling bindings — but NOT in the nb-repeat's own collection
    // expression, which runs with the parent params).
    const ownRepeat = binding.baseName === 'nb-repeat' ? binding : undefined;
    const repeatScopes = getAllRepeatScopes(parsed, offset, ownRepeat);
    for (const scope of repeatScopes) {
        const p = scope.prefix;
        const itemName = p ? `${p}Item` : 'item';
        const indexName = p ? `${p}Index` : 'index';
        const countName = p ? `${p}Count` : 'count';
        const repeatLabel = p ? `nb-repeat:${p}` : 'nb-repeat';

        if (word === indexName) {
            return { name: word, type: 'number', source: repeatLabel };
        }
        if (word === countName) {
            return { name: word, type: 'number', source: repeatLabel };
        }
        if (word === itemName) {
            // Infer item type from collection
            let collectionType = 'any[]';
            const repeatExpr = parseExpression(scope.repeatAttr.expression, scope.repeatAttr.expressionPrefix);
            for (const ref of repeatExpr.memberReferences) {
                const resolved = resolveChainTypeForRef(ref, associations, analyzer);
                if (resolved) {
                    collectionType = resolved;
                    break;
                }
            }
            const itemType = inferItemType(collectionType);
            return { name: word, type: itemType, source: repeatLabel };
        }
    }

    // Check nb-var local variables. The consumer-aware overload applies the
    // runtime gating rules: an nb-repeat's own expression and nb-case /
    // nb-default expressions never see the element's own vars, and the first
    // nb-var on an element sees no sibling vars.
    const localVars = getAllLocalVars(parsed, offset, binding);
    for (const lv of localVars) {
        if (word === lv.varName) {
            let varType = 'any';
            const varExpr = parseExpression(lv.attr.expression, lv.attr.expressionPrefix);
            for (const ref of varExpr.memberReferences) {
                const resolved = resolveChainTypeForRef(ref, associations, analyzer);
                if (resolved) {
                    varType = resolved;
                    break;
                }
            }
            return { name: word, type: varType, source: `nb-var:${lv.attr.suffix}` };
        }
    }

    // NOTE: `element` / `nativeElement` are deliberately NOT blessed here for
    // other bindings on an element that merely carries nb-bound — the runtime
    // injects them only into the nb-event / nb-bound expression itself
    // (handled above), and referencing them from a sibling nb-value is a
    // ReferenceError.

    return undefined;
}

// ─── Dotted-access helpers (event.X, nativeElement.X, element.X.Y) ──────────

interface DottedAccess {
    /** The base identifier (e.g. "event", "nativeElement", "element") */
    base: string;
    /** The member being hovered (e.g. "clientX", "style") */
    member: string;
    /** Optional sub-category for element.styles.get → sub="styles", member="get" */
    sub?: string;
    /** Start offset of the member in the expression */
    memberStart: number;
    /** End offset of the member in the expression */
    memberEnd: number;
}

/**
 * Find a dotted access chain at the given offset in an expression.
 * Handles: `base.member` and `base.sub.member` patterns.
 */
function findDottedAccessAtOffset(expression: string, offset: number): DottedAccess | undefined {
    // Find the word at offset (including words preceded by dot)
    let wStart = offset;
    while (wStart > 0 && /[\w$]/.test(expression[wStart - 1])) wStart--;
    let wEnd = offset;
    while (wEnd < expression.length && /[\w$]/.test(expression[wEnd])) wEnd++;

    if (wStart === wEnd) return undefined;
    // Must be preceded by a dot (regular `.` or optional chaining `?.`)
    if (wStart === 0 || expression[wStart - 1] !== '.') return undefined;
    // Determine actual dot position (skip `?` for optional chaining `?.`)
    let dotPos = wStart - 1;
    if (dotPos > 0 && expression[dotPos - 1] === '?') dotPos--;

    const member = expression.substring(wStart, wEnd);

    // Find the token before the dot
    let t1Start = dotPos;
    while (t1Start > 0 && /[\w$]/.test(expression[t1Start - 1])) t1Start--;
    const token1 = expression.substring(t1Start, dotPos);
    if (!token1) return undefined;

    const knownBases = ['event', 'nativeElement', 'element', 'router'];

    // Check for base.member (2-level)
    if (knownBases.includes(token1)) {
        return { base: token1, member, memberStart: wStart, memberEnd: wEnd };
    }

    // Check for base.sub.member (3-level, e.g. element.styles.get or element?.styles?.get)
    if (t1Start > 0 && (expression[t1Start - 1] === '.' || (t1Start >= 2 && expression[t1Start - 2] === '?' && expression[t1Start - 1] === '.'))) {
        let dot2Pos = t1Start - 1;
        if (dot2Pos > 0 && expression[dot2Pos - 1] === '?') dot2Pos--;
        let t0Start = dot2Pos;
        while (t0Start > 0 && /[\w$]/.test(expression[t0Start - 1])) t0Start--;
        const token0 = expression.substring(t0Start, dot2Pos);
        if (knownBases.includes(token0)) {
            return { base: token0, sub: token1, member, memberStart: wStart, memberEnd: wEnd };
        }
    }

    return undefined;
}

/**
 * Resolve hover info for a dotted access on an injected parameter. Every
 * branch is gated on the binding that actually injects the base identifier —
 * `element` / `nativeElement` exist only inside nb-event / nb-bound
 * expressions (like `event` exists only inside nb-event); blessing them in
 * an nb-value hover documented an identifier that is a ReferenceError there.
 */
function resolveInjectedMemberHover(
    access: DottedAccess,
    binding: TemplateAttribute,
    tagName?: string
): { info: MemberInfo; ownerType: string } | undefined {
    // event.X — look up in event member registry
    if (access.base === 'event' && !access.sub) {
        if (binding.baseName !== 'nb-event') return undefined;
        const eventType = binding.suffix ? getEventType(binding.suffix) : 'Event';
        const info = getEventMemberInfo(eventType, access.member);
        if (info) return { info, ownerType: eventType };
    }

    // router.X — the bare `router` param injected into nb-event expressions;
    // members come from the Router model-injection registry.
    if (access.base === 'router' && !access.sub) {
        if (binding.baseName !== 'nb-event') return undefined;
        const injection = getModelInjection('router');
        const member = injection?.members.find(m => m.name === access.member);
        if (member) {
            return {
                info: { type: member.type, desc: member.desc, kind: member.kind },
                ownerType: injection!.type,
            };
        }
    }

    const injectsElementParams = binding.baseName === 'nb-event' || binding.baseName === 'nb-bound';

    // nativeElement.X — look up in DOM element member registry
    if (access.base === 'nativeElement' && !access.sub) {
        if (!injectsElementParams) return undefined;
        const elementType = tagName ? getElementType(tagName) : 'HTMLElement';
        const info = getDomMemberInfo(access.member, elementType);
        if (info) return { info, ownerType: elementType };
    }

    // element.X — top-level ElementManipulations member
    if (access.base === 'element' && !access.sub) {
        if (!injectsElementParams) return undefined;
        const info = getElementManipulationMemberInfo(undefined, access.member);
        if (info) return { info, ownerType: 'ElementManipulations' };
    }

    // element.sub.X — sub-manipulation member (e.g. element.styles.get)
    if (access.base === 'element' && access.sub) {
        if (!injectsElementParams) return undefined;
        const info = getElementManipulationMemberInfo(access.sub, access.member);
        if (info) {
            const subTypes: Record<string, string> = {
                properties: 'ElementPropertiesManipulations',
                attributes: 'ElementAttributesManipulations',
                styles:     'ElementStylesManipulations',
                classes:    'ElementClassesManipulations',
            };
            return { info, ownerType: subTypes[access.sub] || 'ElementManipulations' };
        }
    }

    return undefined;
}
