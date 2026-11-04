---
title: "OmniRoute CLI Plugin System"
version: 3.8.40
lastUpdated: 2026-06-28
---

# OmniRoute CLI Plugin System

Extend the `omniroute` CLI without modifying its core. Plugins follow the `omniroute-cmd-*` naming convention, similar to `gh extension` or `kubectl plugin`.

## Quick start

```bash
# Install a plugin from npm
omniroute plugin install stripe

# Install a local plugin in development
omniroute plugin install ./my-plugin

# List installed plugins
omniroute plugin list

# Scaffold a new plugin
omniroute plugin scaffold myplugin
cd omniroute-cmd-myplugin
omniroute plugin install .
```

## Plugin anatomy

A plugin is an npm package named `omniroute-cmd-<name>` (or `@scope/omniroute-cmd-<name>`).

```
omniroute-cmd-myplugin/
├── package.json     # must have "type": "module" and "main": "index.mjs"
├── index.mjs        # exports register(program, ctx) + optional meta
└── README.md
```

### `package.json`

```json
{
  "name": "omniroute-cmd-myplugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.mjs",
  "engines": { "omniroute": ">=4.0.0" },
  "keywords": ["omniroute-plugin", "omniroute-cmd"]
}
```

### `index.mjs`

```js
export const meta = {
  name: "myplugin",
  version: "0.1.0",
  description: "My plugin for OmniRoute",
  omnirouteApi: ">=4.0.0",
};

export function register(program, ctx) {
  program
    .command("myplugin")
    .description(meta.description)
    .option("-n, --name <name>")
    .action(async (opts, cmd) => {
      const gOpts = cmd.optsWithGlobals();
      const res = await ctx.apiFetch("/api/combos", {
        baseUrl: gOpts.baseUrl,
        apiKey: gOpts.apiKey,
      });
      const data = await res.json();
      ctx.emit(data, gOpts);
    });
}
```

## Plugin context API

The `ctx` object passed to `register(program, ctx)`:

| Property                     | Type             | Description                                        |
| ---------------------------- | ---------------- | -------------------------------------------------- |
| `ctx.apiFetch(path, opts)`   | `async function` | Authenticated fetch to the OmniRoute server        |
| `ctx.emit(data, opts)`       | `function`       | Output in table/json/jsonl/csv per `--output` flag |
| `ctx.t(key)`                 | `async function` | i18n translation lookup                            |
| `ctx.withSpinner(label, fn)` | `async function` | Wraps async fn with ora spinner                    |
| `ctx.baseUrl`                | `string`         | Resolved base URL                                  |
| `ctx.apiKey`                 | `string \| null` | API key if provided                                |

## Discovery

Plugins are discovered from:

1. `~/.omniroute/plugins/<name>/` — user-local installs
2. `OMNIROUTE_PLUGIN_PATH` env var — custom directory

Both are **CLI-only**. The server-side plugin runtime (the marketplace/`plugin.json`
plugins that run inside the proxy) has its own scanner with its own override,
`OMNIROUTE_PLUGINS_DIR` — see
[PLUGIN_MARKETPLACE.md → Plugin directory](./PLUGIN_MARKETPLACE.md#plugin-directory).
Setting one does not affect the other.

Loading errors are caught and printed as warnings — a broken plugin never crashes the CLI.

## Server-side plugins (declarative contributions)

The `omniroute-cmd-*` plugins above extend the CLI only. Plugins that run inside
the proxy instead live in `OMNIROUTE_PLUGINS_DIR` and are described by a
`plugin.json` manifest. Such a plugin can extend the dashboard without shipping
any UI code by declaring a `contributes` block: provider nodes, an extra
providers-page section, a sidebar entry, a dashboard page, slot widgets, `/v1`
API routes, CSS-hidden host chrome, an i18n overlay, or the password-reveal
affordance.

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "contributes": {
    "nav": [
      {
        "id": "plugin-my-plugin",
        "href": "/dashboard/plugin/my-plugin/overview",
        "labelFallback": "My Plugin",
        "sectionId": "other-features"
      }
    ],
    "pages": [
      {
        "id": "overview",
        "titleFallback": "My Plugin",
        "widgets": [{ "type": "keyValue", "items": [{ "label": "Status", "value": "Ready" }] }]
      }
    ]
  }
}
```

Widgets are a closed union rendered by host-owned components (`keyValue`,
`markdown`, `callout`, `statusBadge`, `actionButton`, `providerNodeTable`), so a
manifest can never inject React, HTML or scripts into the dashboard.

If a plugin shells out to a host program, declare it — the host checks `PATH` on
activation and shows a dismissible banner when it is missing (it never hides by
itself, and it never fails the activation):

```json
{ "requires": { "binaries": ["dsh"] } }
```

Full contract, lifecycle materialisation and inspection endpoints:
[PLUGIN_MARKETPLACE.md → Declarative contributions](./PLUGIN_MARKETPLACE.md#declarative-contributions).

## Security

Plugins run with the same Node.js process privileges as `omniroute`. Only install plugins from sources you trust. `omniroute plugin install` shows an explicit warning and requires `--yes` or interactive confirmation.

## Publishing

1. Ensure `package.json` has `"keywords": ["omniroute-plugin"]`
2. `npm publish` as normal
3. Users discover via `omniroute plugin search <query>` (searches npm registry)

## Example plugin

See [`examples/omniroute-cmd-hello/`](../../examples/omniroute-cmd-hello/index.mjs) for a minimal working example with `meta` + `register()`.
