import type { PatchPactCommand } from "./types.js";

const COMMANDS: Record<string, PatchPactCommand> = {
  "/contract create": { kind: "contract", action: "create" },
  "/contract refresh": { kind: "contract", action: "refresh" },
  "/contract approve": { kind: "contract", action: "approve" },
  "/contract waive": { kind: "contract", action: "waive" },
  "/packet explain": { kind: "packet", action: "explain" },
};

export function parseSlashCommand(
  body: string | null | undefined,
): PatchPactCommand | null {
  if (!body) {
    return null;
  }
  const firstLineRaw = body.trim().split(/\r?\n/, 1)[0]?.trim();
  const firstLine = firstLineRaw?.toLowerCase();
  if (!firstLine) {
    return null;
  }

  for (const [prefix, command] of Object.entries(COMMANDS)) {
    if (firstLine === prefix) {
      return command;
    }
    if (firstLine.startsWith(`${prefix} `)) {
      return {
        ...command,
        ...(command.kind === "contract"
          ? { argumentText: firstLineRaw.slice(prefix.length).trim() }
          : {}),
      };
    }
  }

  return null;
}
