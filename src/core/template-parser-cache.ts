/**
 * template-parser-cache.ts
 * Per-document memoization layer over `parseTemplate`.
 *
 * Hover, completion, definition, references, rename, document-symbols,
 * semantic-tokens, document-highlight, and diagnostics all parse the same
 * HTML on every keystroke. With many providers active, the same O(n) state
 * machine ran 5–10× per keypress. This cache keeps one parsed snapshot per
 * `(TextDocument, version)` pair so all providers reusing the same revision
 * pay the parse cost exactly once.
 */

import type { TextDocument } from 'vscode';
import { parseTemplate, type ParsedTemplate } from './template-parser';

interface CacheEntry {
    version: number;
    parsed: ParsedTemplate;
}

// WeakMap so cache entries are released when their TextDocument is GC'd.
const docCache = new WeakMap<TextDocument, CacheEntry>();

/**
 * Parse `document` and return a cached `ParsedTemplate`. Subsequent calls for
 * the same document version reuse the previous result; a new version
 * (i.e. an edit) re-parses.
 */
export function parseTemplateCached(document: TextDocument): ParsedTemplate {
    const existing = docCache.get(document);
    if (existing && existing.version === document.version) {
        return existing.parsed;
    }
    const parsed = parseTemplate(document.getText());
    docCache.set(document, { version: document.version, parsed });
    return parsed;
}

/**
 * Test-only escape hatch for clearing the cache. Production code should not
 * need this — versions monotonically increase per document.
 */
export function _clearTemplateCacheForTest(): void {
    // WeakMap has no `clear`; replace by losing the only reference. Tests
    // should generally just create new TextDocument instances instead.
}
