/**
 * template-parser.ts
 * Parses nHTML templates into a structured AST of nb-* bindings.
 */

import { buildLineIndex, offsetToLineChar } from './utils';
import type { LineIndex } from './utils';

export interface TemplateAttribute {
    /** Full attribute name as-is: "nb-event:click:300" */
    fullName: string;
    /** Base handler name: "nb-event" */
    baseName: string;
    /** Suffix after colon: "click" for "nb-event:click" */
    suffix?: string;
    /** Extra suffix: "300" for "nb-event:click:300" */
    extraSuffix?: string;
    /** Raw attribute value (expression string) */
    value: string;
    /** Expression prefix character if present: '#', '@', '%' */
    expressionPrefix?: string;
    /** Expression after stripping the prefix */
    expression: string;
    /** Source span in the HTML document */
    nameSpan: SourceSpan;
    /** Source span of the attribute value */
    valueSpan: SourceSpan;
}

export interface TemplateElement {
    /** Tag name */
    tagName: string;
    /** nAttributes on this element */
    nbAttributes: TemplateAttribute[];
    /** All attributes (including non-nb) */
    allAttributes: Map<string, { value: string; nameSpan: SourceSpan; valueSpan: SourceSpan }>;
    /** Source span of the opening tag */
    tagSpan: SourceSpan;
    /** Position after the closing tag (or end of opening tag for void/self-closing elements) */
    elementEnd: number;
    /** Children elements */
    children: TemplateElement[];
    /** Parent element */
    parent?: TemplateElement;
}

export interface SourceSpan {
    start: number;
    end: number;
    line: number;
    character: number;
}

export interface ParsedTemplate {
    elements: TemplateElement[];
    /** Flat list of all nb-* attribute bindings for quick searching */
    allBindings: TemplateAttribute[];
    /** Raw HTML text */
    text: string;
}

const NB_PREFIX = 'nb-';
const DATA_NB_PREFIX = 'data-nb-';
const EXPRESSION_PREFIXES = ['#', '@', '%'];

/**
 * Parse an HTML template string into a structured representation of nBindings.
 */
export function parseTemplate(html: string): ParsedTemplate {
    const elements: TemplateElement[] = [];
    const allBindings: TemplateAttribute[] = [];
    const lineIdx = buildLineIndex(html);

    /** Convert offset to SourceSpan-compatible line/character using pre-built index. */
    function lc(offset: number): { line: number; character: number } {
        return offsetToLineChar(lineIdx, offset);
    }

    // Use a state-machine-based parser that handles '>' inside quoted attribute values
    let i = 0;
    while (i < html.length) {
        // Find next '<' that starts a tag (skip comments, doctypes)
        if (html[i] !== '<') { i++; continue; }
        if (html[i + 1] === '!' || html[i + 1] === '/') { i++; continue; }

        const tagStart = i;
        i++; // skip '<'

        // Read tag name
        const tagNameStart = i;
        while (i < html.length && /[\w-]/.test(html[i])) i++;
        const tagName = html.substring(tagNameStart, i);
        if (!tagName) continue;

        const tagPos = lc(tagStart);

        const element: TemplateElement = {
            tagName,
            nbAttributes: [],
            allAttributes: new Map(),
            tagSpan: { start: tagStart, end: tagStart, line: tagPos.line, character: tagPos.character },
            elementEnd: tagStart,
            children: [],
        };

        // Parse attributes
        while (i < html.length) {
            // Skip whitespace
            while (i < html.length && /\s/.test(html[i])) i++;

            // End of tag?
            if (i >= html.length) break;
            if (html[i] === '>') { i++; break; }
            if (html[i] === '/' && html[i + 1] === '>') { i += 2; break; }

            // Read attribute name
            const attrNameStart = i;
            while (i < html.length && /[\w:.-]/.test(html[i])) i++;
            const attrName = html.substring(attrNameStart, i);
            if (!attrName) { i++; continue; }

            const attrNamePos = lc(attrNameStart);
            const nameSpan: SourceSpan = {
                start: attrNameStart,
                end: attrNameStart + attrName.length,
                line: attrNamePos.line,
                character: attrNamePos.character,
            };

            // Skip whitespace
            while (i < html.length && /\s/.test(html[i])) i++;

            // Check for '='
            let attrValue = '';
            let valueOffset = i;
            if (i < html.length && html[i] === '=') {
                i++; // skip '='
                // Skip whitespace
                while (i < html.length && /\s/.test(html[i])) i++;

                if (i < html.length && (html[i] === '"' || html[i] === "'")) {
                    const quote = html[i];
                    i++; // skip opening quote
                    valueOffset = i;
                    const valueStart = i;
                    while (i < html.length && html[i] !== quote) i++;
                    attrValue = html.substring(valueStart, i);
                    if (i < html.length) i++; // skip closing quote
                } else {
                    // Unquoted value
                    valueOffset = i;
                    const valueStart = i;
                    while (i < html.length && !/[\s>]/.test(html[i])) i++;
                    attrValue = html.substring(valueStart, i);
                }
            }

            const valuePos = lc(valueOffset);
            const valueSpan: SourceSpan = {
                start: valueOffset,
                end: valueOffset + attrValue.length,
                line: valuePos.line,
                character: valuePos.character,
            };

            element.allAttributes.set(attrName, { value: attrValue, nameSpan, valueSpan });

            // Check if this is an nb-* attribute
            const normalizedName = normalizeAttributeName(attrName);
            if (normalizedName) {
                const parsed = parseNbAttribute(normalizedName, attrValue, nameSpan, valueSpan);
                if (parsed) {
                    element.nbAttributes.push(parsed);
                    allBindings.push(parsed);
                }
            }
        }

        element.tagSpan.end = i;
        element.elementEnd = i; // default; buildTree will update for non-void elements
        elements.push(element);
    }

    // Build parent-child relationships from HTML structure
    buildTree(elements, html);

    // Scan for {{expression}} interpolations in text content
    const interpolationRegex = /\{\{([^}<>]*(?:\}[^}<>][^}<>]*)*)\}\}/g;
    let intMatch: RegExpExecArray | null;
    while ((intMatch = interpolationRegex.exec(html)) !== null) {
        const fullMatchStart = intMatch.index;
        // Skip if inside an HTML tag (attribute value) — check if we're between < and >
        if (isInsideTag(html, fullMatchStart)) continue;

        const exprRaw = intMatch[1];
        const valueStart = fullMatchStart + 2; // after {{

        let expressionPrefix: string | undefined;
        let expression = exprRaw;
        if (expression.length > 0 && EXPRESSION_PREFIXES.includes(expression[0])) {
            expressionPrefix = expression[0];
            expression = expression.substring(1);
        }

        const valuePos = lc(valueStart);
        const namePos = lc(fullMatchStart);

        const binding: TemplateAttribute = {
            fullName: 'nb-value',
            baseName: 'nb-value',
            suffix: undefined,
            extraSuffix: undefined,
            value: exprRaw,
            expressionPrefix,
            expression,
            nameSpan: { start: fullMatchStart, end: fullMatchStart + 2, line: namePos.line, character: namePos.character },
            valueSpan: { start: valueStart, end: valueStart + exprRaw.length, line: valuePos.line, character: valuePos.character },
        };

        allBindings.push(binding);
    }

    return { elements, allBindings, text: html };
}

/**
 * Check if a position is inside an HTML tag (between < and >).
 */
function isInsideTag(html: string, offset: number): boolean {
    for (let i = offset - 1; i >= 0; i--) {
        if (html[i] === '>') return false;
        if (html[i] === '<') return true;
    }
    return false;
}

/**
 * Normalize attribute name: strip data- prefix, handle W3C mode.
 * Returns null if not an nb-* attribute.
 */
function normalizeAttributeName(name: string): string | null {
    if (name.startsWith(NB_PREFIX)) {
        return name;
    }
    if (name.startsWith(DATA_NB_PREFIX)) {
        // Convert data-nb-event--click to nb-event:click
        const withoutData = name.substring(5);
        return withoutData.replace(/--/g, ':');
    }
    return null;
}

/**
 * Parse an nb-* attribute into structured form.
 */
function parseNbAttribute(name: string, value: string, nameSpan: SourceSpan, valueSpan: SourceSpan): TemplateAttribute | null {
    const parts = name.split(':');
    const baseName = parts[0];
    const suffix = parts[1];
    const extraSuffix = parts[2];

    let expressionPrefix: string | undefined;
    let expression = value;

    if (expression.length > 0 && EXPRESSION_PREFIXES.includes(expression[0])) {
        expressionPrefix = expression[0];
        expression = expression.substring(1);
    }

    return {
        fullName: name,
        baseName,
        suffix,
        extraSuffix,
        value,
        expressionPrefix,
        expression,
        nameSpan,
        valueSpan,
    };
}



/**
 * Simple tree building based on matching opening/closing tags.
 */
function buildTree(elements: TemplateElement[], html: string): void {
    // Build a map of closing tag positions for each tag name
    // Then assign parent pointers by matching open/close tag nesting
    const VOID_ELEMENTS = new Set([
        'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'
    ]);

    // Find all closing tags: </tagName>
    const closingTagRegex = /<\/([a-zA-Z][\w-]*)\s*>/g;
    const closingTags: { tagName: string; start: number; end: number }[] = [];
    let closeMatch: RegExpExecArray | null;
    while ((closeMatch = closingTagRegex.exec(html)) !== null) {
        closingTags.push({
            tagName: closeMatch[1].toLowerCase(),
            start: closeMatch.index,
            end: closeMatch.index + closeMatch[0].length,
        });
    }

    // For each opening tag, find its matching closing tag to determine true element end
    // Use a simple stack-based approach for nesting
    interface TagEntry {
        element: TemplateElement;
        elementEnd: number; // position after closing tag
    }

    const stack: TagEntry[] = [];
    // Process elements in order, assigning closing positions
    const elementEnds = new Map<TemplateElement, number>();

    // Use a copy of closing tags as a queue
    let closeIdx = 0;

    // Simple approach: process opening tags in order, use a nesting stack
    const openStack: { el: TemplateElement; tagName: string }[] = [];

    for (const el of elements) {
        const tagNameLower = el.tagName.toLowerCase();

        // First, consume any closing tags that appear before this element
        while (closeIdx < closingTags.length && closingTags[closeIdx].start < el.tagSpan.start) {
            const ct = closingTags[closeIdx];
            // Find matching open tag on the stack
            for (let j = openStack.length - 1; j >= 0; j--) {
                if (openStack[j].tagName === ct.tagName) {
                    elementEnds.set(openStack[j].el, ct.end);
                    openStack.splice(j, 1);
                    break;
                }
            }
            closeIdx++;
        }

        if (!VOID_ELEMENTS.has(tagNameLower)) {
            // Check for self-closing (tag ends with />)
            const tagText = html.substring(el.tagSpan.start, el.tagSpan.end);
            if (!tagText.endsWith('/>')) {
                openStack.push({ el, tagName: tagNameLower });
            }
        }
    }

    // Consume remaining closing tags
    while (closeIdx < closingTags.length) {
        const ct = closingTags[closeIdx];
        for (let j = openStack.length - 1; j >= 0; j--) {
            if (openStack[j].tagName === ct.tagName) {
                elementEnds.set(openStack[j].el, ct.end);
                openStack.splice(j, 1);
                break;
            }
        }
        closeIdx++;
    }

    // Now build parent-child with proper element end positions
    const parentStack: { el: TemplateElement; end: number }[] = [];
    for (const el of elements) {
        const elEnd = elementEnds.get(el) ?? el.tagSpan.end;

        // Pop elements that have ended before this one starts
        while (parentStack.length > 0 && parentStack[parentStack.length - 1].end <= el.tagSpan.start) {
            parentStack.pop();
        }

        if (parentStack.length > 0) {
            el.parent = parentStack[parentStack.length - 1].el;
            parentStack[parentStack.length - 1].el.children.push(el);
        }

        el.elementEnd = elEnd;
        parentStack.push({ el, end: elEnd });
    }
}

/**
 * Find the nb-* attribute at a given offset in the HTML text.
 * Returns the attribute and whether the position is in the name or value portion.
 */
export function findBindingAtOffset(parsed: ParsedTemplate, offset: number): { binding: TemplateAttribute; inValue: boolean } | undefined {
    for (const binding of parsed.allBindings) {
        if (offset >= binding.nameSpan.start && offset < binding.nameSpan.end) {
            return { binding, inValue: false };
        }
        if (offset >= binding.valueSpan.start && offset <= binding.valueSpan.end) {
            return { binding, inValue: true };
        }
    }
    return undefined;
}

/**
 * Find the element whose opening tag contains the given offset.
 */
export function findElementAtOffset(parsed: ParsedTemplate, offset: number): TemplateElement | undefined {
    for (const el of parsed.elements) {
        if (offset >= el.tagSpan.start && offset <= el.tagSpan.end) {
            return el;
        }
    }
    return undefined;
}

/**
 * Find the deepest element that encloses the given offset (including text content between tags).
 */
export function findEnclosingElement(parsed: ParsedTemplate, offset: number): TemplateElement | undefined {
    let best: TemplateElement | undefined;
    for (const el of parsed.elements) {
        if (offset >= el.tagSpan.start && offset < el.elementEnd) {
            if (!best || el.tagSpan.start >= best.tagSpan.start) {
                best = el;
            }
        }
    }
    return best;
}

/**
 * Check if a position is inside an nb-repeat scope (has an ancestor with nb-repeat).
 */
export function isInRepeatScope(parsed: ParsedTemplate, offset: number): { repeatAttr: TemplateAttribute; prefix?: string } | undefined {
    const element = findElementAtOffset(parsed, offset) ?? findEnclosingElement(parsed, offset);
    if (!element) return undefined;

    // Check current element and walk up parents
    let current: TemplateElement | undefined = element;
    while (current) {
        for (const attr of current.nbAttributes) {
            if (attr.baseName === 'nb-repeat') {
                return { repeatAttr: attr, prefix: attr.suffix };
            }
        }
        current = current.parent;
    }
    return undefined;
}

/**
 * Collect ALL nb-repeat scopes from the element at offset up through ancestors.
 * Returns array from innermost to outermost.
 */
export function getAllRepeatScopes(parsed: ParsedTemplate, offset: number): { repeatAttr: TemplateAttribute; prefix?: string }[] {
    const element = findElementAtOffset(parsed, offset) ?? findEnclosingElement(parsed, offset);
    if (!element) return [];

    const scopes: { repeatAttr: TemplateAttribute; prefix?: string }[] = [];
    let current: TemplateElement | undefined = element;
    while (current) {
        for (const attr of current.nbAttributes) {
            if (attr.baseName === 'nb-repeat') {
                scopes.push({ repeatAttr: attr, prefix: attr.suffix });
            }
        }
        current = current.parent;
    }
    return scopes;
}

/**
 * Collect ALL nb-var local variables visible at the given offset.
 * Walks up from the element at offset through ancestors, collecting nb-var attributes.
 * Returns array from innermost to outermost scope.
 */
export function getAllLocalVars(parsed: ParsedTemplate, offset: number): { varName: string; attr: TemplateAttribute }[] {
    const element = findElementAtOffset(parsed, offset) ?? findEnclosingElement(parsed, offset);
    if (!element) return [];

    const vars: { varName: string; attr: TemplateAttribute }[] = [];
    let current: TemplateElement | undefined = element;
    while (current) {
        for (const attr of current.nbAttributes) {
            if (attr.baseName === 'nb-var' && attr.suffix) {
                vars.push({ varName: kebabToCamelCase(attr.suffix), attr });
            }
        }
        current = current.parent;
    }
    return vars;
}

/**
 * Convert kebab-case to camelCase (e.g. "date-time" → "dateTime").
 */
function kebabToCamelCase(value: string): string {
    return value.toLowerCase().split('-').map((part, i) => i > 0 ? part.charAt(0).toUpperCase() + part.substring(1) : part).join('');
}
