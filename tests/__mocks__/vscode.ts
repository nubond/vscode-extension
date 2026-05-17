/**
 * Minimal mock of the 'vscode' module for testing.
 */

export class Position {
    constructor(public readonly line: number, public readonly character: number) {}
    isEqual(other: Position): boolean { return this.line === other.line && this.character === other.character; }
    isBefore(other: Position): boolean { return this.line < other.line || (this.line === other.line && this.character < other.character); }
    isAfter(other: Position): boolean { return other.isBefore(this); }
    translate(lineDelta = 0, characterDelta = 0): Position { return new Position(this.line + lineDelta, this.character + characterDelta); }
}

export class Range {
    public readonly start: Position;
    public readonly end: Position;
    constructor(startOrLine: Position | number, endOrChar: Position | number, endLine?: number, endChar?: number) {
        if (typeof startOrLine === 'number') {
            this.start = new Position(startOrLine, endOrChar as number);
            this.end = new Position(endLine!, endChar!);
        } else {
            this.start = startOrLine;
            this.end = endOrChar as Position;
        }
    }
    contains(positionOrRange: Position | Range): boolean {
        if (positionOrRange instanceof Position) {
            return !positionOrRange.isBefore(this.start) && !positionOrRange.isAfter(this.end);
        }
        return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
    }
}

export class Selection extends Range {
    public readonly anchor: Position;
    public readonly active: Position;
    constructor(anchor: Position, active: Position) {
        super(anchor, active);
        this.anchor = anchor;
        this.active = active;
    }
}

export class Location {
    constructor(public uri: Uri, public range: Range) {}
}

export class Uri {
    public readonly scheme: string;
    public readonly authority: string;
    public readonly path: string;
    public readonly query: string;
    public readonly fragment: string;
    public readonly fsPath: string;

    private constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
        this.scheme = scheme;
        this.authority = authority;
        this.path = path;
        this.query = query;
        this.fragment = fragment;
        this.fsPath = path.replace(/\//g, '\\');
    }

    static file(path: string): Uri {
        return new Uri('file', '', path.replace(/\\/g, '/'), '', '');
    }

    static parse(value: string): Uri {
        return new Uri('file', '', value, '', '');
    }

    toString(): string {
        return `${this.scheme}://${this.path}`;
    }
}

export class MarkdownString {
    public value: string;
    public isTrusted: boolean = false;
    constructor(value?: string) { this.value = value ?? ''; }
    appendText(value: string): this { this.value += value; return this; }
    appendMarkdown(value: string): this { this.value += value; return this; }
    appendCodeblock(code: string, language?: string): this { this.value += `\`\`\`${language ?? ''}\n${code}\n\`\`\`\n`; return this; }
}

export class Hover {
    constructor(public contents: MarkdownString | MarkdownString[], public range?: Range) {}
}

export class CompletionItem {
    public detail?: string;
    public documentation?: MarkdownString | string;
    public insertText?: string;
    public sortText?: string;
    public filterText?: string;
    public range?: Range;
    constructor(public label: string, public kind?: CompletionItemKind) {}
}

export class CompletionList {
    constructor(public items: CompletionItem[], public isIncomplete: boolean = false) {}
}

export enum CompletionItemKind {
    Text = 0, Method = 1, Function = 2, Constructor = 3, Field = 4,
    Variable = 5, Class = 6, Interface = 7, Module = 8, Property = 9,
    Unit = 10, Value = 11, Enum = 12, Keyword = 13, Snippet = 14,
    Color = 15, File = 16, Reference = 17, Folder = 18, EnumMember = 19,
    Constant = 20, Struct = 21, Event = 22, Operator = 23, TypeParameter = 24,
}

export class Diagnostic {
    public code?: string | number;
    public source?: string;
    constructor(public range: Range, public message: string, public severity?: DiagnosticSeverity) {}
}

export enum DiagnosticSeverity {
    Error = 0, Warning = 1, Information = 2, Hint = 3,
}

export class CodeLens {
    public command?: Command;
    constructor(public readonly range: Range, command?: Command) {
        this.command = command;
    }
}

export interface Command {
    title: string;
    command: string;
    arguments?: any[];
}

export class DocumentHighlight {
    constructor(public range: Range, public kind?: DocumentHighlightKind) {}
}

export enum DocumentHighlightKind {
    Text = 0, Read = 1, Write = 2,
}

export class SymbolInformation {
    constructor(
        public name: string,
        public kind: SymbolKind,
        public containerName: string,
        public location: Location,
    ) {}
}

export enum SymbolKind {
    File = 0, Module = 1, Namespace = 2, Package = 3, Class = 4,
    Method = 5, Property = 6, Field = 7, Constructor = 8, Enum = 9,
    Interface = 10, Function = 11, Variable = 12, Constant = 13,
    String = 14, Number = 15, Boolean = 16, Array = 17, Object = 18,
    Key = 19, Null = 20, EnumMember = 21, Struct = 22, Event = 23,
    Operator = 24, TypeParameter = 25,
}

export class WorkspaceEdit {
    private _entries: Array<{ uri: Uri; edits: TextEdit[] }> = [];
    replace(uri: Uri, range: Range, newText: string): void {
        this._entries.push({ uri, edits: [new TextEdit(range, newText)] });
    }
    get entries() { return this._entries; }
    get size() { return this._entries.length; }
}

export class TextEdit {
    constructor(public range: Range, public newText: string) {}
}

export enum TextEditorRevealType {
    Default = 0, InCenter = 1, InCenterIfOutsideViewport = 2, AtTop = 3,
}

export class SemanticTokensBuilder {
    private _data: number[] = [];
    push(line: number, char: number, length: number, tokenType: number, tokenModifiers: number): void {
        this._data.push(line, char, length, tokenType, tokenModifiers);
    }
    build(): SemanticTokens {
        return new SemanticTokens(new Uint32Array(this._data));
    }
}

export class SemanticTokens {
    constructor(public readonly data: Uint32Array) {}
}

export class SemanticTokensLegend {
    constructor(public readonly tokenTypes: string[], public readonly tokenModifiers: string[] = []) {}
}

export const languages = {
    createDiagnosticCollection: jest.fn((name?: string) => ({
        name: name ?? 'default',
        set: jest.fn(),
        delete: jest.fn(),
        clear: jest.fn(),
        dispose: jest.fn(),
        forEach: jest.fn(),
        get: jest.fn(),
        has: jest.fn(),
    })),
    registerHoverProvider: jest.fn(),
    registerDefinitionProvider: jest.fn(),
    registerReferenceProvider: jest.fn(),
    registerCompletionItemProvider: jest.fn(),
    registerRenameProvider: jest.fn(),
    registerCodeLensProvider: jest.fn(),
    registerDocumentSymbolProvider: jest.fn(),
    registerDocumentHighlightProvider: jest.fn(),
    registerDocumentSemanticTokensProvider: jest.fn(),
};

export const workspace = {
    getConfiguration: jest.fn(() => ({
        get: jest.fn((key: string, defaultValue?: any) => defaultValue),
    })),
    findFiles: jest.fn(() => Promise.resolve([])),
    textDocuments: [],
    openTextDocument: jest.fn((uri: any) => Promise.resolve({
        uri: typeof uri === 'string' ? Uri.file(uri) : uri,
        getText: () => '',
        languageId: 'html',
    })),
    createFileSystemWatcher: jest.fn(() => ({
        onDidChange: jest.fn(),
        onDidCreate: jest.fn(),
        onDidDelete: jest.fn(),
        dispose: jest.fn(),
    })),
    onDidChangeTextDocument: jest.fn(),
    onDidOpenTextDocument: jest.fn(),
    onDidCloseTextDocument: jest.fn(),
};

export const window = {
    createOutputChannel: jest.fn(() => ({
        appendLine: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
    })),
    showInformationMessage: jest.fn(),
    showTextDocument: jest.fn(),
    showQuickPick: jest.fn(),
    activeTextEditor: undefined as any,
};

export const commands = {
    registerCommand: jest.fn(),
};

export class SnippetString {
    constructor(public value: string = '') {}
    appendText(value: string): this { this.value += value; return this; }
    appendPlaceholder(value: string | ((snippet: SnippetString) => any), number?: number): this { this.value += `$\{${number ?? 1}:${value}}`; return this; }
    appendTabstop(number?: number): this { this.value += `$${number ?? 0}`; return this; }
}

export class DocumentSymbol {
    public children: DocumentSymbol[] = [];
    constructor(
        public name: string,
        public detail: string,
        public kind: SymbolKind,
        public range: Range,
        public selectionRange: Range,
    ) {}
}

export class EventEmitter {
    event = jest.fn();
    fire = jest.fn();
    dispose = jest.fn();
}

export class CancellationTokenSource {
    token = { isCancellationRequested: false, onCancellationRequested: jest.fn() };
    cancel() { this.token.isCancellationRequested = true; }
    dispose() {}
}
