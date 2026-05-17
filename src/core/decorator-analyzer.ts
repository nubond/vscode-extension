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
    name: string;
    type: 'container' | 'component' | 'aspect' | 'transformer' | 'template' | 'injectable';
    tsFilePath: string;
    className: string;
    /** For transformers: the function name used in expressions (e.g. 'localize' for class Localize) */
    transformerFunctionName?: string;
}

export class DecoratorAnalyzer {
    /** Map: HTML file path (normalized) → TemplateAssociation[] */
    private htmlToTs = new Map<string, TemplateAssociation[]>();
    /** Map: TS file path (normalized) → TemplateAssociation[] */
    private tsToAssociations = new Map<string, TemplateAssociation[]>();
    /** All registered entities (containers, components, aspects, transformers) */
    private registeredEntities: RegisteredEntity[] = [];
    /** Index of all interface/type/class definitions found in source files: name → filePath */
    private typeIndex = new Map<string, string>();
    /**
     * Cache of parsed `ts.SourceFile`s keyed by normalized path. Hover, completion
     * and definition each call findMemberInType / findMemberWithType / etc.
     * which previously did `fs.readFileSync` + `ts.createSourceFile` per call —
     * a chain like `this.user.address.city.zip` would re-parse 4 different files
     * on every keystroke, multiplied across providers. Invalidated by removeFile.
     */
    private sourceFileCache = new Map<string, ts.SourceFile>();
    /**
     * Last-seen `ts.SourceFile` reference per analyzed TS file path. Used by
     * `analyzeWithLanguageService` to detect which files actually changed
     * between two `ls.getProgram()` calls — TypeScript's LanguageService
     * returns the *same* `SourceFile` object for unchanged files, so a simple
     * reference check is enough to skip re-analysis. This is the foundation
     * of the incremental, type-checked update path that replaces the
     * `analyzeSourceText` fallback (which lost inferred types on every edit).
     */
    private lastAnalyzedSourceFiles = new Map<string, ts.SourceFile>();

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
     * Returns the list of file paths that were re-analyzed. Empty result on
     * a no-op call (LanguageService not ready yet, or nothing changed).
     */
    analyzeWithLanguageService(languageService: ts.LanguageService): string[] {
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
            return [];
        }
        if (!program) return [];

        let checker: ts.TypeChecker;
        try {
            checker = program.getTypeChecker();
        } catch (err) {
            logError('analyzeWithLanguageService.getTypeChecker', err);
            return [];
        }

        const reanalyzed: string[] = [];
        const seen = new Set<string>();

        let sourceFiles: readonly ts.SourceFile[];
        try {
            sourceFiles = program.getSourceFiles();
        } catch (err) {
            logError('analyzeWithLanguageService.getSourceFiles', err);
            return [];
        }

        for (const sourceFile of sourceFiles) {
            if (sourceFile.isDeclarationFile) continue;
            if (sourceFile.fileName.includes('node_modules')) continue;

            const key = normalizePath(sourceFile.fileName);
            seen.add(key);

            // Skip files whose SourceFile reference hasn't changed — the
            // LanguageService didn't re-parse them, so our analysis is fresh.
            const prev = this.lastAnalyzedSourceFiles.get(key);
            if (prev === sourceFile) continue;

            // Per-file try/catch: a single broken source file (e.g. one that
            // hits a bug in `extractMembers`) must not stop us analyzing the
            // rest of the workspace. Without this, a single rogue file could
            // cripple every provider for every other file.
            try {
                this.removeFile(sourceFile.fileName);
                this.lastAnalyzedSourceFiles.set(key, sourceFile);
                this.analyzeSourceFile(sourceFile, checker);
                reanalyzed.push(sourceFile.fileName);
            } catch (err) {
                // Leave the file marked as "seen" so we don't try to re-analyze
                // it in tight loops. The user can recover by editing the file
                // (which bumps its SourceFile reference) or via restart.
                logError(`analyzeWithLanguageService.perFile(${sourceFile.fileName})`, err);
            }
        }

        // Detect files removed since the last call — they're no longer in the
        // program's SourceFile list. Drop their analyzer state too, otherwise
        // we'd accumulate stale associations across deletes.
        for (const [key, _sf] of this.lastAnalyzedSourceFiles) {
            if (!seen.has(key)) {
                try {
                    this.removeFile(key);
                } catch (err) {
                    // removeFile is internal — a throw here would indicate
                    // map corruption, which is worth flagging.
                    logError(`analyzeWithLanguageService.removeStaleFile(${key})`, err);
                }
                this.lastAnalyzedSourceFiles.delete(key);
            }
        }

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

        // Find entity with matching class name, or fall back to type index
        const entity = this.registeredEntities.find(e => e.className === cleanType);
        const filePath = entity?.tsFilePath ?? this.typeIndex.get(cleanType);
        if (!filePath) return undefined;

        const sourceFile = this.getSourceFile(filePath);
        if (!sourceFile) return undefined;

        // Find the class/interface and the member
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
            } else if (ts.isInterfaceDeclaration(node) && node.name.text === cleanType) {
                for (const member of node.members) {
                    if (member.name && member.name.getText(sourceFile) === memberName) {
                        const pos = sourceFile.getLineAndCharacterOfPosition(member.name.getStart(sourceFile));
                        result = { filePath, line: pos.line, character: pos.character };
                        return;
                    }
                }
            }
        });

        return result;
    }

    /**
     * Find a member declaration in a type and return position + type info.
     * Used for chained member resolution (e.g. this.iptvs.data → resolve 'data' in IPTVs).
     * Searches registered entities first, then the type index for interfaces/plain classes.
     */
    findMemberWithType(typeName: string, memberName: string): { filePath: string; line: number; character: number; type: string; kind: string } | undefined {
        const cleanType = typeName.replace(/<.*>/, '').replace(/\[\]$/, '').replace(/\s*\|.*$/, '').trim();

        // Resolve the file path: check registered entities first, then type index
        const entity = this.registeredEntities.find(e => e.className === cleanType);
        const filePath = entity?.tsFilePath ?? this.typeIndex.get(cleanType);
        if (!filePath) return undefined;

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
                // Check constructor params with visibility modifiers
                for (const member of node.members) {
                    if (result) return;
                    if (ts.isConstructorDeclaration(member)) {
                        for (const param of member.parameters) {
                            const paramMods = ts.getModifiers(param);
                            if (!paramMods) continue;
                            const hasVisibility = paramMods.some(m =>
                                m.kind === ts.SyntaxKind.PublicKeyword ||
                                m.kind === ts.SyntaxKind.ProtectedKeyword
                            );
                            if (!hasVisibility) continue;
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
            } else if (ts.isInterfaceDeclaration(node) && node.name.text === cleanType) {
                for (const member of node.members) {
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

        // Look up in the type index
        const filePath = this.typeIndex.get(cleanType);
        if (!filePath) return undefined;

        const sourceFile = this.getSourceFile(filePath);
        if (!sourceFile) return undefined;
        const members: ClassMember[] = [];

        ts.forEachChild(sourceFile, (node) => {
            if (members.length > 0) return; // already found
            if (ts.isInterfaceDeclaration(node) && node.name.text === cleanType) {
                for (const member of node.members) {
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
            } else if (ts.isClassDeclaration(node) && node.name?.text === cleanType) {
                members.push(...this.extractMembers(node, sourceFile));
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
        this.sourceFileCache.clear();
        this.lastAnalyzedSourceFiles.clear();
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
        for (const [typeName, filePath] of this.typeIndex) {
            if (normalizePath(filePath) === normalized) {
                typeKeysToDelete.push(typeName);
            }
        }
        for (const key of typeKeysToDelete) {
            this.typeIndex.delete(key);
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

        // Prime the cache with the program's parsed source so callers like
        // findMemberInType / getTypeMembers don't re-read+re-parse from disk.
        this.sourceFileCache.set(normalizePath(filePath), sourceFile);

        ts.forEachChild(sourceFile, (node) => {
            if (ts.isClassDeclaration(node) && node.name) {
                this.typeIndex.set(node.name.text, filePath);
                const decorators = this.getDecorators(node);
                for (const dec of decorators) {
                    const association = this.processDecoratorCore(dec, node, sourceFile, filePath, checker);
                    if (association) {
                        this.registerAssociation(association);
                    }
                }
            } else if (ts.isInterfaceDeclaration(node) && node.name) {
                this.typeIndex.set(node.name.text, filePath);
            } else if (ts.isTypeAliasDeclaration(node) && node.name) {
                this.typeIndex.set(node.name.text, filePath);
            }
        });
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
                this.typeIndex.set(node.name.text, filePath);
                const decorators = this.getDecorators(node);
                for (const dec of decorators) {
                    const association = this.processDecoratorCore(dec, node, sourceFile, filePath);
                    if (association) {
                        this.registerAssociation(association);
                    }
                }
            } else if (ts.isInterfaceDeclaration(node) && node.name) {
                this.typeIndex.set(node.name.text, filePath);
            } else if (ts.isTypeAliasDeclaration(node) && node.name) {
                this.typeIndex.set(node.name.text, filePath);
            }
        });
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

        if (templateDecorators.includes(decoratorName) || entityDecorators.includes(decoratorName)) {
            const className = classNode.name?.text ?? 'Anonymous';
            const entity: RegisteredEntity = {
                name: className,
                type: this.decoratorToEntityType(decoratorName),
                tsFilePath: filePath,
                className,
            };
            // For transformers, compute the function name used in expressions
            if (decoratorName === 'Transformer') {
                let funcName: string | undefined;
                // Check for @Transformer('customName') — first string argument
                if (decoratorExpr.arguments.length > 0) {
                    const firstArg = decoratorExpr.arguments[0];
                    if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
                        funcName = firstArg.text;
                    }
                }
                // Default: lowercase first char of class name (convention: Helpers.toCamelCase)
                if (!funcName) {
                    funcName = className.charAt(0).toLowerCase() + className.slice(1);
                }
                entity.transformerFunctionName = funcName;
            }
            this.registeredEntities.push(entity);
        }

        if (!templateDecorators.includes(decoratorName)) return null;
        if (decoratorExpr.arguments.length === 0 && decoratorName !== 'AppRoot') return null;

        const className = classNode.name!.text;
        const classPos = sourceFile.getLineAndCharacterOfPosition(classNode.getStart());
        const members = this.extractMembers(classNode, sourceFile, checker);

        const htmlInfo = this.resolveTemplateArg(decoratorExpr, sourceFile, filePath);

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

        // String literal → inline template
        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
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
            if (ts.isStringLiteral(second)) {
                return { inline: second.text };
            }
        }

        return null;
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
        let resolved = path.resolve(dir, modulePath);
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
            const nameText = member.name.getText(sourceFile);
            const pos = sourceFile.getLineAndCharacterOfPosition(member.getStart());
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
                offset: member.getStart(),
                isPublic,
            });
        }

        // Constructor params with visibility modifiers
        for (const member of classNode.members) {
            if (ts.isConstructorDeclaration(member)) {
                for (const param of member.parameters) {
                    const paramMods = ts.getModifiers(param);
                    if (!paramMods) continue;
                    const hasVisibility = paramMods.some(m =>
                        m.kind === ts.SyntaxKind.PublicKeyword ||
                        m.kind === ts.SyntaxKind.ProtectedKeyword
                    );
                    if (!hasVisibility) continue;
                    if (!param.name || !ts.isIdentifier(param.name)) continue;

                    const pos = sourceFile.getLineAndCharacterOfPosition(param.getStart());
                    const isPublic = paramMods.some(m => m.kind === ts.SyntaxKind.PublicKeyword);
                    let type = 'any';
                    if (param.type) type = param.type.getText(sourceFile);

                    members.push({
                        name: param.name.text,
                        kind: 'property',
                        type,
                        line: pos.line,
                        character: pos.character,
                        offset: param.getStart(),
                        isPublic,
                    });
                }
            }
        }

        return members;
    }

    private hasPrivateModifier(member: ts.ClassElement): boolean {
        const mods = ts.getModifiers(member as ts.HasModifiers);
        if (!mods) return false;
        return mods.some(m => m.kind === ts.SyntaxKind.PrivateKeyword);
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

function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
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
 * Test-only: clear the tsconfig parse cache between specs.
 * Production code never needs this — configs are static for a session.
 */
export function _clearTsConfigCacheForTest(): void {
    parsedConfigCache.clear();
}
