import Anthropic from '@anthropic-ai/sdk';
import { checkAdminPassword, denyUnauthorized, rateLimit, denyRateLimit } from './_lib/auth.js';

// Known travel-industry brands. Add to this as you go.
const KNOWN_DOMAINS = {
  'virgin atlantic': 'virginatlantic.com',
  'jet2': 'jet2.com',
  'jet2 holidays': 'jet2holidays.com',
  'tui': 'tui.co.uk',
  'hotelbeds': 'hotelbeds.com',
  'ratehawk': 'ratehawk.com',
  'webbeds': 'webbeds.com',
  'etihad': 'etihad.com',
  'etihad holidays': 'etihadholidays.com',
  'gold medal': 'goldmedal.co.uk',
  'aerticket': 'aerticket.de',
  'faremine': 'faremine.com',
  'holiday taxis': 'holidaytaxis.com',
  'flexible autos': 'flexibleautos.com',
  'travelgenix': 'travelgenix.io',
  'british airways': 'britishairways.com',
  'easyjet': 'easyjet.com',
  'ryanair': 'ryanair.com',
  'emirates': 'emirates.com',
  'qatar airways': 'qatarairways.com',
  'singapore airlines': 'singaporeair.com',
  'lufthansa': 'lufthansa.com',
  'air france': 'airfrance.com',
  'klm': 'klm.com'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkAdminPassword(req)) return denyUnauthorized(res);

  const rl = await rateLimit(req, 'resolve', 30, '1 m');
  if (!rl.ok) return denyRateLimit(res, rl.reset);

  const { brand } = req.body || {};
  if (!brand || typeof brand !== 'string' || brand.length > 200) {
    return res.status(400).json({ error: 'Invalid brand name' });
  }

  const trimmed = brand.trim();
  const lower = trimmed.toLowerCase();

  // 1. Known brands map
  if (KNOWN_DOMAINS[lower]) {
    return res.json({
      domain: KNOWN_DOMAINS[lower],
      method: 'known-brands',
      confidence: 'high'
    });
  }

  // 2. Claude API fallback for unknown brands
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `What is the official primary domain for the company "${trimmed}"?\n\nRespond with ONLY the domain (no protocol, no path), like "example.com". If you don't know, respond with exactly "UNKNOWN".`
        }]
      });

      const text = message.content[0]?.text?.trim().toLowerCase();
      if (text && text !== 'unknown' && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(text)) {
        return res.json({
          domain: text,
          method: 'ai-resolver',
          confidence: 'medium'
        });
      }
    } catch (err) {
      console.error('[resolve-domain] AI resolver failed:', err.message);
    }
  }

  // 3. Naive fallback
  const naive = lower.replace(/\s+/g, '').replace(/[^a-z0-9]/g, '') + '.com';
  return res.json({
    domain: naive,
    method: 'naive-fallback',
    confidence: 'low'
  });
}
