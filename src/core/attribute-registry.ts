/**
 * attribute-registry.ts
 * Static registry of all nb-* handlers with documentation, injected parameters, and metadata.
 */

export interface InjectedParam {
    name: string;
    type: string;
    description: string;
}

export interface HandlerInfo {
    /** The base attribute name, e.g. "nb-value" */
    attribute: string;
    /** Human-readable handler name */
    displayName: string;
    /** Detailed description of what this handler does */
    description: string;
    /** The type of expression accepted */
    expressionType: string;
    /** Whether the attribute takes a colon-suffix (e.g. nb-event:click) */
    isPrefix: boolean;
    /** Suffix description when isPrefix is true */
    suffixDescription?: string;
    /** Supported expression prefixes */
    prefixes: PrefixInfo[];
    /** Parameters injected into scope when this handler is active */
    injectedParams: InjectedParam[];
    /** Named prefix variant info (e.g. nb-repeat:outer) */
    namedPrefixInfo?: string;
    /** Additional notes */
    notes?: string;
    /** Usage examples */
    examples: string[];
    /** Formats when multiple syntax styles exist (nb-class) */
    formats?: string[];
}

export interface PrefixInfo {
    char: string;
    name: string;
    description: string;
}

const SINGLE_BIND_PREFIX: PrefixInfo = {
    char: '#',
    name: 'Single-bind',
    description: 'Evaluates once, then freezes (one-time binding).'
};

const CONSTANT_PREFIX: PrefixInfo = {
    char: '@',
    name: 'Constant',
    description: 'Treated as a literal constant value (no evaluation).'
};

const ROUTE_PREFIX: PrefixInfo = {
    char: '%',
    name: 'Route slot',
    description: 'Binds a container to a named route slot.'
};

const EVENT_INJECTED_PARAMS: InjectedParam[] = [
    { name: 'element', type: 'ElementManipulations', description: 'Facade for manipulating the current element\'s properties, attributes, styles, and classes.' },
    { name: 'event', type: 'Event', description: 'The native DOM Event object.' },
    { name: 'data', type: 'any', description: 'Custom event detail payload (event.detail).' },
    { name: 'unSubscribe', type: '() => void', description: 'Call to manually unsubscribe from this event.' },
    { name: 'router', type: 'Router | undefined', description: 'Router instance, if routing is configured.' },
    { name: 'nativeElement', type: 'Element', description: 'The native DOM element.' }
];

const REPEAT_INJECTED_PARAMS: InjectedParam[] = [
    { name: 'item', type: 'T', description: 'The current iteration item.' },
    { name: 'index', type: 'number', description: 'The current iteration index (0-based).' },
    { name: 'count', type: 'number', description: 'The total number of items in the collection.' }
];

const BOUND_INJECTED_PARAMS: InjectedParam[] = [
    { name: 'element', type: 'ElementManipulations', description: 'Facade for manipulating the bound element.' },
    { name: 'nativeElement', type: 'Element', description: 'The native DOM element.' }
];

const HANDLER_REGISTRY: HandlerInfo[] = [
    {
        attribute: 'nb-value',
        displayName: 'Value Binding',
        description: 'Binds the result of an expression to the element\'s `textContent`. The expression is re-evaluated on every change detection cycle (unless single-bound with `#`).',
        expressionType: 'any → string',
        isPrefix: false,
        prefixes: [SINGLE_BIND_PREFIX, CONSTANT_PREFIX],
        injectedParams: [],
        examples: [
            'nb-value="this.name"',
            'nb-value="#this.name"',
            'nb-value="@Hello World"',
            'nb-value="`Hello, ${this.name}!`"'
        ]
    },
    {
        attribute: 'nb-html',
        displayName: 'HTML Binding',
        description: 'Binds the result of an expression to the element\'s `innerHTML`. The value is passed through the `htmlSanitizer` configured on `IContextConfig` / `IGlobalConfig`.',
        expressionType: 'string (HTML)',
        isPrefix: false,
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: [],
        examples: [
            'nb-html="this.richContent"',
            'nb-html="#this.staticHtml"'
        ],
        notes: 'Raw HTML injection. The default `htmlSanitizer` is an identity function (pass-through) — register a real sanitizer in `IContextConfig.htmlSanitizer` (or `IGlobalConfig.htmlSanitizer`) to prevent XSS.'
    },
    {
        attribute: 'nb-class',
        displayName: 'Class Binding',
        description: 'Dynamically binds CSS classes to an element. Supports three formats: simple string, array, and conditional object. Entries inside `[ ]` and `{ }` are separated by `;`. Each entry may use the `#` single-bind prefix on its own expression.',
        expressionType: 'string | string[] | { [className]: boolean }',
        isPrefix: false,
        prefixes: [SINGLE_BIND_PREFIX, CONSTANT_PREFIX],
        injectedParams: [],
        formats: [
            'Simple: expression returning a class name string',
            'Array: [expr1; expr2] — multiple class names',
            'Conditional: {className: booleanExpr; anotherClass: booleanExpr}'
        ],
        examples: [
            'nb-class="this.className"',
            'nb-class="[this.class1; this.class2]"',
            'nb-class="{active: this.isActive; hidden: this.isHidden}"',
            'nb-class="@my-static-class"'
        ],
        notes: 'Trailing or empty entries inside `[ ]` / `{ }` are filtered out.'
    },
    {
        attribute: 'nb-style',
        displayName: 'Style Binding',
        description: 'Dynamically binds inline CSS styles to an element. Multiple properties are separated by `;`. Each entry may use the `#` single-bind prefix on its own expression.',
        expressionType: 'prop: expression; prop: expression',
        isPrefix: false,
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: [],
        examples: [
            'nb-style="opacity: this.fade; color: this.textColor"',
            'nb-style="opacity: #this.initialOpacity; color: this.textColor"',
            'nb-style="background-color: this.themeBg"'
        ],
        notes: 'Trailing or empty entries are filtered out. Evaluating a property to `null` or `undefined` removes it from the inline style.'
    },
    {
        attribute: 'nb-attr',
        displayName: 'Attribute Binding',
        description: 'Binds the result of an expression to an HTML attribute. The attribute name is specified after the colon. Setting the value to `null` (or `undefined`) removes the attribute.',
        expressionType: 'any',
        isPrefix: true,
        suffixDescription: 'The HTML attribute name to bind (e.g., `disabled`, `title`, `aria-label`). Names are kept as-is.',
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: [],
        examples: [
            'nb-attr:disabled="this.isDisabled"',
            'nb-attr:title="this.tooltipText"',
            'nb-attr:aria-label="this.label"',
            'nb-attr:open="this.isOpen ? \'\' : null"'
        ],
        notes: 'Cannot bind to `class` (use `nb-class`) or `style` (use `nb-style`); framework-reserved `nb-*` / `data-nb-*` attribute names are rejected.'
    },
    {
        attribute: 'nb-prop',
        displayName: 'Property Binding',
        description: 'Binds the result of an expression to a DOM property. The property name is specified after the colon and converted from kebab-case to camelCase (e.g., `nb-prop:selected-index` → `selectedIndex`).',
        expressionType: 'any',
        isPrefix: true,
        suffixDescription: 'The DOM property name to bind. Kebab-cased names are converted to camelCase (e.g., `selected-index` → `selectedIndex`).',
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: [],
        examples: [
            'nb-prop:checked="this.isChecked"',
            'nb-prop:value="this.inputValue"',
            'nb-prop:selected-index="this.activeIndex"'
        ],
        notes: 'Cannot bind to `className`, `classList`, `style`, `textContent`, `innerText`, or `innerHTML` — use the dedicated `nb-class` / `nb-style` / `nb-value` / `nb-html` handlers instead.'
    },
    {
        attribute: 'nb-if',
        displayName: 'Conditional Rendering',
        description: 'Conditionally shows or hides the element based on a boolean expression. When false, the element is hidden (a CSS class is applied).',
        expressionType: 'boolean',
        isPrefix: false,
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: [],
        examples: [
            'nb-if="this.isVisible"',
            'nb-if="#this.showOnce"',
            'nb-if="this.items.length > 0"'
        ]
    },
    {
        attribute: 'nb-repeat',
        displayName: 'Repeat / Loop',
        description: 'Repeats the element for each entry in a collection. Supports arrays, typed arrays, strings, `Map` / `Set` (and other iterables), positive numbers (generates `item = 1..N`), and plain objects (iterates own property values).',
        expressionType: 'Array | TypedArray | string | number | Iterable | Object',
        isPrefix: true,
        suffixDescription: 'Optional named prefix for nested loops (e.g., `nb-repeat:outer`). Injected parameters become prefixed: `outerItem`, `outerIndex`, `outerCount`. The prefix is rejected if it collides with a registered `@Transformer` name.',
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: REPEAT_INJECTED_PARAMS,
        namedPrefixInfo: 'With `nb-repeat:PREFIX`, injected params become `PREFIXItem`, `PREFIXIndex`, `PREFIXCount`. This enables nested loops without variable-name collisions.',
        examples: [
            'nb-repeat="this.items"',
            'nb-repeat:outer="this.groups"',
            'nb-repeat="5"  <!-- repeats 5 times, item = 1..5, index = 0..4 -->',
            'nb-repeat="#this.snapshot"  <!-- iterate once, then freeze -->'
        ],
        notes: 'For plain-object data, `item` is each own-property value (not the key).'
    },
    {
        attribute: 'nb-switch',
        displayName: 'Switch Statement',
        description: 'Evaluates an expression and shows the matching `nb-case` child element. Works together with `nb-case` and `nb-default`.',
        expressionType: 'any (compared via equality)',
        isPrefix: false,
        prefixes: [],
        injectedParams: [],
        examples: [
            'nb-switch="this.status"'
        ],
        notes: 'Child elements should use `nb-case` or `nb-default`.'
    },
    {
        attribute: 'nb-case',
        displayName: 'Switch Case',
        description: 'A case branch inside an `nb-switch`. Visible when the case value matches the parent switch expression.',
        expressionType: 'any (matched against parent nb-switch value)',
        isPrefix: false,
        prefixes: [CONSTANT_PREFIX],
        injectedParams: [],
        examples: [
            'nb-case="@active"',
            'nb-case="@1"',
            'nb-case="this.expectedValue"'
        ],
        notes: 'Must be a direct nuBond child of an element with `nb-switch`.'
    },
    {
        attribute: 'nb-default',
        displayName: 'Switch Default',
        description: 'The default branch inside an `nb-switch`. Shown when no `nb-case` matches.',
        expressionType: 'none (attribute presence only)',
        isPrefix: false,
        prefixes: [],
        injectedParams: [],
        examples: [
            'nb-default'
        ],
        notes: 'Must be a direct nuBond child of an element with `nb-switch`.'
    },
    {
        attribute: 'nb-event',
        displayName: 'Event Handler',
        description: 'Subscribes to a DOM event on the element. The event name is specified after the first colon. An optional second colon suffix specifies debounce in milliseconds.',
        expressionType: 'void | Promise<void>',
        isPrefix: true,
        suffixDescription: 'Event name (e.g., `click`, `input`, `mouseover`). Optional debounce in milliseconds: `nb-event:click:300`.',
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: EVENT_INJECTED_PARAMS,
        examples: [
            'nb-event:click="this.onClick()"',
            'nb-event:input:300="this.onSearch(event)"',
            'nb-event:mouseover="element.styles.set(\'color\', \'red\')"',
            'nb-event:click="this.router.go(\'home\'), event.preventDefault()"',
            'nb-event:click="#this.handleOnce()"  <!-- one-time, auto-unsubscribes -->'
        ],
        notes: 'With `#` prefix, the event auto-unsubscribes after the first trigger. Call `unSubscribe()` for manual control. If the handler returns a `Promise`, a change-detection cycle is automatically scheduled when it settles, otherwise change-detection cycle is automatically scheduled after expression execution.'
    },
    {
        attribute: 'nb-var',
        displayName: 'Local Variable',
        description: 'Defines a local variable available in expressions of the current element (after this attribute) and all descendants. Multiple sibling `nb-var` attributes are evaluated left-to-right, so a later one can reference earlier ones.',
        expressionType: 'any',
        isPrefix: true,
        suffixDescription: 'The variable name to define. Kebab-cased names are converted to camelCase (e.g., `nb-var:total-count` → `totalCount`).',
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: [],
        examples: [
            'nb-var:label="this.getLabel()"',
            'nb-var:total="this.items.length"',
            'nb-var:first-item="#this.items[0]"'
        ],
        notes: 'Reserved names (`item`, `index`, `count`, `event`, `data`, `router`, `unSubscribe`, `nativeElement`, `element`) and registered `@Transformer` names (case-insensitive) cannot be used — those would shadow injected parameters or transformers.'
    },
    {
        attribute: 'nb-exec',
        displayName: 'Execute Expression',
        description: 'Executes an expression on every change-detection cycle without producing any DOM output. Useful for side effects. Use the `#` single-bind prefix to run it once.',
        expressionType: 'void',
        isPrefix: false,
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: [],
        examples: [
            'nb-exec="this.counter++"',
            'nb-exec="this.trackRender()"',
            'nb-exec="#this.initOnce()"'
        ]
    },
    {
        attribute: 'nb-bound',
        displayName: 'Bound (On Bind)',
        description: 'Executes once when the element is first bound to the context. Provides access to the element facade and the underlying DOM node — useful for capturing element references or running imperative setup.',
        expressionType: 'void',
        isPrefix: false,
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: BOUND_INJECTED_PARAMS,
        examples: [
            'nb-bound="this.rootEl = nativeElement"',
            'nb-bound="this.myElement = element"',
            'nb-bound="element.classes.add(\'initialized\')"'
        ],
        notes: 'The expression is always treated as single-bind, no need to specify — a leading `#`.'
    },
    {
        attribute: 'nb-container',
        displayName: 'Container',
        description: 'Renders a registered `@Container` (context-bound template region) inside this element. Use `@Name` for a direct reference, `%slotName` to bind to a route slot, or a plain expression for a dynamic name. Container-name lookup is case-insensitive. Pass inputs with `nb-in:prop` / `nb-in-ref:prop`.',
        expressionType: 'string (container name or route slot)',
        isPrefix: false,
        prefixes: [CONSTANT_PREFIX, ROUTE_PREFIX],
        injectedParams: [],
        examples: [
            'nb-container="@MyContainer"',
            'nb-container="%tab"  <!-- bound to the "tab" route slot -->',
            'nb-container="this.currentContainerName"  <!-- dynamic -->',
            '<div nb-container="@UserCard" nb-in:user="this.activeUser"></div>'
        ],
        notes: 'Route-bound containers (`%slot`) update automatically when `Router.state[slot]` changes. An empty/unknown name hides the container.'
    },
    {
        attribute: 'nb-component',
        displayName: 'Component (marker)',
        description: 'Marker for elements bound to an `@Component`. A custom-element tag that matches a registered component is wired up automatically — you do not have to add `nb-component` yourself. After the first bind, the framework also adds the matching `nb-component-ready` marker for the processing-hide stylesheet.',
        expressionType: 'none (marker attribute, no value)',
        isPrefix: false,
        prefixes: [],
        injectedParams: [],
        examples: [
            '<user-card nb-in:user="this.activeUser" nb-event:select="this.onSelect(data)"></user-card>',
            '<date-picker nb-in:value="this.date" nb-event:change="this.date = data"></date-picker>'
        ],
        notes: 'Components are auto-detected by custom-element tag name (case-insensitive). You don\'t write `nb-component="@Name"` — register the class with `@Component(...)` and use its custom-element tag in your template. Inputs go through `nb-in:` / `nb-in-ref:`, outputs go through `nb-event:`.'
    },
    {
        attribute: 'nb-template',
        displayName: 'Template Injection',
        description: 'Injects a globally registered template (declared via the `$Template(name, …)` helper) into this element. The value must be a `@templateName` reference.',
        expressionType: 'string (@templateName)',
        isPrefix: false,
        prefixes: [CONSTANT_PREFIX],
        injectedParams: [],
        examples: [
            'nb-template="@info-icon"',
            'nb-template="@warning-icon"',
            'nb-template="@left-right-tile"'
        ],
        notes: 'The value must start with `@`. Templates are loaded asynchronously when not yet ready; the element is repopulated once the template resolves.'
    },
    {
        attribute: 'nb-aspect',
        displayName: 'Aspect Binding',
        description: 'Attaches a registered `@Aspect` (a reusable element-level extender/mixin) to this element. The aspect name follows the colon. The optional value is passed to the aspect\'s `data` setter when changed. Multiple `nb-aspect:` attributes on the same element are allowed.',
        expressionType: 'any (passed to the aspect\'s data setter)',
        isPrefix: true,
        suffixDescription: 'The registered aspect name (e.g., `tooltip`, `draggable`).',
        prefixes: [SINGLE_BIND_PREFIX, CONSTANT_PREFIX],
        injectedParams: [],
        examples: [
            'nb-aspect:tooltip  <!-- attach with no data -->',
            'nb-aspect:tooltip="@Help text"',
            'nb-aspect:tooltip="{text: \'Help\', placement: \'top\'}"',
            'nb-aspect:tooltip="this.tooltipConfig"'
        ],
        notes: 'The expression value is optional — `nb-aspect:tooltip` on its own attaches the aspect without binding any data. Aspect adopted-stylesheets are reference-counted globally and reused across instances.'
    },
    {
        attribute: 'nb-in',
        displayName: 'Input Binding',
        description: 'Passes an input value to a child container or component. The property name follows the colon and is converted from kebab-case to camelCase (e.g., `nb-in:user-id` → `userId`). Values are deep-cloned with `structuredClone` before being assigned.',
        expressionType: 'any',
        isPrefix: true,
        suffixDescription: 'The target property name on the child container/component. Kebab-cased names are converted to camelCase.',
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: [],
        examples: [
            'nb-in:data="this.parentData"',
            'nb-in:title="this.pageTitle"',
            'nb-in:user="this.activeUser"'
        ],
        notes: 'The child does not sees the same object reference as the parent — mutations are isolated on both sides.'
    },
    {
        attribute: 'nb-in-ref',
        displayName: 'Input Binding (By Reference)',
        description: 'Passes an input value by reference (no `structuredClone`) to a child container or component. Use this when the value sharing live references is intentional.',
        expressionType: 'any',
        isPrefix: true,
        suffixDescription: 'The target property name on the child container/component. Kebab-cased names are converted to camelCase.',
        prefixes: [SINGLE_BIND_PREFIX],
        injectedParams: [],
        examples: [
            'nb-in-ref:items="this.sharedList"',
            'nb-in-ref:host-element="this.rootEl"'
        ],
        notes: 'The child sees the same object reference as the parent — mutations are observable on both sides.'
    },
    {
        attribute: 'nb-projection',
        displayName: 'Content Projection',
        description: 'Marks this element\'s content for projection into a slot defined inside the parent container/component/template template. The attribute value is the slot name (compared verbatim against `nb-project-to` / `nb-project-instead` targets); leaving it empty marks the default projection slot.',
        expressionType: 'string (slot name) or none for default',
        isPrefix: false,
        prefixes: [],
        injectedParams: [],
        examples: [
            'nb-projection  <!-- default (unnamed) slot -->',
            'nb-projection="@header"',
            'nb-projection="@content:left"  <!-- named slot with qualifier -->'
        ],
        notes: 'Only one default (empty-value) projection per parent is allowed. Slot names are taken literally — `@header` here matches `@header` on the target, not the bare string `header`.'
    },
    {
        attribute: 'nb-project-to',
        displayName: 'Projection Slot (Append)',
        description: 'Marks this element as the target slot for a named projection. When the parent renders, the projected content replaces this element\'s children.',
        expressionType: 'string (slot name) or none for default',
        isPrefix: false,
        prefixes: [],
        injectedParams: [],
        examples: [
            'nb-project-to  <!-- default slot -->',
            'nb-project-to="@header"',
            'nb-project-to="@content:left"'
        ],
        notes: 'Slot names match the corresponding `nb-projection` value verbatim (including any `@` / `:` qualifiers).'
    },
    {
        attribute: 'nb-project-instead',
        displayName: 'Projection Slot (Replace)',
        description: 'Marks this element as a named projection target. When the parent renders, the entire element is replaced with the projected content (not just its children).',
        expressionType: 'string (slot name)',
        isPrefix: false,
        prefixes: [],
        injectedParams: [],
        examples: [
            'nb-project-instead="@description"',
            'nb-project-instead="@content:right"'
        ],
        notes: 'Unlike `nb-project-to`, this uses `Element.replaceWith(...)` — the host element itself is removed once the slot is filled.'
    }
];

/** Map for O(1) lookup by attribute name */
const registryMap = new Map<string, HandlerInfo>();
for (const handler of HANDLER_REGISTRY) {
    registryMap.set(handler.attribute, handler);
}

/** All known nb-* base attribute names */
export const ALL_NB_ATTRIBUTES = HANDLER_REGISTRY.map(h => h.attribute);

/** All prefix-based attributes (that accept :suffix) */
export const PREFIX_ATTRIBUTES = HANDLER_REGISTRY.filter(h => h.isPrefix).map(h => h.attribute);

/**
 * Look up handler info by full attribute name.
 * Handles prefix attributes: "nb-event:click" → looks up "nb-event".
 */
export function getHandlerInfo(attributeName: string): HandlerInfo | undefined {
    // Direct lookup
    const direct = registryMap.get(attributeName);
    if (direct) return direct;

    // Prefix lookup: nb-event:click → nb-event
    const colonIdx = attributeName.indexOf(':');
    if (colonIdx > 0) {
        const base = attributeName.substring(0, colonIdx);
        return registryMap.get(base);
    }

    // W3C mode: data-nb-value → nb-value
    if (attributeName.startsWith('data-')) {
        const withoutData = attributeName.substring(5);
        return getHandlerInfo(withoutData);
    }

    return undefined;
}

/**
 * Check if an attribute name is a known handler.
 */
export function isNAttribute(attributeName: string): boolean {
    return getHandlerInfo(attributeName) !== undefined;
}


/**
 * Build a Markdown documentation string for hover display.
 */
export function buildHandlerDocumentation(handler: HandlerInfo, fullAttribute?: string): string {
    const lines: string[] = [];

    lines.push(`### ${handler.displayName}`);
    lines.push(`\`${fullAttribute || handler.attribute}\``);
    lines.push('');
    lines.push(handler.description);

    if (handler.formats && handler.formats.length > 0) {
        lines.push('');
        lines.push('**Formats:**');
        for (const fmt of handler.formats) {
            lines.push(`- ${fmt}`);
        }
    }

    lines.push('');
    lines.push(`**Expression type:** \`${handler.expressionType}\``);

    if (handler.isPrefix && handler.suffixDescription) {
        lines.push('');
        lines.push(`**Suffix:** ${handler.suffixDescription}`);
    }

    if (handler.prefixes.length > 0) {
        lines.push('');
        lines.push('**Expression prefixes:**');
        for (const p of handler.prefixes) {
            lines.push(`- \`${p.char}\` (${p.name}) — ${p.description}`);
        }
    }

    if (handler.injectedParams.length > 0) {
        lines.push('');
        lines.push('**Injected context variables:**');
        lines.push('| Variable | Type | Description |');
        lines.push('|----------|------|-------------|');
        for (const param of handler.injectedParams) {
            lines.push(`| \`${param.name}\` | \`${param.type}\` | ${param.description} |`);
        }
    }

    if (handler.namedPrefixInfo) {
        lines.push('');
        lines.push(`**Named prefix:** ${handler.namedPrefixInfo}`);
    }

    if (handler.notes) {
        lines.push('');
        lines.push(`> **Note:** ${handler.notes}`);
    }

    if (handler.examples.length > 0) {
        lines.push('');
        lines.push('**Examples:**');
        lines.push('```html');
        for (const ex of handler.examples) {
            lines.push(ex);
        }
        lines.push('```');
    }

    return lines.join('\n');
}

/** Common DOM event names with descriptions for nb-event: completion */
export const COMMON_DOM_EVENTS: { name: string; desc: string }[] = [
    // Mouse events
    { name: 'click', desc: 'Fired when the element is clicked' },
    { name: 'dblclick', desc: 'Fired when the element is double-clicked' },
    { name: 'mousedown', desc: 'Fired when a mouse button is pressed on the element' },
    { name: 'mouseup', desc: 'Fired when a mouse button is released over the element' },
    { name: 'mouseover', desc: 'Fired when the pointer enters the element or its children' },
    { name: 'mouseout', desc: 'Fired when the pointer leaves the element or its children' },
    { name: 'mousemove', desc: 'Fired when the pointer moves within the element' },
    { name: 'mouseenter', desc: 'Fired when the pointer enters the element (does not bubble)' },
    { name: 'mouseleave', desc: 'Fired when the pointer leaves the element (does not bubble)' },
    // Keyboard events
    { name: 'keydown', desc: 'Fired when a key is pressed down' },
    { name: 'keyup', desc: 'Fired when a key is released' },
    { name: 'keypress', desc: 'Fired when a key that produces a character is pressed (deprecated)' },
    // Focus events
    { name: 'focus', desc: 'Fired when the element receives focus (does not bubble)' },
    { name: 'blur', desc: 'Fired when the element loses focus (does not bubble)' },
    { name: 'focusin', desc: 'Fired when the element receives focus (bubbles)' },
    { name: 'focusout', desc: 'Fired when the element loses focus (bubbles)' },
    // Form events
    { name: 'input', desc: 'Fired when the value of an input, select, or textarea changes' },
    { name: 'change', desc: 'Fired when the value is committed (e.g. on blur for text inputs)' },
    { name: 'submit', desc: 'Fired when a form is submitted' },
    { name: 'reset', desc: 'Fired when a form is reset' },
    // Scroll / Resize
    { name: 'scroll', desc: 'Fired when the element is scrolled' },
    { name: 'resize', desc: 'Fired when the element is resized (window)' },
    // Touch events
    { name: 'touchstart', desc: 'Fired when a touch point is placed on the touch surface' },
    { name: 'touchend', desc: 'Fired when a touch point is removed from the touch surface' },
    { name: 'touchmove', desc: 'Fired when a touch point moves along the touch surface' },
    { name: 'touchcancel', desc: 'Fired when one or more touch points are disrupted in an implementation-specific manner' },
    // Drag events
    { name: 'drag', desc: 'Fired continuously while the element is being dragged' },
    { name: 'dragstart', desc: 'Fired when the user starts dragging the element' },
    { name: 'dragend', desc: 'Fired when a drag operation ends (release or Escape)' },
    { name: 'dragover', desc: 'Fired continuously while a dragged element is over a valid drop target' },
    { name: 'dragenter', desc: 'Fired when a dragged element enters a valid drop target' },
    { name: 'dragleave', desc: 'Fired when a dragged element leaves a valid drop target' },
    { name: 'drop', desc: 'Fired when a dragged element is dropped on a valid drop target' },
    // Other
    { name: 'contextmenu', desc: 'Fired when the right mouse button is clicked (context menu)' },
    { name: 'wheel', desc: 'Fired when the mouse wheel is rotated over the element' },
    // Animation / Transition
    { name: 'animationstart', desc: 'Fired when a CSS animation starts' },
    { name: 'animationend', desc: 'Fired when a CSS animation completes' },
    { name: 'animationiteration', desc: 'Fired when a CSS animation completes one cycle' },
    { name: 'transitionend', desc: 'Fired when a CSS transition completes' },
    { name: 'transitionstart', desc: 'Fired when a CSS transition starts' },
    // Toggle events
    { name: 'toggle', desc: 'Fired when a details element or popover is opened or closed' },
    { name: 'beforetoggle', desc: 'Fired before a details element or popover open/close state changes' },
    // Clipboard events
    { name: 'copy', desc: 'Fired when the user initiates a copy action' },
    { name: 'cut', desc: 'Fired when the user initiates a cut action' },
    { name: 'paste', desc: 'Fired when the user initiates a paste action' },
    // Composition events
    { name: 'compositionstart', desc: 'Fired when an IME composition session begins' },
    { name: 'compositionupdate', desc: 'Fired when a new character is received during IME composition' },
    { name: 'compositionend', desc: 'Fired when an IME composition session ends' },
    // Additional form events
    { name: 'beforeinput', desc: 'Fired before the value of an input element is modified' },
    { name: 'formdata', desc: 'Fired when FormData is constructed from a form' },
    // Pointer capture events
    { name: 'gotpointercapture', desc: 'Fired when an element captures a pointer via setPointerCapture()' },
    { name: 'lostpointercapture', desc: 'Fired when a captured pointer is released' },
];
