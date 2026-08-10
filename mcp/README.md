# Small Software Cloud — MCP server

Let an AI agent (Claude, Cursor, Codex, …) create and deploy small apps to your
Small Software Cloud directly. The agent writes the files; one tool call builds,
deploys, and returns a live HTTPS URL.

## Setup

1. Create an **API token** on your account page (`https://YOURDOMAIN/account`).
2. Point your MCP client at `mcp/server.mjs` with that token in the environment.
   Requires Node 20+ and `npm install` having been run in this repo.

### Claude Desktop / Claude Code
Add to your MCP config (`claude_desktop_config.json`, or `claude mcp add`):

```json
{
  "mcpServers": {
    "small-software-cloud": {
      "command": "node",
      "args": ["/absolute/path/to/small-software-cloud/mcp/server.mjs"],
      "env": {
        "SMALLSOFTWARE_TOKEN": "scloud_your_token",
        "SMALLSOFTWARE_SERVER": "https://YOURDOMAIN"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)
Same shape as above under `mcpServers`.

### Codex (`~/.codex/config.toml`)
```toml
[mcp_servers.small-software-cloud]
command = "node"
args = ["/absolute/path/to/small-software-cloud/mcp/server.mjs"]
env = { SMALLSOFTWARE_TOKEN = "scloud_your_token", SMALLSOFTWARE_SERVER = "https://YOURDOMAIN" }
```

`SMALLSOFTWARE_SERVER` defaults to `https://taskicloud.com` if omitted.

## Tools

| Tool | What it does |
|---|---|
| `deploy_new_app` | Create a project from files (or a git URL) and deploy it → live URL. Optionally share by email. The one-shot tool. |
| `deploy_app` | Deploy/redeploy an existing project with new files or source. |
| `list_projects` | List your projects with status and URLs. |
| `project_status` | A project's status, URL, and recent logs. |
| `share_app` | Share a project by email (`collaborator` or `editor`). |
| `set_env` | Set an environment variable / secret. |

## Example

> "Build a tiny web page that shows a random dad joke and deploy it as *Dad Jokes*."

The agent generates `index.html` (or a small server), calls `deploy_new_app`
with the files, and replies with `https://dad-jokes.YOURDOMAIN/`.

Files must be a **small app**: a Node server (`package.json` + a file listening on
`process.env.PORT`), a Python FastAPI/Flask app, or a static site (`index.html`).
