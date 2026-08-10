#!/usr/bin/env node
// Small Software Cloud MCP server. Exposes the platform as tools an AI agent
// (Claude, Cursor, Codex, …) can call to create and deploy small apps directly.
//
// Run over stdio; configure your MCP client to launch:
//   node /path/to/small-software-cloud/mcp/server.mjs
// with env SMALLSOFTWARE_TOKEN (from your account page) and optionally
// SMALLSOFTWARE_SERVER (defaults to https://taskicloud.com).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as actions from "./actions.mjs";

const fileArray = {
  type: "array",
  description: "The app's files. Small apps only — a Node server (package.json + server.js, listening on process.env.PORT), a Python FastAPI/Flask app, or a static site (index.html).",
  items: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative path, e.g. 'server.js' or 'src/index.html'." },
      content: { type: "string", description: "UTF-8 file contents." },
    },
    required: ["path", "content"],
  },
};

const TOOLS = [
  {
    name: "deploy_new_app",
    description:
      "Create a project from generated files (or a public git repo) and deploy it, returning a live HTTPS URL. The one-shot way to put a small app online. Optionally share it with colleagues by email.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "App name (also becomes the URL slug)." },
        description: { type: "string" },
        files: fileArray,
        repository_url: { type: "string", description: "Public https git URL, as an alternative to files." },
        share_with: { type: "array", items: { type: "string" }, description: "Emails to share the app with." },
      },
      required: ["name"],
    },
  },
  {
    name: "list_projects",
    description: "List the caller's projects with their status and live URLs.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "deploy_app",
    description: "Deploy (or redeploy) an existing project — with new files, a new git URL, or its current source. Returns the live URL or failure logs.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project id, slug, or name." },
        files: fileArray,
        repository_url: { type: "string" },
      },
      required: ["project"],
    },
  },
  {
    name: "project_status",
    description: "Get a project's deployment status, live URL, and recent logs.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project id, slug, or name." } },
      required: ["project"],
    },
  },
  {
    name: "share_app",
    description: "Share a project with someone by email. role is 'collaborator' (use) or 'editor' (use + deploy).",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        email: { type: "string" },
        role: { type: "string", enum: ["collaborator", "editor"] },
      },
      required: ["project", "email"],
    },
  },
  {
    name: "set_env",
    description: "Set an environment variable / secret on a project (applied on the next deploy).",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["project", "key", "value"],
    },
  },
];

const DISPATCH = {
  deploy_new_app: actions.createAndDeploy,
  list_projects: () => actions.listProjects(),
  deploy_app: actions.deployApp,
  project_status: actions.projectStatus,
  share_app: actions.shareProject,
  set_env: actions.setEnv,
};

const server = new Server(
  { name: "small-software-cloud", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const fn = DISPATCH[name];
  if (!fn) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  try {
    const result = await fn(args ?? {});
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
