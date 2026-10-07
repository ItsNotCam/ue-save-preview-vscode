# Vendored UeSaveConverter (modified)

This folder contains the source of [UeSaveConverter](https://github.com/CrystalFerrai/UeSaveConverter) and its
[UeSaveGame](https://github.com/CrystalFerrai/UeSaveGame) submodule by Crystal Ferrai, licensed under Apache 2.0
(see `license.txt` and `UeSaveGame/license.txt`). Upstream commits:

- UeSaveConverter `4ab76c1bb3b4e5e8d4e10bbbe2d98f4799ed487d`
- UeSaveGame `bbde564d5b0672757d2adecea00aea7620901a07`

## Changes (UeSaveGame)

The goal is that any GVAS save loads, and every save round-trips byte-identical even when parts of it aren't understood.

- **Raw fallback** (`PropertyTypes/RawProperty.cs`, `PropertyTag.DeserializeProperty`): when a property's type is
  unknown, its value fails to parse, or it parses to a different size than the tag says, the reader rewinds and stores
  the exact bytes. In JSON these values look like
  `{ "$RawReason": "...", "$RawBase64": "...", "$RawHeaderBase64": "..." }` and are written back unchanged.
- **Native structs**: an unknown struct whose tag has `HasBinaryOrNativeSerialize` goes straight to the raw fallback.
  Before, it was guessed to be a property list and misread.
- **SoftClassPath** is handled like SoftObjectPath (same binary layout).
- **Property tag guids** (both pre-5.4 and 5.4+ tag formats) and **tag extensions** (overridable-property info) are read
  and written. Before, they threw `NotImplementedException`.

Files that still can't be read are those that aren't GVAS at all, such as encrypted, compressed or custom-container saves.

## Build

`npm run build-converter` (or `scripts/build-converter.ps1`) runs `dotnet publish` into `bin/UeSaveConverter`.
