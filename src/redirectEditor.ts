import * as vscode from "vscode";
import { SaveFileSystem } from "./saveFs";
import { toJsonUri } from "./uris";

export const VIEW_TYPE = "ueSave.redirect";

/**
 * Default editor for *.sav. It renders nothing itself: it opens the `uesav:` JSON document in the same column and
 * closes its own tab. If conversion fails it stays open and shows the converter output instead.
 */
export class RedirectEditorProvider implements vscode.CustomReadonlyEditorProvider {
	constructor(private readonly saveFs: SaveFileSystem) {}

	openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return { uri, dispose: () => undefined };
	}

	async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
		panel.webview.options = { enableScripts: true };
		panel.webview.onDidReceiveMessage(async (msg: { command: string }) => {
			if (msg.command === "binary") {
				await vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
			} else if (msg.command === "retry") {
				await this.redirect(document.uri, panel);
			} else if (msg.command === "settings") {
				await vscode.commands.executeCommand("workbench.action.openSettings", "ueSave");
			} else if (msg.command === "dotnet") {
				await vscode.env.openExternal(vscode.Uri.parse("https://dotnet.microsoft.com/download/dotnet/8.0"));
			}
		});
		await this.redirect(document.uri, panel);
	}

	private async redirect(savUri: vscode.Uri, panel: vscode.WebviewPanel): Promise<void> {
		panel.webview.html = page(`<p class="muted">Converting ${escape(savUri.fsPath)}…</p>`);
		try {
			const doc = await vscode.workspace.openTextDocument(toJsonUri(savUri));
			await vscode.window.showTextDocument(doc, { viewColumn: panel.viewColumn, preview: false });
			await closeCustomTab(savUri);
		} catch (e) {
			const err = this.saveFs.lastReadError(savUri.fsPath);
			const message = err?.message ?? (e instanceof Error ? e.message : String(e));
			const buttons = [
				`<button data-cmd="binary">Open as binary</button>`,
				`<button data-cmd="retry">Retry</button>`,
				err?.dotnetMissing ? `<button data-cmd="dotnet">Download .NET 8</button>` : "",
				`<button data-cmd="settings">Settings</button>`,
			].join("");
			panel.webview.html = page(`
				<h2>Couldn't convert this save to JSON</h2>
				<p class="err">${escape(message)}</p>
				<p class="muted">Not every game's saves are supported by UeSaveConverter (custom serialisation, encryption or
				compression, or a non-GVAS file that just uses the .sav extension).</p>
				<div class="buttons">${buttons}</div>
				${err?.output ? `<pre>${escape(err.output)}</pre>` : ""}`);
		}
	}
}

async function closeCustomTab(savUri: vscode.Uri): Promise<void> {
	const tabs = vscode.window.tabGroups.all
		.flatMap(g => g.tabs)
		.filter(t => t.input instanceof vscode.TabInputCustom
			&& t.input.viewType === VIEW_TYPE
			&& t.input.uri.toString() === savUri.toString());
	if (tabs.length) {
		await vscode.window.tabGroups.close(tabs);
	}
}

function escape(s: string): string {
	return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);
}

function page(body: string): string {
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px 24px; }
	.muted { color: var(--vscode-descriptionForeground); }
	.err { color: var(--vscode-errorForeground); font-weight: 600; }
	.buttons { display: flex; gap: 8px; margin: 16px 0; }
	button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none;
		padding: 6px 14px; cursor: pointer; }
	button:hover { background: var(--vscode-button-hoverBackground); }
	pre { background: var(--vscode-textCodeBlock-background); padding: 12px; white-space: pre-wrap; word-break: break-all;
		font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
</style></head>
<body>${body}
<script>
	const vscode = acquireVsCodeApi();
	document.querySelectorAll("button[data-cmd]").forEach(b =>
		b.addEventListener("click", () => vscode.postMessage({ command: b.dataset.cmd })));
</script>
</body></html>`;
}
