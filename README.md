# Unreal Save Preview (VS Code)

Open Unreal Engine `.sav` files (GVAS) in VS Code as normal JSON documents: syntax highlighting, folding, search and
outline all work. Edit the JSON and press **Ctrl+S** to write it back into the `.sav`.

Conversion is done by a patched copy of [UeSaveConverter](https://github.com/CrystalFerrai/UeSaveConverter) by Crystal
Ferrai, bundled in the extension (source and change list in [converter/](converter/README-VENDORED.md)). Anything it
doesn't understand (unknown property types, game-specific native structs) is kept as exact raw bytes, shown as
`{ "$RawReason": ..., "$RawBase64": ... }`, so every GVAS save opens and saves back byte-identical.

## How it works

- `*.sav` files open with the **Unreal Save (JSON)** editor by default. It converts the save and opens it as
  `uesav:/…/Name.sav.json`, a virtual file backed by the real `.sav`.
- **Saving** checks that the JSON is valid, converts it to a temporary `.sav`, backs up the original, then replaces it.
  If any step fails, the original file is left alone.
- If the game rewrites the `.sav` while it's open, the document reloads.
- Files that aren't GVAS at all (some games wrap saves in their own encrypted, compressed or custom container) show
  the converter's error output, with **Open as binary** and **Retry** buttons.
- To open a `.sav` with a different editor, right-click its tab → **Reopen Editor With…**. To change the default,
  set `workbench.editorAssociations`.

### Commands

| Command | Where |
| --- | --- |
| Open Unreal Save as JSON | Explorer context menu on `.sav` |
| Export Unreal Save to .sav.json | Explorer context menu on `.sav` (writes a real file next to it) |
| Reveal Original .sav | Editor tab context menu on a `uesav:` tab |

### Settings

| Setting | Default | |
| --- | --- | --- |
| `ueSave.backup` | `once` | `once`: create `Name.sav.bak` before the first save and never overwrite it. `every`: create a timestamped `.bak` on every save. `off`: no backups. |
| `ueSave.converterPath` | *(bundled)* | Use another `UeSaveConverter.exe` / `.dll`. |
| `ueSave.timeoutSeconds` | `60` | Kill a conversion after this many seconds. |

## Requirements

- The [.NET 8 runtime (x64)](https://dotnet.microsoft.com/download/dotnet/8.0). UeSaveConverter needs it.
- Windows. On other platforms the bundled `.dll` runs through `dotnet`.

## Building

```powershell
npm install
npm run build-converter   # builds converter/ (patched UeSaveConverter) into bin/; needs the .NET 8+ SDK
npm test                  # converter round-trips + end-to-end tests in a downloaded VS Code build
npm run package           # -> ue-save-preview-<version>.vsix
code --install-extension ue-save-preview-0.2.0.vsix
```

## Licenses

This extension is MIT licensed. The vendored UeSaveConverter / UeSaveGame are Apache 2.0 (`converter/license.txt`).
