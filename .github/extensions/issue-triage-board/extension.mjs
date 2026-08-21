import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();
const statusLabels = ["triage:backlog", "triage:ready", "triage:in-progress", "triage:blocked", "triage:done"];
const columns = [
    { id: "backlog", label: "Backlog", color: "#8b949e" },
    { id: "ready", label: "Ready", color: "#58a6ff" },
    { id: "in-progress", label: "In progress", color: "#d29922" },
    { id: "blocked", label: "Blocked", color: "#f85149" },
    { id: "done", label: "Done", color: "#3fb950" },
];
const extensionDirectory = dirname(fileURLToPath(import.meta.url));

async function findRepositoryRoot() {
    let directory = extensionDirectory;
    while (directory !== dirname(directory)) {
        try {
            await access(join(directory, ".git"));
            return directory;
        } catch {
            directory = dirname(directory);
        }
    }
    throw new Error("Could not find the repository root for the issue triage board.");
}

function htmlEscape(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function runGh(workspacePath, args, input) {
    const options = { cwd: workspacePath, maxBuffer: 10 * 1024 * 1024 };
    if (input === undefined) {
        const { stdout } = await execFileAsync("gh", args, options);
        return stdout;
    }
    const { stdout } = await execFileAsync("gh", args, { ...options, input });
    return stdout;
}

async function getRepository(workspacePath) {
    const remote = await runGh(workspacePath, ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    return remote.trim();
}

async function getIssues(workspacePath) {
    const repository = await getRepository(workspacePath);
    const output = await runGh(workspacePath, [
        "api",
        `repos/${repository}/issues`,
        "--paginate",
        "--method",
        "GET",
        "-f",
        "state=all",
        "-f",
        "per_page=100",
    ]);
    const issues = JSON.parse(output);
    return {
        repository,
        issues: issues
            .filter((issue) => !issue.pull_request)
            .map((issue) => ({
                number: issue.number,
                title: issue.title,
                body: issue.body ?? "",
                url: issue.html_url,
                state: issue.state,
                author: issue.user?.login ?? "unknown",
                labels: issue.labels.map((label) => label.name),
                updatedAt: issue.updated_at,
            })),
    };
}

async function updateIssue(workspacePath, number, status) {
    if (!columns.some((column) => column.id === status)) {
        throw new Error(`Unknown triage status: ${status}`);
    }
    const repository = await getRepository(workspacePath);
    const issue = JSON.parse(await runGh(workspacePath, [
        "api",
        `repos/${repository}/issues/${number}`,
    ]));
    const args = ["issue", "edit", String(number), "--repo", repository, "--add-label", `triage:${status}`];
    for (const label of issue.labels.map((item) => item.name).filter((name) => statusLabels.includes(name))) {
        if (label !== `triage:${status}`) {
            args.push("--remove-label", label);
        }
    }
    await runGh(workspacePath, args);
    if (status === "done" && issue.state === "open") {
        await runGh(workspacePath, ["issue", "close", String(number), "--repo", repository]);
    } else if (status !== "done" && issue.state === "closed") {
        await runGh(workspacePath, ["issue", "reopen", String(number), "--repo", repository]);
    }
    return { number, status };
}

function renderHtml(instanceId) {
    const serializedColumns = JSON.stringify(columns);
    return `<!doctype html>
<html lang="en" data-color-mode="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Issue triage board</title>
<style>
:root { color-scheme: dark; --bg: #0d1117; --panel: #161b22; --border: #30363d; --muted: #8b949e; --text: #f0f6fc; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
h1 { margin: 0; font-size: 22px; }
.subtitle { color: var(--muted); margin: 4px 0 0; }
button { border: 1px solid var(--border); border-radius: 6px; background: #21262d; color: var(--text); padding: 7px 12px; cursor: pointer; }
button:hover, button:focus-visible { background: #30363d; outline: 2px solid #58a6ff; outline-offset: 2px; }
.board { display: grid; grid-template-columns: repeat(5, minmax(190px, 1fr)); gap: 12px; align-items: start; overflow-x: auto; }
.column { min-height: 420px; padding: 10px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; }
.column.over { border-color: #58a6ff; background: #1c2733; }
.column-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom: 10px; font-weight: 600; }
.count { color: var(--muted); font-weight: 400; }
.card { margin: 8px 0; padding: 12px; background: #21262d; border: 1px solid var(--border); border-radius: 7px; cursor: grab; }
.card:active { cursor: grabbing; }
.card-title { color: var(--text); text-decoration: none; font-weight: 600; }
.card-title:hover { color: #58a6ff; }
.meta { margin-top: 8px; color: var(--muted); font-size: 12px; }
.labels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.label { padding: 2px 6px; border-radius: 999px; background: #30363d; color: #c9d1d9; font-size: 11px; }
.empty { color: var(--muted); text-align: center; padding: 24px 4px; }
#status { min-height: 22px; color: var(--muted); }
@media (max-width: 1100px) { .board { grid-template-columns: repeat(5, 220px); } }
</style>
</head>
<body>
<header>
  <div><h1>Issue triage board</h1><p class="subtitle">Drag issues between columns to update their triage label and open/closed state.</p></div>
  <button id="refresh" type="button">Refresh</button>
</header>
<div id="status" role="status" aria-live="polite"></div>
<main id="board" class="board" aria-label="Issue triage columns"></main>
<script>
const instanceId = ${JSON.stringify(instanceId)};
const columns = ${serializedColumns};
const board = document.querySelector("#board");
const status = document.querySelector("#status");
let issues = [];

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function issueStatus(issue) {
  const label = issue.labels.find((item) => item.startsWith("triage:"));
  if (label) return label.slice("triage:".length);
  return issue.state === "closed" ? "done" : "backlog";
}
function render() {
  board.innerHTML = columns.map((column) => {
    const matching = issues.filter((issue) => issueStatus(issue) === column.id);
    return '<section class="column" data-status="' + column.id + '" tabindex="0" aria-label="' + column.label + '">' +
      '<div class="column-heading"><span>' + column.label + '</span><span class="count">' + matching.length + '</span></div>' +
      (matching.length ? matching.map((issue) => '<article class="card" draggable="true" data-number="' + issue.number + '">' +
        '<a class="card-title" href="' + escapeHtml(issue.url) + '" target="_blank" rel="noreferrer">#' + issue.number + ' ' + escapeHtml(issue.title) + '</a>' +
        '<div class="meta">' + escapeHtml(issue.state) + ' · ' + escapeHtml(issue.author) + '</div>' +
        '<div class="labels">' + issue.labels.filter((label) => !label.startsWith("triage:")).map((label) => '<span class="label">' + escapeHtml(label) + '</span>').join("") + '</div>' +
      '</article>').join("") : '<div class="empty">No issues</div>') +
    '</section>';
  }).join("");
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", card.dataset.number));
  });
  document.querySelectorAll(".column").forEach((column) => {
    column.addEventListener("dragover", (event) => { event.preventDefault(); column.classList.add("over"); });
    column.addEventListener("dragleave", () => column.classList.remove("over"));
    column.addEventListener("drop", async (event) => {
      event.preventDefault(); column.classList.remove("over");
      await moveIssue(event.dataTransfer.getData("text/plain"), column.dataset.status);
    });
  });
}
async function load() {
  status.textContent = "Loading issues…";
  const response = await fetch("/api/issues");
  if (!response.ok) throw new Error(await response.text());
  issues = (await response.json()).issues;
  render();
  status.textContent = issues.length + " issues loaded";
}
async function moveIssue(number, targetStatus) {
  status.textContent = "Updating #" + number + "…";
  const response = await fetch("/api/issues/update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: Number(number), status: targetStatus }) });
  if (!response.ok) { status.textContent = "Could not update issue: " + await response.text(); return; }
  await load();
}
document.querySelector("#refresh").addEventListener("click", () => load().catch((error) => { status.textContent = error.message; }));
load().catch((error) => { status.textContent = error.message; });
</script>
</body>
</html>`;
}

async function startServer(instanceId, workspacePath) {
    const server = createServer(async (req, res) => {
        try {
            if (req.method === "GET" && req.url === "/api/issues") {
                const result = await getIssues(workspacePath);
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(result));
                return;
            }
            if (req.method === "POST" && req.url === "/api/issues/update") {
                let body = "";
                for await (const chunk of req) body += chunk;
                const payload = JSON.parse(body);
                const result = await updateIssue(workspacePath, payload.number, payload.status);
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(result));
                return;
            }
            if (req.method === "GET" && req.url === "/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(renderHtml(instanceId));
                return;
            }
            res.writeHead(404);
            res.end("Not found");
        } catch (error) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(error instanceof Error ? error.message : String(error));
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "Issue triage board",
            description: "Interactive Kanban board for triaging this repository's GitHub issues.",
            actions: [
                {
                    name: "refresh_issues",
                    description: "Load the repository's current GitHub issues and their triage statuses.",
                    handler: async () => getIssues(await findRepositoryRoot()),
                },
                {
                    name: "update_issue_status",
                    description: "Move a GitHub issue to a triage column by updating its triage label and open/closed state.",
                    inputSchema: {
                        type: "object",
                        properties: { number: { type: "integer" }, status: { type: "string", enum: columns.map((column) => column.id) } },
                        required: ["number", "status"],
                        additionalProperties: false,
                    },
                    handler: async (ctx) => updateIssue(await findRepositoryRoot(), ctx.input.number, ctx.input.status),
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId, await findRepositoryRoot());
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Issue triage board", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
