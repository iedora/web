#!/usr/bin/env bun
// Lê JSON output de `hadolint --format json` em stdin, emite Gitea
// Actions workflow annotations (::warning::/::error::) + tabela
// Markdown para o log. Exit 1 só se houver level=error.
//
// Workflow command syntax (compat GitHub Actions):
//   ::warning file=X,line=Y,col=Z,title=CODE::msg

interface Finding {
	file: string;
	line: number;
	column?: number;
	code: string;
	message: string;
	level: "error" | "warning" | "info" | "style";
}

const raw = await Bun.stdin.text();
const data = JSON.parse(raw) as Finding[];

if (data.length === 0) {
	console.log("✓ hadolint: no issues");
	process.exit(0);
}

let exitCode = 0;

console.log(`## hadolint: ${data.length} finding(s)\n`);
console.log("| File | Line | Code | Level | Message |");
console.log("| ---- | ---- | ---- | ----- | ------- |");

for (const f of data) {
	const lvl = f.level ?? "info";
	const col = f.column ?? 1;

	console.log(`| \`${f.file}\` | ${f.line} | \`${f.code}\` | ${lvl} | ${f.message} |`);

	// Gitea/GitHub Actions split on commas/colons em key=value pairs.
	// Escape o message conforme spec (`%25` para `%`, `%0D` para CR, `%0A` para LF).
	const safeMsg = f.message
		.replace(/%/g, "%25")
		.replace(/\r/g, "%0D")
		.replace(/\n/g, "%0A");

	const annot = lvl === "error" ? "error" : "warning";
	console.log(
		`::${annot} file=${f.file},line=${f.line},col=${col},title=${f.code}::${safeMsg}`,
	);

	if (lvl === "error") exitCode = 1;
}

process.exit(exitCode);
