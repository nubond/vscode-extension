import {
    THIS_PREFIX_LEN,
    buildLineIndex,
    offsetToLineChar,
    getChainIndexAtOffset,
    resolveChainType,
    inferItemType,
    getEventType,
    getElementType,
    getTagSpecificMembers,
    getTagSpecificAttributes,
    getTagSpecificProperties,
    getEventMemberInfo,
    getDomMemberInfo,
    getElementManipulationMemberInfo,
} from '../../src/core/utils';

describe('utils', () => {
    describe('THIS_PREFIX_LEN', () => {
        it('should be 5', () => {
            expect(THIS_PREFIX_LEN).toBe(5);
        });
    });

    describe('buildLineIndex / offsetToLineChar', () => {
        it('should handle single-line text', () => {
            const idx = buildLineIndex('hello');
            expect(offsetToLineChar(idx, 0)).toEqual({ line: 0, character: 0 });
            expect(offsetToLineChar(idx, 3)).toEqual({ line: 0, character: 3 });
        });

        it('should handle multi-line text', () => {
            const text = 'line1\nline2\nline3';
            const idx = buildLineIndex(text);
            expect(offsetToLineChar(idx, 0)).toEqual({ line: 0, character: 0 });
            expect(offsetToLineChar(idx, 5)).toEqual({ line: 0, character: 5 }); // the \n
            expect(offsetToLineChar(idx, 6)).toEqual({ line: 1, character: 0 }); // start of line2
            expect(offsetToLineChar(idx, 12)).toEqual({ line: 2, character: 0 }); // start of line3
        });

        it('should handle empty text', () => {
            const idx = buildLineIndex('');
            expect(offsetToLineChar(idx, 0)).toEqual({ line: 0, character: 0 });
        });

        it('should handle text ending with newline', () => {
            const text = 'a\nb\n';
            const idx = buildLineIndex(text);
            expect(offsetToLineChar(idx, 4)).toEqual({ line: 2, character: 0 });
        });
    });


    describe('getChainIndexAtOffset', () => {
        it('should return 0 for root member', () => {
            // chain: ['name'], refStart: 0, this.name
            // exprOffset in 'this.name' — offset 5 is 'n' of name
            expect(getChainIndexAtOffset(['name'], 0, 5)).toBe(0);
        });

        it('should return 1 for first chained member', () => {
            // chain: ['user', 'name'], refStart: 0
            // this.user.name — at offset 10 should be in 'name'
            expect(getChainIndexAtOffset(['user', 'name'], 0, 10)).toBe(1);
        });

        it('should return 0 for offset before chain', () => {
            expect(getChainIndexAtOffset(['name'], 0, 0)).toBe(0);
        });

        it('should handle optional chaining separators', () => {
            // chain: ['user', 'name'], refStart: 0, separators: [2] meaning ?.
            // this.user?.name — user starts at 5, ends at 9, sep=2, name at 11
            expect(getChainIndexAtOffset(['user', 'name'], 0, 11, [2])).toBe(1);
        });
    });

    describe('resolveChainType', () => {
        it('should resolve root member type', () => {
            const associations = [{ members: [{ name: 'user', type: 'User' }] }];
            const findMember = (assoc: any, name: string) => assoc.members.find((m: any) => m.name === name);
            const findMemberWithType = () => undefined;
            const result = resolveChainType(['user'], associations, findMember, findMemberWithType);
            expect(result).toBe('User');
        });

        it('should resolve chained member type', () => {
            const associations = [{ members: [{ name: 'user', type: 'User' }] }];
            const findMember = (assoc: any, name: string) => assoc.members.find((m: any) => m.name === name);
            const findMemberWithType = (typeName: string, memberName: string) => {
                if (typeName === 'User' && memberName === 'name') return { type: 'string' };
                return undefined;
            };
            const result = resolveChainType(['user', 'name'], associations, findMember, findMemberWithType);
            expect(result).toBe('string');
        });

        it('should return undefined if root not found', () => {
            const associations = [{ members: [] }];
            const findMember = () => undefined;
            const findMemberWithType = () => undefined;
            const result = resolveChainType(['unknown'], associations, findMember, findMemberWithType);
            expect(result).toBeUndefined();
        });

        it('should return parent type if chain member not found', () => {
            const associations = [{ members: [{ name: 'user', type: 'User' }] }];
            const findMember = (assoc: any, name: string) => assoc.members.find((m: any) => m.name === name);
            const findMemberWithType = () => undefined;
            const result = resolveChainType(['user', 'unknown'], associations, findMember, findMemberWithType);
            expect(result).toBe('User');
        });
    });

    describe('inferItemType', () => {
        it('should infer from array brackets', () => {
            expect(inferItemType('string[]')).toBe('string');
        });

        it('should infer from Array generic', () => {
            expect(inferItemType('Array<number>')).toBe('number');
        });

        it('should strip union with undefined', () => {
            expect(inferItemType('string[] | undefined')).toBe('string');
        });

        it('should return string for string type', () => {
            expect(inferItemType('string')).toBe('string');
        });

        it('should return number for number type', () => {
            expect(inferItemType('number')).toBe('number');
        });

        it('should return any for unknown type', () => {
            expect(inferItemType('SomeType')).toBe('any');
        });
    });

    describe('getEventType', () => {
        it('should return MouseEvent for click', () => {
            expect(getEventType('click')).toBe('MouseEvent');
        });

        it('should return KeyboardEvent for keydown', () => {
            expect(getEventType('keydown')).toBe('KeyboardEvent');
        });

        it('should return FocusEvent for focus', () => {
            expect(getEventType('focus')).toBe('FocusEvent');
        });

        it('should return Event for unknown event', () => {
            expect(getEventType('customEvent')).toBe('Event');
        });

        it('should return DragEvent for drag events', () => {
            expect(getEventType('dragstart')).toBe('DragEvent');
        });

        it('should return PointerEvent for pointer events', () => {
            expect(getEventType('pointerdown')).toBe('PointerEvent');
        });

        it('should return ToggleEvent for toggle', () => {
            expect(getEventType('toggle')).toBe('ToggleEvent');
            expect(getEventType('beforetoggle')).toBe('ToggleEvent');
        });

        it('should return ClipboardEvent for clipboard events', () => {
            expect(getEventType('copy')).toBe('ClipboardEvent');
            expect(getEventType('cut')).toBe('ClipboardEvent');
            expect(getEventType('paste')).toBe('ClipboardEvent');
        });

        it('should return CompositionEvent for composition events', () => {
            expect(getEventType('compositionstart')).toBe('CompositionEvent');
            expect(getEventType('compositionupdate')).toBe('CompositionEvent');
            expect(getEventType('compositionend')).toBe('CompositionEvent');
        });

        it('should return InputEvent for beforeinput', () => {
            expect(getEventType('beforeinput')).toBe('InputEvent');
        });

        it('should return FormDataEvent for formdata', () => {
            expect(getEventType('formdata')).toBe('FormDataEvent');
        });

        it('should return PointerEvent for pointer capture events', () => {
            expect(getEventType('gotpointercapture')).toBe('PointerEvent');
            expect(getEventType('lostpointercapture')).toBe('PointerEvent');
        });
    });

    describe('getElementType', () => {
        it('should return HTMLInputElement for input', () => {
            expect(getElementType('input')).toBe('HTMLInputElement');
        });

        it('should return HTMLDivElement for div', () => {
            expect(getElementType('div')).toBe('HTMLDivElement');
        });

        it('should return HTMLAnchorElement for a', () => {
            expect(getElementType('a')).toBe('HTMLAnchorElement');
        });

        it('should return HTMLElement for unknown tag', () => {
            expect(getElementType('custom-element')).toBe('HTMLElement');
        });

        it('should be case-insensitive', () => {
            expect(getElementType('DIV')).toBe('HTMLDivElement');
        });
    });

    describe('getTagSpecificMembers', () => {
        it('should return members for HTMLInputElement', () => {
            const members = getTagSpecificMembers('HTMLInputElement');
            expect(members.length).toBeGreaterThan(0);
            const names = members.map(m => m.name);
            expect(names).toContain('value');
            expect(names).toContain('checked');
        });

        it('should return members for HTMLAnchorElement', () => {
            const members = getTagSpecificMembers('HTMLAnchorElement');
            expect(members.length).toBeGreaterThan(0);
            const names = members.map(m => m.name);
            expect(names).toContain('href');
        });

        it('should return empty for HTMLElement', () => {
            const members = getTagSpecificMembers('HTMLElement');
            expect(members).toEqual([]);
        });

        it('should handle media elements', () => {
            const members = getTagSpecificMembers('HTMLVideoElement');
            expect(members.length).toBeGreaterThan(0);
            const names = members.map(m => m.name);
            expect(names).toContain('play');
            expect(names).toContain('pause');
        });
    });

    describe('getTagSpecificAttributes', () => {
        it('should return attributes for HTMLInputElement', () => {
            const attrs = getTagSpecificAttributes('HTMLInputElement');
            expect(attrs.length).toBeGreaterThan(0);
        });

        it('should return empty or common attributes for unknown type', () => {
            const attrs = getTagSpecificAttributes('');
            expect(Array.isArray(attrs)).toBe(true);
        });
    });

    describe('getTagSpecificProperties', () => {
        it('should return properties for HTMLInputElement', () => {
            const props = getTagSpecificProperties('HTMLInputElement');
            expect(props.length).toBeGreaterThan(0);
        });
    });

    describe('getEventMemberInfo', () => {
        it('should return info for MouseEvent.clientX', () => {
            const info = getEventMemberInfo('MouseEvent', 'clientX');
            expect(info).toBeDefined();
            expect(info!.type).toBe('number');
        });

        it('should return info for base Event type', () => {
            const info = getEventMemberInfo('Event', 'type');
            expect(info).toBeDefined();
            expect(info!.type).toBe('string');
        });

        it('should return undefined for unknown member', () => {
            const info = getEventMemberInfo('MouseEvent', 'unknownProp');
            expect(info).toBeUndefined();
        });
    });


    describe('getDomMemberInfo', () => {
        it('should return info for known DOM member', () => {
            const info = getDomMemberInfo('innerHTML');
            expect(info).toBeDefined();
        });

        it('should return info for element-type-specific member', () => {
            const info = getDomMemberInfo('value', 'HTMLInputElement');
            expect(info).toBeDefined();
        });

        it('should return undefined for unknown member', () => {
            const info = getDomMemberInfo('fooBarBaz');
            expect(info).toBeUndefined();
        });
    });

    describe('getElementManipulationMemberInfo', () => {
        it('should return info for top-level manipulation member', () => {
            const info = getElementManipulationMemberInfo(undefined, 'properties');
            expect(info).toBeDefined();
            expect(info!.type).toBe('ElementPropertiesManipulations');
        });

        it('should return info for sub-member', () => {
            const info = getElementManipulationMemberInfo('classes', 'add');
            expect(info).toBeDefined();
            expect(info!.kind).toBe('method');
        });

        it('should return info for styles sub-member', () => {
            const info = getElementManipulationMemberInfo('styles', 'get');
            expect(info).toBeDefined();
        });

        it('should return undefined for unknown member', () => {
            const info = getElementManipulationMemberInfo(undefined, 'unknownMethod');
            expect(info).toBeUndefined();
        });

        it('should return undefined for unknown sub-member', () => {
            const info = getElementManipulationMemberInfo('classes', 'unknownMethod');
            expect(info).toBeUndefined();
        });
    });
});
