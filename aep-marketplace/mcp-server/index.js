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
