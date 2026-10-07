import * as vscode from "vscode";

export const SCHEME = "uesav";

/** `file:///d:/Saves/Slot.sav` -> `uesav:/d:/Saves/Slot.sav.json` (the .json suffix selects the JSON language mode). */
export function toJsonUri(savUri: vscode.Uri): vscode.Uri {
	return savUri.with({ scheme: SCHEME, path: savUri.path + ".json" });
}

/** True when a `uesav:` URI names a save (as opposed to a folder, which only exists for breadcrumbs). */
export function isSaveJsonUri(uri: vscode.Uri): boolean {
	return uri.path.toLowerCase().endsWith(".sav.json");
}

/** Inverse of {@link toJsonUri}. Folder URIs map straight to their real folder. */
export function toRealUri(uri: vscode.Uri): vscode.Uri {
	const path = isSaveJsonUri(uri) ? uri.path.slice(0, -".json".length) : uri.path;
	return uri.with({ scheme: "file", path });
}
