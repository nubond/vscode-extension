/**
 * element-manipulations.ts
 * Member metadata for the framework's `ElementManipulations` facade
 * (the `element` injected param on nb-event/nb-bound).
 *
 *   element.properties / element.attributes / element.styles / element.classes
 *
 * Used by hover (single-member lookup) and completions (full enumeration).
 */

import type { MemberInfo } from '../types';

const ELEMENT_TOP_MEMBERS: Record<string, MemberInfo> = {
    properties: { type: 'ElementPropertiesManipulations', desc: 'Manipulate element DOM properties — `.get(key)` / `.set(key, value)`',                         kind: 'property' },
    attributes: { type: 'ElementAttributesManipulations', desc: 'Manipulate element HTML attributes — `.has()`, `.get()`, `.getAll()`, `.set()`, `.remove()`',  kind: 'property' },
    styles:     { type: 'ElementStylesManipulations',     desc: 'Manipulate element inline styles — `.has()`, `.get()`, `.getAll()`, `.set()`, `.remove()`',    kind: 'property' },
    classes:    { type: 'ElementClassesManipulations',     desc: 'Manipulate element CSS classes — `.has()`, `.getAll()`, `.add()`, `.remove()`, `.toggle()`',   kind: 'property' },
};

const ELEMENT_SUB_MEMBERS: Record<string, Record<string, MemberInfo>> = {
    properties: {
        get: { type: '(propertyKey: string) => any',                         desc: 'Get the current value of a DOM property',                 kind: 'method' },
        set: { type: '(propertyKey: string, propertyValue: any) => void',    desc: 'Set a DOM property to the specified value',                kind: 'method' },
    },
    attributes: {
        has:    { type: '(attributeName: string) => boolean',                      desc: 'Check whether the element has the specified HTML attribute',         kind: 'method' },
        get:    { type: '(attributeName: string) => string | undefined',           desc: 'Get the value of an HTML attribute, or `undefined` if absent',       kind: 'method' },
        getAll: { type: '() => Map<string, string | undefined>',                   desc: 'Get a `Map` of all HTML attributes on the element',                  kind: 'method' },
        set:    { type: '(attributeName: string, attributeValue?: string | null) => void', desc: 'Set an HTML attribute; pass `null` to create a valueless attribute', kind: 'method' },
        remove: { type: '(attributeName: string) => void',                         desc: 'Remove an HTML attribute from the element',                          kind: 'method' },
    },
    styles: {
        has:    { type: '(propertyName: string) => boolean',                       desc: 'Check whether the element has the specified inline style',           kind: 'method' },
        get:    { type: '(propertyName: string) => string | undefined',            desc: 'Get the value of an inline style property',                          kind: 'method' },
        getAll: { type: '() => Map<string, string>',                               desc: 'Get a `Map` of all inline styles on the element',                    kind: 'method' },
        set:    { type: '(propertyName: string, propertyValue?: string | null) => void', desc: 'Set an inline style property value',                           kind: 'method' },
        remove: { type: '(propertyName: string) => void',                          desc: 'Remove an inline style property from the element',                   kind: 'method' },
    },
    classes: {
        has:    { type: '(className: string) => boolean',  desc: 'Check whether the element has the specified CSS class',     kind: 'method' },
        getAll: { type: '() => Array<string>',             desc: 'Get an array of all CSS class names on the element',        kind: 'method' },
        add:    { type: '(className: string) => void',     desc: 'Add a CSS class to the element',                            kind: 'method' },
        remove: { type: '(className: string) => void',     desc: 'Remove a CSS class from the element',                       kind: 'method' },
        toggle: { type: '(className: string) => void',     desc: 'Toggle a CSS class — add if absent, remove if present',     kind: 'method' },
    },
};

/**
 * Enumerate ElementManipulations members.
 * - `sub === undefined` → top-level (`properties`, `attributes`, `styles`, `classes`)
 * - `sub === 'styles'` → the sub-API (`get`, `set`, `has`, `getAll`, `remove`)
 */
export function getAllElementManipulationMembers(sub?: string): Array<{ name: string } & MemberInfo> {
    const map = sub ? (ELEMENT_SUB_MEMBERS[sub] ?? {}) : ELEMENT_TOP_MEMBERS;
    return Object.keys(map).map(name => ({ name, ...map[name] }));
}

/**
 * Look up an ElementManipulations member.
 * - `getElementManipulationMemberInfo(undefined, 'properties')` → top-level member
 * - `getElementManipulationMemberInfo('styles', 'get')` → sub-member
 */
export function getElementManipulationMemberInfo(sub: string | undefined, memberName: string): MemberInfo | undefined {
    if (sub) {
        return ELEMENT_SUB_MEMBERS[sub]?.[memberName];
    }
    return ELEMENT_TOP_MEMBERS[memberName];
}
