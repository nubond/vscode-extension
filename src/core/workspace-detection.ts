/**
 * workspace-detection.ts
 * Runtime gate that decides whether this workspace actually wants the nuBond
 * language service.
 *
 * VS Code `activationEvents` can gate on a file's *existence* but CANNOT read
 * a JSON property value. (A `workspaceContains:**\/node_modules/nubond/package.json`
 * narrowing event was tried and REMOVED from package.json — node_modules
 * matching is unreliable across VS Code versions and only re-evaluates on
 * window open — so activation is plain `onLanguage:html` / `onLanguage:typescript`.)
 * The explicit opt-in — a `"nubond": { "languageService": true }` block in a
 * workspace-folder-root package.json — is enforced here, at activation time. A
 * workspace that doesn't opt in leaves the extension fully inert (mirroring the
 * `nubond.enable === false` early-return), so native HTML/TS features in
 * unrelated projects are never touched.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Constants } from '../constants';
import { logError } from './logger';

/**
 * Reads the opt-in flag out of an already-parsed package.json object. Pure (no
 * I/O) so the decision logic is unit-testable in isolation.
 *
 * Accepts the nested-object form so the field can grow more sub-options later
 * without a breaking change:
 *
 *   { "nubond": { "languageService": true } }
 *
 * Defaults to `false` — opt-in is explicit, never inferred.
 */
export function packageJsonOptsIn(pkg: unknown): boolean {
    if (!pkg || typeof pkg !== 'object') {
        return false;
    }
    const marker = (pkg as Record<string, unknown>)[Constants.INTERNAL_NAME];
    if (!marker || typeof marker !== 'object') {
        return false;
    }
    return (marker as Record<string, unknown>).languageService === true;
}

/**
 * True when at least one open workspace folder's root package.json opts in to
 * the nuBond language service.
 *
 * Only each folder's *root* package.json is read — a bounded, synchronous check
 * with no workspace-wide scan, so it stays cheap even in large repos. A
 * malformed or unreadable manifest is logged and skipped rather than aborting
 * the scan, so one bad file in a multi-root workspace can't silently keep the
 * extension dormant.
 */
export function isNubondLanguageServiceEnabled(): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return false;
    }

    for (const folder of folders) {
        const pkgPath = path.join(folder.uri.fsPath, 'package.json');
        try {
            if (!fs.existsSync(pkgPath)) {
                continue;
            }
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (packageJsonOptsIn(pkg)) {
                return true;
            }
        } catch (err) {
            logError(`isNubondLanguageServiceEnabled(${pkgPath})`, err);
        }
    }

    return false;
}
