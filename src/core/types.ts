/**
 * types.ts
 * Shared type definitions used across registries and providers. Lives in its
 * own file so registry modules can import it without depending on `utils.ts`,
 * which would otherwise create import cycles when utils re-exports the
 * registries.
 */

export interface MemberInfo {
    type: string;
    desc: string;
    kind: 'property' | 'method';
}

export interface NamedDesc {
    name: string;
    desc: string;
}

export interface DomMember {
    name: string;
    kind: 'property' | 'method';
    type: string;
    desc: string;
}
