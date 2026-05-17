/**
 * model-injections-registry.ts
 * Registry of model injections available on `this` in templates.
 * These are framework-provided properties (ChangeDetector, ElementManipulations,
 * ElementSubscriptions, EventDispatcher) injected into every Container/Component.
 */

export interface InjectionMember {
    name: string;
    type: string;
    desc: string;
    kind: 'method' | 'property';
    subMembers?: InjectionMember[];
}

export interface ModelInjection {
    name: string;
    type: string;
    desc: string;
    members: InjectionMember[];
}

const MODEL_INJECTIONS: ModelInjection[] = [
    {
        name: 'changeDetector',
        type: 'ChangeDetector',
        desc: 'Request change detection to update bindings after asynchronous operations',
        members: [
            { name: 'detect', type: '() => void', desc: 'Trigger change detection to re-evaluate all bindings', kind: 'method' },
        ],
    },
    {
        name: 'elementManipulations',
        type: 'ElementManipulations',
        desc: 'Facade for manipulating the host element (properties, attributes, styles, classes)',
        members: [
            {
                name: 'properties', type: 'ElementPropertiesManipulations',
                desc: 'Manipulate element DOM properties (get/set)', kind: 'property',
                subMembers: [
                    { name: 'get', type: '(propertyKey: string) => any', desc: 'Get element property value', kind: 'method' },
                    { name: 'set', type: '(propertyKey: string, propertyValue: any) => void', desc: 'Set element property value', kind: 'method' },
                ],
            },
            {
                name: 'attributes', type: 'ElementAttributesManipulations',
                desc: 'Manipulate element attributes (has/get/getAll/set/remove)', kind: 'property',
                subMembers: [
                    { name: 'has', type: '(attributeName: string) => boolean', desc: 'Check if element has attribute', kind: 'method' },
                    { name: 'get', type: '(attributeName: string) => string | undefined', desc: 'Get element attribute value', kind: 'method' },
                    { name: 'getAll', type: '() => Map<string, string | undefined>', desc: 'Get all element attributes', kind: 'method' },
                    { name: 'set', type: '(attributeName: string, attributeValue?: string | null) => void', desc: 'Set element attribute value', kind: 'method' },
                    { name: 'remove', type: '(attributeName: string) => void', desc: 'Remove element attribute', kind: 'method' },
                ],
            },
            {
                name: 'styles', type: 'ElementStylesManipulations',
                desc: 'Manipulate element styles (has/get/getAll/set/remove)', kind: 'property',
                subMembers: [
                    { name: 'has', type: '(propertyName: string) => boolean', desc: 'Check if element has style', kind: 'method' },
                    { name: 'get', type: '(propertyName: string) => string | undefined', desc: 'Get element style value', kind: 'method' },
                    { name: 'getAll', type: '() => Map<string, string>', desc: 'Get all element styles', kind: 'method' },
                    { name: 'set', type: '(propertyName: string, propertyValue?: string | null) => void', desc: 'Set element style value', kind: 'method' },
                    { name: 'remove', type: '(propertyName: string) => void', desc: 'Remove element style', kind: 'method' },
                ],
            },
            {
                name: 'classes', type: 'ElementClassesManipulations',
                desc: 'Manipulate element classes (has/getAll/add/remove/toggle)', kind: 'property',
                subMembers: [
                    { name: 'has', type: '(className: string) => boolean', desc: 'Check if element has class', kind: 'method' },
                    { name: 'getAll', type: '() => Array<string>', desc: 'Get all element classes', kind: 'method' },
                    { name: 'add', type: '(className: string) => void', desc: 'Add element class', kind: 'method' },
                    { name: 'remove', type: '(className: string) => void', desc: 'Remove element class', kind: 'method' },
                    { name: 'toggle', type: '(className: string) => void', desc: 'Toggle element class', kind: 'method' },
                ],
            },
        ],
    },
    {
        name: 'elementSubscriptions',
        type: 'ElementSubscriptions',
        desc: 'Subscribe to DOM events on the host element',
        members: [
            { name: 'isSubscribed', type: '(eventName: string) => boolean', desc: 'Check if currently subscribed to an event', kind: 'method' },
            { name: 'isUnSubscribed', type: '(eventName: string) => boolean', desc: 'Check if unsubscribed from an event after a prior subscription', kind: 'method' },
            { name: 'subscribe', type: '(eventName: string, callback: (evt: Event) => any, options?: boolean | AddEventListenerOptions, debounce?: number) => () => void', desc: 'Subscribe to a DOM event. Returns an unsubscribe function', kind: 'method' },
        ],
    },
    {
        name: 'eventDispatcher',
        type: 'EventDispatcher',
        desc: 'Dispatch custom events from the host element',
        members: [
            { name: 'dispatch', type: '(nameOrEvent: string | Event, data?: any) => boolean', desc: 'Dispatch a custom event or named event with optional detail data', kind: 'method' },
        ],
    },
];

/** Get all model injections. */
export function getAllModelInjections(): ModelInjection[] {
    return MODEL_INJECTIONS;
}

/** Find a model injection by property name (e.g. 'changeDetector'). */
export function getModelInjection(name: string): ModelInjection | undefined {
    return MODEL_INJECTIONS.find(i => i.name === name);
}

/** Find a member of a model injection, or a sub-member via dotted path. */
export function getModelInjectionMember(injectionName: string, memberPath: string[]): InjectionMember | undefined {
    const injection = getModelInjection(injectionName);
    if (!injection) return undefined;

    let members = injection.members;
    let target: InjectionMember | undefined;

    for (const part of memberPath) {
        target = members.find(m => m.name === part);
        if (!target) return undefined;
        members = target.subMembers ?? [];
    }

    return target;
}
