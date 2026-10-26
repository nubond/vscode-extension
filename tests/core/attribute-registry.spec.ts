import {
    getHandlerInfo,
    isNAttribute,
    buildHandlerDocumentation,
    ALL_NB_ATTRIBUTES,
    PREFIX_ATTRIBUTES,
    COMMON_DOM_EVENTS,
} from '../../src/core/attribute-registry';

describe('attribute-registry', () => {
    describe('getHandlerInfo', () => {
        it('should return handler info for nb-value', () => {
            const info = getHandlerInfo('nb-value');
            expect(info).toBeDefined();
            expect(info!.attribute).toBe('nb-value');
            expect(info!.displayName).toBe('Value Binding');
        });

        it('should return handler info for nb-event (prefix attribute)', () => {
            const info = getHandlerInfo('nb-event');
            expect(info).toBeDefined();
            expect(info!.isPrefix).toBe(true);
        });

        it('should resolve nb-event:click to nb-event handler', () => {
            const info = getHandlerInfo('nb-event:click');
            expect(info).toBeDefined();
            expect(info!.attribute).toBe('nb-event');
        });

        it('should resolve data-nb-value to nb-value handler', () => {
            const info = getHandlerInfo('data-nb-value');
            expect(info).toBeDefined();
            expect(info!.attribute).toBe('nb-value');
        });

        it('should resolve data-nb-event:click by falling through to the data- strip', () => {
            // Mixed form — not something either mode produces, but the
            // template parser normalizes any data-nb-* name, so getHandlerInfo
            // must resolve it consistently instead of dead-ending on the
            // colon branch.
            const info = getHandlerInfo('data-nb-event:click');
            expect(info).toBeDefined();
            expect(info!.attribute).toBe('nb-event');
        });

        it('should resolve data-nb-event--click (W3C double-dash separator)', () => {
            // W3C compliance mode flips the meta separator from ':' to '--':
            // data-nb-event--click → nb-event:click → nb-event.
            const info = getHandlerInfo('data-nb-event--click');
            expect(info).toBeDefined();
            expect(info!.attribute).toBe('nb-event');
        });

        it('should resolve W3C suffixed forms for every prefix attribute', () => {
            for (const attr of PREFIX_ATTRIBUTES) {
                const info = getHandlerInfo(`data-${attr}--something`);
                expect(info).toBeDefined();
                expect(info!.attribute).toBe(attr);
            }
        });

        it('should resolve data-nb-in-ref--user-id (kebab suffix with W3C separator)', () => {
            const info = getHandlerInfo('data-nb-in-ref--user-id');
            expect(info).toBeDefined();
            expect(info!.attribute).toBe('nb-in-ref');
        });

        it('should return undefined for unknown attribute', () => {
            expect(getHandlerInfo('unknown-attr')).toBeUndefined();
        });

        it('should return undefined for empty string', () => {
            expect(getHandlerInfo('')).toBeUndefined();
        });

        it('should resolve all known handlers', () => {
            for (const attr of ALL_NB_ATTRIBUTES) {
                expect(getHandlerInfo(attr)).toBeDefined();
            }
        });

        it('should return info for nb-if', () => {
            const info = getHandlerInfo('nb-if');
            expect(info).toBeDefined();
            expect(info!.displayName).toBe('Conditional Rendering');
        });

        it('should return info for nb-repeat', () => {
            const info = getHandlerInfo('nb-repeat');
            expect(info).toBeDefined();
            expect(info!.injectedParams.length).toBeGreaterThan(0);
            const paramNames = info!.injectedParams.map(p => p.name);
            expect(paramNames).toContain('item');
            expect(paramNames).toContain('index');
            expect(paramNames).toContain('count');
        });

        it('should return info for nb-container', () => {
            const info = getHandlerInfo('nb-container');
            expect(info).toBeDefined();
        });

        it('should return info for nb-component', () => {
            const info = getHandlerInfo('nb-component');
            expect(info).toBeDefined();
        });
    });

    describe('isNAttribute', () => {
        it('should return true for known nb attributes', () => {
            expect(isNAttribute('nb-value')).toBe(true);
            expect(isNAttribute('nb-event:click')).toBe(true);
            expect(isNAttribute('nb-if')).toBe(true);
        });

        it('should return true for data-nb attributes', () => {
            expect(isNAttribute('data-nb-value')).toBe(true);
        });

        it('should return false for unknown attributes', () => {
            expect(isNAttribute('class')).toBe(false);
            expect(isNAttribute('id')).toBe(false);
            expect(isNAttribute('ng-model')).toBe(false);
        });
    });

    describe('buildHandlerDocumentation', () => {
        it('should build markdown for nb-value', () => {
            const info = getHandlerInfo('nb-value')!;
            const md = buildHandlerDocumentation(info);
            expect(md).toContain('Value Binding');
            expect(md).toContain('nb-value');
            expect(md).toContain('Expression type');
        });

        it('should include examples', () => {
            const info = getHandlerInfo('nb-value')!;
            const md = buildHandlerDocumentation(info);
            expect(md).toContain('Examples');
            expect(md).toContain('nb-value="this.name"');
        });

        it('should include injected params for nb-event', () => {
            const info = getHandlerInfo('nb-event')!;
            const md = buildHandlerDocumentation(info);
            expect(md).toContain('Injected context variables');
            expect(md).toContain('event');
            expect(md).toContain('element');
        });

        it('should include suffix description for prefix attrs', () => {
            const info = getHandlerInfo('nb-event')!;
            const md = buildHandlerDocumentation(info);
            expect(md).toContain('Suffix');
        });

        it('should include formats for nb-class', () => {
            const info = getHandlerInfo('nb-class')!;
            const md = buildHandlerDocumentation(info);
            expect(md).toContain('Formats');
        });

        it('should include notes when present', () => {
            const info = getHandlerInfo('nb-html')!;
            const md = buildHandlerDocumentation(info);
            expect(md).toContain('Note');
        });

        it('should include named prefix info for nb-repeat', () => {
            const info = getHandlerInfo('nb-repeat')!;
            const md = buildHandlerDocumentation(info);
            expect(md).toContain('Named prefix');
        });

        it('should use fullAttribute when provided', () => {
            const info = getHandlerInfo('nb-event')!;
            const md = buildHandlerDocumentation(info, 'nb-event:click');
            expect(md).toContain('nb-event:click');
        });

        it('should include prefix info', () => {
            const info = getHandlerInfo('nb-value')!;
            const md = buildHandlerDocumentation(info);
            expect(md).toContain('#');
            expect(md).toContain('Single-bind');
        });
    });

    describe('registry constants', () => {
        it('ALL_NB_ATTRIBUTES should include basic handlers', () => {
            expect(ALL_NB_ATTRIBUTES).toContain('nb-value');
            expect(ALL_NB_ATTRIBUTES).toContain('nb-if');
            expect(ALL_NB_ATTRIBUTES).toContain('nb-event');
            expect(ALL_NB_ATTRIBUTES).toContain('nb-repeat');
        });

        it('PREFIX_ATTRIBUTES should include prefix handlers', () => {
            expect(PREFIX_ATTRIBUTES).toContain('nb-event');
            expect(PREFIX_ATTRIBUTES).toContain('nb-attr');
            expect(PREFIX_ATTRIBUTES).toContain('nb-prop');
            expect(PREFIX_ATTRIBUTES).toContain('nb-repeat');
            expect(PREFIX_ATTRIBUTES).not.toContain('nb-value');
        });

        it('COMMON_DOM_EVENTS should include standard events', () => {
            const names = COMMON_DOM_EVENTS.map(e => e.name);
            expect(names).toContain('click');
            expect(names).toContain('input');
            expect(names).toContain('keydown');
            expect(names).toContain('scroll');
        });
    });

    // Mirror tests: lock the framework-derived facts the registry encodes, so
    // accidental drift from the framework's actual behavior is caught here.
    describe('framework-truth mirror', () => {
        it('nb-component is documented as a framework marker (auto-applied by tag), not an @Name binding', () => {
            const info = getHandlerInfo('nb-component')!;
            expect(info.displayName).toMatch(/marker/i);
            // The old wrong examples (`nb-component="@MyButton"`) must not regress.
            for (const ex of info.examples) {
                expect(ex).not.toMatch(/nb-component\s*=\s*["']@/);
            }
            // It must not be a prefix handler and must not list any prefixes the user would author.
            expect(info.isPrefix).toBe(false);
            expect(info.prefixes).toHaveLength(0);
        });

        it('nb-repeat numeric data starts item at 1 (not 0)', () => {
            const info = getHandlerInfo('nb-repeat')!;
            const numericExample = info.examples.find(e => /nb-repeat\s*=\s*["']\s*5\s*["']/.test(e));
            expect(numericExample).toBeDefined();
            // The framework computes `item = repeatIndex + 1` for numeric data,
            // so the documented range is 1..N (not 0..N-1).
            expect(numericExample!).toMatch(/item\s*=\s*1\.\.5/);
            expect(numericExample!).not.toMatch(/item\s*=\s*0\.\.4/);
        });

        it('nb-bound is documented as forced single-bind', () => {
            const info = getHandlerInfo('nb-bound')!;
            expect(info.prefixes.map(p => p.char)).toContain('#');
            expect(info.notes ?? '').toMatch(/single-bind|added automatically/i);
        });

        it('nb-aspect supports the valueless form and the # single-bind prefix', () => {
            const info = getHandlerInfo('nb-aspect')!;
            expect(info.prefixes.map(p => p.char)).toContain('#');
            const hasValuelessExample = info.examples.some(ex => /^nb-aspect:[\w-]+\s*(?:<!--|$)/.test(ex));
            expect(hasValuelessExample).toBe(true);
        });

        it('nb-event documents Promise-return behavior', () => {
            const info = getHandlerInfo('nb-event')!;
            expect((info.notes ?? '').toLowerCase()).toContain('promise');
        });

        it('nb-var documents reserved-name conflicts', () => {
            const info = getHandlerInfo('nb-var')!;
            expect(info.notes ?? '').toMatch(/reserved|transformer/i);
            // Reserved names from Constants.RESERVED_CONTEXT_NAMES.
            for (const reserved of ['item', 'index', 'count', 'event', 'data', 'router', 'unSubscribe', 'nativeElement', 'element']) {
                expect(info.notes ?? '').toContain(reserved);
            }
        });

        it('nb-attr forbids class/style binding', () => {
            const info = getHandlerInfo('nb-attr')!;
            expect(info.notes ?? '').toMatch(/nb-class/i);
            expect(info.notes ?? '').toMatch(/nb-style/i);
        });

        it('nb-prop forbids the dedicated-handler properties and documents kebab-to-camel', () => {
            const info = getHandlerInfo('nb-prop')!;
            // Cannot bind the framework-reserved DOM properties.
            for (const banned of ['className', 'classList', 'style', 'textContent', 'innerText', 'innerHTML']) {
                expect(info.notes ?? '').toContain(banned);
            }
            // Suffix description must call out kebab-to-camel.
            expect(info.suffixDescription ?? '').toMatch(/camel/i);
        });

        it('nb-in is deep-cloned by structuredClone; nb-in-ref bypasses cloning', () => {
            const inInfo = getHandlerInfo('nb-in')!;
            const refInfo = getHandlerInfo('nb-in-ref')!;
            expect((inInfo.description + ' ' + (inInfo.notes ?? '')).toLowerCase()).toContain('structuredclone');
            expect((refInfo.description + ' ' + (refInfo.notes ?? '')).toLowerCase()).toMatch(/reference|clone/);
        });

        it('nb-html is documented as unsanitized by default', () => {
            // The old description implied the value "is passed through the
            // htmlSanitizer" unconditionally — the default sanitizer is an
            // identity pass-through, so nb-html is an XSS sink out of the box.
            const info = getHandlerInfo('nb-html')!;
            expect(info.description.toLowerCase()).toContain('unsanitized by default');
            expect(info.description).not.toContain('is passed through the `htmlSanitizer`');
        });

        it('nb-in note reads correctly (no "does not sees" typo)', () => {
            const info = getHandlerInfo('nb-in')!;
            expect(info.notes ?? '').not.toContain('does not sees');
            expect((info.notes ?? '').toLowerCase()).toContain('clone');
        });

        it('nb-projection / nb-project-to / nb-project-instead are non-prefix, value-as-slot-name attributes', () => {
            for (const name of ['nb-projection', 'nb-project-to', 'nb-project-instead']) {
                const info = getHandlerInfo(name)!;
                expect(info.isPrefix).toBe(false);
                // Framework reads the value verbatim — these handlers don't enable
                // expression prefixes (`#`, `@`, `%`) for the user.
                expect(info.prefixes).toHaveLength(0);
            }
        });

        it('nb-container documents both @Name and %slot binding', () => {
            const info = getHandlerInfo('nb-container')!;
            const chars = info.prefixes.map(p => p.char);
            expect(chars).toContain('@');
            expect(chars).toContain('%');
            expect(info.examples.some(e => /["']%/.test(e))).toBe(true);
        });

        it('nb-html documents the default identity sanitizer (XSS risk)', () => {
            const info = getHandlerInfo('nb-html')!;
            expect(info.notes ?? '').toMatch(/identity|pass-through|sanitiz/i);
            expect(info.notes ?? '').toMatch(/XSS|sanitizer/i);
        });

        it('nb-class formats use `;` as the array/object separator', () => {
            const info = getHandlerInfo('nb-class')!;
            // The framework's parser uses `;`, not `,`, between entries.
            expect(info.formats?.some(f => /;/.test(f))).toBe(true);
            expect(info.examples.some(ex => /\[.*;.*\]/.test(ex))).toBe(true);
            expect(info.examples.some(ex => /\{.*;.*\}/.test(ex))).toBe(true);
        });
    });

    // ---- Round 6 (E7/E4/E8): prefix-list corrections + refreshed notes ----
    describe('registry prefix corrections (round 6)', () => {
        it('nb-style lists NO whole-value prefixes — entries are split before any prefix could apply', () => {
            const info = getHandlerInfo('nb-style')!;
            expect(info.prefixes).toHaveLength(0);
            expect(info.notes ?? '').toMatch(/whole-value/i);
            expect(info.notes ?? '').toContain('#opacity');
        });

        it('nb-switch and nb-case support # (both funnel through processExpressionExecution)', () => {
            expect(getHandlerInfo('nb-switch')!.prefixes.map(p => p.char)).toContain('#');
            const caseChars = getHandlerInfo('nb-case')!.prefixes.map(p => p.char);
            expect(caseChars).toContain('#');
            expect(caseChars).toContain('@');
        });

        it('@ constant is documented on nb-html, nb-if, nb-exec, nb-event, nb-in, nb-in-ref', () => {
            for (const name of ['nb-html', 'nb-if', 'nb-exec', 'nb-event', 'nb-in', 'nb-in-ref']) {
                expect(getHandlerInfo(name)!.prefixes.map(p => p.char)).toContain('@');
            }
        });

        it('nb-prop blocklist documentation includes outerHTML (framework fix #3, 2026-07-13)', () => {
            expect(getHandlerInfo('nb-prop')!.notes ?? '').toContain('outerHTML');
        });

        it('nb-html note documents the global-sanitizer fallback as working (framework fix #1), with the pre-fix-build caveat', () => {
            const notes = getHandlerInfo('nb-html')!.notes ?? '';
            // The old note asserted the global sanitizer is "currently NOT
            // applied" — that framework bug was fixed in src/ on 2026-07-13.
            expect(notes).not.toMatch(/currently NOT applied/i);
            expect(notes).toContain('IGlobalConfig.htmlSanitizer');
            expect(notes).toMatch(/per-context sanitizer wins/i);
            expect(notes).toMatch(/before 2026-07-13/);
        });
    });

    // ---- Round 4b: full help-content verification against the framework ----
    describe('framework-parity doc details (round 4b)', () => {
        it('router injected param is plain Router — the param does not exist when routing is unconfigured', () => {
            const info = getHandlerInfo('nb-event')!;
            const router = info.injectedParams.find(p => p.name === 'router')!;
            expect(router.type).toBe('Router');
            expect(router.description).toMatch(/ReferenceError/);
        });

        it('nb-attr documents the boolean-false trap (stringified, attribute stays active)', () => {
            const info = getHandlerInfo('nb-attr')!;
            expect(info.notes ?? '').toMatch(/false/);
            expect(info.notes ?? '').toMatch(/null/);
        });

        it('nb-style documents kebab-case-only property names and !important priority support', () => {
            const info = getHandlerInfo('nb-style')!;
            expect(info.notes ?? '').toMatch(/kebab/i);
            expect(info.notes ?? '').toMatch(/!important/);
            expect(info.notes ?? '').toMatch(/priority/i);
        });

        it('nb-switch and nb-case document stringified matching', () => {
            expect(getHandlerInfo('nb-switch')!.notes ?? '').toMatch(/STRINGIFIED/i);
            expect(getHandlerInfo('nb-case')!.expressionType).toMatch(/stringified/i);
        });

        it('nb-repeat documents the lowercase prefix requirement', () => {
            const info = getHandlerInfo('nb-repeat')!;
            expect(info.suffixDescription ?? '').toMatch(/lowercase/i);
            expect(info.namedPrefixInfo ?? '').toMatch(/lowercase/i);
        });

        it('nb-container supports the # single-bind prefix (parser + runtime parity)', () => {
            const chars = getHandlerInfo('nb-container')!.prefixes.map(p => p.char);
            expect(chars).toContain('#');
        });

        it('nb-value documents the stringification rules', () => {
            expect(getHandlerInfo('nb-value')!.notes ?? '').toMatch(/JSON\.stringify/);
        });

        it('nb-repeat documents Map/Set-only iteration and entry-tuple items', () => {
            const info = getHandlerInfo('nb-repeat')!;
            expect(info.description).not.toMatch(/other iterables\)/);
            expect(info.notes ?? '').toMatch(/\[key, value\]/);
        });

        it('nb-in documents the in-place-mutation and clone-failure delivery caveats', () => {
            const notes = getHandlerInfo('nb-in')!.notes ?? '';
            expect(notes).toMatch(/in place|in-place|same object/i);
            expect(notes).toMatch(/nb-in-ref/);
        });
    });
});
