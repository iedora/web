#!/usr/bin/env bun
// Corre um script em todos os workspaces em paralelo, com cap igual ao
// número de cores disponíveis. `bun run --workspaces <task>` corre em
// série (8 cores parados a olhar para um a fazer trabalho); spawn de
// todos ao mesmo tempo sem cap explode em context-switching quando há
// mais workspaces que cores (ESLint/Vitest são CPU-heavy, contention
// piora wall time).
//
// Concurrency = availableParallelism() respeita cgroup --cpus limits
// (importante em CI: o job container do Gitea runner é capped, sem
// isto spawnaríamos 9 jobs em containers de 4 cores).
//
// Override: CONCURRENCY=N bun run scripts/run-parallel.mjs <task>
// Uso:      bun run scripts/run-parallel.mjs <task>

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";

const task = process.argv[2];
if (!task) {
	console.error("usage: run-parallel.mjs <task>");
	process.exit(2);
}

const concurrency = Math.max(
	1,
	Number(process.env.CONCURRENCY) || availableParallelism(),
);

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

console.log(
	`▶ ${task} × ${workspaces.length} workspaces, concurrency=${concurrency}`,
);
const t0 = Date.now();

function runOne(w) {
	return new Promise((resolve) => {
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
	});
}

// Pool with bounded concurrency. Each worker pulls the next workspace
// off the queue when its previous job finishes — keeps `concurrency`
// in-flight at any time without over-subscription.
const queue = [...workspaces];
const results = [];
async function worker() {
	while (queue.length) {
		const w = queue.shift();
		results.push(await runOne(w));
	}
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

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
