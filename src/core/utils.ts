/**
 * utils.ts
 * Pure utility helpers (offsets, paths, type-resolution) plus a barrel that
 * re-exports the focused registry modules under `core/registries/`. Kept as
 * a barrel so existing imports of `'../core/utils'` continue to work after
 * the data was extracted into smaller, single-purpose files.
 */

// ─── Re-exported types and registries ──────────────────────────────────────
// These previously lived inline in this file (1,200+ lines). They were split
// into focused modules so adding a new DOM event property or per-tag attribute
// touches one small file instead of scrolling through a megafile.
export type { MemberInfo, NamedDesc, DomMember } from './types';
export {
    getEventType,
    getEventMemberInfo,
    getAllEventMembers,
} from './registries/dom-events';
export {
    getElementType,
    getTagSpecificMembers,
    getTagSpecificAttributes,
    getTagSpecificProperties,
    getDomMemberInfo,
    getAllDomElementMembers,
} from './registries/dom-elements';
export {
    getElementManipulationMemberInfo,
    getAllElementManipulationMembers,
} from './registries/element-manipulations';

// ─── Pure utility helpers (no registry data) ───────────────────────────────

/** Length of the "this." prefix (5 characters). */
export const THIS_PREFIX_LEN = 5;

/**
 * Pre-built line offset index for efficient offset→line/character conversion.
 * Call `buildLineIndex(text)` once, then use `offsetToLineChar()` for O(log n) lookups.
 */
export interface LineIndex {
    /** Start offset of each line (lineStarts[0] = 0, lineStarts[1] = offset after first '\n', etc.) */
    lineStarts: number[];
}

/**
 * Build a line-start index for the given text.
 * O(n) to build, then O(log n) per lookup.
 */
export function buildLineIndex(text: string): LineIndex {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            lineStarts.push(i + 1);
        }
    }
    return { lineStarts };
}

/**
 * Convert an offset to 0-based line and character using a pre-built line index.
 */
export function offsetToLineChar(index: LineIndex, offset: number): { line: number; character: number } {
    const { lineStarts } = index;
    // Binary search for the line containing offset
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= offset) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return { line: lo, character: offset - lineStarts[lo] };
}

/**
 * Compare two file paths for equality, ignoring slash style and (Windows) case.
 * Use whenever one side comes from `vscode.uri.fsPath` (native separators) and
 * the other from analyzer state (forward-slash, normalized).
 */
export function arePathsEqual(a: string, b: string): boolean {
    return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}

/**
 * Compute the absolute character range of a `MemberReference`'s root member
 * inside the document, given the surrounding binding's value span.
 * Centralizes the `valueSpan.start + prefixLen + ref.start + THIS_PREFIX_LEN`
 * arithmetic that was previously duplicated across providers — small mistakes
 * in any term silently misaligned highlights and renames by a few characters.
 */
export function getAbsoluteMemberRange(
    binding: { valueSpan: { start: number }; expressionPrefix?: string },
    ref: { start: number; rootMember: string }
): { start: number; end: number } {
    const prefixLen = binding.expressionPrefix ? 1 : 0;
    const start = binding.valueSpan.start + prefixLen + ref.start + THIS_PREFIX_LEN;
    return { start, end: start + ref.rootMember.length };
}

/**
 * Determine which chain segment the cursor offset falls on.
 * Returns 0 for root member, 1 for first chained member, etc.
 */
export function getChainIndexAtOffset(chain: string[], refStart: number, exprOffset: number, separators?: number[]): number {
    let pos = refStart + THIS_PREFIX_LEN; // after 'this.'
    for (let i = 0; i < chain.length; i++) {
        const segEnd = pos + chain[i].length;
        if (exprOffset >= pos && exprOffset < segEnd) {
            return i;
        }
        const sepWidth = separators && i < separators.length ? separators[i] : 1;
        pos = segEnd + sepWidth; // +1 for '.', +2 for '?.'
    }
    return 0;
}

/**
 * Walk a member chain through types, resolving each segment's type.
 * Returns the final resolved type string, or undefined if resolution fails at any point.
 */
export function resolveChainType(
    chain: string[],
    associations: ReadonlyArray<{ members: ReadonlyArray<{ name: string; type: string }> }>,
    findMember: (assoc: any, name: string) => { type: string } | undefined,
    findMemberWithType: (typeName: string, memberName: string) => { type: string } | undefined
): string | undefined {
    let currentType: string | undefined;
    for (const assoc of associations) {
        const member = findMember(assoc, chain[0]);
        if (member) {
            currentType = member.type;
            break;
        }
    }
    if (!currentType) return undefined;

    for (let i = 1; i < chain.length; i++) {
        const found = findMemberWithType(currentType, chain[i]);
        if (!found) return currentType;
        currentType = found.type;
    }
    return currentType;
}

/**
 * Infer the element type from a collection type string.
 * e.g. "string[]" → "string", "Array<number>" → "number"
 */
export function inferItemType(collectionType: string): string {
    const stripped = collectionType.replace(/\s*\|\s*(undefined|null)\s*/g, '').trim();
    const arrayGenericMatch = stripped.match(/^Array<(.+)>$/);
    if (arrayGenericMatch) return arrayGenericMatch[1];
    const arrayBracketMatch = stripped.match(/^(.+)\[\]$/);
    if (arrayBracketMatch) return arrayBracketMatch[1];
    if (stripped === 'string') return 'string';
    if (stripped === 'number') return 'number';
    return 'any';
}
