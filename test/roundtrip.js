// Converter-level test: every fixture that is a GVAS save must convert to JSON and back to a byte-identical .sav.
// Usage: node test/roundtrip.js
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const exe = path.resolve(__dirname, "..", "bin", "UeSaveConverter", "UeSaveConverter.exe");
const fixtures = path.join(__dirname, "fixtures");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "uesave-rt-"));
let failed = 0;

for (const name of fs.readdirSync(fixtures).filter(n => n.endsWith(".sav"))) {
	const sav = path.join(fixtures, name);
	if (fs.readFileSync(sav).subarray(0, 4).toString("ascii") !== "GVAS") {
		continue;
	}
	const json = path.join(work, name + ".json");
	const back = path.join(work, name);
	try {
		execFileSync(exe, ["--to-json", "--overwrite", sav, json], { stdio: "pipe" });
		execFileSync(exe, ["--to-sav", "--overwrite", json, back], { stdio: "pipe" });
		const same = fs.readFileSync(sav).equals(fs.readFileSync(back));
		const raw = (fs.readFileSync(json, "utf8").match(/"\$RawBase64"/g) || []).length;
		console.log(`${same ? "PASS" : "FAIL"}  ${name} round-trips${same ? "" : " (bytes differ)"}, raw values: ${raw}`);
		failed += same ? 0 : 1;
	} catch (e) {
		failed++;
		console.log(`FAIL  ${name}\n${e.stdout || e}`);
	}
}

fs.rmSync(work, { recursive: true, force: true });
process.exitCode = failed ? 1 : 0;
