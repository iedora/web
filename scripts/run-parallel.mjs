#!/usr/bin/env bun
// Corre um script em todos os workspaces em paralelo.
// `bun run --workspaces <task>` corre em série (8 cores parados a olhar
// para um a fazer trabalho). Para typecheck/lint/test são workspaces
// independentes — paraleliza tudo, falha se algum falhar.
//
// Uso: bun run scripts/run-parallel.mjs <task>
// Ex.:  bun run scripts/run-parallel.mjs typecheck

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const task = process.argv[2];
if (!task) {
	console.error("usage: run-parallel.mjs <task>");
	process.exit(2);
}

const ROOTS = ["packages", "products", "apps"];
const workspaces = [];
for (const root of ROOTS) {
	for (const name of await readdir(root, { withFileTypes: true })) {
		if (!name.isDirectory()) continue;
		const dir = join(root, name.name);
		try {
			const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
			if (pkg.scripts?.[task]) workspaces.push({ dir, name: pkg.name ?? name.name });
		} catch {}
	}
}

if (workspaces.length === 0) {
	console.log(`(no workspaces define '${task}')`);
	process.exit(0);
}

console.log(`▶ ${task} × ${workspaces.length} workspaces in parallel`);
const t0 = Date.now();

const results = await Promise.all(
	workspaces.map(
		(w) =>
			new Promise((resolve) => {
				const chunks = [];
				const child = spawn("bun", ["run", task], {
					cwd: w.dir,
					stdio: ["ignore", "pipe", "pipe"],
					env: { ...process.env, FORCE_COLOR: "1" },
				});
				child.stdout.on("data", (c) => chunks.push(c));
				child.stderr.on("data", (c) => chunks.push(c));
				child.on("close", (code) => {
					const ms = Date.now() - t0;
					resolve({ ...w, code, output: Buffer.concat(chunks).toString(), ms });
				});
			}),
	),
);

results.sort((a, b) => a.ms - b.ms);
const failed = results.filter((r) => r.code !== 0);

for (const r of results) {
	const mark = r.code === 0 ? "✓" : "✗";
	console.log(`${mark} ${r.name} (${(r.ms / 1000).toFixed(1)}s)`);
}

if (failed.length) {
	console.log("");
	for (const r of failed) {
		console.log(`── ${r.name} ──`);
		console.log(r.output.trim());
	}
	process.exit(1);
}
