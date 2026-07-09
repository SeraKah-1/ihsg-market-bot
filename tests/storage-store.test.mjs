/**
 * Smoke test: storage-store pure helpers via dynamic import won't work (firebase CDN).
 * Validate source contracts instead.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = fs.readFileSync(path.join(root, "frontend/js/storage-store.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "frontend/js/storage-ui.js"), "utf8");
const html = fs.readFileSync(path.join(root, "frontend/index.html"), "utf8");

assert.match(store, /sys_briefings/);
assert.match(store, /sys_deep_dives/);
assert.match(store, /saveGeneratedDoc/);
assert.match(store, /createFolder/);
assert.match(store, /deleteDocRecord/);
assert.match(store, /ihsg_folders/);
assert.match(store, /ihsg_docs/);

assert.match(ui, /openEmitenPanel/);
assert.match(ui, /openStorageDoc/);
assert.match(ui, /data-main-view/);

assert.match(html, /view-storage/);
assert.match(html, /emiten-panel/);
assert.match(html, /btn-storage-new-folder/);

const orch = fs.readFileSync(path.join(root, "frontend/js/orchestrate.js"), "utf8");
assert.match(orch, /saveGeneratedDoc/);
assert.match(orch, /kind: "briefing"/);
assert.match(orch, /kind: "deep_dive"/);

console.log("storage-store.test.mjs OK");
