import { spawn } from "node:child_process";

import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";

import { enableDebug } from "../../debug-logger.js";
import { dispatchDirectPhase } from "../../auto-direct-dispatch.js";
import { handleConfig } from "../../commands-config.js";
import { handleDoctor, handleCapture, handleKnowledge, handleRunHook, handleSkillHealth, handleSteer, handleTriage, handleUpdate } from "../../commands-handlers.js";
import { handleInspect } from "../../commands-inspect.js";
import { handleLogs } from "../../commands-logs.js";
import { handleCleanupBranches, handleCleanupSnapshots, handleSkip } from "../../commands-maintenance.js";
import { handleExport } from "../../export.js";
import { handleHistory } from "../../history.js";
import { handleUndo } from "../../undo.js";
import { handleRemote } from "../../../remote-questions/mod.js";
import { projectRoot } from "../context.js";

let activeDetachedWebAttachPid: number | null = null;

export async function handleOpsCommand(trimmed: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<boolean> {
  if (trimmed === "init") {
    const { detectProjectState } = await import("../../detection.js");
    const { handleReinit, showProjectInit } = await import("../../init-wizard.js");
    const basePath = projectRoot();
    const detection = detectProjectState(basePath);
    if (detection.state === "v2-gsd" || detection.state === "v2-gsd-empty") {
      await handleReinit(ctx, detection);
    } else {
      await showProjectInit(ctx, pi, basePath, detection);
    }
    return true;
  }
  if (trimmed === "keys" || trimmed.startsWith("keys ")) {
    const { handleKeys } = await import("../../key-manager.js");
    await handleKeys(trimmed.replace(/^keys\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "doctor" || trimmed.startsWith("doctor ")) {
    await handleDoctor(trimmed.replace(/^doctor\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "logs" || trimmed.startsWith("logs ")) {
    await handleLogs(trimmed.replace(/^logs\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "forensics" || trimmed.startsWith("forensics ")) {
    const { handleForensics } = await import("../../forensics.js");
    await handleForensics(trimmed.replace(/^forensics\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "changelog" || trimmed.startsWith("changelog ")) {
    const { handleChangelog } = await import("../../changelog.js");
    await handleChangelog(trimmed.replace(/^changelog\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "history" || trimmed.startsWith("history ")) {
    await handleHistory(trimmed.replace(/^history\s*/, "").trim(), ctx, projectRoot());
    return true;
  }
  if (trimmed === "undo" || trimmed.startsWith("undo ")) {
    await handleUndo(trimmed.replace(/^undo\s*/, "").trim(), ctx, pi, projectRoot());
    return true;
  }
  if (trimmed.startsWith("skip ")) {
    await handleSkip(trimmed.replace(/^skip\s*/, "").trim(), ctx, projectRoot());
    return true;
  }
  if (trimmed === "export" || trimmed.startsWith("export ")) {
    await handleExport(trimmed.replace(/^export\s*/, "").trim(), ctx, projectRoot());
    return true;
  }
  if (trimmed === "cleanup") {
    await handleCleanupBranches(ctx, projectRoot());
    await handleCleanupSnapshots(ctx, projectRoot());
    return true;
  }
  if (trimmed === "cleanup branches") {
    await handleCleanupBranches(ctx, projectRoot());
    return true;
  }
  if (trimmed === "cleanup snapshots") {
    await handleCleanupSnapshots(ctx, projectRoot());
    return true;
  }
  if (trimmed.startsWith("capture ") || trimmed === "capture") {
    await handleCapture(trimmed.replace(/^capture\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "triage") {
    await handleTriage(ctx, pi, process.cwd());
    return true;
  }
  if (trimmed === "config") {
    await handleConfig(ctx);
    return true;
  }
  if (trimmed === "hooks") {
    const { formatHookStatus } = await import("../../post-unit-hooks.js");
    ctx.ui.notify(formatHookStatus(), "info");
    return true;
  }
  if (trimmed === "skill-health" || trimmed.startsWith("skill-health ")) {
    await handleSkillHealth(trimmed.replace(/^skill-health\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed.startsWith("run-hook ")) {
    await handleRunHook(trimmed.replace(/^run-hook\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "run-hook") {
    ctx.ui.notify(`Usage: /gsd run-hook <hook-name> <unit-type> <unit-id>

Unit types:
  execute-task   - Task execution (unit-id: M001/S01/T01)
  plan-slice     - Slice planning (unit-id: M001/S01)
  research-milestone - Milestone research (unit-id: M001)
  complete-slice - Slice completion (unit-id: M001/S01)
  complete-milestone - Milestone completion (unit-id: M001)

Examples:
  /gsd run-hook code-review execute-task M001/S01/T01
  /gsd run-hook lint-check plan-slice M001/S01`, "warning");
    return true;
  }
  if (trimmed.startsWith("steer ")) {
    await handleSteer(trimmed.replace(/^steer\s+/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "steer") {
    ctx.ui.notify("Usage: /gsd steer <description of change>. Example: /gsd steer Use Postgres instead of SQLite", "warning");
    return true;
  }
  if (trimmed.startsWith("knowledge ")) {
    await handleKnowledge(trimmed.replace(/^knowledge\s+/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "knowledge") {
    ctx.ui.notify("Usage: /gsd knowledge <rule|pattern|lesson> <description>. Example: /gsd knowledge rule Use real DB for integration tests", "warning");
    return true;
  }
  if (trimmed === "migrate" || trimmed.startsWith("migrate ")) {
    const { handleMigrate } = await import("../../migrate/command.js");
    await handleMigrate(trimmed.replace(/^migrate\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "remote" || trimmed.startsWith("remote ")) {
    await handleRemote(trimmed.replace(/^remote\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "dispatch" || trimmed.startsWith("dispatch ")) {
    const phase = trimmed.replace(/^dispatch\s*/, "").trim();
    if (!phase) {
      ctx.ui.notify("Usage: /gsd dispatch <phase>  (research|plan|execute|complete|reassess|uat|replan)", "warning");
      return true;
    }
    await dispatchDirectPhase(ctx, pi, phase, projectRoot());
    return true;
  }
  if (trimmed === "inspect") {
    await handleInspect(ctx);
    return true;
  }
  if (trimmed === "update") {
    await handleUpdate(ctx);
    return true;
  }
  if (trimmed === "web-attach" || trimmed.startsWith("web-attach ")) {
    const rawArgs = trimmed.replace(/^web-attach\s*/, "").trim();
    const args = splitQuotedArgs(rawArgs);

    let attachFlags;
    try {
      attachFlags = parseSlashWebAttachArgs(args, "/gsd web-attach");
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
      return true;
    }

    const cliPath = process.env.GSD_BIN_PATH || process.argv[1];
    if (!cliPath) {
      ctx.ui.notify("Cannot determine the GSD CLI path for web-attach.", "error");
      return true;
    }

    // Keep the compatibility alias non-blocking, but ensure only one detached
    // bridge is active per session and that it gets torn down on shutdown.
    stopDetachedWebAttachBridge();

    // Launch the compatibility bridge as a detached process group so the TUI
    // stays responsive. We track the group leader PID and terminate the group
    // on session shutdown so the bridge and its child RPC process do not leak.
    const child = spawn(process.execPath, [
      cliPath,
      "web",
      "attach",
      "--manager",
      attachFlags.managerUrl,
      ...(attachFlags.hostLabel ? ["--host-label", attachFlags.hostLabel] : []),
      ...(attachFlags.instanceId ? ["--instance-id", attachFlags.instanceId] : []),
    ], {
      cwd: projectRoot(),
      env: process.env,
      stdio: "ignore",
      detached: true,
    });

    activeDetachedWebAttachPid = child.pid ?? null;
    child.once("exit", () => {
      if (activeDetachedWebAttachPid === child.pid) {
        activeDetachedWebAttachPid = null;
      }
    });
    child.unref();

    ctx.ui.notify(
      `Started web attach bridge in the background.\n` +
      `Manager: ${attachFlags.managerUrl}\n` +
      `Project: ${projectRoot()}\n` +
      `PID: ${child.pid ?? "unknown"}`,
      "info",
    );
    return true;
  }
  if (trimmed === "extensions" || trimmed.startsWith("extensions ")) {
    const { handleExtensions } = await import("../../commands-extensions.js");
    await handleExtensions(trimmed.replace(/^extensions\s*/, "").trim(), ctx);
    return true;
  }
  return false;
}

export function cleanupDetachedWebAttachBridge(): void {
  stopDetachedWebAttachBridge();
}

function splitQuotedArgs(input: string): string[] {
  if (!input) return [];

  const tokens = input.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g) ?? [];
  return tokens.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"'))
      || (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function parseSlashWebAttachArgs(
  args: string[],
  commandLabel: string,
): { managerUrl: string; hostLabel?: string; instanceId?: string } {
  const flags: { managerUrl: string; hostLabel?: string; instanceId?: string } = {
    managerUrl: "",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--manager" && i + 1 < args.length) {
      flags.managerUrl = args[++i]!;
    } else if (arg === "--host-label" && i + 1 < args.length) {
      flags.hostLabel = args[++i];
    } else if (arg === "--instance-id" && i + 1 < args.length) {
      flags.instanceId = args[++i];
    } else {
      throw new Error(
        `Unknown web attach option: ${arg}\n` +
        `Usage: ${commandLabel} --manager <ws-url> [--host-label <label>] [--instance-id <id>]`,
      );
    }
  }

  if (!flags.managerUrl) {
    throw new Error(
      `web attach requires --manager <ws-url>\n` +
      `Usage: ${commandLabel} --manager <ws-url> [--host-label <label>] [--instance-id <id>]`,
    );
  }

  return flags;
}

function stopDetachedWebAttachBridge(): void {
  if (!activeDetachedWebAttachPid) return;

  const pid = activeDetachedWebAttachPid;
  activeDetachedWebAttachPid = null;

  try {
    // Detached children become their own process group leaders. Killing the
    // negative PID tears down both the bridge and the RPC subprocess it owns.
    process.kill(-pid, "SIGTERM");
    return;
  } catch {
    // Fall back to the direct PID for environments that reject negative PIDs.
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Best-effort cleanup only.
  }
}
