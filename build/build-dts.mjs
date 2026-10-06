import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import dts from "rollup-plugin-dts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(root, "src");
const distDir = resolve(root, "dist");
const typesDir = resolve(distDir, "types");

await cp(resolve(srcDir, "wasm"), resolve(typesDir, "wasm"), { recursive: true });

const bundle = await rollup({
	input: resolve(typesDir, "main.d.ts"),
	plugins: [dts()],
});

await bundle.write({
	file: resolve(distDir, "index.d.ts"),
	format: "es",
});

await bundle.close();

await rm(typesDir, { recursive: true, force: true });
