/**
 * decorator-analyzer.ts
 * Analyzes TypeScript source files to find @Container/@Component decorated classes,
 * resolve their associated HTML templates, and extract class member information.
 * Builds a bidirectional map between .html files and .ts class declarations.
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { logError } from './logger';

export interface ClassMember {
    name: string;
    kind: 'property' | 'method' | 'getter' | 'setter';
    type: string;
    /** Line/column in the TS file where this member is declared */
    line: number;
    character: number;
    /** Byte offset in the TS file */
    offset: number;
    /** Whether the member is public (accessible from templates) */
    isPublic: boolean;
    /**
     * Absolute (slash-normalized) path of the file that declares this member,
     * set only for members inherited from a base class declared elsewhere.
     * Undefined for members declared directly on the associated class —
     * consumers fall back to the association's `tsFilePath`.
     */
    declaredIn?: string;
}

export interface TemplateAssociation {
    /** Absolute path to the TypeScript file */
    tsFilePath: string;
    /** Class name */
    className: string;
    /** Decorator: 'Container' | 'Component' | 'AppRoot' */
    decoratorType: string;
    /** Absolute path to the associated HTML template (if external) */
    htmlFilePath?: string;
    /** Inline template string (if inline) */
    inlineTemplate?: string;
    /** Position of the class declaration */
    classOffset: number;
    classLine: number;
    classCharacter: number;
    /** All accessible class members */
    members: ClassMember[];
}

export interface RegisteredEntity {
    /**
     * The name the framework registers the entity under at runtime — what
     * templates actually reference. Mirrors `Environment.add*` semantics:
     * containers register the custom name / class name verbatim; components
     * and aspects kebab-case names without a '-'; transformers camelCase.
     */
    name: string;
    type: 'container' | 'component' | 'aspect' | 'transformer' | 'template' | 'injectable';
    tsFilePath: string;
    className: string;
    /** For transformers: the function name used in expressions (e.g. 'localize' for class Localize) */
    transformerFunctionName?: string;
    /** Position of the declaration (class, or `$Template(...)` call) for navigation */
    line?: number;
    character?: number;
}

export class DecoratorAnalyzer {
    /** Map: HTML file path (normalized) → TemplateAssociation[] */
    private htmlToTs = new Map<string, TemplateAssociation[]>();
    /** Map: TS file path (normalized) → TemplateAssociation[] */
    private tsToAssociations = new Map<string, TemplateAssociation[]>();
    /** All registered entities (containers, components, aspects, transformers) */
    private registeredEntities: RegisteredEntity[] = [];
    /**
     * Index of all interface/type/class definitions found in source files:
     * name → file paths declaring a type of that name. Multiple files can
     * declare same-named types; lookups scan each candidate until the
     * declaration is actually found instead of last-write-wins.
     */
    private typeIndex = new Map<string, string[]>();
    /**
     * Cache of parsed `ts.SourceFile`s keyed by normalized path. Hover, completion
     * and definition each call findMemberInType / findMemberWithType / etc.
     * which previously did `fs.readFileSync` + `ts.createSourceFile` per call —
     * a chain like `this.user.address.city.zip` would re-parse 4 different files
     * on every keystroke, multiplied across providers. Invalidated by removeFile.
     */
    private sourceFileCache = new Map<string, ts.SourceFile>();
    /**
     * Last-seen `ts.SourceFile` reference per analyzed TS file path, tracked
     * PER LanguageService. Used by `analyzeWithLanguageService` to detect
     * which files actually changed between two `ls.getProgram()` calls —
     * TypeScript's LanguageService returns the *same* `SourceFile` object for
     * unchanged files, so a simple reference check is enough to skip
     * re-analysis. Per-service tracking matters: different services hold
     * different `SourceFile` objects for the same shared file, so a single
     * global map made every shared file fail the identity check on each
     * alternating service's pass — permanent re-analysis ping-pong.
     *
     * `analyzedAt` records the analysis tick, so a file can also be
     * invalidated when one of its DECLARATION DEPENDENCIES changes (see
     * `declChangeTicks`) even though its own SourceFile identity is stable.
     */
    private lastAnalyzedByService = new WeakMap<ts.LanguageService, Map<string, AnalyzedFileRecord>>();
    /**
     * Monotonic counter, bumped once per `analyzeWithLanguageService` pass.
     * Global across services so cross-service staleness comparisons work.
     */
    private analysisTick = 0;
    /**
     * Tick at which each file's own text last changed (SourceFile identity
     * check failed), keyed by normalized path. Association member records
     * carry cross-file coordinates: a subclass's inherited members store
     * name offsets/lines INSIDE the base file, captured when the SUBCLASS
     * was analyzed. Editing the base file moves those declarations, but the
     * subclass's SourceFile is unchanged so the identity check alone would
     * keep its stale coordinates forever — rename fan-out
     * (`getAssociationsWithMember`, offset-keyed) then silently missed
     * subclass templates, and the TS-rename delegation fired at stale
     * positions. Files whose members reference a declaring file with a newer
     * change tick than their own `analyzedAt` are re-analyzed.
     */
    private declChangeTicks = new Map<string, number>();
    /**
     * Per-LanguageService record of which files each service's program
     * contained on its previous `analyzeWithLanguageService` call. The
     * stale-file cleanup must compare against *this service's* previous
     * snapshot only — comparing against the global `lastAnalyzedSourceFiles`
     * wiped every other tsconfig group's analysis on each call (multi-project
     * workspaces ended up with only the most recently analyzed group alive).
     */
    private lastSeenByService = new WeakMap<ts.LanguageService, Set<string>>();
    /**
     * How many LanguageServices' programs currently contain each analyzed
     * file. Programs include *transitive imports*, so one file can appear in
     * several groups' programs at once (e.g. a shared util imported across
     * tsconfig projects). A file is only evicted when its LAST claimant drops
     * it — otherwise one group dropping an import would wipe analysis still
     * valid for another group.
     */
    private fileClaimCounts = new Map<string, number>();

    /**
     * Analyze a set of TypeScript files and build the association maps.
     *
     * If `compilerOptions` is provided it is used as-is (test path / explicit
     * override). Otherwise files are grouped by their nearest `tsconfig.json`
     * and one `ts.Program` is created per group using that project's compiler
     * options — so path aliases, custom `lib`/`target`, `useDefineForClassFields`
     * etc. all behave the way the project itself behaves. Files with no
     * resolvable tsconfig (or where parsing fails) fall back to a minimal
     * default set so analysis is still attempted.
     */
    analyzeFiles(filePaths: string[], compilerOptions?: ts.CompilerOptions): void {
        if (compilerOptions) {
            const program = ts.createProgram(filePaths, compilerOptions);
            this.analyzeProgram(program);
            return;
        }

        for (const group of resolveProgramGroups(filePaths)) {
            const program = ts.createProgram(group.files, group.options);
            this.analyzeProgram(program);
        }
    }

    /**
     * Analyze a TypeScript program.
     */
    analyzeProgram(program: ts.Program): void {
        const checker = program.getTypeChecker();

        for (const sourceFile of program.getSourceFiles()) {
            if (sourceFile.isDeclarationFile) continue;
            if (sourceFile.fileName.includes('node_modules')) continue;
            this.analyzeSourceFile(sourceFile, checker);
        }
    }

    /**
     * Incrementally analyze using a long-lived `ts.LanguageService`.
     *
     * Key property: `LanguageService.getProgram()` returns *the same*
     * `ts.SourceFile` object for files that haven't changed since the
     * previous call (TypeScript's incremental builder reuses ASTs aggressively).
     * We exploit that to re-analyze only the files whose `SourceFile`
     * reference actually differs from last time — typically just the one
     * file the user edited.
     *
     * Critically, the `LanguageService` always provides a working `TypeChecker`,
     * so inferred types (`x = new Foo()` without an explicit annotation) are
     * resolved correctly on every update. This is the path that fixes the
     * `analyzeSourceText` regression where edits silently downgraded all
     * inferred member types to `any`.
     *
     * Returns the list of file paths that were re-analyzed — empty on a
     * legitimate no-op call (nothing changed). Returns `undefined` when the
     * analysis could not run at all (LanguageService not ready, program or
     * checker unavailable): callers tracking a "last analyzed version" stamp
     * must NOT bump it in that case, or the failed pass would suppress
     * re-analysis until the next unrelated project change.
     */
    analyzeWithLanguageService(languageService: ts.LanguageService): string[] | undefined {
        // The LanguageService itself can throw — e.g. tsserver in a bad state,
        // a corrupt tsconfig that fails type-resolution, or an unsupported
        // syntax flag. A crash here would propagate up to whatever called us
        // (a file watcher, a command, a TS plugin proxy), and risk poisoning
        // VS Code's native TS support. Bail cleanly on any LanguageService
        // failure — the next call will retry against fresh project state.
        let program: ts.Program | undefined;
        try {
            program = languageService.getProgram();
        } catch (err) {
            logError('analyzeWithLanguageService.getProgram', err);
            return undefined;
        }
        if (!program) return undefined;

        let checker: ts.TypeChecker;
        try {
            checker = program.getTypeChecker();
        } catch (err) {
            logError('analyzeWithLanguageService.getTypeChecker', err);
            return undefined;
        }

        const reanalyzed: string[] = [];
        const seen = new Set<string>();

        let sourceFiles: readonly ts.SourceFile[];
        try {
            sourceFiles = program.getSourceFiles();
        } catch (err) {
            logError('analyzeWithLanguageService.getSourceFiles', err);
            return undefined;
        }

        let lastAnalyzed = this.lastAnalyzedByService.get(languageService);
        if (!lastAnalyzed) {
            lastAnalyzed = new Map<string, AnalyzedFileRecord>();
            this.lastAnalyzedByService.set(languageService, lastAnalyzed);
        }

        const tick = ++this.analysisTick;

        // Phase 1: identity check. Files whose SourceFile reference changed
        // were re-parsed by the LanguageService — their own declarations may
        // have moved, so record the change tick BEFORE deciding dependents.
        const toAnalyze: ts.SourceFile[] = [];
        const changedKeys = new Set<string>();
        const eligible: ts.SourceFile[] = [];
        for (const sourceFile of sourceFiles) {
            if (sourceFile.isDeclarationFile) continue;
            if (sourceFile.fileName.includes('node_modules')) continue;
            eligible.push(sourceFile);

            const key = normalizePath(sourceFile.fileName);
            seen.add(key);

            const prev = lastAnalyzed.get(key);
            if (prev?.sourceFile === sourceFile) continue;

            toAnalyze.push(sourceFile);
            changedKeys.add(key);
            this.declChangeTicks.set(key, tick);
        }

        // Phase 2: dependent invalidation. An unchanged file whose association
        // members reference a declaring file (`declaredIn`) that changed after
        // this file was last analyzed holds stale cross-file coordinates —
        // re-analyze it too. Must run against the PRE-analysis association
        // maps (phase 3 rebuilds them).
        for (const sourceFile of eligible) {
            const key = normalizePath(sourceFile.fileName);
            if (changedKeys.has(key)) continue;
            const prev = lastAnalyzed.get(key);
            if (!prev) continue; // no entry ⇒ phase 1 already queued it
            if (this.hasStaleDeclarationDependency(key, prev.analyzedAt)) {
                toAnalyze.push(sourceFile);
            }
        }

        // Phase 3: (re)analyze everything queued.
        for (const sourceFile of toAnalyze) {
            const key = normalizePath(sourceFile.fileName);

            // Per-file try/catch: a single broken source file (e.g. one that
            // hits a bug in `extractMembers`) must not stop us analyzing the
            // rest of the workspace. Without this, a single rogue file could
            // cripple every provider for every other file.
            try {
                this.removeFile(sourceFile.fileName);
                lastAnalyzed.set(key, { sourceFile, analyzedAt: tick });
                this.analyzeSourceFile(sourceFile, checker);
                reanalyzed.push(sourceFile.fileName);
            } catch (err) {
                // Leave the file marked as "seen" so we don't try to re-analyze
                // it in tight loops. The user can recover by editing the file
                // (which bumps its SourceFile reference) or via restart.
                logError(`analyzeWithLanguageService.perFile(${sourceFile.fileName})`, err);
            }
        }

        // Detect files removed since THIS service's last call — they're no
        // longer in its program's SourceFile list. Scoped per LanguageService:
        // other tsconfig groups' files are legitimately absent from this
        // program and must not be evicted.
        const prevSeen = this.lastSeenByService.get(languageService);

        // Claim files this service's program contains for the first time.
        for (const key of seen) {
            if (!prevSeen || !prevSeen.has(key)) {
                this.fileClaimCounts.set(key, (this.fileClaimCounts.get(key) ?? 0) + 1);
            }
        }

        if (prevSeen) {
            for (const key of prevSeen) {
                if (!seen.has(key)) {
                    // Release this service's claim; evict only when no other
                    // service's program still contains the file.
                    const remaining = (this.fileClaimCounts.get(key) ?? 1) - 1;
                    if (remaining > 0) {
                        this.fileClaimCounts.set(key, remaining);
                        continue;
                    }
                    this.fileClaimCounts.delete(key);
                    try {
                        this.removeFile(key);
                    } catch (err) {
                        // removeFile is internal — a throw here would indicate
                        // map corruption, which is worth flagging.
                        logError(`analyzeWithLanguageService.removeStaleFile(${key})`, err);
                    }
                    lastAnalyzed.delete(key);
                    // No claimant left ⇒ no service can need this file's
                    // change tick for dependent invalidation anymore — prune
                    // it so the map doesn't grow with deleted/renamed files.
                    // Deliberately NOT done inside removeFile: phase 3 calls
                    // removeFile right after phase 1 recorded the tick, and
                    // deleting it there would break cross-service dependent
                    // invalidation.
                    this.declChangeTicks.delete(key);
                }
            }
        }
        this.lastSeenByService.set(languageService, seen);

        return reanalyzed;
    }

    /**
     * Analyze a single source file text (without full program — for quick updates).
     */
    analyzeSourceText(filePath: string, sourceText: string): void {
        const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ES2020, true);
        this.analyzeSourceFileBasic(sourceFile);
    }

    /**
     * Get template association(s) for an HTML file.
     */
    getAssociationsForHtml(htmlFilePath: string): TemplateAssociation[] {
        const normalized = normalizePath(htmlFilePath);
        return this.htmlToTs.get(normalized) ?? [];
    }

    /**
     * Get template association(s) for a TypeScript file.
     */
    getAssociationsForTs(tsFilePath: string): TemplateAssociation[] {
        const normalized = normalizePath(tsFilePath);
        return this.tsToAssociations.get(normalized) ?? [];
    }

    /**
     * Find a class member by name in the association.
     */
    findMember(association: TemplateAssociation, memberName: string): ClassMember | undefined {
        return association.members.find(m => m.name === memberName);
    }

    /**
     * Get all known associations.
     */
    getAllAssociations(): TemplateAssociation[] {
        const all: TemplateAssociation[] = [];
        for (const arr of this.tsToAssociations.values()) {
            all.push(...arr);
        }
        return all;
    }

    /**
     * All associations whose member list contains a member backed by the SAME
     * declaration — matched by name + declaring file + name-start offset.
     *
     * This is how rename / references / the ts-plugin fan out to every class
     * that shares a member: a base-class property appears (via
     * `collectInheritedMembers`, with `declaredIn` set) in the member list of
     * every subclass association, all pointing at one declaration. Fanning
     * out by declaration keeps sibling subclasses' templates in sync on
     * rename — previously only the originating class's templates were edited
     * and the rest silently broke at runtime.
     *
     * The offset key is only trustworthy because `analyzeWithLanguageService`
     * re-analyzes dependents when a declaring file changes (`declChangeTicks`)
     * — without that, a base-file edit left subclass records pointing at the
     * old offset and this lookup silently returned nothing.
     */
    getAssociationsWithMember(memberName: string, declFilePath: string, declOffset: number): TemplateAssociation[] {
        const declNorm = normalizePath(declFilePath);
        const result: TemplateAssociation[] = [];
        for (const assocs of this.tsToAssociations.values()) {
            for (const assoc of assocs) {
                const matches = assoc.members.some(m =>
                    m.name === memberName &&
                    m.offset === declOffset &&
                    normalizePath(m.declaredIn ?? assoc.tsFilePath) === declNorm);
                if (matches) result.push(assoc);
            }
        }
        return result;
    }

    /**
     * Get all registered entities of a specific type.
     */
    getEntitiesByType(type: RegisteredEntity['type']): RegisteredEntity[] {
        return this.registeredEntities.filter(e => e.type === type);
    }

    /**
     * Get all registered entities.
     */
    getAllEntities(): RegisteredEntity[] {
        return [...this.registeredEntities];
    }

    /**
     * Find a transformer entity by its function name used in expressions.
     */
    getTransformerByFunctionName(funcName: string): RegisteredEntity | undefined {
        return this.registeredEntities.find(
            e => e.type === 'transformer' && e.transformerFunctionName === funcName
        );
    }

    /**
     * Find a member declaration by looking up a type name across all registered entities
     * and scanning the source file for the class and member.
     * Returns { filePath, line, character } or undefined.
     */
    findMemberInType(typeName: string, memberName: string): { filePath: string; line: number; character: number } | undefined {
        // Strip generic params, array brackets, and union suffixes for lookup
        const cleanType = typeName.replace(/<.*>/, '').replace(/\[\]$/, '').replace(/\s*\|.*$/, '').trim();

        // Same-named types can exist in multiple files — scan each candidate
        // until the declaration actually containing the member is found.
        for (const filePath of this.candidateFilesForType(cleanType)) {
            const sourceFile = this.getSourceFile(filePath);
            if (!sourceFile) continue;

            // Find the class/interface/type-alias and the member
            let result: { filePath: string; line: number; character: number } | undefined;
            ts.forEachChild(sourceFile, (node) => {
                if (result) return;
                if (ts.isClassDeclaration(node) && node.name?.text === cleanType) {
                    for (const member of node.members) {
                        if (member.name && member.name.getText(sourceFile) === memberName) {
                            const pos = sourceFile.getLineAndCharacterOfPosition(member.name.getStart(sourceFile));
                            result = { filePath, line: pos.line, character: pos.character };
                            return;
                        }
                    }
                } else {
                    const shapeMembers = getObjectShapeMembers(node, cleanType);
                    if (shapeMembers) {
                        for (const member of shapeMembers) {
                            if (member.name && member.name.getText(sourceFile) === memberName) {
                                const pos = sourceFile.getLineAndCharacterOfPosition(member.name.getStart(sourceFile));
                                result = { filePath, line: pos.line, character: pos.character };
                                return;
                            }
                        }
                    }
                }
            });

            if (result) return result;
        }

        return undefined;
    }

    /**
     * All files that may declare a type of the given name: a registered
     * entity's file first (most specific), then every typeIndex candidate.
     */
    private candidateFilesForType(cleanType: string): string[] {
        const candidates: string[] = [];
        const entity = this.registeredEntities.find(e => e.className === cleanType);
        if (entity) candidates.push(entity.tsFilePath);
        for (const fp of this.typeIndex.get(cleanType) ?? []) {
            if (!candidates.includes(fp)) candidates.push(fp);
        }
        return candidates;
    }

    /**
     * Find a member declaration in a type and return position + type info.
     * Used for chained member resolution (e.g. this.iptvs.data → resolve 'data' in IPTVs).
     * Searches registered entities first, then the type index for interfaces/plain classes.
     */
    findMemberWithType(typeName: string, memberName: string): { filePath: string; line: number; character: number; type: string; kind: string } | undefined {
        const cleanType = typeName.replace(/<.*>/, '').replace(/\[\]$/, '').replace(/\s*\|.*$/, '').trim();

        for (const filePath of this.candidateFilesForType(cleanType)) {
            const found = this.findMemberWithTypeInFile(filePath, cleanType, memberName);
            if (found) return found;
        }
        return undefined;
    }

    private findMemberWithTypeInFile(filePath: string, cleanType: string, memberName: string): { filePath: string; line: number; character: number; type: string; kind: string } | undefined {
        const sourceFile = this.getSourceFile(filePath);
        if (!sourceFile) return undefined;

        let result: { filePath: string; line: number; character: number; type: string; kind: string } | undefined;
        ts.forEachChild(sourceFile, (node) => {
            if (result) return;
            if (ts.isClassDeclaration(node) && node.name?.text === cleanType) {
                for (const member of node.members) {
                    if (member.name && member.name.getText(sourceFile) === memberName) {
                        const pos = sourceFile.getLineAndCharacterOfPosition(member.name.getStart(sourceFile));
                        let type = 'any';
                        let kind = 'property';
                        if (ts.isPropertyDeclaration(member)) {
                            kind = 'property';
                            if (member.type) type = member.type.getText(sourceFile);
                        } else if (ts.isMethodDeclaration(member)) {
                            kind = 'method';
                            if (member.type) type = member.type.getText(sourceFile);
                        } else if (ts.isGetAccessorDeclaration(member)) {
                            kind = 'getter';
                            if (member.type) type = member.type.getText(sourceFile);
                        } else if (ts.isSetAccessorDeclaration(member)) {
                            kind = 'setter';
                            if (member.parameters.length > 0 && member.parameters[0].type) {
                                type = member.parameters[0].type.getText(sourceFile);
                            }
                        }
                        result = { filePath, line: pos.line, character: pos.character, type, kind };
                        return;
                    }
                }
                // Check constructor parameter properties
                for (const member of node.members) {
                    if (result) return;
                    if (ts.isConstructorDeclaration(member)) {
                        for (const param of member.parameters) {
                            const paramMods = ts.getModifiers(param);
                            if (!paramMods) continue;
                            if (!isParameterProperty(paramMods)) continue;
                            if (!param.name || !ts.isIdentifier(param.name)) continue;
                            if (param.name.text === memberName) {
                                const pos = sourceFile.getLineAndCharacterOfPosition(param.name.getStart(sourceFile));
                                let type = 'any';
                                if (param.type) type = param.type.getText(sourceFile);
                                result = { filePath, line: pos.line, character: pos.character, type, kind: 'property' };
                                return;
                            }
                        }
                    }
                }
            } else {
                const shapeMembers = getObjectShapeMembers(node, cleanType);
                if (!shapeMembers) return;
                for (const member of shapeMembers) {
                    if (!member.name) continue;
                    const nameText = member.name.getText(sourceFile);
                    if (nameText !== memberName) continue;
                    const pos = sourceFile.getLineAndCharacterOfPosition(member.name.getStart(sourceFile));
                    let type = 'any';
                    let kind = 'property';
                    if (ts.isPropertySignature(member)) {
                        if (member.type) type = member.type.getText(sourceFile);
                    } else if (ts.isMethodSignature(member)) {
                        kind = 'method';
                        if (member.type) type = member.type.getText(sourceFile);
                    }
                    result = { filePath, line: pos.line, character: pos.character, type, kind };
                    return;
                }
            }
        });

        return result;
    }

    /**
     * Get all members of a type by name (works for interfaces, type aliases with object shapes,
     * and classes — including those NOT decorated with decorators).
     * Uses the typeIndex built during analysis.
     */
    getTypeMembers(typeName: string): ClassMember[] | undefined {
        const cleanType = typeName.replace(/<.*>/, '').replace(/\[\]$/, '').replace(/\s*\|.*$/, '').trim();
        if (!cleanType) return undefined;

        // First check if it's a registered entity — use its TemplateAssociation members if available
        for (const assocs of this.tsToAssociations.values()) {
            for (const assoc of assocs) {
                if (assoc.className === cleanType && assoc.members.length > 0) {
                    return assoc.members;
                }
            }
        }

        // Look up in the type index — scan each candidate file until the
        // declaration is found (same-named types can live in multiple files).
        for (const filePath of this.typeIndex.get(cleanType) ?? []) {
            const members = this.getTypeMembersInFile(filePath, cleanType);
            if (members) return members;
        }
        return undefined;
    }

    private getTypeMembersInFile(filePath: string, cleanType: string): ClassMember[] | undefined {
        const sourceFile = this.getSourceFile(filePath);
        if (!sourceFile) return undefined;
        const members: ClassMember[] = [];

        ts.forEachChild(sourceFile, (node) => {
            if (members.length > 0) return; // already found
            if (ts.isClassDeclaration(node) && node.name?.text === cleanType) {
                members.push(...this.extractMembers(node, sourceFile));
                return;
            }
            const shapeMembers = getObjectShapeMembers(node, cleanType);
            if (!shapeMembers) return;
            for (const member of shapeMembers) {
                if (ts.isPropertySignature(member) && member.name) {
                    const nameText = member.name.getText(sourceFile);
                    const pos = sourceFile.getLineAndCharacterOfPosition(member.name.getStart(sourceFile));
                    let type = 'any';
                    if (member.type) type = member.type.getText(sourceFile);
                    members.push({ name: nameText, kind: 'property', type, line: pos.line, character: pos.character, offset: member.getStart(), isPublic: true });
                } else if (ts.isMethodSignature(member) && member.name) {
                    const nameText = member.name.getText(sourceFile);
                    const pos = sourceFile.getLineAndCharacterOfPosition(member.name.getStart(sourceFile));
                    let type = 'any';
                    if (member.type) type = member.type.getText(sourceFile);
                    members.push({ name: nameText, kind: 'method', type, line: pos.line, character: pos.character, offset: member.getStart(), isPublic: true });
                }
            }
        });

        return members.length > 0 ? members : undefined;
    }

    /**
     * Get the signature of a method in a class (reads source and extracts the declaration text).
     * Returns the full method signature string or undefined.
     */
    getMethodSignature(className: string, methodName: string): string | undefined {
        const entity = this.registeredEntities.find(e => e.className === className);
        if (!entity) return undefined;

        const sourceFile = this.getSourceFile(entity.tsFilePath);
        if (!sourceFile) return undefined;
        let signature: string | undefined;

        ts.forEachChild(sourceFile, (node) => {
            if (signature) return;
            if (ts.isClassDeclaration(node) && node.name?.text === className) {
                for (const member of node.members) {
                    if (ts.isMethodDeclaration(member) && member.name?.getText(sourceFile) === methodName) {
                        // Build signature: name(params): returnType
                        const params = member.parameters.map(p => p.getText(sourceFile)).join(', ');
                        const returnType = member.type ? member.type.getText(sourceFile) : 'any';
                        signature = `(${params}): ${returnType}`;
                        return;
                    }
                }
            }
        });

        return signature;
    }

    /**
     * Clear all cached data.
     */
    clear(): void {
        this.htmlToTs.clear();
        this.tsToAssociations.clear();
        this.registeredEntities = [];
        this.typeIndex.clear();
        // WeakMaps have no clear(); dropping the references resets all
        // per-LanguageService snapshots in one go.
        this.sourceFileCache.clear();
        this.lastAnalyzedByService = new WeakMap();
        this.lastSeenByService = new WeakMap();
        this.fileClaimCounts.clear();
        this.declChangeTicks.clear();
    }

    /**
     * Remove associations for a specific TS file (for incremental updates).
     */
    removeFile(tsFilePath: string): void {
        const normalized = normalizePath(tsFilePath);
        const associations = this.tsToAssociations.get(normalized) ?? [];

        for (const assoc of associations) {
            if (assoc.htmlFilePath) {
                const htmlNorm = normalizePath(assoc.htmlFilePath);
                const htmlAssocs = this.htmlToTs.get(htmlNorm);
                if (htmlAssocs) {
                    const filtered = htmlAssocs.filter(a => normalizePath(a.tsFilePath) !== normalized);
                    if (filtered.length > 0) {
                        this.htmlToTs.set(htmlNorm, filtered);
                    } else {
                        this.htmlToTs.delete(htmlNorm);
                    }
                }
            }
        }

        this.tsToAssociations.delete(normalized);
        this.registeredEntities = this.registeredEntities.filter(e => normalizePath(e.tsFilePath) !== normalized);
        // Drop the cached AST for this file — content may have changed on disk
        // or in the editor buffer; lazy callers will re-read on next access.
        this.sourceFileCache.delete(normalized);

        // Clean up typeIndex entries pointing to this file.
        // Normalize both sides to handle Windows path case differences between
        // paths from ts.createProgram (via analyzeFiles) and paths from uri.fsPath.
        const typeKeysToDelete: string[] = [];
        for (const [typeName, filePaths] of this.typeIndex) {
            const remaining = filePaths.filter(fp => normalizePath(fp) !== normalized);
            if (remaining.length === 0) {
                typeKeysToDelete.push(typeName);
            } else if (remaining.length !== filePaths.length) {
                this.typeIndex.set(typeName, remaining);
            }
        }
        for (const key of typeKeysToDelete) {
            this.typeIndex.delete(key);
        }
    }

    /** Record that `filePath` declares a type named `typeName` (multimap add). */
    private addToTypeIndex(typeName: string, filePath: string): void {
        const existing = this.typeIndex.get(typeName);
        if (!existing) {
            this.typeIndex.set(typeName, [filePath]);
        } else if (!existing.includes(filePath)) {
            existing.push(filePath);
        }
    }

    // ----- Private analysis -----

    /**
     * Read and parse a TS file once, caching the result. Returns undefined if
     * the file cannot be read. Cache is invalidated by `removeFile`.
     */
    private getSourceFile(filePath: string): ts.SourceFile | undefined {
        const key = normalizePath(filePath);
        const cached = this.sourceFileCache.get(key);
        if (cached) return cached;
        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch {
            return undefined;
        }
        const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.ES2020, true);
        this.sourceFileCache.set(key, sourceFile);
        return sourceFile;
    }

    private analyzeSourceFile(sourceFile: ts.SourceFile, checker: ts.TypeChecker): void {
        const filePath = normalizeSlashes(sourceFile.fileName);

        // Clear any previous analysis of this file first (idempotent — the
        // analyzeWithLanguageService path already did it). Without this, the
        // analyzeFiles/analyzeProgram path DUPLICATED associations and
        // entities: a second analyzeFiles call, or a file reachable from two
        // groups' programs (shared transitive import), registered everything
        // twice.
        this.removeFile(filePath);

        // Prime the cache with the program's parsed source so callers like
        // findMemberInType / getTypeMembers don't re-read+re-parse from disk.
        this.sourceFileCache.set(normalizePath(filePath), sourceFile);

        ts.forEachChild(sourceFile, (node) => {
            if (ts.isClassDeclaration(node) && node.name) {
                this.addToTypeIndex(node.name.text, filePath);
                const decorators = this.getDecorators(node);
                for (const dec of decorators) {
                    const association = this.processDecoratorCore(dec, node, sourceFile, filePath, checker);
                    if (association) {
                        this.registerAssociation(association);
                    }
                }
            } else if (ts.isInterfaceDeclaration(node) && node.name) {
                this.addToTypeIndex(node.name.text, filePath);
            } else if (ts.isTypeAliasDeclaration(node) && node.name) {
                this.addToTypeIndex(node.name.text, filePath);
            }
        });

        this.scanForTemplateRegistrations(sourceFile, filePath);
    }

    /**
     * Basic analysis without type checker (for quick incremental updates).
     */
    private analyzeSourceFileBasic(sourceFile: ts.SourceFile): void {
        const filePath = normalizeSlashes(sourceFile.fileName);

        // Remove old data for this file
        this.removeFile(filePath);

        // Prime the source-file cache with the freshly-parsed buffer so later
        // providers don't re-read stale disk content for an unsaved edit.
        this.sourceFileCache.set(normalizePath(filePath), sourceFile);

        ts.forEachChild(sourceFile, (node) => {
            if (ts.isClassDeclaration(node) && node.name) {
                this.addToTypeIndex(node.name.text, filePath);
                const decorators = this.getDecorators(node);
                for (const dec of decorators) {
                    const association = this.processDecoratorCore(dec, node, sourceFile, filePath);
                    if (association) {
                        this.registerAssociation(association);
                    }
                }
            } else if (ts.isInterfaceDeclaration(node) && node.name) {
                this.addToTypeIndex(node.name.text, filePath);
            } else if (ts.isTypeAliasDeclaration(node) && node.name) {
                this.addToTypeIndex(node.name.text, filePath);
            }
        });

        this.scanForTemplateRegistrations(sourceFile, filePath);
    }

    /**
     * Register `$Template('name', …)` calls as 'template' entities so
     * `nb-template="@name"` completion and navigation resolve global template
     * names. Previously nothing ever produced 'template' entities, so both
     * features were dead. Calls may appear at module scope or nested inside
     * decorator metadata arrays — walk the whole file.
     */
    private scanForTemplateRegistrations(sourceFile: ts.SourceFile, filePath: string): void {
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                node.expression.text === '$Template' &&
                node.arguments.length >= 1) {
                const nameArg = node.arguments[0];
                if (ts.isStringLiteral(nameArg) || ts.isNoSubstitutionTemplateLiteral(nameArg)) {
                    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
                    this.registeredEntities.push({
                        name: nameArg.text,
                        type: 'template',
                        tsFilePath: filePath,
                        className: nameArg.text,
                        line: pos.line,
                        character: pos.character,
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }

    private getDecorators(node: ts.ClassDeclaration): ts.Decorator[] {
        const result: ts.Decorator[] = [];
        if (ts.canHaveDecorators(node)) {
            const mods = ts.getDecorators(node);
            if (mods) {
                result.push(...mods);
            }
        }
        return result;
    }

    private processDecoratorCore(
        decorator: ts.Decorator,
        classNode: ts.ClassDeclaration,
        sourceFile: ts.SourceFile,
        filePath: string,
        checker?: ts.TypeChecker
    ): TemplateAssociation | null {
        if (!ts.isCallExpression(decorator.expression)) return null;

        const decoratorExpr = decorator.expression;
        const decoratorName = this.getDecoratorName(decoratorExpr);
        if (!decoratorName) return null;

        const templateDecorators = ['Container', 'Component', 'AppRoot'];
        const entityDecorators = ['Aspect', 'Transformer', 'Injectable'];

        // @AppRoot is deliberately excluded: the runtime's AppRoot decorator
        // only calls Environment.setupRouter + Environment.addApp — it never
        // registers the class as a container, so offering it for
        // nb-container="@…" completion/navigation blessed a name that can
        // never resolve at runtime. (The template ASSOCIATION below still
        // covers AppRoot for member/template features.)
        if ((templateDecorators.includes(decoratorName) && decoratorName !== 'AppRoot') || entityDecorators.includes(decoratorName)) {
            const className = classNode.name?.text ?? 'Anonymous';
            const customName = this.extractCustomEntityName(decoratorExpr, decoratorName);
            const entityPos = sourceFile.getLineAndCharacterOfPosition(classNode.getStart());
            const entity: RegisteredEntity = {
                // The name the runtime registers — what templates reference.
                name: computeRegisteredEntityName(decoratorName, className, customName),
                type: this.decoratorToEntityType(decoratorName),
                tsFilePath: filePath,
                className,
                line: entityPos.line,
                character: entityPos.character,
            };
            // For transformers, the registered name IS the function name used
            // in expressions (Environment.addTransformer camelCases both
            // custom and default names).
            if (decoratorName === 'Transformer') {
                entity.transformerFunctionName = entity.name;
            }
            this.registeredEntities.push(entity);
        }

        if (!templateDecorators.includes(decoratorName)) return null;
        if (decoratorExpr.arguments.length === 0 && decoratorName !== 'AppRoot') return null;

        const className = classNode.name!.text;
        const classPos = sourceFile.getLineAndCharacterOfPosition(classNode.getStart());
        const members = this.extractMembers(classNode, sourceFile, checker);

        // @AppRoot string arguments are an element selector or a route config
        // (never a template) — running them through resolveTemplateArg
        // misclassified e.g. '#app' as an inline template and suppressed the
        // index.html fallback below.
        const htmlInfo = decoratorName === 'AppRoot'
            ? null
            : this.resolveTemplateArg(decoratorExpr, sourceFile, filePath);

        // For @AppRoot, if no explicit template was resolved, look for index.html in the same directory
        let htmlFilePath = htmlInfo?.filePath;
        if (!htmlFilePath && !htmlInfo?.inline && decoratorName === 'AppRoot') {
            const dir = path.dirname(filePath);
            const candidates = ['index.html', 'index.htm', 'index.xhtml', 'app.html', 'app.htm', 'app.xhtml'];
            for (const name of candidates) {
                const candidate = path.resolve(dir, name);
                try {
                    if (fs.existsSync(candidate)) {
                        htmlFilePath = normalizeSlashes(candidate);
                        break;
                    }
                } catch {
                    // ignore
                }
            }
        }

        return {
            tsFilePath: filePath,
            className,
            decoratorType: decoratorName,
            htmlFilePath,
            inlineTemplate: htmlInfo?.inline,
            classOffset: classNode.getStart(),
            classLine: classPos.line,
            classCharacter: classPos.character,
            members,
        };
    }

    /**
     * Extract a custom entity name from decorator arguments.
     * `@Transformer('name')` carries it as the first string argument;
     * Container / Component / Aspect only via the `['name', template]` array
     * form (a bare string argument there is the template itself).
     */
    private extractCustomEntityName(decoratorExpr: ts.CallExpression, decoratorName: string): string | undefined {
        if (decoratorExpr.arguments.length === 0) return undefined;
        const firstArg = decoratorExpr.arguments[0];

        if (decoratorName === 'Transformer') {
            if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
                return firstArg.text;
            }
            return undefined;
        }

        if (ts.isArrayLiteralExpression(firstArg) && firstArg.elements.length >= 2) {
            const nameElement = firstArg.elements[0];
            if (ts.isStringLiteral(nameElement) || ts.isNoSubstitutionTemplateLiteral(nameElement)) {
                return nameElement.text;
            }
        }
        return undefined;
    }

    private getDecoratorName(callExpr: ts.CallExpression): string | null {
        if (ts.isIdentifier(callExpr.expression)) {
            return callExpr.expression.text;
        }
        if (ts.isPropertyAccessExpression(callExpr.expression)) {
            return callExpr.expression.name.text;
        }
        return null;
    }

    private decoratorToEntityType(name: string): RegisteredEntity['type'] {
        switch (name) {
            case 'Container': return 'container';
            case 'Component': return 'component';
            case 'Aspect': return 'aspect';
            case 'Transformer': return 'transformer';
            case 'Injectable': return 'injectable';
            case 'AppRoot': return 'container';
            default: return 'container';
        }
    }

    private resolveTemplateArg(
        decoratorExpr: ts.CallExpression,
        sourceFile: ts.SourceFile,
        filePath: string
    ): { filePath?: string; inline?: string } | null {
        if (decoratorExpr.arguments.length === 0) return null;

        const firstArg = decoratorExpr.arguments[0];

        // String literal → template path (e.g. './card.html') or inline markup
        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
            const asPath = this.resolveTemplatePathLiteral(firstArg.text, filePath);
            if (asPath) return { filePath: asPath };
            return { inline: firstArg.text };
        }

        // Identifier → imported HTML file
        if (ts.isIdentifier(firstArg)) {
            const importPath = this.resolveImportedIdentifier(firstArg.text, sourceFile, filePath);
            if (importPath) {
                return { filePath: importPath };
            }
        }

        // Array literal → [name, template]
        if (ts.isArrayLiteralExpression(firstArg) && firstArg.elements.length >= 2) {
            const second = firstArg.elements[1];
            if (ts.isIdentifier(second)) {
                const importPath = this.resolveImportedIdentifier(second.text, sourceFile, filePath);
                if (importPath) return { filePath: importPath };
            }
            // Backtick templates are the natural multi-line inline form —
            // the non-array path accepts both string kinds, so must this one.
            if (ts.isStringLiteral(second) || ts.isNoSubstitutionTemplateLiteral(second)) {
                const asPath = this.resolveTemplatePathLiteral(second.text, filePath);
                if (asPath) return { filePath: asPath };
                return { inline: second.text };
            }
        }

        return null;
    }

    /**
     * The framework accepts a string template argument that is a *path* to an
     * HTML file rather than inline markup. Markup always contains '<'; paths
     * end in an HTML-ish extension. Resolve relative to the declaring TS file;
     * only an existing file is accepted (the runtime may also resolve paths
     * against the served root, which we cannot know — existence is the safe
     * signal). Returns undefined when the string should be treated as inline.
     */
    private resolveTemplatePathLiteral(text: string, fromFile: string): string | undefined {
        const trimmed = text.trim();
        if (!trimmed || trimmed.includes('<') || trimmed.includes('\n')) return undefined;
        if (!/\.(html?|xhtml)$/i.test(trimmed)) return undefined;
        try {
            const resolved = path.resolve(path.dirname(fromFile), trimmed);
            if (fs.existsSync(resolved)) return normalizeSlashes(resolved);
        } catch {
            // unreadable fs — treat as inline
        }
        return undefined;
    }

    private resolveImportedIdentifier(identName: string, sourceFile: ts.SourceFile, filePath: string): string | null {
        // Search import declarations for the identifier
        for (const stmt of sourceFile.statements) {
            if (!ts.isImportDeclaration(stmt)) continue;
            if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;

            const modulePath = stmt.moduleSpecifier.text;

            // Check default import
            if (stmt.importClause?.name?.text === identName) {
                return this.resolveModulePath(modulePath, filePath);
            }

            // Check named imports
            if (stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
                for (const spec of stmt.importClause.namedBindings.elements) {
                    if (spec.name.text === identName) {
                        return this.resolveModulePath(modulePath, filePath);
                    }
                }
            }
        }
        return null;
    }

    private resolveModulePath(modulePath: string, fromFile: string): string {
        const dir = path.dirname(fromFile);
        const resolved = path.resolve(dir, modulePath);
        if (!path.extname(resolved)) {
            // Try with common extensions, check if file exists
            for (const ext of ['.html', '.ts', '.js']) {
                const candidate = resolved + ext;
                try {
                    if (fs.existsSync(candidate)) {
                        return normalizeSlashes(candidate);
                    }
                } catch {
                    // ignore
                }
            }
            // Fallback to .html if nothing found
            return normalizeSlashes(resolved + '.html');
        }
        return normalizeSlashes(resolved);
    }

    private extractMembers(
        classNode: ts.ClassDeclaration,
        sourceFile: ts.SourceFile,
        checker?: ts.TypeChecker
    ): ClassMember[] {
        const members: ClassMember[] = [];

        for (const member of classNode.members) {
            if (!member.name) continue;
            // Static members live on the constructor, not the instance —
            // template expressions run with `.apply(instance)`, so `this.X`
            // can never reach them. Listing them offered dead completions and
            // let diagnostics silently accept `this.someStatic`.
            if (this.hasStaticModifier(member)) continue;
            // ECMAScript #private fields are unreachable from template
            // expressions (`new Function` code outside the class can't even
            // parse `this.#x`) — surfacing them offered completions that are
            // a syntax error when accepted.
            if (ts.isPrivateIdentifier(member.name)) continue;
            const nameText = member.name.getText(sourceFile);
            // Anchor positions on the member NAME, not the declaration start —
            // `member.getStart()` points at modifiers/decorators (`public`,
            // `@Detector()`), which made rename replace the wrong characters
            // and navigation land on the modifier.
            const nameStart = member.name.getStart(sourceFile);
            const pos = sourceFile.getLineAndCharacterOfPosition(nameStart);
            const isPublic = !this.hasPrivateModifier(member);

            let kind: ClassMember['kind'];
            let type = 'any';

            if (ts.isPropertyDeclaration(member)) {
                kind = 'property';
                if (member.type) {
                    type = member.type.getText(sourceFile);
                } else if (checker) {
                    try {
                        const symbol = checker.getSymbolAtLocation(member.name);
                        if (symbol) {
                            type = checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, member));
                        }
                    } catch {
                        // ignore
                    }
                }
            } else if (ts.isMethodDeclaration(member)) {
                kind = 'method';
                if (member.type) type = member.type.getText(sourceFile);
            } else if (ts.isGetAccessorDeclaration(member)) {
                kind = 'getter';
                if (member.type) type = member.type.getText(sourceFile);
            } else if (ts.isSetAccessorDeclaration(member)) {
                kind = 'setter';
                if (member.parameters.length > 0 && member.parameters[0].type) {
                    type = member.parameters[0].type.getText(sourceFile);
                }
            } else {
                continue;
            }

            members.push({
                name: nameText,
                kind,
                type,
                line: pos.line,
                character: pos.character,
                offset: nameStart,
                isPublic,
            });
        }

        // Constructor parameter properties. ANY of public/protected/private/
        // readonly creates an instance property — and `constructor(private
        // changeDetector: ChangeDetector)` is the standard nuBond DI style.
        // Expressions run with `.apply(context)`, so templates can reference
        // private params at runtime; excluding them produced false
        // "Property does not exist" diagnostics. `isPublic` mirrors the
        // property-declaration rule: only `private` marks a member non-public.
        for (const member of classNode.members) {
            if (ts.isConstructorDeclaration(member)) {
                for (const param of member.parameters) {
                    const paramMods = ts.getModifiers(param);
                    if (!paramMods) continue;
                    if (!isParameterProperty(paramMods)) continue;
                    if (!param.name || !ts.isIdentifier(param.name)) continue;

                    // Anchor on the parameter NAME — param.getStart() points
                    // at the visibility modifier ('public x' would have its
                    // 'public' keyword renamed/highlighted otherwise).
                    const nameStart = param.name.getStart(sourceFile);
                    const pos = sourceFile.getLineAndCharacterOfPosition(nameStart);
                    const isPublic = !paramMods.some(m => m.kind === ts.SyntaxKind.PrivateKeyword);
                    let type = 'any';
                    if (param.type) type = param.type.getText(sourceFile);

                    members.push({
                        name: param.name.text,
                        kind: 'property',
                        type,
                        line: pos.line,
                        character: pos.character,
                        offset: nameStart,
                        isPublic,
                    });
                }
            }
        }

        this.collectInheritedMembers(classNode, members, checker);

        return members;
    }

    /**
     * Append members inherited from base classes (BUG: previously invisible,
     * causing false "Property does not exist" diagnostics and missing
     * completions for anything declared on a base class). Requires the
     * TypeChecker — the checker-less `analyzeSourceText` path cannot resolve
     * heritage and simply keeps own members only.
     */
    private collectInheritedMembers(
        classNode: ts.ClassDeclaration,
        members: ClassMember[],
        checker?: ts.TypeChecker
    ): void {
        if (!checker || !classNode.name) return;
        try {
            const classSymbol = checker.getSymbolAtLocation(classNode.name);
            if (!classSymbol) return;
            const instanceType = checker.getDeclaredTypeOfSymbol(classSymbol);

            for (const symbol of instanceType.getProperties()) {
                const name = symbol.getName();
                // Skip mangled/private-identifier names and anything already collected
                if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
                if (members.some(m => m.name === name)) continue;

                const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
                if (!decl) continue;
                // Own members (incl. constructor params) were collected above
                if (decl.parent === classNode) continue;
                if (ts.isParameter(decl) && decl.parent?.parent === classNode) continue;

                const declFile = decl.getSourceFile();
                // Skip default-lib members (Object.prototype etc. don't reach
                // here via the declared type, but guard against lib mixins)
                if (/lib\.[^/\\]*\.d\.ts$/.test(declFile.fileName)) continue;

                let kind: ClassMember['kind'] = 'property';
                if (ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl)) kind = 'method';
                else if (ts.isGetAccessorDeclaration(decl)) kind = 'getter';
                else if (ts.isSetAccessorDeclaration(decl)) kind = 'setter';

                const nameNode = (decl as ts.NamedDeclaration).name ?? decl;
                const nameStart = nameNode.getStart(declFile);
                const pos = declFile.getLineAndCharacterOfPosition(nameStart);

                let isPublic = true;
                if (ts.canHaveModifiers(decl)) {
                    const mods = ts.getModifiers(decl);
                    if (mods?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)) isPublic = false;
                }

                let type = 'any';
                try {
                    type = checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, classNode));
                } catch {
                    // keep 'any'
                }

                members.push({
                    name,
                    kind,
                    type,
                    line: pos.line,
                    character: pos.character,
                    offset: nameStart,
                    isPublic,
                    declaredIn: normalizeSlashes(declFile.fileName),
                });
            }
        } catch {
            // Checker hiccups must not break basic (own-member) extraction
        }
    }

    private hasPrivateModifier(member: ts.ClassElement): boolean {
        const mods = ts.getModifiers(member as ts.HasModifiers);
        if (!mods) return false;
        return mods.some(m => m.kind === ts.SyntaxKind.PrivateKeyword);
    }

    private hasStaticModifier(member: ts.ClassElement): boolean {
        const mods = ts.getModifiers(member as ts.HasModifiers);
        if (!mods) return false;
        return mods.some(m => m.kind === ts.SyntaxKind.StaticKeyword);
    }

    /**
     * True when any member of this file's associations is declared in a file
     * whose text changed (identity check failed) after `analyzedAt`. Those
     * member records carry the declaring file's offsets/lines from an older
     * parse — stale for rename fan-out and TS-rename delegation.
     */
    private hasStaleDeclarationDependency(fileKey: string, analyzedAt: number): boolean {
        const assocs = this.tsToAssociations.get(fileKey);
        if (!assocs) return false;
        for (const assoc of assocs) {
            for (const member of assoc.members) {
                if (!member.declaredIn) continue;
                const depKey = normalizePath(member.declaredIn);
                if (depKey === fileKey) continue;
                const changedAt = this.declChangeTicks.get(depKey);
                if (changedAt !== undefined && changedAt > analyzedAt) return true;
            }
        }
        return false;
    }

    private registerAssociation(assoc: TemplateAssociation): void {
        const tsNorm = normalizePath(assoc.tsFilePath);

        if (!this.tsToAssociations.has(tsNorm)) {
            this.tsToAssociations.set(tsNorm, []);
        }
        this.tsToAssociations.get(tsNorm)!.push(assoc);

        if (assoc.htmlFilePath) {
            const htmlNorm = normalizePath(assoc.htmlFilePath);
            if (!this.htmlToTs.has(htmlNorm)) {
                this.htmlToTs.set(htmlNorm, []);
            }
            this.htmlToTs.get(htmlNorm)!.push(assoc);
        }
    }
}

/** One service's analysis snapshot of a file: the AST identity + when. */
interface AnalyzedFileRecord {
    sourceFile: ts.SourceFile;
    /** `analysisTick` value of the pass that analyzed this file. */
    analyzedAt: number;
}

/**
 * The member list of an interface OR a type alias with an object shape
 * (`type X = { … }`) matching `cleanType`. The type-alias half was always
 * promised by getTypeMembers' doc comment (and typeIndex records alias
 * declarations), but only interface branches existed — `this.x.` with
 * `x: SomeAliasShape` silently yielded no members.
 */
function getObjectShapeMembers(node: ts.Node, cleanType: string): readonly ts.TypeElement[] | undefined {
    if (ts.isInterfaceDeclaration(node) && node.name.text === cleanType) {
        return node.members;
    }
    if (ts.isTypeAliasDeclaration(node) && node.name.text === cleanType && ts.isTypeLiteralNode(node.type)) {
        return node.type.members;
    }
    return undefined;
}

/**
 * Case folding is only valid where the file system is case-insensitive —
 * on Linux `Foo.ts` and `foo.ts` are DIFFERENT files, and folding both to
 * one key made removeFile on one wipe the other's associations. Defaults to
 * folding (the historical behavior) if `ts.sys` is unavailable.
 */
const FOLD_PATH_CASE = !(ts.sys?.useCaseSensitiveFileNames ?? false);

function normalizePath(p: string): string {
    const forward = p.replace(/\\/g, '/');
    return FOLD_PATH_CASE ? forward.toLowerCase() : forward;
}

/**
 * True when a constructor parameter's modifiers make it a parameter property
 * (an instance member): any of public / protected / private / readonly.
 */
export function isParameterProperty(mods: readonly ts.Modifier[]): boolean {
    return mods.some(m =>
        m.kind === ts.SyntaxKind.PublicKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword ||
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.ReadonlyKeyword
    );
}

/** Mirror of the framework's `Helpers.toCamelCase` (first char lowercased). */
function toCamelCaseName(value: string): string {
    return value.charAt(0).toLowerCase() + value.slice(1);
}

/** Mirror of `Helpers.fromCamelToKebabCase(Helpers.toCamelCase(value))`. */
function toKebabCaseName(value: string): string {
    return toCamelCaseName(value).replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

/**
 * Compute the name the framework registers an entity under at runtime —
 * mirrors `Environment.addContainer` / `addComponent` / `addAspect` /
 * `addTransformer`:
 * - containers: custom name or class name, verbatim;
 * - components/aspects: custom names containing '-' pass through verbatim,
 *   everything else (custom or class name) is camelCased then kebab-cased
 *   (`DragHandle` → `drag-handle`);
 * - transformers: camelCase of the custom or class name.
 */
export function computeRegisteredEntityName(decoratorName: string, className: string, customName?: string): string {
    switch (decoratorName) {
        case 'Container':
            return customName ?? className;
        case 'Component':
        case 'Aspect':
            if (customName) {
                return customName.indexOf('-') > 0 ? customName : toKebabCaseName(customName);
            }
            return toKebabCaseName(className);
        case 'Transformer':
            return toCamelCaseName(customName ?? className);
        default:
            return className;
    }
}

function normalizeSlashes(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Used when a workspace has no tsconfig.json or its tsconfig fails to parse.
 * `experimentalDecorators` matches runtime semantics; `allowJs` lets
 * us index .js companions; the lax `target`/`module` keep the scan working
 * even on projects with no compiler config at all.
 */
const FALLBACK_COMPILER_OPTIONS: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    experimentalDecorators: true,
    allowJs: true,
    noEmit: true,
};

/** A grouping of files that should be compiled together with shared options. */
export interface ProgramGroup {
    files: string[];
    options: ts.CompilerOptions;
}

/**
 * Group files by the nearest tsconfig.json and resolve that project's
 * compiler options. Exposed (separate from `analyzeFiles`) so tests can
 * assert the dispatch shape — what files end up under which options —
 * without needing to mock `ts.createProgram`, whose exports are getter-only
 * and resist `jest.spyOn`.
 */
export function resolveProgramGroups(filePaths: string[]): ProgramGroup[] {
    // Memoize per-directory resolution so a 5,000-file workspace doesn't
    // walk every directory twice via `ts.findConfigFile`.
    const dirToConfig = new Map<string, string | undefined>();
    const groups = new Map<string | 'default', string[]>();
    for (const file of filePaths) {
        const dir = path.dirname(file);
        let configPath: string | undefined;
        if (dirToConfig.has(dir)) {
            configPath = dirToConfig.get(dir);
        } else {
            configPath = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json');
            dirToConfig.set(dir, configPath);
        }
        const key = configPath ?? 'default';
        const list = groups.get(key);
        if (list) list.push(file); else groups.set(key, [file]);
    }

    const result: ProgramGroup[] = [];
    for (const [key, files] of groups) {
        const projectOptions = key === 'default' ? undefined : parseProjectTsConfig(key);
        const options: ts.CompilerOptions = {
            ...(projectOptions ?? FALLBACK_COMPILER_OPTIONS),
            // Force regardless of project: we never emit, and skipLibCheck
            // means a buggy ambient @types package can't break our scan.
            noEmit: true,
            skipLibCheck: true,
        };
        result.push({ files, options });
    }
    return result;
}

/**
 * Memoized parse of `tsconfig.json` paths → resolved `ts.CompilerOptions`.
 * Keyed by absolute config path. A repository with a single tsconfig is
 * parsed exactly once across the whole initial scan; multi-root workspaces
 * pay the parse cost once per root.
 */
const parsedConfigCache = new Map<string, ts.CompilerOptions | undefined>();

/**
 * Read and parse a `tsconfig.json` into resolved `ts.CompilerOptions`.
 * Returns `undefined` on any read/parse error so the caller can fall back to
 * `FALLBACK_COMPILER_OPTIONS` instead of failing the whole scan.
 */
function parseProjectTsConfig(configPath: string): ts.CompilerOptions | undefined {
    if (parsedConfigCache.has(configPath)) {
        return parsedConfigCache.get(configPath);
    }
    let result: ts.CompilerOptions | undefined;
    try {
        const read = ts.readConfigFile(configPath, ts.sys.readFile);
        if (read.error) {
            // Don't log — `read.error` is normal for invalid JSON in user
            // tsconfigs and the caller already falls back gracefully.
        } else if (read.config) {
            const parsed = ts.parseJsonConfigFileContent(
                read.config,
                ts.sys,
                path.dirname(configPath),
            );
            // We tolerate parse diagnostics — the user's project may have
            // unrelated type errors. We only need `parsed.options` to be a
            // best-effort approximation of what tsserver would use.
            result = parsed.options;
        }
    } catch (err) {
        // Unexpected — readConfigFile and parseJsonConfigFileContent return
        // diagnostics for normal failure modes; an actual throw indicates a
        // serious problem (e.g. corrupt fs handle) worth logging.
        logError(`parseProjectTsConfig(${configPath})`, err);
    }
    parsedConfigCache.set(configPath, result);
    return result;
}

/**
 * Clear the memoized tsconfig parse results. Wired into the restart-server
 * command so edits to tsconfig.json are picked up without a window reload.
 */
export function clearTsConfigCache(): void {
    parsedConfigCache.clear();
}

/** Test-only alias kept for existing specs. */
export function _clearTsConfigCacheForTest(): void {
    clearTsConfigCache();
}
