import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRequirementsBlobFromFile } from "../src/ingest/requirements-file-importer.js";

describe("loadRequirementsBlobFromFile", () => {
  it("reads a markdown blob as verbatim text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "poc-import-"));
    const file = join(dir, "requirements.md");
    await writeFile(file, "# Acme\n\nAcme wants to evaluate PostHog.\n");

    const blob = await loadRequirementsBlobFromFile(file, {
      participants: [{ email: "buyer@acme.test" }],
    });

    expect(blob.source).toBe("file");
    expect(blob.filename).toBe("requirements.md");
    expect(blob.text).toContain("Acme wants to evaluate PostHog.");
    expect(blob.participants).toEqual([{ email: "buyer@acme.test" }]);
  });

  it("reads a json blob into text plus structuredHints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "poc-import-"));
    const file = join(dir, "requirements.json");
    await writeFile(file, JSON.stringify({ text: "Acme wants PostHog", priority: "high" }));

    const blob = await loadRequirementsBlobFromFile(file);

    expect(blob.text).toBe("Acme wants PostHog");
    expect(blob.structuredHints).toMatchObject({ priority: "high" });
  });

  it("rejects unsupported file types", async () => {
    await expect(loadRequirementsBlobFromFile("requirements.pdf")).rejects.toThrow(/Unsupported/);
  });
});
