# MarketNow — Agent Skill Marketplace

The largest open MCP skill marketplace. 13,000+ verified MCP-compatible skills.

## MCP Server

Add to your `~/.claude/settings.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "marketnow": {
      "type": "http",
      "url": "https://www.marketnow.site/mcp"
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `search_skills` | Search 13,000+ skills by keyword or category |
| `get_skill_details` | Full docs, MCP config, benchmarks for any skill |
| `list_categories` | Browse all skill categories with counts |
| `get_marketplace_stats` | Marketplace-wide metrics |
| `purchase_skill` | Get payment link and MCP config for a skill |

## Quick Test

```bash
curl -X POST https://www.marketnow.site/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
