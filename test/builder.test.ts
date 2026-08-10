// Unit tests for build detection: URL sanitizing, app-type detection, Python
// framework/entry inference, and the Node server-vs-static decision.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BuildError, detectAppType, nodeServerCmd, normalizeGitUrl, pythonEntry,
} from "../lib/builder";

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scloud-test-"));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

test("normalizeGitUrl: strips tracking query/fragment and trailing slash", () => {
  assert.equal(normalizeGitUrl("https://github.com/u/r?utm_source=chatgpt.com"), "https://github.com/u/r");
  assert.equal(normalizeGitUrl("https://github.com/u/r/"), "https://github.com/u/r");
  assert.equal(normalizeGitUrl("https://github.com/u/r#readme"), "https://github.com/u/r");
});

test("normalizeGitUrl: rejects non-https and pathless URLs", () => {
  assert.throws(() => normalizeGitUrl("git@github.com:u/r.git"), BuildError);
  assert.throws(() => normalizeGitUrl("https://github.com"), BuildError);
  assert.throws(() => normalizeGitUrl("ftp://x/y"), BuildError);
});

test("detectAppType: recognizes node / python / static, rejects unknown", () => {
  assert.equal(detectAppType(tmp({ "package.json": "{}" })), "node");
  assert.equal(detectAppType(tmp({ "main.py": "" })), "python");
  assert.equal(detectAppType(tmp({ "requirements.txt": "flask" })), "python");
  assert.equal(detectAppType(tmp({ "index.html": "<h1>" })), "static");
  assert.equal(detectAppType(tmp({ "public/index.html": "<h1>" })), "static");
  assert.throws(() => detectAppType(tmp({ "readme.txt": "hi" })), BuildError);
});

test("pythonEntry: FastAPI -> uvicorn, Flask -> gunicorn", () => {
  const fast = pythonEntry(tmp({ "main.py": "from fastapi import FastAPI\napp = FastAPI()" }));
  assert.deepEqual(fast, { entry: "main:app", pyServer: "uvicorn" });

  const flask = pythonEntry(tmp({ "app.py": "from flask import Flask\napp = Flask(__name__)" }));
  assert.deepEqual(flask, { entry: "app:app", pyServer: "gunicorn" });

  // Django-style wsgi.py exposing `application`.
  const dj = pythonEntry(tmp({ "wsgi.py": "import django\napplication = get_wsgi_application()" }));
  assert.equal(dj.pyServer, "gunicorn");
  assert.equal(dj.entry, "wsgi:application");
});

test("nodeServerCmd: start script, server file, or null (static)", () => {
  assert.deepEqual(nodeServerCmd({ scripts: { start: "node x" } }, tmp({})), ["npm", "start"]);
  assert.deepEqual(nodeServerCmd({}, tmp({ "server.js": "" })), ["node", "server.js"]);
  assert.equal(nodeServerCmd({}, tmp({})), null); // no server -> treated as a static frontend
});
