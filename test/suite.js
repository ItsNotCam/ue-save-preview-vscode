// End-to-end test run inside a real VS Code instance (see test/runTest.js). Plain JS, no test framework.
const vscode = require("vscode");
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const dir = process.env.UESAVE_TEST_DIR;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, what, timeout = 20000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const v = fn();
		if (v) return v;
		await sleep(100);
	}
	throw new Error(`Timed out waiting for ${what}`);
}

const tests = {
	async "opening a .sav redirects to a JSON document and closes the custom tab"() {
		const sav = vscode.Uri.file(path.join(dir, "Reset.sav"));
		await vscode.commands.executeCommand("vscode.open", sav);
		const editor = await waitFor(() => {
			const e = vscode.window.activeTextEditor;
			return e && e.document.uri.scheme === "uesav" ? e : undefined;
		}, "uesav editor");
		assert.strictEqual(editor.document.languageId, "json");
		assert.ok(JSON.parse(editor.document.getText()).Header, "JSON has a Header");
		await waitFor(() => !vscode.window.tabGroups.all.flatMap(g => g.tabs)
			.some(t => t.input instanceof vscode.TabInputCustom), "custom tab to close");
	},

	async "saving edited JSON writes the .sav and makes a backup"() {
		const savPath = path.join(dir, "Reset.sav");
		const original = fs.readFileSync(savPath);
		const editor = vscode.window.activeTextEditor;
		const doc = editor.document;
		const json = JSON.parse(doc.getText());
		json.Header.EngineVersion.BuildId = json.Header.EngineVersion.BuildId + "-edited";
		await editor.edit(b => b.replace(new vscode.Range(0, 0, doc.lineCount, 0), JSON.stringify(json, null, 2)));
		assert.ok(await doc.save(), "save succeeded");
		assert.ok(fs.existsSync(savPath + ".bak"), ".bak created");
		assert.ok(fs.readFileSync(savPath + ".bak").equals(original), ".bak is the original");
		assert.ok(fs.readFileSync(savPath).includes("Release-5.7-edited"), ".sav contains the edit");
	},

	async "invalid JSON is refused and the .sav is untouched"() {
		const savPath = path.join(dir, "Reset.sav");
		const before = fs.readFileSync(savPath);
		const editor = vscode.window.activeTextEditor;
		await editor.edit(b => b.insert(new vscode.Position(0, 0), "garbage"));
		let saved;
		try { saved = await editor.document.save(); } catch { saved = false; }
		assert.ok(!saved, "save should fail");
		assert.ok(fs.readFileSync(savPath).equals(before), ".sav unchanged");
		await vscode.commands.executeCommand("workbench.action.files.revert");
	},

	async "an external change to the .sav refreshes the document"() {
		const savPath = path.join(dir, "Reset.sav");
		fs.copyFileSync(savPath + ".bak", savPath);
		const doc = vscode.window.activeTextEditor.document;
		await waitFor(() => !doc.getText().includes("-edited"), "document to reload");
	},

	async "an unsupported .sav shows the error page instead of closing"() {
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
		const sav = vscode.Uri.file(path.join(dir, "NotASave.sav"));
		await vscode.commands.executeCommand("vscode.open", sav);
		await sleep(4000);
		const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
		assert.ok(tabs.some(t => t.input instanceof vscode.TabInputCustom), "custom error tab stays open");
		assert.ok(!tabs.some(t => t.input instanceof vscode.TabInputText && t.input.uri.scheme === "uesav"), "no JSON tab");
	},

	async "export command writes a .sav.json next to the save"() {
		const sav = vscode.Uri.file(path.join(dir, "Reset.sav"));
		await vscode.commands.executeCommand("ueSave.exportJson", sav);
		const out = sav.fsPath + ".json";
		assert.ok(fs.existsSync(out) && JSON.parse(fs.readFileSync(out, "utf8")).Header, "export written");
	},
};

exports.run = async function () {
	let failed = 0;
	for (const [name, fn] of Object.entries(tests)) {
		try {
			await fn();
			console.log(`PASS  ${name}`);
		} catch (e) {
			failed++;
			console.log(`FAIL  ${name}\n      ${e && e.stack || e}`);
		}
	}
	if (failed) throw new Error(`${failed} test(s) failed`);
};
