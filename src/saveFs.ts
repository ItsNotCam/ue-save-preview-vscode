import * as vscode from "vscode";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Converter, ConverterError } from "./converter";
import { isSaveJsonUri, toRealUri } from "./uris";

interface CacheEntry {
	mtimeMs: number;
	size: number;
	json: Uint8Array;
}

/**
 * Exposes every `.sav` as a virtual `.sav.json` file under the `uesav:` scheme.
 * Reading converts sav -> json; writing validates the JSON, converts json -> sav, backs up and replaces the original.
 */
export class SaveFileSystem implements vscode.FileSystemProvider {
	private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this.emitter.event;

	private readonly cache = new Map<string, CacheEntry>();
	private readonly writeQueue = new Map<string, Promise<void>>();
	private readonly readErrors = new Map<string, ConverterError>();

	constructor(private readonly converter: Converter, private readonly log: vscode.OutputChannel) {}

	watch(uri: vscode.Uri): vscode.Disposable {
		if (!isSaveJsonUri(uri)) {
			return new vscode.Disposable(() => undefined);
		}
		const real = toRealUri(uri).fsPath;
		let timer: NodeJS.Timeout | undefined;
		let watcher: fs.FSWatcher | undefined;
		try {
			// Games often rewrite saves in several chunks; debounce so we convert once.
			watcher = fs.watch(real, () => {
				clearTimeout(timer);
				timer = setTimeout(() => this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]), 300);
			});
			watcher.on("error", () => watcher?.close());
		} catch {
			// File may not exist yet; nothing to watch.
		}
		return new vscode.Disposable(() => {
			clearTimeout(timer);
			watcher?.close();
		});
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const real = await this.realStat(uri);
		const isFile = isSaveJsonUri(uri);
		if (isFile && !real.isFile()) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		const cached = isFile ? this.cache.get(toRealUri(uri).fsPath) : undefined;
		return {
			type: isFile ? vscode.FileType.File : vscode.FileType.Directory,
			ctime: real.ctimeMs,
			mtime: real.mtimeMs,
			// Size of the JSON is unknown until converted; report the cached one when we have it.
			size: cached && cached.mtimeMs === real.mtimeMs ? cached.json.byteLength : real.size,
		};
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		// Only used for breadcrumbs / quick-open within the virtual tree: list subfolders and saves.
		const entries = await fsp.readdir(toRealUri(uri).fsPath, { withFileTypes: true }).catch(() => []);
		const result: [string, vscode.FileType][] = [];
		for (const e of entries) {
			if (e.isDirectory()) {
				result.push([e.name, vscode.FileType.Directory]);
			} else if (e.isFile() && e.name.toLowerCase().endsWith(".sav")) {
				result.push([e.name + ".json", vscode.FileType.File]);
			}
		}
		return result;
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		if (!isSaveJsonUri(uri)) {
			throw vscode.FileSystemError.FileIsADirectory(uri);
		}
		const realPath = toRealUri(uri).fsPath;
		const st = await this.realStat(uri);
		const cached = this.cache.get(realPath);
		if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
			return cached.json;
		}
		try {
			const json = await this.converter.toJson(realPath);
			this.cache.set(realPath, { mtimeMs: st.mtimeMs, size: st.size, json });
			this.readErrors.delete(realPath);
			return json;
		} catch (e) {
			if (e instanceof ConverterError) {
				this.readErrors.set(realPath, e);
			}
			throw this.toFsError(e, uri);
		}
	}

	/** Full converter output of the last failed read, for the error page (FileSystemError only carries a message). */
	lastReadError(realPath: string): ConverterError | undefined {
		return this.readErrors.get(realPath);
	}

	writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
		if (!isSaveJsonUri(uri)) {
			throw vscode.FileSystemError.NoPermissions("Only .sav files can be written.");
		}
		const realPath = toRealUri(uri).fsPath;
		// Serialise saves of the same file so two quick Ctrl+S presses can't interleave.
		const previous = this.writeQueue.get(realPath) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(() => this.doWrite(uri, realPath, content, options));
		this.writeQueue.set(realPath, next);
		return next;
	}

	private async doWrite(uri: vscode.Uri, realPath: string, content: Uint8Array, options: { create: boolean }): Promise<void> {
		const exists = await fsp.stat(realPath).then(() => true, () => false);
		if (!exists && !options.create) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		// Never hand broken JSON to the converter: catch it here with a readable position.
		try {
			JSON.parse(Buffer.from(content).toString("utf8").replace(/^﻿/, ""));
		} catch (e) {
			throw vscode.FileSystemError.NoPermissions(`Not saved - invalid JSON: ${(e as Error).message}`);
		}

		let sav: Buffer;
		try {
			sav = await this.converter.toSav(content, path.basename(realPath));
		} catch (e) {
			throw this.toFsError(e, uri, "Not saved - ");
		}
		if (sav.byteLength === 0) {
			throw vscode.FileSystemError.Unavailable("Not saved - the converter produced an empty .sav.");
		}

		if (exists) {
			await this.backup(realPath);
		}
		await fsp.writeFile(realPath, sav);
		this.log.appendLine(`Saved ${realPath} (${sav.byteLength} bytes)`);

		const st = await fsp.stat(realPath);
		this.cache.set(realPath, { mtimeMs: st.mtimeMs, size: st.size, json: content });
		this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
	}

	private async backup(realPath: string): Promise<void> {
		const mode = vscode.workspace.getConfiguration("ueSave").get<string>("backup") ?? "once";
		if (mode === "off") {
			return;
		}
		let target = realPath + ".bak";
		if (mode === "every") {
			const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
			target = `${realPath}.${stamp}.bak`;
		} else if (await fsp.stat(target).then(() => true, () => false)) {
			return; // "once": keep the very first original.
		}
		await fsp.copyFile(realPath, target);
		this.log.appendLine(`Backed up to ${target}`);
	}

	private async realStat(uri: vscode.Uri): Promise<fs.Stats> {
		try {
			return await fsp.stat(toRealUri(uri).fsPath);
		} catch {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}

	private toFsError(e: unknown, uri: vscode.Uri, prefix = ""): vscode.FileSystemError {
		if (e instanceof vscode.FileSystemError) {
			return e;
		}
		const message = e instanceof ConverterError ? e.message : String(e);
		return vscode.FileSystemError.Unavailable(`${prefix}${message}`);
	}

	createDirectory(): void {
		throw vscode.FileSystemError.NoPermissions("Read-only view of save folders.");
	}

	delete(): void {
		throw vscode.FileSystemError.NoPermissions("Delete the .sav from the normal explorer instead.");
	}

	rename(): void {
		throw vscode.FileSystemError.NoPermissions("Rename the .sav from the normal explorer instead.");
	}
}
