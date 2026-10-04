import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(root, "src");
const wasmDir = resolve(srcDir, "wasm");
const distDir = resolve(root, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
	entryPoints: [resolve(srcDir, "main.ts")],
	outfile: resolve(distDir, "index.js"),
	bundle: true,
	format: "esm",
	platform: "neutral",
	target: "es2024",
	treeShaking: true,
	sourcemap: true,
	minify: false,
	legalComments: "eof",
	external: ["node:fs/promises"],
});

await cp(resolve(wasmDir, "protocol.core.wasm"), resolve(distDir, "protocol.core.wasm"));
