import { parseTemplate, isEvaluatedBinding, findBindingAtOffset, kebabToCamelCase, camelToKebabCase, getAllRepeatScopes, isInRepeatScope, getAllLocalVars } from '../../src/core/template-parser';

// ---- Round 3 (L6): framework parity for kebab→camel conversion ----
// The framework's Helpers.fromKebabToCamelCase only rewrites `-` followed by
// a LETTER — a digit-initial segment keeps its dash, and a trailing dash
// survives. The mirror silently produced names the runtime never creates.
describe('kebabToCamelCase (framework parity)', () => {
    it('converts normal kebab segments', () => {
        expect(kebabToCamelCase('date-time')).toBe('dateTime');
        expect(kebabToCamelCase('a-b-c')).toBe('aBC');
    });

    it('mirrors browser attribute-name lowercasing', () => {
        expect(kebabToCamelCase('userName')).toBe('username');
    });

    it('keeps the dash before a digit-initial segment (framework behavior)', () => {
        expect(kebabToCamelCase('user-2fa')).toBe('user-2fa');
        expect(kebabToCamelCase('col-2')).toBe('col-2');
    });

    it('keeps a trailing dash (framework behavior)', () => {
        expect(kebabToCamelCase('foo-')).toBe('foo-');
    });
});

// ---- Round 3 (L7): nb-attr takes the FULL remainder as the attribute name ----
// The runtime's Attributes handler strips only 'nb-attr:' and uses everything
// after it — `nb-attr:xlink:href` targets the namespaced attribute
// `xlink:href`, not attribute 'xlink' with an extra 'href' segment.
describe('nb-attr multi-colon suffix', () => {
    it('keeps the namespaced attribute name intact', () => {
        const parsed = parseTemplate('<a nb-attr:xlink:href="this.url"></a>');
        const binding = parsed.allBindings.find(b => b.baseName === 'nb-attr')!;
        expect(binding.suffix).toBe('xlink:href');
        expect(binding.extraSuffix).toBeUndefined();
    });

    it('leaves nb-event debounce parsing unchanged', () => {
        const parsed = parseTemplate('<div nb-event:click:300="this.go()"></div>');
        const binding = parsed.allBindings.find(b => b.baseName === 'nb-event')!;
        expect(binding.suffix).toBe('click');
        expect(binding.extraSuffix).toBe('300');
    });

    // W3C parity: the runtime takes the raw remainder after 'data-nb-attr--'
    // VERBATIM — it never converts '--' back to ':'. The two W3C spellings
    // below are DIFFERENT attributes at runtime and must not collapse into
    // the same suffix (the normalize step alone conflates them).
    it('keeps a W3C double-dash remainder literal (data-nb-attr--xlink--href → xlink--href)', () => {
        const parsed = parseTemplate('<a data-nb-attr--xlink--href="this.url"></a>');
        const binding = parsed.allBindings.find(b => b.baseName === 'nb-attr')!;
        expect(binding.suffix).toBe('xlink--href');
        expect(binding.extraSuffix).toBeUndefined();
        expect(binding.fullName).toBe('nb-attr:xlink--href');
    });

    it('keeps the W3C colon spelling for a namespaced attribute (data-nb-attr--xlink:href)', () => {
        const parsed = parseTemplate('<a data-nb-attr--xlink:href="this.url"></a>');
        const binding = parsed.allBindings.find(b => b.baseName === 'nb-attr')!;
        expect(binding.suffix).toBe('xlink:href');
        expect(binding.extraSuffix).toBeUndefined();
    });

    it('keeps plain W3C single-dash suffixes unchanged (data-nb-attr--aria-label)', () => {
        const parsed = parseTemplate('<div data-nb-attr--aria-label="this.label"></div>');
        const binding = parsed.allBindings.find(b => b.baseName === 'nb-attr')!;
        expect(binding.suffix).toBe('aria-label');
        expect(binding.fullName).toBe('nb-attr:aria-label');
    });
});

// ---- W3C compliance-mode parity for the scope helpers ----
// Everything downstream (hover, diagnostics, semantic tokens, completion)
// consumes the parser's normalized view — these lock the normalization for
// the suffix-carrying W3C forms the providers rely on.
describe('W3C mode parity (data-nb-* / -- separator)', () => {
    it('parses nb-event debounce through the W3C separator', () => {
        const parsed = parseTemplate('<input data-nb-event--input--300="this.onInput()"/>');
        const binding = parsed.allBindings.find(b => b.baseName === 'nb-event')!;
        expect(binding.suffix).toBe('input');
        expect(binding.extraSuffix).toBe('300');
    });

    it('parses a kebab-case event name with debounce (data-nb-event--my-event--300)', () => {
        const parsed = parseTemplate('<div data-nb-event--my-event--300="this.fn()"></div>');
        const binding = parsed.allBindings.find(b => b.baseName === 'nb-event')!;
        expect(binding.suffix).toBe('my-event');
        expect(binding.extraSuffix).toBe('300');
    });

    it('exposes a W3C nb-repeat prefix as a repeat scope', () => {
        const parsed = parseTemplate('<div data-nb-repeat--outer="this.items"><span data-nb-value="outerItem.name"></span></div>');
        const inner = parsed.allBindings.find(b => b.baseName === 'nb-value')!;
        const scopes = getAllRepeatScopes(parsed, inner.valueSpan.start);
        expect(scopes.map(s => s.prefix)).toEqual(['outer']);
    });

    it('exposes a W3C nb-var local with kebab→camel conversion', () => {
        const parsed = parseTemplate('<div data-nb-var--user-name="this.owner"><span data-nb-value="userName"></span></div>');
        const inner = parsed.allBindings.find(b => b.baseName === 'nb-value')!;
        const vars = getAllLocalVars(parsed, inner.valueSpan.start, inner);
        expect(vars.map(v => v.varName)).toEqual(['userName']);
    });

    it('parses W3C nb-in / nb-in-ref suffixes', () => {
        const parsed = parseTemplate('<my-cmp data-nb-in--user-id="this.id" data-nb-in-ref--host-element="this.el"></my-cmp>');
        const inBinding = parsed.allBindings.find(b => b.baseName === 'nb-in')!;
        const refBinding = parsed.allBindings.find(b => b.baseName === 'nb-in-ref')!;
        expect(inBinding.suffix).toBe('user-id');
        expect(refBinding.suffix).toBe('host-element');
    });

    it('finds a binding when the offset sits inside the data- part of the name', () => {
        const html = '<div data-nb-value="this.name"></div>';
        const parsed = parseTemplate(html);
        const hit = findBindingAtOffset(parsed, html.indexOf('data-') + 2);
        expect(hit).toBeDefined();
        expect(hit!.binding.baseName).toBe('nb-value');
        expect(hit!.inValue).toBe(false);
    });

    it('parses value-less W3C attributes (data-nb-default)', () => {
        const parsed = parseTemplate('<div data-nb-switch="this.x"><span data-nb-default></span></div>');
        const binding = parsed.allBindings.find(b => b.baseName === 'nb-default');
        expect(binding).toBeDefined();
        expect(binding!.value).toBe('');
    });

    it('does not treat unrelated data-* attributes as bindings', () => {
        const parsed = parseTemplate('<div data-testid="x" data-nbx="y" data-value="z"></div>');
        expect(parsed.allBindings).toHaveLength(0);
    });
});

// ---- Round 3 (L4): a repeat's own expression is outside its own scope ----
// The nb-repeat collection expression evaluates with the PARENT params — its
// own item/index/count don't exist yet. `excludeAttr` lets callers analyzing
// that expression drop the scope contributed by the same attribute.
describe('getAllRepeatScopes excludeAttr', () => {
    const html = '<div nb-repeat:outer="this.items"><span nb-repeat="outerItem.children" nb-value="item"></span></div>';

    it('includes the element\'s own repeat scope by default', () => {
        const parsed = parseTemplate(html);
        const inner = parsed.allBindings.find(b => b.baseName === 'nb-repeat' && !b.suffix)!;
        const scopes = getAllRepeatScopes(parsed, inner.valueSpan.start);
        expect(scopes.map(s => s.prefix)).toEqual([undefined, 'outer']);
    });

    it('excludes the scope contributed by the excluded attribute only', () => {
        const parsed = parseTemplate(html);
        const inner = parsed.allBindings.find(b => b.baseName === 'nb-repeat' && !b.suffix)!;
        const scopes = getAllRepeatScopes(parsed, inner.valueSpan.start, inner);
        expect(scopes.map(s => s.prefix)).toEqual(['outer']);
    });

    it('isInRepeatScope honors the exclusion', () => {
        const parsed = parseTemplate('<li nb-repeat="item.children"></li>');
        const repeat = parsed.allBindings.find(b => b.baseName === 'nb-repeat')!;
        expect(isInRepeatScope(parsed, repeat.valueSpan.start)).toBeDefined();
        expect(isInRepeatScope(parsed, repeat.valueSpan.start, repeat)).toBeUndefined();
    });
});

describe('isEvaluatedBinding', () => {
    it('treats plain and #-prefixed expressions as evaluated', () => {
        expect(isEvaluatedBinding({ expressionPrefix: undefined })).toBe(true);
        expect(isEvaluatedBinding({ expressionPrefix: '#' })).toBe(true);
    });

    it('treats @ constants and % route slots as NOT evaluated', () => {
        expect(isEvaluatedBinding({ expressionPrefix: '@' })).toBe(false);
        expect(isEvaluatedBinding({ expressionPrefix: '%' })).toBe(false);
    });
});

describe('template-parser', () => {
    describe('parseTemplate', () => {
        it('should parse a simple nb-value attribute', () => {
            const result = parseTemplate('<div nb-value="this.name"></div>');
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].baseName).toBe('nb-value');
            expect(result.allBindings[0].expression).toBe('this.name');
        });

        it('should parse nb-event:click with suffix', () => {
            const result = parseTemplate('<button nb-event:click="this.onClick()"></button>');
            expect(result.allBindings).toHaveLength(1);
            const binding = result.allBindings[0];
            expect(binding.baseName).toBe('nb-event');
            expect(binding.suffix).toBe('click');
            expect(binding.fullName).toBe('nb-event:click');
        });

        it('should parse extra suffix (debounce)', () => {
            const result = parseTemplate('<input nb-event:input:300="this.onInput()"/>');
            expect(result.allBindings).toHaveLength(1);
            const binding = result.allBindings[0];
            expect(binding.suffix).toBe('input');
            expect(binding.extraSuffix).toBe('300');
        });

        it('should strip expression prefix #', () => {
            const result = parseTemplate('<div nb-value="#this.name"></div>');
            const binding = result.allBindings[0];
            expect(binding.expressionPrefix).toBe('#');
            expect(binding.expression).toBe('this.name');
            expect(binding.value).toBe('#this.name');
        });

        it('should strip expression prefix @', () => {
            const result = parseTemplate('<div nb-value="@Hello"></div>');
            const binding = result.allBindings[0];
            expect(binding.expressionPrefix).toBe('@');
            expect(binding.expression).toBe('Hello');
        });

        it('should strip expression prefix %', () => {
            const result = parseTemplate('<div nb-container="%page"></div>');
            const binding = result.allBindings[0];
            expect(binding.expressionPrefix).toBe('%');
            expect(binding.expression).toBe('page');
        });

        it('should handle data-nb-* W3C mode attributes', () => {
            const result = parseTemplate('<div data-nb-value="this.name"></div>');
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].baseName).toBe('nb-value');
        });

        it('should handle data-nb-event--click (double dash for colon)', () => {
            const result = parseTemplate('<div data-nb-event--click="this.fn()"></div>');
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].baseName).toBe('nb-event');
            expect(result.allBindings[0].suffix).toBe('click');
        });

        it('should capture multiple nb attributes on same element', () => {
            const result = parseTemplate('<div nb-value="this.x" nb-if="this.y"></div>');
            expect(result.allBindings).toHaveLength(2);
            expect(result.allBindings.map(b => b.baseName).sort()).toEqual(['nb-if', 'nb-value']);
        });

        it('should parse multiple elements', () => {
            const result = parseTemplate('<div nb-value="this.a"></div><span nb-value="this.b"></span>');
            expect(result.allBindings).toHaveLength(2);
            expect(result.elements).toHaveLength(2);
        });

        it('should build parent-child tree', () => {
            const result = parseTemplate('<div><span nb-value="this.x"></span></div>');
            expect(result.elements.length).toBeGreaterThanOrEqual(2);
        });

        it('should handle self-closing elements', () => {
            const result = parseTemplate('<input nb-prop:value="this.val"/>');
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].baseName).toBe('nb-prop');
            expect(result.allBindings[0].suffix).toBe('value');
        });

        it('should handle void elements (br, hr, img etc)', () => {
            const result = parseTemplate('<img nb-attr:src="this.url">');
            expect(result.allBindings).toHaveLength(1);
        });

        it('should capture source spans (nameSpan, valueSpan)', () => {
            const html = '<div nb-value="this.x"></div>';
            const result = parseTemplate(html);
            const binding = result.allBindings[0];
            expect(binding.nameSpan.start).toBe(5); // position of 'nb-value'
            expect(binding.valueSpan.start).toBe(15); // position of 'this.x' within quotes
        });

        it('should calculate line and character for spans', () => {
            const html = '<div\n  nb-value="this.x"></div>';
            const result = parseTemplate(html);
            const binding = result.allBindings[0];
            expect(binding.nameSpan.line).toBe(1); // second line
            expect(binding.nameSpan.character).toBe(2); // 2 spaces indent
        });

        it('should handle empty HTML', () => {
            const result = parseTemplate('');
            expect(result.allBindings).toHaveLength(0);
            expect(result.elements).toHaveLength(0);
        });

        it('should ignore non-nb attributes', () => {
            const result = parseTemplate('<div class="test" id="main" nb-value="this.x"></div>');
            expect(result.allBindings).toHaveLength(1);
        });

        it('should record all attributes on the element', () => {
            const result = parseTemplate('<div class="test" nb-value="this.x"></div>');
            const el = result.elements[0];
            expect(el.allAttributes.has('class')).toBe(true);
            expect(el.allAttributes.has('nb-value')).toBe(true);
        });

        it('should skip HTML comments', () => {
            const result = parseTemplate('<!-- comment --><div nb-value="this.x"></div>');
            expect(result.allBindings).toHaveLength(1);
        });

        it('should handle attributes without value (boolean attrs)', () => {
            const result = parseTemplate('<div nb-default></div>');
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].value).toBe('');
            expect(result.allBindings[0].expression).toBe('');
        });

        it('should parse {{interpolation}} expressions', () => {
            const result = parseTemplate('<div>Hello {{this.name}}</div>');
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].baseName).toBe('nb-value');
            expect(result.allBindings[0].expression).toBe('this.name');
        });

        it('should parse {{#prefix}} interpolation', () => {
            const result = parseTemplate('<span>{{#this.once}}</span>');
            const binding = result.allBindings[0];
            expect(binding.expressionPrefix).toBe('#');
            expect(binding.expression).toBe('this.once');
        });

        it('should skip interpolations inside HTML tags', () => {
            // {{...}} inside a tag's attribute is handled by attribute parsing, not interpolation
            const result = parseTemplate('<div title="{{this.x}}">text</div>');
            // Should not find an interpolation binding for the one inside the tag
            const interpolationBindings = result.allBindings.filter(b => b.nameSpan.start > 24);
            expect(interpolationBindings).toHaveLength(0);
        });

        it('should handle single-quoted attribute values', () => {
            const result = parseTemplate("<div nb-value='this.x'></div>");
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].expression).toBe('this.x');
        });

        it('should assign tag names', () => {
            const result = parseTemplate('<div nb-value="this.x"></div>');
            expect(result.elements[0].tagName).toBe('div');
        });
    });

    // ---- Regression: comments were only stepped over by one character, so
    // commented-out markup produced live bindings, phantom diagnostics, and
    // closing tags inside comments corrupted the element tree. ----
    describe('comment handling', () => {
        it('does not produce bindings from commented-out markup', () => {
            const result = parseTemplate('<!-- <div nb-value="this.old"></div> --><span nb-value="this.live"></span>');
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].expression).toBe('this.live');
        });

        it('ignores closing tags inside comments when building the tree', () => {
            const html = '<div nb-var:x="1"><!-- </div> --><span nb-value="x"></span></div>';
            const result = parseTemplate(html);
            const span = result.elements.find(e => e.tagName === 'span');
            expect(span).toBeDefined();
            // The commented-out </div> must not close the live <div>
            expect(span!.parent?.tagName).toBe('div');
        });

        it('skips interpolations inside comments', () => {
            const result = parseTemplate('<!-- {{this.x}} --><div>{{this.y}}</div>');
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].expression).toBe('this.y');
        });

        it('handles an unterminated comment without hanging', () => {
            const result = parseTemplate('<!-- unterminated <div nb-value="this.x">');
            expect(result.allBindings).toHaveLength(0);
        });
    });

    // ---- Regression: the interpolation regex rejected '>' so comparison
    // expressions were invisible, and the inside-tag check was confused by
    // '>' inside quoted attribute values. ----
    describe('interpolations with comparison operators', () => {
        it('parses {{ a > b }}', () => {
            const result = parseTemplate('<div>{{this.a > this.b}}</div>');
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].expression).toBe('this.a > this.b');
        });

        it('still skips interpolations inside a tag when a prior attribute value contains ">"', () => {
            const html = '<div nb-if="this.a > this.b" title="{{this.x}}">text</div>';
            const result = parseTemplate(html);
            // Only the nb-if binding — the {{...}} sits inside the opening tag
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].baseName).toBe('nb-if');
        });

        // ---- Round 6 (E6): '<' followed by a non-tag-start character is
        // legal HTML text — posthtml keeps the text node intact, the plugin
        // transforms it, and the runtime evaluates it. The regex previously
        // rejected EVERY '<', so comparison interpolations were invisible. ----
        it('parses {{ index < count }} (a "<" not starting a tag is text)', () => {
            const result = parseTemplate('<div>{{ index < count }}</div>');
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].baseName).toBe('nb-value');
            expect(result.allBindings[0].expression).toBe(' index < count ');
        });

        it('parses {{ a <= b }} and {{ a < 5 }}', () => {
            expect(parseTemplate('<div>{{ this.a <= this.b }}</div>').allBindings).toHaveLength(1);
            expect(parseTemplate('<div>{{ this.a < 5 }}</div>').allBindings).toHaveLength(1);
        });

        it('still terminates the scan at a real tag start inside the braces', () => {
            // '<' followed by a letter, '/', or '!' begins real markup — a
            // binding must never span it.
            expect(parseTemplate('<div>{{ a <b>bold</b> }}</div>').allBindings).toHaveLength(0);
            expect(parseTemplate('<div>{{ a </div>').allBindings).toHaveLength(0);
            expect(parseTemplate('<div>{{ a <!-- c --> }}</div>').allBindings).toHaveLength(0);
        });

        it('handles "<" after a lone "}" inside the expression', () => {
            const result = parseTemplate('<div>{{ this.map[k] } < 5 }}</div>');
            // '} <' is a single '}' followed by non-'}' text — still one binding.
            expect(result.allBindings).toHaveLength(1);
            expect(result.allBindings[0].expression).toBe(' this.map[k] } < 5 ');
        });
    });

    // ---- Regression: implied-close tags (a sibling <li> without an explicit
    // </li>) stayed on the open stack, leaking nb-var / nb-repeat scopes
    // across siblings. ----
    describe('implied-close tags', () => {
        it('closes a previous <li> when a sibling <li> starts', () => {
            const html = '<ul><li nb-var:first="1">one<li nb-value="this.x">two</li></ul>';
            const result = parseTemplate(html);
            const liElements = result.elements.filter(e => e.tagName === 'li');
            expect(liElements).toHaveLength(2);
            // The second <li> is a SIBLING under <ul>, not a child of the first
            expect(liElements[1].parent?.tagName).toBe('ul');
        });

        it('implicitly closes unclosed children at the parent closing tag', () => {
            const html = '<ul><li>one</ul><div nb-value="this.x"></div>';
            const result = parseTemplate(html);
            const div = result.elements.find(e => e.tagName === 'div');
            expect(div).toBeDefined();
            // The unclosed <li> ends at </ul> — the following <div> is top-level
            expect(div!.parent).toBeUndefined();
        });
    });
});

// ---- Round-2 regressions ----

describe('parseTemplate — raw-text elements (<script>/<style>)', () => {
    it('does not parse tags out of <script> content', () => {
        const html = '<div nb-if="this.a"><script>for (let i = 0; i<arr.length; i++) { run(i); }</script><span nb-value="this.b"></span></div>';
        const parsed = parseTemplate(html);
        const tagNames = parsed.elements.map(e => e.tagName);
        expect(tagNames).toEqual(['div', 'script', 'span']);
    });

    it('does not produce interpolation bindings from {{ }} inside <script>', () => {
        const html = '<script>const t = `{{not a binding}}`;</script><p>{{this.real}}</p>';
        const parsed = parseTemplate(html);
        expect(parsed.allBindings).toHaveLength(1);
        expect(parsed.allBindings[0].expression).toBe('this.real');
    });

    it('does not let a literal close tag inside <style> steal a live close', () => {
        const html = '<div nb-if="this.x"><style>/* </div> */ .a { color: red; }</style><span nb-value="this.y"></span></div>';
        const parsed = parseTemplate(html);
        const div = parsed.elements.find(e => e.tagName === 'div')!;
        const span = parsed.elements.find(e => e.tagName === 'span')!;
        expect(span.parent).toBe(div);
    });

    it('still parses elements after a script section', () => {
        const html = '<script src="app.js"></script><div nb-value="this.name"></div>';
        const parsed = parseTemplate(html);
        expect(parsed.allBindings).toHaveLength(1);
        expect(parsed.allBindings[0].expression).toBe('this.name');
    });
});

describe('parseTemplate — unclosed elements at EOF', () => {
    it('extends unclosed elements to end of input so scopes survive mid-typing', () => {
        const html = '<div nb-repeat="this.items"><span nb-value="item"';
        const parsed = parseTemplate(html);
        const div = parsed.elements[0];
        const span = parsed.elements[1];
        expect(div.elementEnd).toBe(html.length);
        expect(span.parent).toBe(div);
    });

    it('keeps children of an unclosed fragment root', () => {
        const html = '<section nb-if="this.show">\n  <p nb-value="this.text"></p>\n';
        const parsed = parseTemplate(html);
        const section = parsed.elements.find(e => e.tagName === 'section')!;
        const p = parsed.elements.find(e => e.tagName === 'p')!;
        expect(p.parent).toBe(section);
        expect(section.elementEnd).toBe(html.length);
    });
});

describe('parseTemplate — unquoted attribute values with self-closing tags', () => {
    it('does not swallow the self-closing slash into the value', () => {
        const html = '<my-tag value=foo/><span nb-value="this.x"></span>';
        const parsed = parseTemplate(html);
        const myTag = parsed.elements.find(e => e.tagName === 'my-tag')!;
        expect(myTag.allAttributes.get('value')!.value).toBe('foo');
        // self-closing detected → span is a sibling, not a child
        const span = parsed.elements.find(e => e.tagName === 'span')!;
        expect(span.parent).toBeUndefined();
    });
});

describe('parseTemplate — value-less attribute spans', () => {
    // Regression: the empty value span was left at the whitespace-skipped
    // scan position — ON the next attribute's first character — and
    // findBindingAtOffset's inclusive end claimed it: hover/completion had a
    // one-character dead spot after every value-less nb-attribute.
    it('anchors the empty value span at the name end', () => {
        const html = '<div nb-switch="this.x"><span nb-default nb-value="this.fallback"></span></div>';
        const parsed = parseTemplate(html);
        const nbDefault = parsed.allBindings.find(b => b.baseName === 'nb-default')!;
        expect(nbDefault.valueSpan.start).toBe(nbDefault.nameSpan.end);
        expect(nbDefault.valueSpan.end).toBe(nbDefault.nameSpan.end);
    });

    it('resolves the first character of the attribute FOLLOWING a value-less one', () => {
        const html = '<div nb-switch="this.x"><span nb-default nb-value="this.fallback"></span></div>';
        const parsed = parseTemplate(html);
        const nextAttrOffset = html.indexOf('nb-value="this.fallback"');
        const hit = findBindingAtOffset(parsed, nextAttrOffset);
        expect(hit).toBeDefined();
        expect(hit!.binding.baseName).toBe('nb-value');
        expect(hit!.inValue).toBe(false);
    });
});

describe('parseTemplate — % is a Container-only expression prefix', () => {
    // The framework's Container handler is the ONLY place that honors a
    // leading '%' (route slot); ExpressionDetails recognizes just '#'/'@'.
    it('keeps % as a route-slot prefix on nb-container', () => {
        const parsed = parseTemplate('<div nb-container="%page"></div>');
        expect(parsed.allBindings[0].expressionPrefix).toBe('%');
        expect(parsed.allBindings[0].expression).toBe('page');
    });

    it('does not treat % as a prefix on other attributes (the runtime evaluates it)', () => {
        const parsed = parseTemplate('<div nb-value="%foo"></div>');
        const binding = parsed.allBindings[0];
        expect(binding.expressionPrefix).toBeUndefined();
        expect(binding.expression).toBe('%foo');
        // Classified as evaluated — matching the runtime's (erroring) eval
        expect(isEvaluatedBinding(binding)).toBe(true);
    });

    it('does not strip % from {{ }} interpolation expressions', () => {
        const parsed = parseTemplate('<p>{{%foo}}</p>');
        expect(parsed.allBindings[0].expressionPrefix).toBeUndefined();
        expect(parsed.allBindings[0].expression).toBe('%foo');
    });
});

describe('parseTemplate — raw-text close-tag prefixes', () => {
    it('a close-tag whose name merely STARTS with the raw-text tag does not end the range', () => {
        // '</scripty>' inside the script must not terminate <script> — the
        // real HTML rule requires '>', '/', whitespace, or EOF after the name.
        const html = '<div nb-if="this.a"><script>el.innerHTML = "</scripty>"; if (i<b.length) run();</script><span nb-value="this.b"></span></div>';
        const parsed = parseTemplate(html);
        expect(parsed.elements.map(e => e.tagName)).toEqual(['div', 'script', 'span']);
        const div = parsed.elements.find(e => e.tagName === 'div')!;
        const span = parsed.elements.find(e => e.tagName === 'span')!;
        expect(span.parent).toBe(div);
    });

    it('same rule for <style> (`</styled-thing>` does not close it)', () => {
        const html = '<style>/* </styled-thing> */ .a { color: red; }</style><div nb-value="this.x"></div>';
        const parsed = parseTemplate(html);
        expect(parsed.allBindings).toHaveLength(1);
        expect(parsed.allBindings[0].expression).toBe('this.x');
        expect(parsed.elements.map(e => e.tagName)).toEqual(['style', 'div']);
    });
});

// ---- Round 4 (L1): the runtime TRIMS values before prefix detection ----
// `Attributes`' constructor trims attribute values and `ExpressionDetails`
// trims again, so `" @literal"` is a constant at runtime. The parser must
// detect the prefix at the first non-whitespace char and expose the
// expression's exact offset inside the raw value for span math.
describe('expression prefix detection after leading whitespace (round 4)', () => {
    it('exposes expressionOffset 0 without a prefix', () => {
        const parsed = parseTemplate('<div nb-value="this.x"></div>');
        const b = parsed.allBindings[0];
        expect(b.expressionPrefix).toBeUndefined();
        expect(b.expressionOffset).toBe(0);
        expect(b.expression).toBe('this.x');
    });

    it('exposes expressionOffset 1 for a prefix at position 0', () => {
        const parsed = parseTemplate('<div nb-value="@Hello"></div>');
        const b = parsed.allBindings[0];
        expect(b.expressionPrefix).toBe('@');
        expect(b.expressionOffset).toBe(1);
        expect(b.expression).toBe('Hello');
    });

    it('detects an @ constant after leading whitespace (runtime-trim parity)', () => {
        const parsed = parseTemplate('<div nb-value=" @Version 2"></div>');
        const b = parsed.allBindings[0];
        expect(b.expressionPrefix).toBe('@');
        expect(b.expressionOffset).toBe(2);
        expect(b.expression).toBe('Version 2');
        expect(isEvaluatedBinding(b)).toBe(false);
    });

    it('detects a # single-bind after leading whitespace', () => {
        const parsed = parseTemplate('<div nb-value="  #this.load()"></div>');
        const b = parsed.allBindings[0];
        expect(b.expressionPrefix).toBe('#');
        expect(b.expressionOffset).toBe(3);
        expect(b.expression).toBe('this.load()');
    });

    it('detects a prefix after leading whitespace in interpolations', () => {
        const parsed = parseTemplate('<div>{{ #this.x }}</div>');
        const b = parsed.allBindings[0];
        expect(b.expressionPrefix).toBe('#');
        expect(b.expressionOffset).toBe(2);
        expect(b.expression).toBe('this.x ');
    });
});

// ---- Round 4 (M2): the runtime repeat prefix is the DOM-LOWERCASED name ----
// The browser ASCII-lowercases attribute names (verified against jsdom), and
// the runtime uses the lowercased remainder verbatim: `nb-repeat:myList`
// injects `mylistItem`, never `myListItem`.
describe('repeat prefix lowercasing (round 4)', () => {
    it('lowercases the prefix in getAllRepeatScopes', () => {
        const html = '<div nb-repeat:myList="this.items"><span nb-value="x"></span></div>';
        const parsed = parseTemplate(html);
        const scopes = getAllRepeatScopes(parsed, html.indexOf('nb-value'));
        expect(scopes).toHaveLength(1);
        expect(scopes[0].prefix).toBe('mylist');
    });

    it('keeps an already-lowercase prefix as-is', () => {
        const html = '<div nb-repeat:outer="this.items"><span nb-value="x"></span></div>';
        const parsed = parseTemplate(html);
        const scopes = getAllRepeatScopes(parsed, html.indexOf('nb-value'));
        expect(scopes[0].prefix).toBe('outer');
    });
});

// ---- Round 4 (M1 support): camelCase → kebab-case authoring direction ----
describe('camelToKebabCase (framework parity)', () => {
    it('converts camelCase DOM property names', () => {
        expect(camelToKebabCase('tabIndex')).toBe('tab-index');
        expect(camelToKebabCase('selectedIndex')).toBe('selected-index');
        expect(camelToKebabCase('contentEditable')).toBe('content-editable');
    });

    it('lowercases a leading capital without a dash (framework behavior)', () => {
        expect(camelToKebabCase('TabIndex')).toBe('tab-index');
    });

    it('leaves single-word names untouched', () => {
        expect(camelToKebabCase('value')).toBe('value');
        expect(camelToKebabCase('checked')).toBe('checked');
    });
});

// ---- Round 4 (M4): nb-var visibility gated by the consuming handler ----
// Runtime bind sequence: repeat → variables → everything else; switch cases
// evaluate with the parent switch's params; the first nb-var on an element
// sees no sibling vars; reserved-named vars are never created at all.
describe('getAllLocalVars consumer gating (round 4)', () => {
    it('excludes same-element vars for the nb-repeat consumer (repeat binds before variables)', () => {
        const html = '<div nb-var:limit="5" nb-repeat="this.items.slice(0, limit)"></div>';
        const parsed = parseTemplate(html);
        const repeatBinding = parsed.allBindings.find(b => b.baseName === 'nb-repeat')!;
        const offset = repeatBinding.valueSpan.start;
        expect(getAllLocalVars(parsed, offset).map(v => v.varName)).toContain('limit');
        expect(getAllLocalVars(parsed, offset, repeatBinding).map(v => v.varName)).not.toContain('limit');
    });

    it('keeps ANCESTOR vars for the nb-repeat consumer', () => {
        const html = '<div nb-var:limit="5"><span nb-repeat="this.items.slice(0, limit)"></span></div>';
        const parsed = parseTemplate(html);
        const repeatBinding = parsed.allBindings.find(b => b.baseName === 'nb-repeat')!;
        expect(getAllLocalVars(parsed, repeatBinding.valueSpan.start, repeatBinding).map(v => v.varName))
            .toContain('limit');
    });

    it('excludes the case element\'s own vars for nb-case (evaluated with the switch\'s params)', () => {
        const html = '<div nb-switch="this.s" nb-var:sv="1"><span nb-case="sv" nb-var:cv="2"></span></div>';
        const parsed = parseTemplate(html);
        const caseBinding = parsed.allBindings.find(b => b.baseName === 'nb-case')!;
        const names = getAllLocalVars(parsed, caseBinding.valueSpan.start, caseBinding).map(v => v.varName);
        expect(names).toContain('sv');       // switch element's var — visible
        expect(names).not.toContain('cv');   // case element's own var — not visible
    });

    it('the FIRST nb-var on an element sees no sibling vars (not even itself)', () => {
        const html = '<div nb-var:a="b" nb-var:b="2"></div>';
        const parsed = parseTemplate(html);
        const varA = parsed.allBindings.find(b => b.fullName === 'nb-var:a')!;
        const varB = parsed.allBindings.find(b => b.fullName === 'nb-var:b')!;
        expect(getAllLocalVars(parsed, varA.valueSpan.start, varA).map(v => v.varName)).toEqual([]);
        // From the second var on, the whole pre-seeded map applies.
        expect(getAllLocalVars(parsed, varB.valueSpan.start, varB).map(v => v.varName).sort()).toEqual(['a', 'b']);
    });

    it('filters reserved-named vars the runtime refuses to create', () => {
        const html = '<div nb-var:item="1" nb-var:x="2"><span nb-value="x"></span></div>';
        const parsed = parseTemplate(html);
        const names = getAllLocalVars(parsed, html.indexOf('nb-value')).map(v => v.varName);
        expect(names).toEqual(['x']);
        // 'x' is the first CREATED var (nb-var:item is never created), so its
        // own expression sees no sibling vars.
        const varX = parsed.allBindings.find(b => b.fullName === 'nb-var:x')!;
        expect(getAllLocalVars(parsed, varX.valueSpan.start, varX)).toEqual([]);
    });
});
