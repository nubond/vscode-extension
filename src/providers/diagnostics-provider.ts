/**
 * diagnostics-provider.ts
 * Validates nb-* attribute expressions and produces diagnostics (squiggles):
 * - Unknown nb-* attribute names (typos)
 * - References to non-existent class members (this.nonExistent)
 * - nb-case / nb-default without parent nb-switch
 * - Repeat params used outside nb-repeat scope
 */

import * as vscode from 'vscode';
import { ParsedTemplate, TemplateAttribute, getAllRepeatScopes, getAllLocalVars, isEvaluatedBinding, kebabToCamelCase, RESERVED_CONTEXT_NAMES } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { parseExpression, maskNonCode } from '../core/expression-parser';
import { isNAttribute, getHandlerInfo, ALL_NB_ATTRIBUTES, PREFIX_ATTRIBUTES } from '../core/attribute-registry';
import { getAllGlobalObjects, getAllGlobalFunctions, getAllGlobalConstants } from '../core/globals-registry';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';
import { logError } from '../core/logger';
import { Constants } from '../constants';

/**
 * Handlers the runtime accepts with an EMPTY (trimmed) value: the Attributes
 * constructor admits value-less names via KNOWN_HANDLERS_WITHOUT_VALUE
 * (nb-aspect…, nb-default) and the extension attributes (projection trio +
 * nb-component). Every OTHER empty-valued nb-* attribute logs "attributes
 * should have value." and is dropped before any handler sees it.
 */
const EMPTY_VALUE_ALLOWED: ReadonlySet<string> = new Set([
    'nb-aspect', 'nb-default', 'nb-projection', 'nb-project-to', 'nb-project-instead', 'nb-component',
]);

/**
 * Handlers whose value the runtime evaluates as a JavaScript expression. The
 * '%' route-slot prefix is honored by nb-container ONLY — everywhere in this
 * set a leading '%' reaches `new Function` and is a guaranteed SyntaxError.
 * nb-style is deliberately absent (its value is split into `prop: expr`
 * entries before any expression is seen), as are nb-template (never
 * evaluated) and the projection/marker attributes (literal values).
 */
const EXPRESSION_VALUE_HANDLERS: ReadonlySet<string> = new Set([
    'nb-value', 'nb-html', 'nb-class', 'nb-if', 'nb-switch', 'nb-case', 'nb-repeat',
    'nb-exec', 'nb-bound', 'nb-event', 'nb-var', 'nb-attr', 'nb-prop', 'nb-in',
    'nb-in-ref', 'nb-aspect',
]);

/**
 * DOM properties the Properties handler rejects with a console error, keyed
 * by the lowercased camelCase name the runtime derives from the suffix.
 * `outerHTML` joined the runtime blocklist in the framework's 2026-07-13 fixes.
 */
const BLOCKED_PROP_TARGETS: ReadonlyMap<string, string> = new Map([
    ['classlist', "use 'nb-class' instead"],
    ['classname', "use 'nb-class' instead"],
    ['style', "use 'nb-style' instead"],
    ['textcontent', "use 'nb-value' instead"],
    ['innertext', "use 'nb-value' instead"],
    ['innerhtml', "use 'nb-html' instead"],
    ['outerhtml', "'outerHTML' cannot be changed at all"],
]);

const NB_EXACT_NAMES: ReadonlySet<string> = new Set(ALL_NB_ATTRIBUTES);

/**
 * Recognized nb-* attributes that do NOT make an element N-applicable at
 * runtime: `Attributes.isNApplicable` checks only KNOWN_HANDLERS_SET and
 * KNOWN_PREFIX_HANDLERS — the projection trio and nb-component live in
 * KNOWN_HANDLER_EXTENSIONS, which the applicability check never consults.
 */
const EXTENSION_ONLY_ATTRIBUTES: ReadonlySet<string> = new Set([
    'nb-component', 'nb-projection', 'nb-project-to', 'nb-project-instead',
]);

/**
 * Exact handler names that grant N-applicability (mirror of the runtime's
 * KNOWN_HANDLERS_SET — matched against the FULL attribute name, so a dead
 * suffixed spelling like 'nb-value:foo' does not qualify).
 */
const EXACT_APPLICABLE_HANDLERS: ReadonlySet<string> = new Set(
    ALL_NB_ATTRIBUTES.filter(a => !PREFIX_ATTRIBUTES.includes(a) && !EXTENSION_ONLY_ATTRIBUTES.has(a)));

/**
 * True when this attribute makes its element N-applicable at runtime.
 * Mirrors `Attributes.isNApplicable`: exact KNOWN_HANDLERS_SET membership or
 * a startsWith match against a prefix handler — the latter is a plain
 * `indexOf(...) === 0` in the runtime, so even an unknown name like
 * 'nb-index' qualifies (it starts with 'nb-in'). Checked on the normalized
 * full name; the parser's W3C normalization preserves every startsWith
 * relationship ('data-nb-index' → 'nb-index').
 */
function grantsNApplicability(attr: TemplateAttribute): boolean {
    return EXACT_APPLICABLE_HANDLERS.has(attr.fullName) ||
           PREFIX_ATTRIBUTES.some(p => attr.fullName.startsWith(p));
}

/**
 * Example suffixes for the R7-4 missing-suffix diagnostic, so the message
 * shows a concrete correct spelling per handler.
 */
const PREFIX_SUFFIX_EXAMPLES: ReadonlyMap<string, string> = new Map([
    ['nb-event', 'click'],
    ['nb-attr', 'title'],
    ['nb-prop', 'value'],
    ['nb-var', 'name'],
    ['nb-in', 'data'],
    ['nb-in-ref', 'items'],
    ['nb-aspect', 'tooltip'],
]);

/**
 * Mirror of the Attributes constructor's reserved-name rejection for
 * `nb-attr:` targets: exact known handler / extension names are blocked, and
 * so is anything STARTING WITH a prefix-handler name (the runtime check is a
 * plain startsWith — `nb-attr:nb-index` is rejected because 'nb-index'
 * startsWith 'nb-in'). W3C spellings are normalized first so both modes are
 * covered.
 */
function isFrameworkReservedAttrTarget(suffix: string): boolean {
    const lower = suffix.toLowerCase();
    const normalized = lower.startsWith('data-nb-')
        ? 'nb-' + lower.substring('data-nb-'.length).replace(/--/g, ':')
        : lower;
    return NB_EXACT_NAMES.has(normalized) || PREFIX_ATTRIBUTES.some(p => normalized.startsWith(p));
}

export class nDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private disposables: vscode.Disposable[] = [];
    private changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
    static readonly DEBOUNCE_MS = 300;

    constructor(private analyzer: DecoratorAnalyzer) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(Constants.INTERNAL_NAME);
        this.disposables.push(this.diagnosticCollection);

        // Event listeners that VS Code invokes on doc lifecycle events. Each
        // wrap is mandatory: if a listener throws uncaught, VS Code disposes
        // the subscription silently — leaving us deaf to all subsequent
        // events of that kind for the rest of the session.
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                try { this.validate(doc); } catch (err) { logError('diagnostics.onDidOpenTextDocument', err); }
            }),
            vscode.workspace.onDidChangeTextDocument(e => {
                try { this.scheduleValidation(e.document); } catch (err) { logError('diagnostics.onDidChangeTextDocument', err); }
            }),
            vscode.workspace.onDidCloseTextDocument(doc => {
                try { this.cancelPending(doc.uri.toString()); } catch (err) { logError('diagnostics.onDidCloseTextDocument.cancelPending', err); }
                try { this.diagnosticCollection.delete(doc.uri); } catch (err) { logError('diagnostics.onDidCloseTextDocument.delete', err); }
            })
        );

        // Validate all currently-open HTML documents. A throw on one
        // document must not prevent us validating the rest.
        for (const doc of vscode.workspace.textDocuments) {
            try { this.validate(doc); } catch (err) { logError('diagnostics.initialValidateAll', err); }
        }
    }

    private scheduleValidation(document: vscode.TextDocument): void {
        if (document.languageId !== 'html') return;
        const key = document.uri.toString();
        this.cancelPending(key);
        this.changeTimers.set(
            key,
            setTimeout(() => {
                this.changeTimers.delete(key);
                this.validate(document);
            }, nDiagnosticsProvider.DEBOUNCE_MS)
        );
    }

    private cancelPending(key: string): void {
        const existing = this.changeTimers.get(key);
        if (typeof(existing) !== 'undefined') {
            clearTimeout(existing);
            this.changeTimers.delete(key);
        }
    }

    validate(document: vscode.TextDocument): void {
        // Outer guard catches anything the inner block can't — config-read
        // failures, diagnosticCollection mutation errors, etc. Whatever
        // happens, this method must never propagate up to a VS Code listener.
        try {
            if (document.languageId !== 'html') return;

            const config = vscode.workspace.getConfiguration(Constants.INTERNAL_NAME);
            if (!config.get('diagnostics.enable', true)) {
                try { this.diagnosticCollection.delete(document.uri); } catch (err) {
                    logError('diagnostics.validate.deleteOnDisable', err);
                }
                return;
            }

            try {
                this.computeDiagnostics(document);
            } catch (err) {
                // A single broken file shouldn't wedge diagnostics for every
                // open document. Clear stale diagnostics so nothing misleading
                // is left behind, but log so the underlying bug is visible.
                logError(`diagnostics.computeDiagnostics(${document.uri.fsPath})`, err);
                try { this.diagnosticCollection.delete(document.uri); } catch (err2) {
                    logError('diagnostics.validate.deleteAfterFailure', err2);
                }
            }
        } catch (err) {
            logError(`diagnostics.validate(${document.uri?.fsPath ?? 'unknown'})`, err);
        }
    }

    private computeDiagnostics(document: vscode.TextDocument): void {
        const diagnostics: vscode.Diagnostic[] = [];
        const parsed = parseTemplateCached(document);
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);

        // Runtime transformer function names (lowercased) — used by the
        // nb-var name checks here and by checkVarEvaluationOrder.
        const transformerNames = new Set<string>();
        for (const t of this.analyzer.getEntitiesByType('transformer')) {
            const fnName = t.transformerFunctionName ?? t.name;
            if (fnName) transformerNames.add(fnName.toLowerCase());
        }

        // Registered component tags (lowercased) — a component host element is
        // N-applicable at runtime even with no nb-attributes, which matters
        // for the nb-case parent-switch rule and the element-trap checks.
        const componentTags = new Set<string>(
            this.analyzer.getEntitiesByType('component').map(e => e.name.toLowerCase()));

        for (const binding of parsed.allBindings) {
            // 1. Check for unknown nb-* attribute names
            if (!isNAttribute(binding.baseName)) {
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(
                        document.positionAt(binding.nameSpan.start),
                        document.positionAt(binding.nameSpan.end)
                    ),
                    `Unknown ${Constants.DISPLAY_NAME} attribute: '${binding.baseName}'. Did you mean one of the known nb-* attributes?`,
                    vscode.DiagnosticSeverity.Warning
                ));
                continue;
            }

            // 2. Check nb-case / nb-default without parent nb-switch
            if (binding.baseName === 'nb-case' || binding.baseName === 'nb-default') {
                if (!this.hasParentSwitch(parsed, binding.nameSpan.start, componentTags)) {
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(
                            document.positionAt(binding.nameSpan.start),
                            document.positionAt(binding.nameSpan.end)
                        ),
                        `'${binding.baseName}' must be a direct child of an element with 'nb-switch'.`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }

            // 2b. Suffix/value sanity checks for patterns that are silent or
            // fatal at runtime (see the round-4 audit).
            this.checkBindingShape(document, binding, transformerNames, diagnostics);

            // '@' (constant literal) and '%' (route slot) values are never
            // evaluated as expressions — validating them produced spurious
            // warnings for literals that merely contain 'this.' or 'item'.
            const isEvaluated = isEvaluatedBinding(binding);

            // 3. Validate member references if we have TS class associations
            if (associations.length > 0 && binding.expression && isEvaluated) {
                const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);

                for (const ref of exprInfo.memberReferences) {
                    const found = associations.some(assoc =>
                        assoc.members.some(m => m.name === ref.rootMember)
                    );

                    if (!found) {
                        const absoluteStart = binding.valueSpan.start + binding.expressionOffset + ref.start;
                        const absoluteEnd = binding.valueSpan.start + binding.expressionOffset + ref.end;

                        const classNames = associations.map(a => a.className).join(' | ');
                        diagnostics.push(new vscode.Diagnostic(
                            new vscode.Range(
                                document.positionAt(absoluteStart),
                                document.positionAt(absoluteEnd)
                            ),
                            `Property '${ref.rootMember}' does not exist on '${classNames}'.`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                }
            }

            // 4. Check for repeat params used without an injecting nb-repeat
            // scope. Note: a *prefixed* scope (nb-repeat:outer) injects only
            // the prefixed names (outerItem, …) — bare 'item' is still
            // unavailable inside it, so the injected-name set is computed per
            // scope instead of treating any ancestor nb-repeat as a pass.
            if (associations.length > 0 && binding.expression && isEvaluated) {
                const repeatParams = ['item', 'index', 'count'];
                const injectedNames = new Set<string>();
                // An nb-repeat's OWN collection expression is evaluated with
                // the parent params — its own item/index/count don't exist
                // yet, so the scope contributed by this very attribute must
                // not suppress the warning (`nb-repeat="item.x"` with no
                // outer repeat throws at runtime).
                const ownRepeat = binding.baseName === 'nb-repeat' ? binding : undefined;
                for (const scope of getAllRepeatScopes(parsed, binding.valueSpan.start, ownRepeat)) {
                    if (scope.prefix) {
                        injectedNames.add(`${scope.prefix}Item`);
                        injectedNames.add(`${scope.prefix}Index`);
                        injectedNames.add(`${scope.prefix}Count`);
                    } else {
                        for (const p of repeatParams) injectedNames.add(p);
                    }
                }
                // Scan a masked copy: string/template-literal text, comments,
                // and regex literals blanked (offset-preserving). This shares
                // maskNonCode with every other provider — the previous ad-hoc
                // extractCodeParts scanner didn't know regex literals, so a
                // quote inside /['"]/ derailed it.
                const maskedCode = maskNonCode(binding.expression);
                // Collect nb-var local variable names visible at this binding.
                // The consumer-aware overload applies the runtime gating rules
                // (an nb-repeat's own expression never sees same-element vars;
                // reserved-named vars are never created, so a `nb-var:item`
                // must not suppress the repeat-param warning).
                const localVarNames = new Set(getAllLocalVars(parsed, binding.nameSpan.start, binding).map(v => v.varName));
                // Arrow-function parameters shadow the injected names — an
                // `item` in `rows.forEach(item => …)` is the callback's own
                // binding, not the repeat param (false positive otherwise).
                const arrowParams = collectArrowParams(maskedCode);
                for (const paramName of repeatParams) {
                    if (injectedNames.has(paramName)) continue;
                    if (arrowParams.has(paramName)) continue;
                    if (isIdentifierUsedAsValue(maskedCode, paramName)) {
                        // Only warn if it's not also a class member or nb-var local
                        const isClassMember = associations.some(assoc =>
                            assoc.members.some(m => m.name === paramName)
                        );
                        if (!isClassMember && !localVarNames.has(paramName)) {
                            diagnostics.push(new vscode.Diagnostic(
                                new vscode.Range(
                                    document.positionAt(binding.valueSpan.start),
                                    document.positionAt(binding.valueSpan.end)
                                ),
                                `'${paramName}' is a repeat parameter but this element is not inside an 'nb-repeat' scope.`,
                                vscode.DiagnosticSeverity.Information
                            ));
                        }
                    }
                }
            }
        }

        // 5. nb-var evaluation-order checks (template-only semantics — no
        // TS association required).
        this.checkVarEvaluationOrder(document, parsed, transformerNames, diagnostics);

        // 6. Element-level runtime traps: duplicate nb-event subscriptions,
        // nb-in vs nb-in-ref collisions, inputs nothing consumes.
        this.checkElementTraps(document, parsed, componentTags, diagnostics);

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Mirror of `Variables.bind`'s left-to-right evaluation:
     * - The FIRST nb-var expression on an element runs with the parent
     *   execution params only — no sibling nb-var (including itself) exists
     *   as a parameter yet, so referencing one is a runtime ReferenceError
     *   (unless the name also resolves via an ancestor nb-var, an enclosing
     *   nb-repeat's context params, or a browser global — `new Function`
     *   bodies see `window` properties).
     * - From the second nb-var on, the element's WHOLE var map is applied
     *   (it is pre-seeded with every declared name and REPLACES same-named
     *   ancestor params), so later siblings and the var itself are defined
     *   but still `undefined` — legal, flagged as Information only.
     * Names the runtime refuses to create (reserved context names,
     * case-insensitive transformer collisions) never enter the var map and
     * are excluded from both sides of the check.
     */
    private checkVarEvaluationOrder(document: vscode.TextDocument, parsed: ParsedTemplate,
                                    transformerNames: ReadonlySet<string>, diagnostics: vscode.Diagnostic[]): void {
        for (const el of parsed.elements) {
            const varAttrs = el.nbAttributes.filter(a => a.baseName === 'nb-var' && a.suffix);
            if (varAttrs.length === 0) continue;

            // Vars the runtime actually creates on this element, in document
            // (= evaluation) order.
            const created = varAttrs
                .map(attr => ({ attr, name: kebabToCamelCase(attr.suffix!) }))
                .filter(v => !RESERVED_CONTEXT_NAMES.has(v.name.toLowerCase()) &&
                             !transformerNames.has(v.name.toLowerCase()));
            if (created.length === 0) continue;

            // Ancestor-declared var names stay visible to the FIRST var's
            // expression (its params are the untouched parent params).
            // Reserved / transformer-colliding names are excluded — the
            // runtime never created those ancestor vars either.
            const ancestorVarNames = new Set<string>();
            for (let cur = el.parent; cur; cur = cur.parent) {
                for (const attr of cur.nbAttributes) {
                    if (attr.baseName === 'nb-var' && attr.suffix) {
                        const name = kebabToCamelCase(attr.suffix);
                        if (RESERVED_CONTEXT_NAMES.has(name.toLowerCase())) continue;
                        if (transformerNames.has(name.toLowerCase())) continue;
                        ancestorVarNames.add(name);
                    }
                }
            }

            // nb-repeat context params are ALSO in the parent params the first
            // var evaluates with — a sibling var shadowing a prefixed repeat
            // param (e.g. 'outerItem') must not be flagged as a ReferenceError:
            // the first var legally reads the repeat's value. The walk includes
            // the element itself (a repeat here clones it, and the clone's vars
            // receive the repeat params). Unprefixed item/index/count are
            // reserved var names, so only prefixed params can collide with a
            // `created` entry.
            const repeatParamNames = new Set<string>();
            for (let cur: typeof el | undefined = el; cur; cur = cur.parent) {
                for (const attr of cur.nbAttributes) {
                    if (attr.baseName === 'nb-repeat' && attr.suffix) {
                        // The runtime prefix is the browser-LOWERCASED
                        // attribute remainder used verbatim.
                        const prefix = attr.suffix.toLowerCase();
                        repeatParamNames.add(`${prefix}Item`);
                        repeatParamNames.add(`${prefix}Index`);
                        repeatParamNames.add(`${prefix}Count`);
                    }
                }
            }

            for (let k = 0; k < created.length; k++) {
                const { attr } = created[k];
                if (!attr.expression || !isEvaluatedBinding(attr)) continue;

                const masked = maskNonCode(attr.expression);
                const arrowParams = collectArrowParams(masked);
                const prefixLen = attr.expressionOffset;

                for (let j = 0; j < created.length; j++) {
                    const refName = created[j].name;
                    if (arrowParams.has(refName)) continue;

                    if (k === 0) {
                        // Resolvable through the parent params (ancestor vars,
                        // repeat context params) or as a bare browser global —
                        // not an error for the first var.
                        if (ancestorVarNames.has(refName) || repeatParamNames.has(refName) ||
                            GLOBAL_SCOPE_NAMES.has(refName)) continue;
                    } else if (j < k) {
                        // Earlier sibling — already evaluated, fine.
                        continue;
                    }
                    // (For k > 0 even ancestor/global names are shadowed by
                    // the pre-seeded var map, so no exclusions apply.)

                    const idx = findIdentifierValueIndex(masked, refName);
                    if (idx < 0) continue;

                    const start = attr.valueSpan.start + prefixLen + idx;
                    const range = new vscode.Range(
                        document.positionAt(start),
                        document.positionAt(start + refName.length)
                    );

                    if (k === 0) {
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            j === k
                                ? `'${refName}' is not visible here: an 'nb-var' cannot read its own value, and the first 'nb-var' on an element has no sibling var parameters at all — this throws a ReferenceError at runtime.`
                                : `'${refName}' is not visible here: the first 'nb-var' on an element is evaluated before any sibling 'nb-var' exists — this throws a ReferenceError at runtime. Move '${attr.fullName}' after 'nb-var:${created[j].attr.suffix}'.`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    } else {
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            j === k
                                ? `'${refName}' is undefined during its own evaluation — an 'nb-var' cannot read its own value.`
                                : `'${refName}' is still undefined here: sibling 'nb-var's evaluate left-to-right and 'nb-var:${created[j].attr.suffix}' comes later.`,
                            vscode.DiagnosticSeverity.Information
                        ));
                    }
                }
            }
        }
    }

    /**
     * Static shape checks for patterns that are silent or fatal at runtime
     * (round-4 audit, L8). Anchored on the attribute NAME span. Premise for
     * the case checks: the browser ASCII-lowercases attribute names before
     * the framework sees them (verified against jsdom/HTML spec).
     */
    private checkBindingShape(
        document: vscode.TextDocument,
        binding: TemplateAttribute,
        transformerNames: ReadonlySet<string>,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const nameRange = () => new vscode.Range(
            document.positionAt(binding.nameSpan.start),
            document.positionAt(binding.nameSpan.end)
        );

        const handler = getHandlerInfo(binding.baseName);

        // A ':' suffix on a non-suffix handler is dropped ENTIRELY at
        // runtime: the full name is not in the exact-match handler set and
        // matches no prefix handler, so it lands in no bucket — no handler
        // sees it, the element is not even N-applicable through it, and
        // nothing is logged (round-6 audit, E2).
        if (handler !== undefined && !handler.isPrefix && binding.suffix !== undefined) {
            diagnostics.push(new vscode.Diagnostic(
                nameRange(),
                `'${binding.baseName}' does not take a ':' suffix — the runtime drops '${binding.fullName}' entirely (no handler sees it, nothing is logged). Remove ':${binding.suffix}'.`,
                vscode.DiagnosticSeverity.Warning
            ));
            return;
        }

        // Empty value: everything outside EMPTY_VALUE_ALLOWED logs
        // "… attributes should have value." and never reaches a handler.
        if (!EMPTY_VALUE_ALLOWED.has(binding.baseName) && binding.value.trim().length === 0) {
            diagnostics.push(new vscode.Diagnostic(
                nameRange(),
                `'${binding.fullName}' has an empty value — the runtime logs "attributes should have value." and drops the binding.`,
                vscode.DiagnosticSeverity.Warning
            ));
            return;
        }

        // A prefix handler without its ':name' suffix is silently dead: the
        // Attributes store admits the bare name as a system attribute, but
        // every consumer except nb-repeat reads suffixed keys only
        // (`getAll`/`has` default to isPrefixRequired = true) — nothing is
        // bound, nothing is logged (round-7 audit, R7-4). The inverse of the
        // E2 rule above.
        if (handler !== undefined && handler.isPrefix && binding.baseName !== 'nb-repeat' && !binding.suffix) {
            const example = PREFIX_SUFFIX_EXAMPLES.get(binding.baseName) ?? 'name';
            diagnostics.push(new vscode.Diagnostic(
                nameRange(),
                `'${binding.fullName}' is missing its ':name' suffix — every '${binding.baseName}' consumer reads only '${binding.baseName}:<name>' keys, so this binding is silently dead (nothing is bound, nothing is logged). Write '${binding.baseName}:${example}="…"'.`,
                vscode.DiagnosticSeverity.Warning
            ));
            return;
        }

        // nb-bound + '@': Bound.ts prepends '#' unconditionally, producing
        // '#@…', which never compiles — one compilation-error log per bind,
        // dead binding (framework audit R8-4).
        if (binding.baseName === 'nb-bound' && binding.expressionPrefix === '@') {
            diagnostics.push(new vscode.Diagnostic(
                nameRange(),
                `'@' is not valid on 'nb-bound' — the runtime prepends '#' unconditionally, producing '#@…', which never compiles (dead binding, one compilation error logged per bind). nb-bound is always single-bind; write a plain expression.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }

        // nb-style has NO whole-value prefix: entries are split into
        // 'prop: expr' FIRST, so the prefix char folds into the first
        // property name ('#opacity' — a silent dead style).
        if (binding.baseName === 'nb-style' && binding.expressionPrefix !== undefined) {
            diagnostics.push(new vscode.Diagnostic(
                nameRange(),
                `'${binding.expressionPrefix}' is not a whole-value prefix on 'nb-style' — the runtime splits 'prop: expr' entries first, so '${binding.expressionPrefix}' becomes part of the first property name (a silent dead style). Put '#' on the entry's own expression instead: 'prop: #expr'.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }

        // nb-class format detection runs on the RAW value — a leading prefix
        // makes the first char '#'/'@', so an array/conditional form is
        // mis-classified as ONE simple binding ('[…]' is a SyntaxError;
        // '{…}' compiles as a labeled statement block and evaluates to
        // undefined — no classes are ever applied).
        if (binding.baseName === 'nb-class' && binding.expressionPrefix !== undefined) {
            const classExpr = binding.expression.trim();
            if ((classExpr.startsWith('[') && classExpr.endsWith(']')) ||
                (classExpr.startsWith('{') && classExpr.endsWith('}'))) {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `A leading '${binding.expressionPrefix}' disables nb-class's array/conditional format detection (it runs on the RAW value) — the whole value is treated as one simple expression and no classes are ever applied. Use a per-entry '#' inside the brackets instead.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }

        // '%' outside nb-container: the route-slot prefix is honored by the
        // Container handler ONLY — here the runtime evaluates the value as an
        // expression, and 'return (%…)' is a guaranteed SyntaxError.
        if (binding.expressionPrefix === undefined &&
            EXPRESSION_VALUE_HANDLERS.has(binding.baseName) &&
            binding.expression.trimStart().startsWith('%')) {
            diagnostics.push(new vscode.Diagnostic(
                nameRange(),
                `'%' (route slot) is only honored by 'nb-container' — on '${binding.baseName}' the runtime evaluates this value as an expression, which is a guaranteed SyntaxError (dead binding).`,
                vscode.DiagnosticSeverity.Warning
            ));
        }

        // nb-template requires a '@name' value — anything else logs
        // "template name should start with '@'" and the handler stays inert;
        // the value is NEVER evaluated as an expression (round-6 audit, E3).
        if (binding.baseName === 'nb-template' && binding.expressionPrefix !== '@') {
            diagnostics.push(new vscode.Diagnostic(
                nameRange(),
                `'nb-template' requires a '@templateName' value — the runtime logs "template name should start with '@'" and stays inert; the value is never evaluated as an expression, so this binding is dead.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }

        // nb-attr targets the runtime rejects with a console error.
        if (binding.baseName === 'nb-attr' && binding.suffix) {
            const attrTarget = binding.suffix.toLowerCase();
            if (attrTarget === 'class' || attrTarget === 'style') {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `The runtime rejects '${binding.fullName}' with a console error — use '${attrTarget === 'class' ? 'nb-class' : 'nb-style'}' instead.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            } else if (isFrameworkReservedAttrTarget(binding.suffix)) {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `'${binding.suffix}' is a framework-reserved attribute name — the runtime rejects '${binding.fullName}' with "system attribute changes is not allowed".`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }

        // nb-prop targets the runtime rejects with a console error
        // (blocklist incl. outerHTML since the 2026-07-13 framework fixes).
        if (binding.baseName === 'nb-prop' && binding.suffix) {
            const propTarget = kebabToCamelCase(binding.suffix).toLowerCase();
            const hint = BLOCKED_PROP_TARGETS.get(propTarget);
            if (hint !== undefined) {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `The runtime rejects '${binding.fullName}' with a console error — ${hint}.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }

        // nb-default must have an EMPTY value — with any value the runtime
        // silently ignores the attribute entirely (Default requires '').
        if (binding.baseName === 'nb-default' && binding.value.trim().length > 0) {
            diagnostics.push(new vscode.Diagnostic(
                nameRange(),
                `'nb-default' must have no value — the runtime silently ignores 'nb-default' with a value, and this element will not act as the default branch. Write it as a bare attribute: 'nb-default'.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }

        // nb-repeat prefix: the runtime uses the browser-lowercased remainder
        // VERBATIM as a formal parameter prefix.
        if (binding.baseName === 'nb-repeat' && binding.suffix) {
            const runtimePrefix = binding.suffix.toLowerCase();
            if (!/^[a-z_$][\w$]*$/.test(runtimePrefix)) {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `Repeat prefix '${binding.suffix}' produces the parameter names '${runtimePrefix}Item' / '${runtimePrefix}Index' / '${runtimePrefix}Count', which are not valid JavaScript identifiers — at runtime every expression in this subtree fails to compile (strict-mode SyntaxError). Use a letters-only prefix.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            } else if (/[A-Z]/.test(binding.suffix)) {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `Attribute names are lowercased by the browser — this repeat injects '${runtimePrefix}Item' / '${runtimePrefix}Index' / '${runtimePrefix}Count' (not '${binding.suffix}Item' …). Prefer an all-lowercase prefix.`,
                    vscode.DiagnosticSeverity.Information
                ));
            }
        }

        if (binding.baseName === 'nb-event' && binding.suffix) {
            // Uppercase letters never reach the runtime: the browser
            // lowercases the attribute name, so the subscription is to the
            // lowercased event — a CustomEvent dispatched with the camelCase
            // name will never match.
            if (/[A-Z]/.test(binding.suffix)) {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `Attribute names are lowercased by the browser — this subscribes to '${binding.suffix.toLowerCase()}', not '${binding.suffix}'. A CustomEvent dispatched as '${binding.suffix}' will never match; use a lowercase (or kebab-case) event name on both sides.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }

            // Debounce segment must be a plain number — anything else is
            // silently ignored by the runtime (the handler subscribes
            // WITHOUT debounce; the error is logged only in debug mode).
            if (binding.extraSuffix !== undefined && !/^\d+$/.test(binding.extraSuffix)) {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `'${binding.extraSuffix}' is not a valid debounce value — the runtime subscribes WITHOUT debounce and reports nothing outside debug mode. Use a plain number of milliseconds (e.g. 'nb-event:${binding.suffix}:300').`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }

        if (binding.baseName === 'nb-var' && binding.suffix) {
            const varName = kebabToCamelCase(binding.suffix);
            if (RESERVED_CONTEXT_NAMES.has(varName.toLowerCase())) {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `'${varName}' is a reserved context name — the runtime refuses to create this variable (it would shadow an injected parameter). Rename the variable.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            } else if (transformerNames.has(varName.toLowerCase())) {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `'${varName}' collides with a registered @Transformer name (case-insensitive) — the runtime refuses to create this variable. Rename the variable.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            } else if (!/^[a-z_$][\w$]*$/i.test(varName)) {
                diagnostics.push(new vscode.Diagnostic(
                    nameRange(),
                    `Variable name '${binding.suffix}' maps to '${varName}', which is not a valid JavaScript identifier — at runtime every expression in this subtree fails to compile (strict-mode SyntaxError). Use letter-initial kebab-case segments.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }
    }

    /**
     * Per-element trap checks (round-6 audit, E9):
     * - Two nb-event attributes resolving to the same event name: the Events
     *   handler keys its expression map by event name, so only ONE handler
     *   survives (exact-duplicate attribute names are deduped by the browser
     *   — first wins; different spellings like ':click' + ':click:300'
     *   collide in the map — last wins). Either way the others silently
     *   never fire.
     * - nb-in:x + nb-in-ref:x for the same (camelCased) input name: the
     *   by-reference delivery silently wins (round-2 framework audit, R2-10).
     * - nb-in / nb-in-ref on an element hosting no nb-container and no
     *   registered component tag: the inputs are never consumed. Restricted
     *   to dash-less tags so unanalyzed custom elements are never
     *   false-positived; dash-less component registrations are covered by
     *   the analyzer lookup (and a post-scan refresh() re-validates).
     */
    private checkElementTraps(document: vscode.TextDocument, parsed: ParsedTemplate,
                              componentTags: ReadonlySet<string>,
                              diagnostics: vscode.Diagnostic[]): void {
        const nameRange = (attr: TemplateAttribute) => new vscode.Range(
            document.positionAt(attr.nameSpan.start),
            document.positionAt(attr.nameSpan.end)
        );

        for (const el of parsed.elements) {
            // Duplicate nb-event subscriptions (runtime event name =
            // lowercased suffix; the debounce segment is not part of the key).
            const eventGroups = new Map<string, TemplateAttribute[]>();
            for (const attr of el.nbAttributes) {
                if (attr.baseName === 'nb-event' && attr.suffix) {
                    const eventName = attr.suffix.toLowerCase();
                    const group = eventGroups.get(eventName);
                    if (group) {
                        group.push(attr);
                    } else {
                        eventGroups.set(eventName, [attr]);
                    }
                }
            }
            for (const [eventName, group] of eventGroups) {
                if (group.length < 2) continue;
                for (const attr of group) {
                    diagnostics.push(new vscode.Diagnostic(
                        nameRange(attr),
                        `Multiple 'nb-event' attributes on this element subscribe to '${eventName}' — the runtime keeps only ONE handler (its expression map is keyed by event name); the others silently never fire. Merge them into one expression.`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }

            // nb-in vs nb-in-ref delivering to the same input.
            const byRefNames = new Set<string>();
            for (const attr of el.nbAttributes) {
                if (attr.baseName === 'nb-in-ref' && attr.suffix) {
                    byRefNames.add(kebabToCamelCase(attr.suffix));
                }
            }
            if (byRefNames.size > 0) {
                for (const attr of el.nbAttributes) {
                    if (attr.baseName === 'nb-in' && attr.suffix &&
                        byRefNames.has(kebabToCamelCase(attr.suffix))) {
                        diagnostics.push(new vscode.Diagnostic(
                            nameRange(attr),
                            `Input '${kebabToCamelCase(attr.suffix)}' is also bound with 'nb-in-ref' on this element — the by-reference binding silently wins and this 'nb-in' value is never delivered. Remove one of the two.`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                }
            }

            // Inputs on an element that hosts neither a container nor a
            // component — nothing ever consumes them.
            const inputAttrs = el.nbAttributes.filter(a =>
                (a.baseName === 'nb-in' || a.baseName === 'nb-in-ref') && a.suffix);
            if (inputAttrs.length > 0) {
                const hostsContainer = el.nbAttributes.some(a => a.baseName === 'nb-container');
                const tag = el.tagName.toLowerCase();
                if (!hostsContainer && !tag.includes('-') && !componentTags.has(tag)) {
                    for (const attr of inputAttrs) {
                        diagnostics.push(new vscode.Diagnostic(
                            nameRange(attr),
                            `'${attr.fullName}' is never consumed — <${el.tagName}> hosts no 'nb-container' and is not a registered component tag, so this input is silently dead.`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                }
            }
        }
    }

    private hasParentSwitch(parsed: ParsedTemplate, offset: number,
                            componentTags: ReadonlySet<string>): boolean {
        // The runtime binds nb-case/nb-default to the switch of its DIRECT
        // nuBond parent: TreeBuilder attaches the children of non-applicable
        // elements to the nearest N-APPLICABLE ancestor. Applicability
        // (`NElement.isNApplicable`) comes from a KNOWN_HANDLERS_SET /
        // KNOWN_PREFIX_HANDLERS attribute or a registered component tag —
        // the projection trio, nb-component, and unmatched unknown names do
        // NOT grant it, so such wrappers are transparent at runtime and must
        // be transparent here too (round-7 audit, R7-1). A switch above the
        // nearest applicable ancestor does not control this case — the Case
        // handler logs "must have direct nb-switch parent" and stays inert.
        // Unregistered dashed tags are treated as transparent (matching the
        // runtime's components-registry lookup; conservative for tags the
        // analyzer hasn't seen).
        for (const el of parsed.elements) {
            if (offset >= el.tagSpan.start && offset <= el.tagSpan.end) {
                let current = el.parent;
                while (current) {
                    if (componentTags.has(current.tagName.toLowerCase()) ||
                        current.nbAttributes.some(grantsNApplicability)) {
                        // The nearest applicable ancestor must itself carry
                        // the switch (a component host carrying nb-switch is
                        // fine — its Switch handler has the expression).
                        return current.nbAttributes.some(attr => attr.fullName === 'nb-switch');
                    }
                    current = current.parent;
                }
                return false;
            }
        }
        return false;
    }

    refresh(): void {
        for (const doc of vscode.workspace.textDocuments) {
            this.validate(doc);
        }
    }

    /**
     * Remove diagnostics (and any pending validation) for a file that no
     * longer exists. Called from the HTML file watcher's delete event —
     * refresh() only re-validates open documents and would leave deleted
     * files' squiggles in the Problems panel forever.
     */
    clearDocument(uri: vscode.Uri): void {
        try { this.cancelPending(uri.toString()); } catch (err) { logError('diagnostics.clearDocument.cancelPending', err); }
        try { this.diagnosticCollection.delete(uri); } catch (err) { logError('diagnostics.clearDocument.delete', err); }
    }

    dispose(): void {
        // Best-effort tear-down — keep going on individual failures so we
        // don't leak listeners on extension deactivate / restart.
        // clearTimeout failures are too noisy to log (timers may already be
        // expired); disposable failures are worth knowing about.
        for (const timer of this.changeTimers.values()) {
            try { clearTimeout(timer); } catch { /* benign */ }
        }
        this.changeTimers.clear();
        for (const d of this.disposables) {
            try { d.dispose(); } catch (err) {
                logError('diagnostics.dispose.disposable', err);
            }
        }
    }
}

/**
 * Collect identifiers declared as arrow-function parameters: bare
 * (`item => …`) and parenthesized (`(item, i) => …`, including typed or
 * defaulted params). Mirrors the semantic-token provider's arrow detection —
 * these names shadow repeat params inside the expression.
 */
function collectArrowParams(code: string): Set<string> {
    const names = new Set<string>();
    let m: RegExpExecArray | null;

    const bareParam = /(?<![.\w$)\]])([A-Za-z_$][\w$]*)\s*=>/g;
    while ((m = bareParam.exec(code)) !== null) {
        names.add(m[1]);
    }

    const parenParams = /\(([^()]*)\)\s*=>/g;
    while ((m = parenParams.exec(code)) !== null) {
        for (const part of m[1].split(',')) {
            const name = part.trim().split(/[\s:=]/, 1)[0];
            if (/^[A-Za-z_$][\w$]*$/.test(name)) {
                names.add(name);
            }
        }
    }

    return names;
}

/**
 * Names that resolve as bare identifiers inside the framework's
 * `new Function` expression bodies even when no parameter provides them:
 * the globals catalog plus the collision-prone bare `window` properties
 * (a var named `name` is the classic — `window.name` always exists).
 * Used to avoid false ReferenceError warnings in the nb-var order check.
 */
const GLOBAL_SCOPE_NAMES = new Set<string>([
    ...getAllGlobalObjects().map(g => g.name),
    ...getAllGlobalFunctions().map(f => f.name),
    ...getAllGlobalConstants().map(c => c.name),
    'name', 'status', 'length', 'self', 'top', 'parent', 'frames', 'closed',
    'opener', 'origin', 'event', 'history', 'location', 'navigator', 'screen',
    'localStorage', 'sessionStorage', 'crypto', 'performance', 'indexedDB',
    'caches', 'customElements', 'globalThis', 'window', 'document',
]);

/**
 * True when `name` appears in `code` as a value reference — i.e. not as a
 * key in an object literal (`{item: 1}`, `{a, item: 2}`) or in nb-class's
 * `;`-separated conditional format (`{active: expr; item: expr}`), where the
 * identifier is a property/class name, not a use of the injected variable.
 * Ternaries stay flagged: in `cond ? item : other` the char before `item`
 * is `?`, not a key-position delimiter.
 */
function isIdentifierUsedAsValue(code: string, name: string): boolean {
    return findIdentifierValueIndex(code, name) !== -1;
}

/**
 * Index of the first value-position occurrence of `name` in `code`
 * (same key-position rules as isIdentifierUsedAsValue), or -1. Callers that
 * need a diagnostic range must pass offset-preserving code (maskNonCode),
 * not extractCodeParts output — the latter compacts the string.
 */
function findIdentifierValueIndex(code: string, name: string): number {
    const regex = new RegExp(`(?<![\\w.$])${name}(?![\\w$])`, 'g');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(code)) !== null) {
        const after = code.substring(m.index + name.length).match(/^\s*(.)/)?.[1];
        if (after === ':') {
            const before = code.substring(0, m.index).match(/(\S)\s*$/)?.[1];
            if (before === undefined || before === '{' || before === ',' || before === ';') continue;
        }
        return m.index;
    }
    return -1;
}

