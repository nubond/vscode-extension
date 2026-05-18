<h1 align="center">The VS Code language service for <a href="https://github.com/nubond/nubond">nuBond</a></h1>

<p align="center">
  <strong>Full editor intelligence for nuBond HTML templates and their TypeScript classes — IntelliSense, Go to Definition, Find References, Rename, hover docs, diagnostics, and CodeLens.</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=nuBond.nubond-language-service"><img alt="Visual Studio Marketplace" src="https://vsmarketplacebadges.dev/version-short/nubond.nubond-language-service.svg?label=marketplace"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/npm/l/nubond.svg"></a>
  <img alt="coverage" src="https://img.shields.io/badge/coverage-85%25-green.svg">
  <img alt="Made in Ukraine" src="https://img.shields.io/badge/Made_in-Ukraine-FFD800.svg?labelColor=0056B9">
</p>

## What it does

Treats your `nb-*` bindings as a first-class language. Hover any attribute or expression, jump from a template to its class (and back), rename a member across both files at once, and get a squiggle the moment you mistype `nb-valu` or reference a property that doesn't exist on the bound class.

```html
<!-- F12 on `userName` jumps to the TS class. Rename here renames there too. -->
<button nb-event:click="this.greet(this.userName)">
  Hello, {{ this.userName }}
</button>
```

## Installation

> If you scaffolded your project from [`npm create nubond`](https://github.com/nubond/create-nubond), this extension is recommended automatically when you open the workspace.

1. Open the Extensions panel in VS Code (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **nuBond Language Service**.
3. Click **Install**.

Or from the command line:

```bash
code --install-extension nuBond.nubond-language-service
```

The service activates on any HTML or TypeScript file, or any workspace that contains HTML.

## Features

| Feature | What you get |
|---|---|
| **Hover docs** | Full Markdown documentation for every `nb-*` attribute, expression prefix (`#`, `@`, `%`), and injected parameter (`event`, `element`, `item`, `index`, `count`, …). Member types resolved through chained access — `this.foo?.bar.baz`. |
| **Autocomplete** | All 23+ `nb-*` attributes, DOM events for `nb-event:`, tag-specific attributes for `nb-attr:`, registered `@Container` / `@Component` / `@Aspect` / `@Transformer` names, class members after `this.`, repeat params, `nb-var` locals, and JS globals (`console`, `Math`, `JSON`, `Object`, `Array`, `document`, `window`, …). |
| **Go to Definition** | F12 / Ctrl+Click on `this.member`, `@ClassName`, transformer calls, `item` / `index` / `count`, `event` / `element` / `nativeElement`, or any `nb-var` reference jumps to the right TS member or HTML attribute. |
| **Find References** | Shift+F12 on a class member lists every `this.member` usage across all associated templates. |
| **Rename** | F2 on a member in either the template or the class renames it in both files atomically. |
| **Diagnostics** | Squiggles for unknown `nb-*` attributes, non-existent class members, `nb-case` / `nb-default` without `nb-switch`, and repeat params used outside an `nb-repeat` scope. |
| **CodeLens** | `📄 Template: …` above each `@Container` / `@Component` class and `🔗 N template references` above every public member used in a template. |
| **Outline & breadcrumbs** | Document symbols for `nb-container`, `nb-component`, `nb-repeat`, `nb-if`, `nb-switch`, `nb-case`, `nb-aspect`, and projection slots. |
| **Syntax highlighting** | TextMate grammars colour `nb-*` attribute values and `{{ expression }}` interpolations as real JS expressions, including expression prefixes. |
| **Document highlight** | Highlights every occurrence of a `this.member` reference in the current file. |
| **Semantic tokens** | Distinct colour for injected variables (`item`, `index`, `count`, `nb-var` locals) and transformer function calls. |

## Commands

Available from the Command Palette under the **nuBond** category, and from the editor context menu.

| Command | What it does |
|---|---|
| `nuBond: Go to Template` | From a TS class, opens its associated HTML template (QuickPick when there's more than one). |
| `nuBond: Go to Component/Container` | From an HTML template, opens the associated TS class and positions the cursor at the class declaration. |
| `nuBond: Restart nuBond Language Server` | Clears the analyzer and re-scans the workspace. Useful after large refactors or when something looks stale. |

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `nubond.enable` | boolean | `true` | Enable / disable the entire language service. |
| `nubond.diagnostics.enable` | boolean | `true` | Enable / disable template diagnostics (squiggles). |
| `nubond.codeLens.enable` | boolean | `true` | Enable / disable CodeLens on TS class declarations and members. |
| `nubond.trace.server` | enum | `"off"` | Trace level: `"off"`, `"messages"`, `"verbose"`. |

## Requirements

- VS Code 1.85.0 or later.
- A workspace containing nuBond `@Container` / `@Component` classes paired with HTML templates (W3C-compliant `data-nb-*` syntax also supported).

## License

[MIT](LICENSE) © Dmytro Tomayly
