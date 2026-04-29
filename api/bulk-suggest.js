import Anthropic from '@anthropic-ai/sdk';
import { checkAdminPassword, denyUnauthorized, rateLimit, denyRateLimit } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkAdminPassword(req)) return denyUnauthorized(res);

  // Rate limit — this hits Claude API so keep it tight
  const rl = await rateLimit(req, 'bulk-suggest', 10, '1 m');
  if (!rl.ok) return denyRateLimit(res, rl.reset);

  const { category, limit } = req.body || {};
  if (!category || typeof category !== 'string' || category.length < 2 || category.length > 200) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  const max = Math.min(parseInt(limit, 10) || 30, 100);

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI suggester not configured' });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `List the ${max} most well-known and currently-operating brands in this category: "${category.trim()}".

Context: this is for a UK travel-tech company building a logo library, so prioritise brands relevant to UK travel agents and tour operators where applicable.

Rules:
- Return ONLY brand names, one per line
- Use the brand's commonly-used name (e.g. "British Airways" not "British Airways plc")
- No numbering, no bullets, no explanations, no preamble
- Skip brands that no longer operate or have been fully merged/rebranded
- For airlines, skip cargo-only operators
- For hotels, prefer chain/group names over individual properties
- If the category is too vague or returns fewer than 5 results, that is fine — return what you have

Return only the list of brand names.`
      }]
    });

    const text = message.content[0]?.text || '';
    const brands = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && line.length < 100)
      // Strip common formatting artefacts even though we asked for none
      .map(line => line.replace(/^[\d]+[.)]\s*/, ''))   // "1. Brand"
      .map(line => line.replace(/^[-*•]\s*/, ''))        // "- Brand"
      .map(line => line.replace(/^["']|["']$/g, ''))     // surrounding quotes
      .filter(line => line.length > 0)
      .slice(0, max);

    return res.json({
      category: category.trim(),
      count: brands.length,
      brands
    });
  } catch (err) {
    console.error('[bulk-suggest] Failed:', err.message);
    return res.status(500).json({ error: 'Suggester failed' });
  }
}
