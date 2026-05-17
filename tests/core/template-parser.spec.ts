import { parseTemplate } from '../../src/core/template-parser';

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
});
