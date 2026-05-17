/**
 * globals-registry.ts
 * Registry of common JavaScript/DOM global objects and their members
 * for autocomplete inside nb-* expression values.
 */

export interface GlobalMember {
    name: string;
    type: string;
    desc: string;
    kind: 'property' | 'method';
}

export interface GlobalObject {
    name: string;
    type: string;
    desc: string;
    members: GlobalMember[];
}

const CONSOLE_MEMBERS: GlobalMember[] = [
    { name: 'log', type: '(...data: any[]) => void', desc: 'Log a message to the console', kind: 'method' },
    { name: 'warn', type: '(...data: any[]) => void', desc: 'Log a warning message', kind: 'method' },
    { name: 'error', type: '(...data: any[]) => void', desc: 'Log an error message', kind: 'method' },
    { name: 'info', type: '(...data: any[]) => void', desc: 'Log an informational message', kind: 'method' },
    { name: 'debug', type: '(...data: any[]) => void', desc: 'Log a debug message', kind: 'method' },
    { name: 'dir', type: '(item?: any, options?: any) => void', desc: 'Display an interactive list of object properties', kind: 'method' },
    { name: 'table', type: '(tabularData?: any, properties?: string[]) => void', desc: 'Display tabular data as a table', kind: 'method' },
    { name: 'clear', type: '() => void', desc: 'Clear the console', kind: 'method' },
    { name: 'group', type: '(...label: any[]) => void', desc: 'Create a new inline group in the console', kind: 'method' },
    { name: 'groupEnd', type: '() => void', desc: 'Exit the current inline group', kind: 'method' },
    { name: 'groupCollapsed', type: '(...label: any[]) => void', desc: 'Create a new collapsed group', kind: 'method' },
    { name: 'time', type: '(label?: string) => void', desc: 'Start a timer', kind: 'method' },
    { name: 'timeEnd', type: '(label?: string) => void', desc: 'Stop a timer and log elapsed time', kind: 'method' },
    { name: 'timeLog', type: '(label?: string, ...data: any[]) => void', desc: 'Log current timer value', kind: 'method' },
    { name: 'count', type: '(label?: string) => void', desc: 'Log the number of times count() has been called', kind: 'method' },
    { name: 'countReset', type: '(label?: string) => void', desc: 'Reset a counter', kind: 'method' },
    { name: 'assert', type: '(condition?: boolean, ...data: any[]) => void', desc: 'Log an error if the assertion is false', kind: 'method' },
    { name: 'trace', type: '(...data: any[]) => void', desc: 'Output a stack trace', kind: 'method' },
];

const MATH_MEMBERS: GlobalMember[] = [
    // Constants
    { name: 'PI', type: 'number', desc: 'Ratio of a circle\'s circumference to its diameter (~3.14159)', kind: 'property' },
    { name: 'E', type: 'number', desc: 'Euler\'s number (~2.718)', kind: 'property' },
    { name: 'LN2', type: 'number', desc: 'Natural logarithm of 2 (~0.693)', kind: 'property' },
    { name: 'LN10', type: 'number', desc: 'Natural logarithm of 10 (~2.303)', kind: 'property' },
    { name: 'LOG2E', type: 'number', desc: 'Base-2 logarithm of E (~1.443)', kind: 'property' },
    { name: 'LOG10E', type: 'number', desc: 'Base-10 logarithm of E (~0.434)', kind: 'property' },
    { name: 'SQRT2', type: 'number', desc: 'Square root of 2 (~1.414)', kind: 'property' },
    { name: 'SQRT1_2', type: 'number', desc: 'Square root of 1/2 (~0.707)', kind: 'property' },
    // Methods
    { name: 'abs', type: '(x: number) => number', desc: 'Return the absolute value', kind: 'method' },
    { name: 'ceil', type: '(x: number) => number', desc: 'Round up to the nearest integer', kind: 'method' },
    { name: 'floor', type: '(x: number) => number', desc: 'Round down to the nearest integer', kind: 'method' },
    { name: 'round', type: '(x: number) => number', desc: 'Round to the nearest integer', kind: 'method' },
    { name: 'trunc', type: '(x: number) => number', desc: 'Remove the fractional part', kind: 'method' },
    { name: 'max', type: '(...values: number[]) => number', desc: 'Return the largest value', kind: 'method' },
    { name: 'min', type: '(...values: number[]) => number', desc: 'Return the smallest value', kind: 'method' },
    { name: 'pow', type: '(base: number, exponent: number) => number', desc: 'Return base raised to exponent', kind: 'method' },
    { name: 'sqrt', type: '(x: number) => number', desc: 'Return the square root', kind: 'method' },
    { name: 'cbrt', type: '(x: number) => number', desc: 'Return the cube root', kind: 'method' },
    { name: 'random', type: '() => number', desc: 'Return a pseudo-random number between 0 and 1', kind: 'method' },
    { name: 'sign', type: '(x: number) => number', desc: 'Return the sign (-1, 0, or 1)', kind: 'method' },
    { name: 'log', type: '(x: number) => number', desc: 'Return the natural logarithm', kind: 'method' },
    { name: 'log2', type: '(x: number) => number', desc: 'Return the base-2 logarithm', kind: 'method' },
    { name: 'log10', type: '(x: number) => number', desc: 'Return the base-10 logarithm', kind: 'method' },
    { name: 'sin', type: '(x: number) => number', desc: 'Return the sine (radians)', kind: 'method' },
    { name: 'cos', type: '(x: number) => number', desc: 'Return the cosine (radians)', kind: 'method' },
    { name: 'tan', type: '(x: number) => number', desc: 'Return the tangent (radians)', kind: 'method' },
    { name: 'asin', type: '(x: number) => number', desc: 'Return the arcsine (radians)', kind: 'method' },
    { name: 'acos', type: '(x: number) => number', desc: 'Return the arccosine (radians)', kind: 'method' },
    { name: 'atan', type: '(x: number) => number', desc: 'Return the arctangent (radians)', kind: 'method' },
    { name: 'atan2', type: '(y: number, x: number) => number', desc: 'Return the angle from the X axis to a point', kind: 'method' },
    { name: 'hypot', type: '(...values: number[]) => number', desc: 'Return the square root of the sum of squares', kind: 'method' },
    { name: 'clz32', type: '(x: number) => number', desc: 'Return the number of leading zeros in 32-bit integer', kind: 'method' },
    { name: 'fround', type: '(x: number) => number', desc: 'Return nearest 32-bit float representation', kind: 'method' },
    { name: 'imul', type: '(a: number, b: number) => number', desc: 'Return 32-bit integer multiplication', kind: 'method' },
];

const JSON_MEMBERS: GlobalMember[] = [
    { name: 'parse', type: '(text: string, reviver?: (key: string, value: any) => any) => any', desc: 'Parse a JSON string into a value', kind: 'method' },
    { name: 'stringify', type: '(value: any, replacer?: any, space?: string | number) => string', desc: 'Convert a value to a JSON string', kind: 'method' },
];

const OBJECT_MEMBERS: GlobalMember[] = [
    { name: 'keys', type: '(o: object) => string[]', desc: 'Return an array of own enumerable property names', kind: 'method' },
    { name: 'values', type: '(o: object) => any[]', desc: 'Return an array of own enumerable property values', kind: 'method' },
    { name: 'entries', type: '(o: object) => [string, any][]', desc: 'Return an array of own enumerable [key, value] pairs', kind: 'method' },
    { name: 'assign', type: '(target: object, ...sources: object[]) => object', desc: 'Copy properties from source objects to target', kind: 'method' },
    { name: 'freeze', type: '<T>(o: T) => Readonly<T>', desc: 'Freeze an object (prevent modifications)', kind: 'method' },
    { name: 'isFrozen', type: '(o: any) => boolean', desc: 'Check if an object is frozen', kind: 'method' },
    { name: 'create', type: '(proto: object | null, properties?: PropertyDescriptorMap) => any', desc: 'Create a new object with specified prototype', kind: 'method' },
    { name: 'defineProperty', type: '(o: any, p: PropertyKey, attributes: PropertyDescriptor) => any', desc: 'Define a property on an object', kind: 'method' },
    { name: 'getOwnPropertyNames', type: '(o: any) => string[]', desc: 'Return all own property names (including non-enumerable)', kind: 'method' },
    { name: 'getPrototypeOf', type: '(o: any) => any', desc: 'Return the prototype of an object', kind: 'method' },
    { name: 'hasOwn', type: '(o: object, prop: PropertyKey) => boolean', desc: 'Check if object has own property', kind: 'method' },
    { name: 'is', type: '(value1: any, value2: any) => boolean', desc: 'Check if two values are the same (like ===, but handles NaN)', kind: 'method' },
    { name: 'fromEntries', type: '(entries: Iterable<[PropertyKey, any]>) => object', desc: 'Create object from key-value pairs', kind: 'method' },
];

const ARRAY_MEMBERS: GlobalMember[] = [
    { name: 'isArray', type: '(arg: any) => boolean', desc: 'Check if a value is an Array', kind: 'method' },
    { name: 'from', type: '(arrayLike: ArrayLike<any>, mapfn?: Function) => any[]', desc: 'Create an array from an iterable or array-like object', kind: 'method' },
    { name: 'of', type: '(...items: any[]) => any[]', desc: 'Create an array from arguments', kind: 'method' },
];

const NUMBER_MEMBERS: GlobalMember[] = [
    { name: 'isFinite', type: '(value: any) => boolean', desc: 'Check if a value is a finite number', kind: 'method' },
    { name: 'isInteger', type: '(value: any) => boolean', desc: 'Check if a value is an integer', kind: 'method' },
    { name: 'isNaN', type: '(value: any) => boolean', desc: 'Check if a value is NaN', kind: 'method' },
    { name: 'isSafeInteger', type: '(value: any) => boolean', desc: 'Check if a value is a safe integer', kind: 'method' },
    { name: 'parseFloat', type: '(string: string) => number', desc: 'Parse a string to a floating-point number', kind: 'method' },
    { name: 'parseInt', type: '(string: string, radix?: number) => number', desc: 'Parse a string to an integer', kind: 'method' },
    { name: 'MAX_SAFE_INTEGER', type: 'number', desc: 'Maximum safe integer (2^53 - 1)', kind: 'property' },
    { name: 'MIN_SAFE_INTEGER', type: 'number', desc: 'Minimum safe integer (-(2^53 - 1))', kind: 'property' },
    { name: 'MAX_VALUE', type: 'number', desc: 'Largest representable number', kind: 'property' },
    { name: 'MIN_VALUE', type: 'number', desc: 'Smallest positive representable number', kind: 'property' },
    { name: 'POSITIVE_INFINITY', type: 'number', desc: 'Positive Infinity', kind: 'property' },
    { name: 'NEGATIVE_INFINITY', type: 'number', desc: 'Negative Infinity', kind: 'property' },
    { name: 'NaN', type: 'number', desc: 'Not-a-Number value', kind: 'property' },
    { name: 'EPSILON', type: 'number', desc: 'Difference between 1 and the smallest float greater than 1', kind: 'property' },
];

const STRING_MEMBERS: GlobalMember[] = [
    { name: 'fromCharCode', type: '(...codes: number[]) => string', desc: 'Create a string from UTF-16 code units', kind: 'method' },
    { name: 'fromCodePoint', type: '(...codePoints: number[]) => string', desc: 'Create a string from Unicode code points', kind: 'method' },
    { name: 'raw', type: '(template: TemplateStringsArray, ...substitutions: any[]) => string', desc: 'Get the raw string form of template literals', kind: 'method' },
];

const DATE_MEMBERS: GlobalMember[] = [
    { name: 'now', type: '() => number', desc: 'Return current timestamp in milliseconds', kind: 'method' },
    { name: 'parse', type: '(s: string) => number', desc: 'Parse a date string and return timestamp', kind: 'method' },
    { name: 'UTC', type: '(year: number, month?: number, ...args: number[]) => number', desc: 'Return timestamp from UTC date components', kind: 'method' },
];

const PROMISE_MEMBERS: GlobalMember[] = [
    { name: 'all', type: '(values: Iterable<Promise<any>>) => Promise<any[]>', desc: 'Wait for all promises to resolve', kind: 'method' },
    { name: 'allSettled', type: '(values: Iterable<Promise<any>>) => Promise<PromiseSettledResult<any>[]>', desc: 'Wait for all promises to settle', kind: 'method' },
    { name: 'any', type: '(values: Iterable<Promise<any>>) => Promise<any>', desc: 'Return the first fulfilled promise', kind: 'method' },
    { name: 'race', type: '(values: Iterable<Promise<any>>) => Promise<any>', desc: 'Return the first settled promise', kind: 'method' },
    { name: 'resolve', type: '(value?: any) => Promise<any>', desc: 'Return a resolved promise', kind: 'method' },
    { name: 'reject', type: '(reason?: any) => Promise<any>', desc: 'Return a rejected promise', kind: 'method' },
];

const DOCUMENT_MEMBERS: GlobalMember[] = [
    { name: 'getElementById', type: '(id: string) => HTMLElement | null', desc: 'Find element by ID', kind: 'method' },
    { name: 'getElementsByClassName', type: '(classNames: string) => HTMLCollectionOf<Element>', desc: 'Find elements by class name', kind: 'method' },
    { name: 'getElementsByTagName', type: '(tagName: string) => HTMLCollectionOf<Element>', desc: 'Find elements by tag name', kind: 'method' },
    { name: 'querySelector', type: '(selectors: string) => Element | null', desc: 'Find first element matching a CSS selector', kind: 'method' },
    { name: 'querySelectorAll', type: '(selectors: string) => NodeListOf<Element>', desc: 'Find all elements matching a CSS selector', kind: 'method' },
    { name: 'createElement', type: '(tagName: string) => HTMLElement', desc: 'Create a new HTML element', kind: 'method' },
    { name: 'createTextNode', type: '(data: string) => Text', desc: 'Create a new text node', kind: 'method' },
    { name: 'createDocumentFragment', type: '() => DocumentFragment', desc: 'Create a new document fragment', kind: 'method' },
    { name: 'body', type: 'HTMLElement', desc: 'The document body element', kind: 'property' },
    { name: 'head', type: 'HTMLHeadElement', desc: 'The document head element', kind: 'property' },
    { name: 'documentElement', type: 'HTMLElement', desc: 'The root element (<html>)', kind: 'property' },
    { name: 'title', type: 'string', desc: 'The document title', kind: 'property' },
    { name: 'URL', type: 'string', desc: 'The document URL', kind: 'property' },
    { name: 'domain', type: 'string', desc: 'The document domain', kind: 'property' },
    { name: 'cookie', type: 'string', desc: 'Document cookies', kind: 'property' },
    { name: 'readyState', type: 'string', desc: 'Document loading state', kind: 'property' },
    { name: 'activeElement', type: 'Element | null', desc: 'Currently focused element', kind: 'property' },
    { name: 'hidden', type: 'boolean', desc: 'Whether the document is hidden', kind: 'property' },
];

const WINDOW_MEMBERS: GlobalMember[] = [
    { name: 'innerWidth', type: 'number', desc: 'Window inner width in pixels', kind: 'property' },
    { name: 'innerHeight', type: 'number', desc: 'Window inner height in pixels', kind: 'property' },
    { name: 'outerWidth', type: 'number', desc: 'Window outer width in pixels', kind: 'property' },
    { name: 'outerHeight', type: 'number', desc: 'Window outer height in pixels', kind: 'property' },
    { name: 'scrollX', type: 'number', desc: 'Pixels scrolled horizontally', kind: 'property' },
    { name: 'scrollY', type: 'number', desc: 'Pixels scrolled vertically', kind: 'property' },
    { name: 'devicePixelRatio', type: 'number', desc: 'Ratio of physical to CSS pixels', kind: 'property' },
    { name: 'location', type: 'Location', desc: 'Current URL information', kind: 'property' },
    { name: 'navigator', type: 'Navigator', desc: 'Browser/environment information', kind: 'property' },
    { name: 'localStorage', type: 'Storage', desc: 'Local storage object', kind: 'property' },
    { name: 'sessionStorage', type: 'Storage', desc: 'Session storage object', kind: 'property' },
    { name: 'history', type: 'History', desc: 'Browser history object', kind: 'property' },
    { name: 'screen', type: 'Screen', desc: 'Screen information', kind: 'property' },
    { name: 'alert', type: '(message?: any) => void', desc: 'Show an alert dialog', kind: 'method' },
    { name: 'confirm', type: '(message?: string) => boolean', desc: 'Show a confirmation dialog', kind: 'method' },
    { name: 'prompt', type: '(message?: string, default?: string) => string | null', desc: 'Show a prompt dialog', kind: 'method' },
    { name: 'open', type: '(url?: string, target?: string, features?: string) => Window | null', desc: 'Open a new browser window', kind: 'method' },
    { name: 'close', type: '() => void', desc: 'Close the window', kind: 'method' },
    { name: 'scrollTo', type: '(x: number, y: number) => void', desc: 'Scroll to a position', kind: 'method' },
    { name: 'scrollBy', type: '(x: number, y: number) => void', desc: 'Scroll by a delta', kind: 'method' },
    { name: 'getComputedStyle', type: '(element: Element) => CSSStyleDeclaration', desc: 'Get computed styles for an element', kind: 'method' },
    { name: 'requestAnimationFrame', type: '(callback: FrameRequestCallback) => number', desc: 'Request a callback before next repaint', kind: 'method' },
    { name: 'cancelAnimationFrame', type: '(handle: number) => void', desc: 'Cancel a requested animation frame', kind: 'method' },
    { name: 'setTimeout', type: '(handler: Function, timeout?: number) => number', desc: 'Execute a function after a delay', kind: 'method' },
    { name: 'clearTimeout', type: '(id: number) => void', desc: 'Cancel a timeout', kind: 'method' },
    { name: 'setInterval', type: '(handler: Function, timeout?: number) => number', desc: 'Execute a function repeatedly at intervals', kind: 'method' },
    { name: 'clearInterval', type: '(id: number) => void', desc: 'Cancel an interval', kind: 'method' },
    { name: 'fetch', type: '(input: RequestInfo, init?: RequestInit) => Promise<Response>', desc: 'Fetch a resource from the network', kind: 'method' },
    { name: 'atob', type: '(data: string) => string', desc: 'Decode a base64-encoded string', kind: 'method' },
    { name: 'btoa', type: '(data: string) => string', desc: 'Encode a string to base64', kind: 'method' },
    { name: 'matchMedia', type: '(query: string) => MediaQueryList', desc: 'Check if a media query matches', kind: 'method' },
];

/** All registered global objects */
const GLOBAL_OBJECTS: GlobalObject[] = [
    { name: 'console', type: 'Console', desc: 'Browser debugging console', members: CONSOLE_MEMBERS },
    { name: 'Math', type: 'Math', desc: 'Mathematical constants and functions', members: MATH_MEMBERS },
    { name: 'JSON', type: 'JSON', desc: 'JSON parsing and serialization', members: JSON_MEMBERS },
    { name: 'Object', type: 'ObjectConstructor', desc: 'Object static methods', members: OBJECT_MEMBERS },
    { name: 'Array', type: 'ArrayConstructor', desc: 'Array static methods', members: ARRAY_MEMBERS },
    { name: 'Number', type: 'NumberConstructor', desc: 'Number static methods and constants', members: NUMBER_MEMBERS },
    { name: 'String', type: 'StringConstructor', desc: 'String static methods', members: STRING_MEMBERS },
    { name: 'Date', type: 'DateConstructor', desc: 'Date static methods', members: DATE_MEMBERS },
    { name: 'Promise', type: 'PromiseConstructor', desc: 'Promise static methods', members: PROMISE_MEMBERS },
    { name: 'document', type: 'Document', desc: 'The current HTML document', members: DOCUMENT_MEMBERS },
    { name: 'window', type: 'Window', desc: 'The global window object', members: WINDOW_MEMBERS },
];

/** Map for O(1) lookup by global object name */
const globalsMap = new Map<string, GlobalObject>();
for (const g of GLOBAL_OBJECTS) {
    globalsMap.set(g.name, g);
}

/**
 * Get members of a global object by name (e.g. "console", "Math").
 * Returns undefined if the name is not a recognised global.
 */
export function getGlobalObjectMembers(name: string): GlobalMember[] | undefined {
    return globalsMap.get(name)?.members;
}

/**
 * Get all global objects (for top-level suggestions).
 */
export function getAllGlobalObjects(): GlobalObject[] {
    return GLOBAL_OBJECTS;
}

/** Global standalone functions (not on an object) */
export interface GlobalFunction {
    name: string;
    type: string;
    desc: string;
}

const GLOBAL_FUNCTIONS: GlobalFunction[] = [
    { name: 'parseInt', type: '(string: string, radix?: number) => number', desc: 'Parse a string to an integer' },
    { name: 'parseFloat', type: '(string: string) => number', desc: 'Parse a string to a float' },
    { name: 'isNaN', type: '(value: any) => boolean', desc: 'Check if a value is NaN' },
    { name: 'isFinite', type: '(value: any) => boolean', desc: 'Check if a value is finite' },
    { name: 'encodeURIComponent', type: '(component: string) => string', desc: 'Encode a URI component' },
    { name: 'decodeURIComponent', type: '(component: string) => string', desc: 'Decode an encoded URI component' },
    { name: 'encodeURI', type: '(uri: string) => string', desc: 'Encode a URI' },
    { name: 'decodeURI', type: '(uri: string) => string', desc: 'Decode an encoded URI' },
    { name: 'setTimeout', type: '(handler: Function, timeout?: number) => number', desc: 'Execute a function after a delay' },
    { name: 'clearTimeout', type: '(id: number) => void', desc: 'Cancel a timeout' },
    { name: 'setInterval', type: '(handler: Function, timeout?: number) => number', desc: 'Execute a function repeatedly' },
    { name: 'clearInterval', type: '(id: number) => void', desc: 'Cancel an interval' },
    { name: 'fetch', type: '(input: RequestInfo, init?: RequestInit) => Promise<Response>', desc: 'Fetch a resource from the network' },
    { name: 'alert', type: '(message?: any) => void', desc: 'Show an alert dialog' },
    { name: 'atob', type: '(data: string) => string', desc: 'Decode a base64-encoded string' },
    { name: 'btoa', type: '(data: string) => string', desc: 'Encode a string to base64' },
    { name: 'requestAnimationFrame', type: '(callback: FrameRequestCallback) => number', desc: 'Request a callback before next repaint' },
    { name: 'cancelAnimationFrame', type: '(handle: number) => void', desc: 'Cancel a requested animation frame' },
];

/** Global constants/values */
export interface GlobalConstant {
    name: string;
    type: string;
    desc: string;
}

const GLOBAL_CONSTANTS: GlobalConstant[] = [
    { name: 'undefined', type: 'undefined', desc: 'The undefined value' },
    { name: 'null', type: 'null', desc: 'The null value' },
    { name: 'NaN', type: 'number', desc: 'Not-a-Number value' },
    { name: 'Infinity', type: 'number', desc: 'Positive Infinity' },
    { name: 'true', type: 'boolean', desc: 'Boolean true' },
    { name: 'false', type: 'boolean', desc: 'Boolean false' },
];

/**
 * Get all global standalone functions.
 */
export function getAllGlobalFunctions(): GlobalFunction[] {
    return GLOBAL_FUNCTIONS;
}

/**
 * Get all global constants.
 */
export function getAllGlobalConstants(): GlobalConstant[] {
    return GLOBAL_CONSTANTS;
}
