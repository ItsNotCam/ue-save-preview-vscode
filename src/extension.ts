import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { Converter } from "./converter";
import { SaveFileSystem } from "./saveFs";
import { RedirectEditorProvider, VIEW_TYPE } from "./redirectEditor";
import { SCHEME, toJsonUri, toRealUri } from "./uris";

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel("UE Save");
	const tempBase = path.join(context.globalStorageUri.fsPath, "tmp");
	const tempRoot = path.join(tempBase, vscode.env.sessionId.replace(/[^\w-]/g, "_"));
	const converter = new Converter(context.extensionPath, tempRoot, log);
	const saveFs = new SaveFileSystem(converter, log);

	context.subscriptions.push(
		log,
		vscode.workspace.registerFileSystemProvider(SCHEME, saveFs, { isCaseSensitive: process.platform !== "win32" }),
		vscode.window.registerCustomEditorProvider(VIEW_TYPE, new RedirectEditorProvider(saveFs), {
			supportsMultipleEditorsPerDocument: true,
		}),
		vscode.commands.registerCommand("ueSave.openAsJson", async (uri?: vscode.Uri) => {
			const sav = pickSav(uri);
			if (sav) {
				await vscode.window.showTextDocument(toJsonUri(sav), { preview: false });
			}
		}),
		vscode.commands.registerCommand("ueSave.exportJson", async (uri?: vscode.Uri) => {
			const sav = pickSav(uri);
			if (!sav) {
				return;
			}
			const out = sav.fsPath + ".json";
			if (await fs.stat(out).then(() => true, () => false)) {
				const choice = await vscode.window.showWarningMessage(`${path.basename(out)} already exists.`, { modal: true }, "Overwrite");
				if (choice !== "Overwrite") {
					return;
				}
			}
			try {
				await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: `Exporting ${path.basename(sav.fsPath)}…` },
					() => converter.exportJson(sav.fsPath, out));
				await vscode.window.showTextDocument(vscode.Uri.file(out));
			} catch (e) {
				log.show(true);
				vscode.window.showErrorMessage(`Export failed: ${(e as Error).message}`);
			}
		}),
		vscode.commands.registerCommand("ueSave.revealOriginal", async (uri?: vscode.Uri) => {
			const target = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (target?.scheme === SCHEME) {
				await vscode.commands.executeCommand("revealFileInOS", toRealUri(target));
			}
		}),
	);

	// Clear temp files left behind by earlier (possibly crashed) sessions; never touch this session's folder.
	void fs.readdir(tempBase).then(
		names => Promise.all(names
			.filter(n => path.join(tempBase, n) !== tempRoot)
			.map(n => fs.rm(path.join(tempBase, n), { recursive: true, force: true }))),
		() => undefined).catch(() => undefined);
}

/** Resolves the .sav a command should act on: explorer selection, then the active editor. */
function pickSav(uri?: vscode.Uri): vscode.Uri | undefined {
	if (uri?.scheme === "file" && uri.path.toLowerCase().endsWith(".sav")) {
		return uri;
	}
	const active = vscode.window.activeTextEditor?.document.uri ?? activeCustomUri();
	if (active?.scheme === SCHEME) {
		return toRealUri(active);
	}
	if (active?.scheme === "file" && active.path.toLowerCase().endsWith(".sav")) {
		return active;
	}
	vscode.window.showInformationMessage("Select a .sav file in the explorer first.");
	return undefined;
}

function activeCustomUri(): vscode.Uri | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	return input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

export function deactivate(): void {}
