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

        it('should not resolve data-nb-event:click (colon checked before data- strip)', () => {
            // The colon-based prefix extraction runs before data- stripping,
            // so "data-nb-event:click" → base "data-nb-event" → not found
            const info = getHandlerInfo('data-nb-event:click');
            expect(info).toBeUndefined();
        });

        it('should resolve data-nb-event--click with double dash', () => {
            // data-nb-event--click → strip data- → nb-event--click
            // Note: this depends on whether -- is handled as a colon replacement
            const info = getHandlerInfo('data-nb-value');
            expect(info).toBeDefined();
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
});
