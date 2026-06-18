# CLAUDE.md — marketnow.site agent fix instructions

Para antigravity: ejecuta estas instrucciones en orden. No saltes pasos.

Contexto del repo
Stack: React 19 + TypeScript + Vite 8 + Tailwind CSS + Framer Motion
Los skills están en `src/data/all_skills.json` (generados por `generate_skills.cjs`)
El dominio es `marketnow.site` (custom domain, NO GitHub Pages)
Problema raíz: ningún agente AI puede entrar, buscar ni comprar

---

PASO 1 — Arregla el `vite.config.ts` (base path roto)
El `base: '/marketnow/'` hace que todos los assets fallen en el dominio raíz.
Archivo: `vite.config.ts` — reemplaza todo con:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

---

PASO 2 — Crea `public/robots.txt` (actualmente bloquea TODO)
El site devuelve `Disallow: /` para crawlers. Reemplaza o crea:
Archivo: `public/robots.txt`
```
User-agent: *
Allow: /
Allow: /api/
Allow: /mcp

User-agent: ModelContextProtocol
Allow: /
Crawl-delay: 1

User-agent: ClaudeBot
Allow: /
Allow: /api/

Sitemap: https://www.marketnow.site/sitemap.xml

# MCP server endpoint para agentes
X-MCP-Endpoint: https://www.marketnow.site/mcp
```

---

PASO 3 — Crea `public/.well-known/agent.json` (descubrimiento de agentes)
Archivo: `public/.well-known/agent.json`
```json
{
  "name": "MarketNow Skill Marketplace",
  "description": "The largest open MCP skill marketplace. Search, discover and install 13,000+ MCP-compatible skills for autonomous agents.",
  "version": "1.0.0",
  "mcp_endpoint": "https://www.marketnow.site/mcp",
  "capabilities": ["search_skills", "get_skill_details", "list_categories", "purchase_skill"],
  "pricing": "per-skill",
  "auth": "none_required_for_search",
  "contact": "https://www.marketnow.site"
}
```

---

PASO 4 — Crea el servidor MCP completo
Este es el fix más importante. Crea un directorio `mcp-server/` en la raíz del repo.
4.1 `mcp-server/package.json`
```json
{
  "name": "marketnow-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "zod": "^3.25.67"
  }
}
```

4.2 `mcp-server/index.js`
```js
import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carga el catálogo de skills generado
const SKILLS_PATH = join(__dirname, '..', 'src', 'data', 'all_skills.json');
let allSkills = [];
try {
  allSkills = JSON.parse(readFileSync(SKILLS_PATH, 'utf-8'));
  console.log(`Loaded ${allSkills.length} skills`);
} catch (e) {
  console.warn('No skills JSON found, using empty catalog');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function searchSkills(query, category, maxResults = 20) {
  const q = query?.toLowerCase() ?? '';
  return allSkills
    .filter(s => {
      const matchesQuery = !q ||
        s.name?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.tagline?.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q);
      const matchesCategory = !category || s.category === category;
      return matchesQuery && matchesCategory;
    })
    .slice(0, Math.min(maxResults, 50))
    .map(s => ({
      id: s.id,
      name: s.name,
      tagline: s.tagline,
      category: s.category,
      price: s.price,
      rating: s.rating,
      trustScore: s.trustScore,
      verified: s.verified,
      successRate: s.successRate,
      latency: s.latency,
      executions: s.executions,
    }));
}

function getSkillById(id) {
  return allSkills.find(s => s.id === id) ?? null;
}

function getCategories() {
  const counts = {};
  for (const s of allSkills) {
    counts[s.category] = (counts[s.category] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// ── MCP Server ───────────────────────────────────────────────────────────────
function createMcpServer() {
  const server = new McpServer({
    name: 'marketnow',
    version: '1.0.0',
  });

  // Tool: search_skills
  server.tool(
    'search_skills',
    {
      query: z.string().optional().describe('Keyword to search (name, description, category)'),
      category: z.string().optional().describe('Filter by category e.g. DevOps, Security, Finance'),
      max_results: z.number().int().min(1).max(50).optional().default(10),
    },
    async ({ query, category, max_results }) => {
      const results = searchSkills(query, category, max_results);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total_found: results.length,
            query: query ?? null,
            category: category ?? null,
            skills: results,
          }, null, 2),
        }],
      };
    }
  );

  // Tool: get_skill_details
  server.tool(
    'get_skill_details',
    {
      skill_id: z.string().describe('The skill ID (e.g. aep-net-abc123)'),
    },
    async ({ skill_id }) => {
      const skill = getSkillById(skill_id);
      if (!skill) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Skill not found', skill_id }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(skill, null, 2) }],
      };
    }
  );

  // Tool: list_categories
  server.tool(
    'list_categories',
    {},
    async () => {
      const categories = getCategories();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total_categories: categories.length,
            total_skills: allSkills.length,
            categories,
          }, null, 2),
        }],
      };
    }
  );

  // Tool: get_marketplace_stats
  server.tool(
    'get_marketplace_stats',
    {},
    async () => {
      const verified = allSkills.filter(s => s.verified).length;
      const avgRating = (allSkills.reduce((a, s) => a + (s.rating ?? 0), 0) / allSkills.length).toFixed(2);
      const priceRange = {
        min: Math.min(...allSkills.map(s => s.price)),
        max: Math.max(...allSkills.map(s => s.price)),
        avg: Math.round(allSkills.reduce((a, s) => a + s.price, 0) / allSkills.length),
      };
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total_skills: allSkills.length,
            verified_skills: verified,
            average_rating: parseFloat(avgRating),
            price_range_usd: priceRange,
            categories: getCategories().length,
            mcp_endpoint: 'https://www.marketnow.site/mcp',
          }, null, 2),
        }],
      };
    }
  );

  // Tool: purchase_skill (stub — integrar pago real después)
  server.tool(
    'purchase_skill',
    {
      skill_id: z.string().describe('ID of the skill to purchase'),
      agent_wallet: z.string().optional().describe('Agent wallet address for crypto payment'),
      payment_method: z.enum(['crypto', 'stripe']).optional().default('stripe'),
    },
    async ({ skill_id, agent_wallet, payment_method }) => {
      const skill = getSkillById(skill_id);
      if (!skill) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Skill not found' }) }],
          isError: true,
        };
      }
      // TODO: integrar Stripe o x402 micropayments aquí
      // Por ahora devuelve instrucciones de pago
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'payment_required',
            skill_id,
            skill_name: skill.name,
            price_usd: skill.price,
            payment_url: `https://www.marketnow.site/checkout?skill=${skill_id}`,
            mcp_config: skill.doc?.mcpConfig ?? null,
            note: 'Visit payment_url to complete purchase. After payment, mcp_config will be activated.',
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version', 'Mcp-Session-Id'],
}));

app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', skills_loaded: allSkills.length });
});

// MCP endpoint — Streamable HTTP transport
app.post('/mcp', async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => Math.random().toString(36).slice(2),
  });
  res.on('close', () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

// GET /mcp — info for agents that probe with GET
app.get('/mcp', (_req, res) => {
  res.json({
    name: 'MarketNow MCP Server',
    version: '1.0.0',
    protocol: 'MCP 2025-06-18',
    transport: 'streamable-http',
    endpoint: 'POST https://www.marketnow.site/mcp',
    tools: ['search_skills', 'get_skill_details', 'list_categories', 'get_marketplace_stats', 'purchase_skill'],
    total_skills: allSkills.length,
  });
});

// REST API — mantiene compatibilidad con el frontend React
app.get('/api/skills.json', (req, res) => {
  const { q, category, limit = '50' } = req.query;
  const results = searchSkills(q, category, parseInt(limit));
  res.json(results);
});

app.get('/api/categories.json', (_req, res) => {
  res.json(getCategories());
});

app.get('/api/skill/:id', (req, res) => {
  const skill = getSkillById(req.params.id);
  if (!skill) return res.status(404).json({ error: 'Not found' });
  res.json(skill);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`MarketNow MCP Server running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Skills loaded: ${allSkills.length}`);
});
```

---

PASO 5 — Genera los skills antes de hacer build
El archivo `src/data/all_skills.json` probablemente no está en el repo (`.gitignore`). Agrega el comando al build.
Modifica `package.json` en la raíz:
```json
{
  "name": "marketnow",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:mcp": "cd mcp-server && node --watch index.js",
    "dev:all": "concurrently \"npm run dev\" \"npm run dev:mcp\"",
    "prebuild": "node generate_skills.cjs",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "mcp:install": "cd mcp-server && npm install",
    "mcp:start": "cd mcp-server && npm start"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "framer-motion": "^12.38.0",
    "lucide-react": "^1.14.0",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "tailwind-merge": "^3.6.0"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^24.12.2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "autoprefixer": "^10.5.0",
    "concurrently": "^9.0.1",
    "eslint": "^10.2.1",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.5.0",
    "postcss": "^8.5.14",
    "tailwindcss": "^3.4.19",
    "typescript": "~6.0.2",
    "typescript-eslint": "^8.58.2",
    "vite": "^8.0.10"
  }
}
```

Arregla `generate_skills.cjs` — la ruta de salida puede fallar si `src/data/` no existe:
```js
// Agrega esto antes de fs.writeFileSync en generate_skills.cjs:
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}
```

---

PASO 6 — Agrega CORS headers al frontend estático
Crea `public/_headers` (para Cloudflare Pages / Netlify):
```
/api/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization
  X-Robots-Tag: index, follow

/mcp
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Allow-Headers: Content-Type, MCP-Protocol-Version, Mcp-Session-Id

/*
  X-Robots-Tag: index, follow
```

Si el deploy es en Vercel, crea `vercel.json` en la raíz:
```json
{
  "rewrites": [
    { "source": "/mcp", "destination": "https://marketnow-mcp.railway.app/mcp" },
    { "source": "/api/(.*)", "destination": "https://marketnow-mcp.railway.app/api/$1" }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Cache-Control", "value": "public, max-age=300" }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Robots-Tag", "value": "index, follow" }
      ]
    }
  ]
}
```

---

PASO 7 — Deploy del servidor MCP
El servidor MCP necesita correr como proceso Node.js separado (no puede ser Cloudflare Pages que solo sirve static).

Opción A: Railway (recomendado, gratis para empezar)
Crea `mcp-server/railway.toml`:
```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm install"

[deploy]
startCommand = "node index.js"
healthcheckPath = "/health"
healthcheckTimeout = 10
restartPolicyType = "ON_FAILURE"
```
Luego en Railway:
New Project → Deploy from GitHub repo
Root directory: `mcp-server`
Variables: `PORT=3001`
Custom domain: `mcp.marketnow.site` (o usa el subdominio de Railway)

Opción B: Cloudflare Workers (si ya usas CF)
```sh
# En mcp-server/:
npm install -D wrangler
npx wrangler init --no-delegate-c3
```
`mcp-server/wrangler.toml`:
```toml
name = "marketnow-mcp"
main = "worker.js"
compatibility_date = "2026-01-01"

[[kv_namespaces]]
binding = "SKILLS"
id = "TU_KV_ID_AQUI"
```
Nota: Con Workers, sube el JSON de skills a KV en lugar de leerlo del filesystem.

---

PASO 8 — Actualiza el `README.md` del repo con la configuración MCP
Reemplaza el README actual con este contenido (esto también sirve para los directorios MCP):
```md
# MarketNow — Agent Skill Marketplace

The largest open MCP skill marketplace. 13,000+ verified MCP-compatible skills.

## MCP Server

Add to your `~/.claude/settings.json` or `claude_desktop_config.json`:

\`\`\`json
{
  "mcpServers": {
    "marketnow": {
      "type": "http",
      "url": "https://www.marketnow.site/mcp"
    }
  }
}
\`\`\`

## Available Tools

| Tool | Description |
|------|-------------|
| `search_skills` | Search 13,000+ skills by keyword or category |
| `get_skill_details` | Full docs, MCP config, benchmarks for any skill |
| `list_categories` | Browse all skill categories with counts |
| `get_marketplace_stats` | Marketplace-wide metrics |
| `purchase_skill` | Get payment link and MCP config for a skill |

## Quick Test

\`\`\`bash
curl -X POST https://www.marketnow.site/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
\`\`\`
```

---

PASO 9 — Registra en directorios MCP (MANUAL, después del deploy)
Una vez el endpoint `/mcp` esté respondiendo, registra aquí:
mcp.so → https://chat.mcp.so/submit
Name: `MarketNow Skill Marketplace`
GitHub: `https://github.com/edgarfloresguerra2011-a11y/marketnow`
Description: `13,000+ MCP-compatible skills for autonomous agents. Search, buy, install.`
Smithery → https://smithery.ai (conecta GitHub, detecta el servidor automáticamente)
mcpservers.org → abre PR al repo https://github.com/chatmcpclient/mcp_server_market

---

Orden de ejecución para antigravity
```
1. Modifica vite.config.ts          → base: '/'
2. Crea public/robots.txt           → Allow: /
3. Crea public/.well-known/agent.json
4. Crea public/_headers             → CORS headers
5. Arregla generate_skills.cjs      → mkdirSync antes de writeFileSync
6. Modifica package.json raíz       → agrega prebuild + concurrently
7. Crea mcp-server/ completo        → package.json + index.js + railway.toml
8. Modifica README.md               → instrucciones MCP
9. npm run prebuild                 → genera src/data/all_skills.json
10. npm run build                   → build del frontend
11. cd mcp-server && npm install    → instala deps del servidor
12. git add . && git commit -m "feat: add MCP server + fix robots + fix base path"
13. git push origin master
14. Deploy mcp-server en Railway    → manual
15. Actualiza vercel.json/CF config → apunta /mcp al Railway deploy
```
