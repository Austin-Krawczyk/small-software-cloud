// Unit tests for the MCP server's file-packing logic.
import assert from "node:assert/strict";
import { test } from "node:test";
import AdmZip from "adm-zip";
import { zipFiles } from "../mcp/actions.mjs";

test("zipFiles: packs files (including nested paths) into a readable zip", () => {
  const buf = zipFiles([
    { path: "package.json", content: '{"name":"x"}' },
    { path: "src/index.js", content: "console.log(1)" },
    { path: "/leading-slash.txt", content: "ok" },
  ]);
  const zip = new AdmZip(buf);
  const names = zip.getEntries().map((e) => e.entryName).sort();
  assert.deepEqual(names, ["leading-slash.txt", "package.json", "src/index.js"]);
  assert.equal(zip.getEntry("package.json")!.getData().toString(), '{"name":"x"}');
});

test("zipFiles: rejects empty or malformed input", () => {
  assert.throws(() => zipFiles([]), /files/i);
  assert.throws(() => zipFiles([{ path: "x" } as any]), /content/i);
  assert.throws(() => zipFiles("nope" as any), /files/i);
});
