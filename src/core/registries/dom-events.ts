/**
 * dom-events.ts
 * Mapping of DOM event names → TS event interface, plus per-interface member
 * metadata for `event.X` hover and completion. Used by both providers so a
 * new event property only has to be added in one place.
 */

import type { MemberInfo } from '../types';

/** Map a DOM event name to its TypeScript event type. */
export function getEventType(eventName: string): string {
    const eventTypeMap: Record<string, string> = {
        'click': 'MouseEvent', 'dblclick': 'MouseEvent',
        'mousedown': 'MouseEvent', 'mouseup': 'MouseEvent',
        'mouseover': 'MouseEvent', 'mouseout': 'MouseEvent',
        'mousemove': 'MouseEvent', 'mouseenter': 'MouseEvent',
        'mouseleave': 'MouseEvent', 'contextmenu': 'MouseEvent',
        'keydown': 'KeyboardEvent', 'keyup': 'KeyboardEvent', 'keypress': 'KeyboardEvent',
        'input': 'InputEvent', 'change': 'Event',
        'focus': 'FocusEvent', 'blur': 'FocusEvent',
        'focusin': 'FocusEvent', 'focusout': 'FocusEvent',
        'submit': 'SubmitEvent', 'reset': 'Event',
        'scroll': 'Event', 'resize': 'UIEvent',
        'wheel': 'WheelEvent',
        'drag': 'DragEvent', 'dragstart': 'DragEvent', 'dragend': 'DragEvent',
        'dragover': 'DragEvent', 'dragenter': 'DragEvent', 'dragleave': 'DragEvent', 'drop': 'DragEvent',
        'touchstart': 'TouchEvent', 'touchend': 'TouchEvent',
        'touchmove': 'TouchEvent', 'touchcancel': 'TouchEvent',
        'pointerdown': 'PointerEvent', 'pointerup': 'PointerEvent',
        'pointermove': 'PointerEvent', 'pointerenter': 'PointerEvent',
        'pointerleave': 'PointerEvent', 'pointerover': 'PointerEvent',
        'pointerout': 'PointerEvent', 'pointercancel': 'PointerEvent',
        'animationstart': 'AnimationEvent', 'animationend': 'AnimationEvent',
        'animationiteration': 'AnimationEvent',
        'transitionstart': 'TransitionEvent', 'transitionend': 'TransitionEvent',
        'transitionrun': 'TransitionEvent', 'transitioncancel': 'TransitionEvent',
        'toggle': 'ToggleEvent', 'beforetoggle': 'ToggleEvent',
        'copy': 'ClipboardEvent', 'cut': 'ClipboardEvent', 'paste': 'ClipboardEvent',
        'compositionstart': 'CompositionEvent', 'compositionupdate': 'CompositionEvent', 'compositionend': 'CompositionEvent',
        'beforeinput': 'InputEvent',
        'gotpointercapture': 'PointerEvent', 'lostpointercapture': 'PointerEvent',
        'formdata': 'FormDataEvent',
    };
    return eventTypeMap[eventName] || 'Event';
}

const BASE_EVENT_MEMBERS: Record<string, MemberInfo> = {
    type:                       { type: 'string',             desc: 'The name of the event',                                                    kind: 'property' },
    target:                     { type: 'EventTarget | null', desc: 'The element that triggered the event',                                     kind: 'property' },
    currentTarget:              { type: 'EventTarget | null', desc: 'The element the event listener is attached to',                             kind: 'property' },
    bubbles:                    { type: 'boolean',            desc: 'Whether the event bubbles up through the DOM tree',                         kind: 'property' },
    cancelable:                 { type: 'boolean',            desc: 'Whether the event can be cancelled via `preventDefault()`',                 kind: 'property' },
    defaultPrevented:           { type: 'boolean',            desc: 'Whether `preventDefault()` was called on this event',                       kind: 'property' },
    eventPhase:                 { type: 'number',             desc: 'Current event phase (0 = none, 1 = capture, 2 = target, 3 = bubble)',       kind: 'property' },
    isTrusted:                  { type: 'boolean',            desc: 'Whether the event was initiated by a user action (not script)',              kind: 'property' },
    timeStamp:                  { type: 'number',             desc: 'Time (ms since page load) when the event was created',                      kind: 'property' },
    composed:                   { type: 'boolean',            desc: 'Whether the event can cross shadow DOM boundaries',                         kind: 'property' },
    preventDefault:             { type: '() => void',         desc: 'Cancel the default browser action for this event',                          kind: 'method'   },
    stopPropagation:            { type: '() => void',         desc: 'Stop the event from propagating further up or down the DOM',                kind: 'method'   },
    stopImmediatePropagation:   { type: '() => void',         desc: 'Stop the event from reaching any other listeners on the same element',      kind: 'method'   },
    composedPath:               { type: '() => EventTarget[]',desc: 'Returns the event path — the list of DOM nodes the event travels through',  kind: 'method'   },
};

const MOUSE_EVENT_MEMBERS: Record<string, MemberInfo> = {
    clientX:       { type: 'number',             desc: 'Horizontal coordinate relative to the viewport (visible area)',                  kind: 'property' },
    clientY:       { type: 'number',             desc: 'Vertical coordinate relative to the viewport (visible area)',                    kind: 'property' },
    pageX:         { type: 'number',             desc: 'Horizontal coordinate relative to the entire document',                          kind: 'property' },
    pageY:         { type: 'number',             desc: 'Vertical coordinate relative to the entire document',                            kind: 'property' },
    screenX:       { type: 'number',             desc: 'Horizontal coordinate relative to the screen',                                   kind: 'property' },
    screenY:       { type: 'number',             desc: 'Vertical coordinate relative to the screen',                                     kind: 'property' },
    offsetX:       { type: 'number',             desc: 'Horizontal coordinate relative to the padding edge of the target element',       kind: 'property' },
    offsetY:       { type: 'number',             desc: 'Vertical coordinate relative to the padding edge of the target element',         kind: 'property' },
    movementX:     { type: 'number',             desc: 'Horizontal distance the mouse moved since the last `mousemove` event',           kind: 'property' },
    movementY:     { type: 'number',             desc: 'Vertical distance the mouse moved since the last `mousemove` event',             kind: 'property' },
    button:        { type: 'number',             desc: 'Which mouse button was pressed (0 = primary/left, 1 = middle, 2 = secondary/right)', kind: 'property' },
    buttons:       { type: 'number',             desc: 'Bitmask of currently pressed buttons (1 = left, 2 = right, 4 = middle)',         kind: 'property' },
    altKey:        { type: 'boolean',            desc: 'Whether the **Alt** (Option on Mac) key was held during the event',              kind: 'property' },
    ctrlKey:       { type: 'boolean',            desc: 'Whether the **Ctrl** (Control) key was held during the event',                   kind: 'property' },
    shiftKey:      { type: 'boolean',            desc: 'Whether the **Shift** key was held during the event',                            kind: 'property' },
    metaKey:       { type: 'boolean',            desc: 'Whether the **Meta** key (⌘ on Mac, ⊞ on Windows) was held during the event',    kind: 'property' },
    relatedTarget: { type: 'EventTarget | null', desc: 'Secondary target — the element the pointer entered from or exited to',           kind: 'property' },
};

const KEYBOARD_EVENT_MEMBERS: Record<string, MemberInfo> = {
    key:         { type: 'string',  desc: 'The value of the key pressed (e.g. `"Enter"`, `"a"`, `"ArrowUp"`, `"Escape"`)', kind: 'property' },
    code:        { type: 'string',  desc: 'Physical key code regardless of layout (e.g. `"KeyA"`, `"Space"`, `"Digit1"`)', kind: 'property' },
    keyCode:     { type: 'number',  desc: 'Numeric key code — **deprecated**, prefer `key` or `code`',                     kind: 'property' },
    altKey:      { type: 'boolean', desc: 'Whether the **Alt** (Option on Mac) key was held during the event',              kind: 'property' },
    ctrlKey:     { type: 'boolean', desc: 'Whether the **Ctrl** (Control) key was held during the event',                   kind: 'property' },
    shiftKey:    { type: 'boolean', desc: 'Whether the **Shift** key was held during the event',                            kind: 'property' },
    metaKey:     { type: 'boolean', desc: 'Whether the **Meta** key (⌘ on Mac, ⊞ on Windows) was held during the event',    kind: 'property' },
    repeat:      { type: 'boolean', desc: 'Whether the key is being held down causing repeated key events',                 kind: 'property' },
    location:    { type: 'number',  desc: 'Location of the key on the keyboard (0 = standard, 1 = left, 2 = right, 3 = numpad)', kind: 'property' },
    isComposing: { type: 'boolean', desc: 'Whether the event is fired during an IME composition session',                   kind: 'property' },
};

const INPUT_EVENT_MEMBERS: Record<string, MemberInfo> = {
    data:        { type: 'string | null', desc: 'The characters being inserted, or `null` for deletions',                        kind: 'property' },
    inputType:   { type: 'string',        desc: 'Type of input change (e.g. `"insertText"`, `"deleteContentBackward"`, `"insertFromPaste"`)', kind: 'property' },
    isComposing: { type: 'boolean',       desc: 'Whether the event is fired during an IME composition session',                   kind: 'property' },
};

const FOCUS_EVENT_MEMBERS: Record<string, MemberInfo> = {
    relatedTarget: { type: 'EventTarget | null', desc: 'The element that lost focus (`focus`/`focusin`) or gained focus (`blur`/`focusout`)', kind: 'property' },
};

const WHEEL_EVENT_MEMBERS: Record<string, MemberInfo> = {
    deltaX:    { type: 'number', desc: 'Horizontal scroll amount (positive = scroll right)',                              kind: 'property' },
    deltaY:    { type: 'number', desc: 'Vertical scroll amount (positive = scroll down)',                                 kind: 'property' },
    deltaZ:    { type: 'number', desc: 'Z-axis scroll amount (rarely used)',                                              kind: 'property' },
    deltaMode: { type: 'number', desc: 'Unit of delta values: `0` = pixels, `1` = lines, `2` = pages',                   kind: 'property' },
};

const DRAG_EVENT_MEMBERS: Record<string, MemberInfo> = {
    dataTransfer: { type: 'DataTransfer | null', desc: 'Holds the data being dragged — use `.getData()` / `.setData()` to read/write', kind: 'property' },
};

const TOUCH_EVENT_MEMBERS: Record<string, MemberInfo> = {
    touches:        { type: 'TouchList', desc: 'All touch points currently on the surface',                                 kind: 'property' },
    targetTouches:  { type: 'TouchList', desc: 'Touch points that started on the current target element',                   kind: 'property' },
    changedTouches: { type: 'TouchList', desc: 'Touch points that changed in this event (started, moved, or ended)',        kind: 'property' },
    altKey:         { type: 'boolean',   desc: 'Whether the **Alt** (Option on Mac) key was held during the event',         kind: 'property' },
    ctrlKey:        { type: 'boolean',   desc: 'Whether the **Ctrl** (Control) key was held during the event',              kind: 'property' },
    shiftKey:       { type: 'boolean',   desc: 'Whether the **Shift** key was held during the event',                       kind: 'property' },
    metaKey:        { type: 'boolean',   desc: 'Whether the **Meta** key (⌘ on Mac, ⊞ on Windows) was held during the event', kind: 'property' },
};

const POINTER_EVENT_MEMBERS: Record<string, MemberInfo> = {
    pointerId:   { type: 'number',  desc: 'Unique identifier for the pointer causing the event',                             kind: 'property' },
    width:       { type: 'number',  desc: 'Width (px) of the contact geometry of the pointer',                               kind: 'property' },
    height:      { type: 'number',  desc: 'Height (px) of the contact geometry of the pointer',                              kind: 'property' },
    pressure:    { type: 'number',  desc: 'Pressure of the pointer, normalized to `0`–`1`',                                  kind: 'property' },
    tiltX:       { type: 'number',  desc: 'Angle (degrees) between the Y-Z plane and the pointer-tilt plane (-90 to 90)',    kind: 'property' },
    tiltY:       { type: 'number',  desc: 'Angle (degrees) between the X-Z plane and the pointer-tilt plane (-90 to 90)',    kind: 'property' },
    twist:       { type: 'number',  desc: 'Clockwise rotation (degrees, 0–359) of the pointer around its major axis',        kind: 'property' },
    pointerType: { type: 'string',  desc: 'Type of pointer that caused the event: `"mouse"`, `"pen"`, or `"touch"`',         kind: 'property' },
    isPrimary:   { type: 'boolean', desc: 'Whether this pointer is the primary pointer of its type',                          kind: 'property' },
};

const ANIMATION_EVENT_MEMBERS: Record<string, MemberInfo> = {
    animationName: { type: 'string', desc: 'Value of the `animation-name` CSS property that generated the animation',        kind: 'property' },
    elapsedTime:   { type: 'number', desc: 'Time (seconds) the animation has been running, excluding pauses',                kind: 'property' },
    pseudoElement: { type: 'string', desc: 'The `::before` or `::after` pseudo-element the animation runs on, or `""`',      kind: 'property' },
};

const TRANSITION_EVENT_MEMBERS: Record<string, MemberInfo> = {
    propertyName:  { type: 'string', desc: 'The CSS property name associated with the transition (e.g. `"opacity"`)',        kind: 'property' },
    elapsedTime:   { type: 'number', desc: 'Time (seconds) the transition has been running when this event fired',           kind: 'property' },
    pseudoElement: { type: 'string', desc: 'The `::before` or `::after` pseudo-element the transition runs on, or `""`',     kind: 'property' },
};

const SUBMIT_EVENT_MEMBERS: Record<string, MemberInfo> = {
    submitter: { type: 'HTMLElement | null', desc: 'The button or element that triggered the form submission', kind: 'property' },
};

const TOGGLE_EVENT_MEMBERS: Record<string, MemberInfo> = {
    oldState: { type: 'string', desc: 'The state the element is transitioning from (`"open"` or `"closed"`)', kind: 'property' },
    newState: { type: 'string', desc: 'The state the element is transitioning to (`"open"` or `"closed"`)',   kind: 'property' },
};

const CLIPBOARD_EVENT_MEMBERS: Record<string, MemberInfo> = {
    clipboardData: { type: 'DataTransfer | null', desc: 'The clipboard data associated with the event — use `.getData()` / `.setData()` to read/write', kind: 'property' },
};

const COMPOSITION_EVENT_MEMBERS: Record<string, MemberInfo> = {
    data: { type: 'string', desc: 'The characters generated by the IME composition session', kind: 'property' },
};

const FORMDATA_EVENT_MEMBERS: Record<string, MemberInfo> = {
    formData: { type: 'FormData', desc: 'The FormData object representing the form data at the time of the event', kind: 'property' },
};

const EVENT_TYPE_EXTRA_MEMBERS: Record<string, Record<string, MemberInfo>[]> = {
    MouseEvent:      [MOUSE_EVENT_MEMBERS],
    KeyboardEvent:   [KEYBOARD_EVENT_MEMBERS],
    InputEvent:      [INPUT_EVENT_MEMBERS],
    FocusEvent:      [FOCUS_EVENT_MEMBERS],
    WheelEvent:      [MOUSE_EVENT_MEMBERS, WHEEL_EVENT_MEMBERS],
    DragEvent:       [MOUSE_EVENT_MEMBERS, DRAG_EVENT_MEMBERS],
    TouchEvent:      [TOUCH_EVENT_MEMBERS],
    PointerEvent:    [MOUSE_EVENT_MEMBERS, POINTER_EVENT_MEMBERS],
    AnimationEvent:  [ANIMATION_EVENT_MEMBERS],
    TransitionEvent: [TRANSITION_EVENT_MEMBERS],
    SubmitEvent:      [SUBMIT_EVENT_MEMBERS],
    ToggleEvent:      [TOGGLE_EVENT_MEMBERS],
    ClipboardEvent:   [CLIPBOARD_EVENT_MEMBERS],
    CompositionEvent: [COMPOSITION_EVENT_MEMBERS],
    FormDataEvent:    [FORMDATA_EVENT_MEMBERS],
};

/**
 * Enumerate every member visible on a given event type, deduped, with
 * type-specific members listed first then base `Event` members.
 */
export function getAllEventMembers(eventType: string): Array<{ name: string } & MemberInfo> {
    const seen = new Set<string>();
    const out: Array<{ name: string } & MemberInfo> = [];
    const extras = EVENT_TYPE_EXTRA_MEMBERS[eventType];
    if (extras) {
        for (const map of extras) {
            for (const name of Object.keys(map)) {
                if (!seen.has(name)) { seen.add(name); out.push({ name, ...map[name] }); }
            }
        }
    }
    for (const name of Object.keys(BASE_EVENT_MEMBERS)) {
        if (!seen.has(name)) { seen.add(name); out.push({ name, ...BASE_EVENT_MEMBERS[name] }); }
    }
    return out;
}

/**
 * Look up a single event member by name for a given event type.
 * Returns type-specific members first, then base Event members.
 */
export function getEventMemberInfo(eventType: string, memberName: string): MemberInfo | undefined {
    const extras = EVENT_TYPE_EXTRA_MEMBERS[eventType];
    if (extras) {
        for (const map of extras) {
            if (memberName in map) return map[memberName];
        }
    }
    return BASE_EVENT_MEMBERS[memberName];
}
