import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { DefaultResourceLoader } = await import("../../packages/pi-coding-agent/dist/core/resource-loader.js");

function createLoaderPaths() {
	const root = mkdtempSync(join(tmpdir(), "gsd-append-system-"));
	const projectDir = join(root, "project");
	const configDir = join(root, ".gsd");
	const agentDir = join(configDir, "agent");
	mkdirSync(projectDir, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	return { root, projectDir, configDir, agentDir };
}

test("DefaultResourceLoader loads APPEND_SYSTEM.md from the global config directory root", async () => {
	const { root, projectDir, configDir, agentDir } = createLoaderPaths();

	try {
		writeFileSync(join(configDir, "APPEND_SYSTEM.md"), "Always answer in pirate voice.");

		const loader = new DefaultResourceLoader({
			cwd: projectDir,
			agentDir,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
		});

		await loader.reload();

		assert.deepEqual(loader.getAppendSystemPrompt(), ["Always answer in pirate voice."]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("DefaultResourceLoader still falls back to the legacy agent APPEND_SYSTEM.md path", async () => {
	const { root, projectDir, agentDir } = createLoaderPaths();

	try {
		writeFileSync(join(agentDir, "APPEND_SYSTEM.md"), "Always mention the changelog.");

		const loader = new DefaultResourceLoader({
			cwd: projectDir,
			agentDir,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
		});

		await loader.reload();

		assert.deepEqual(loader.getAppendSystemPrompt(), ["Always mention the changelog."]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
