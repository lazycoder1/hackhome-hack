import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { SubmitRequirementsBlobInput } from "../orchestrator/orchestrator.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".json"]);

export type ImportRequirementsOptions = {
  participants?: SubmitRequirementsBlobInput["participants"];
  sourceId?: string;
};

/**
 * Read a dropped `.md` / `.txt` / `.json` requirements file into a `SubmitRequirementsBlobInput`
 * (`source: "file"`). `.md`/`.txt` become the blob text verbatim; `.json` is parsed into
 * `text` (its `text` field, or the pretty-printed object) plus `structuredHints`.
 */
export async function loadRequirementsBlobFromFile(
  filePath: string,
  options: ImportRequirementsOptions = {},
): Promise<SubmitRequirementsBlobInput> {
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported requirements file type "${ext}". Use .md, .txt, or .json.`);
  }

  const raw = await readFile(filePath, "utf8");
  const filename = basename(filePath);
  const base = {
    source: "file" as const,
    filename,
    participants: options.participants ?? [],
    sourceMetadata: { sourceId: options.sourceId ?? filename },
  };

  if (ext === ".json") {
    return { ...base, ...parseJsonBlob(raw) };
  }
  return { ...base, text: raw.trim() };
}

function parseJsonBlob(raw: string): {
  text: string;
  structuredHints?: Record<string, unknown>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Requirements .json file is not valid JSON.");
  }

  if (typeof parsed === "string") {
    return { text: parsed };
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : JSON.stringify(parsed, null, 2);
    return { text, structuredHints: record };
  }
  return { text: String(parsed) };
}
