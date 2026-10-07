// Launches VS Code with the extension under development and runs test/suite.js against copies of the sample saves.
// Usage: node test/runTest.js [path-to-Code.exe]   (defaults to downloading a VS Code build)
const path = require("path");
const fs = require("fs");
const os = require("os");
const { runTests } = require("@vscode/test-electron");

async function main() {
	const root = path.resolve(__dirname, "..");
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "uesave-test-"));
	for (const f of fs.readdirSync(path.join(__dirname, "fixtures"))) {
		fs.copyFileSync(path.join(__dirname, "fixtures", f), path.join(work, f));
	}
	try {
		await runTests({
			vscodeExecutablePath: process.argv[2],
			extensionDevelopmentPath: root,
			extensionTestsPath: path.join(__dirname, "suite.js"),
			extensionTestsEnv: { UESAVE_TEST_DIR: work },
			launchArgs: [work, "--disable-extensions", "--user-data-dir", path.join(work, ".user-data"), "--skip-welcome"],
		});
	} catch (e) {
		console.error(e);
		process.exitCode = 1;
	} finally {
		fs.rmSync(work, { recursive: true, force: true });
	}
}

main();
