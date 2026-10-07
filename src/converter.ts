import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";

/** Thrown when UeSaveConverter fails; `output` holds everything it printed. */
export class ConverterError extends Error {
	constructor(message: string, readonly output: string, readonly dotnetMissing = false) {
		super(message);
	}
}

/** Thin wrapper around the UeSaveConverter CLI. Every call works on private temp files. */
export class Converter {
	constructor(
		private readonly extensionPath: string,
		private readonly tempRoot: string,
		private readonly log: vscode.OutputChannel,
	) {}

	/** Reads a .sav and returns its JSON text. */
	async toJson(savPath: string): Promise<Buffer> {
		return this.withTemp(async dir => {
			const out = path.join(dir, path.basename(savPath) + ".json");
			await this.run(["--to-json", "--overwrite", savPath, out]);
			return fs.readFile(out);
		});
	}

	/** Converts JSON text to .sav bytes without touching any real save file. */
	async toSav(json: Uint8Array, nameHint: string): Promise<Buffer> {
		return this.withTemp(async dir => {
			const input = path.join(dir, nameHint + ".json");
			const out = path.join(dir, nameHint);
			await fs.writeFile(input, json);
			await this.run(["--to-sav", "--overwrite", input, out]);
			return fs.readFile(out);
		});
	}

	/** Writes `<savPath>.json` next to the save (plain export, no virtual file system). */
	async exportJson(savPath: string, outPath: string): Promise<void> {
		await this.run(["--to-json", "--overwrite", savPath, outPath]);
	}

	private resolveCommand(): { file: string; prefix: string[] } {
		const configured = vscode.workspace.getConfiguration("ueSave").get<string>("converterPath")?.trim();
		const target = configured || path.join(this.extensionPath, "bin", "UeSaveConverter", "UeSaveConverter.exe");
		// A .dll (or a non-Windows host, where the bundled .exe apphost can't run) goes through `dotnet`.
		if (target.toLowerCase().endsWith(".dll")) {
			return { file: "dotnet", prefix: [target] };
		}
		if (process.platform !== "win32" && target.toLowerCase().endsWith(".exe")) {
			return { file: "dotnet", prefix: [target.slice(0, -4) + ".dll"] };
		}
		return { file: target, prefix: [] };
	}

	private run(args: string[]): Promise<void> {
		const { file, prefix } = this.resolveCommand();
		const timeout = Math.max(1, vscode.workspace.getConfiguration("ueSave").get<number>("timeoutSeconds") ?? 60) * 1000;
		const fullArgs = [...prefix, ...args];
		this.log.appendLine(`> ${file} ${fullArgs.map(a => JSON.stringify(a)).join(" ")}`);

		return new Promise((resolve, reject) => {
			cp.execFile(file, fullArgs, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
				const output = [stdout, stderr].filter(s => s && s.trim()).join("\n").trim();
				if (output) {
					this.log.appendLine(output);
				}
				if (!err) {
					resolve();
					return;
				}
				const code = (err as NodeJS.ErrnoException).code;
				if (code === "ENOENT") {
					const what = file === "dotnet" ? "The `dotnet` command" : `UeSaveConverter (${file})`;
					reject(new ConverterError(`${what} was not found. Check the ueSave.converterPath setting.`, output, file === "dotnet"));
					return;
				}
				if (err.killed) {
					reject(new ConverterError("UeSaveConverter timed out (see ueSave.timeoutSeconds).", output));
					return;
				}
				// The converter prints its errors to stdout as "[ERROR] ..." lines; surface the most specific one.
				const errors = output.split(/\r?\n/).filter(l => l.startsWith("[ERROR]")).map(l => l.replace(/^\[ERROR\]\s*/, ""));
				const detail = errors.find(l => l.startsWith("[")) ?? errors[0] ?? output.split(/\r?\n/).pop() ?? err.message;
				const dotnetMissing = /install(ing)? .*\.NET|framework.*not found|hostfxr/i.test(output);
				reject(new ConverterError(dotnetMissing ? "UeSaveConverter needs the .NET 8 runtime (x64)." : detail, output, dotnetMissing));
			});
		});
	}

	private async withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
		const dir = path.join(this.tempRoot, crypto.randomUUID());
		await fs.mkdir(dir, { recursive: true });
		try {
			return await fn(dir);
		} finally {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}
