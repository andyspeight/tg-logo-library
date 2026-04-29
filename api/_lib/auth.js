import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import crypto from 'crypto';

// ============ RATE LIMITING ============

let redis = null;
function getRedis() {
  if (!redis && process.env.UPSTASH_REDIS_REST_URL) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    });
  }
  return redis;
}

const limiters = {};
function getLimiter(name, limit, window) {
  const r = getRedis();
  if (!r) return null;
  if (!limiters[name]) {
    limiters[name] = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: `tg-logo:${name}`
    });
  }
  return limiters[name];
}

export function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/** Rate-limit check. Returns { ok: boolean, remaining, reset }. */
export async function rateLimit(req, name = 'default', limit = 30, window = '1 m') {
  const limiter = getLimiter(name, limit, window);
  if (!limiter) {
    // No Redis configured — allow but warn
    console.warn('[auth] Rate limiter not configured, allowing request');
    return { ok: true, remaining: limit, reset: 0 };
  }
  const ip = getClientIp(req);
  const result = await limiter.limit(ip);
  return {
    ok: result.success,
    remaining: result.remaining,
    reset: result.reset
  };
}

// ============ ADMIN AUTH ============

/**
 * Constant-time password comparison.
 * Reads the password from the X-Admin-Password header.
 * Returns true/false. Calling code is responsible for sending 401 on false.
 */
export function checkAdminPassword(req) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    console.error('[auth] ADMIN_PASSWORD not configured');
    return false;
  }

  const supplied = req.headers['x-admin-password'] || '';
  if (typeof supplied !== 'string' || supplied.length === 0) return false;

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Standard "deny" response for failed auth. */
export function denyUnauthorized(res) {
  return res.status(401).json({ error: 'Unauthorized' });
}

/** Standard "deny" response for rate limits. */
export function denyRateLimit(res, reset) {
  res.setHeader('Retry-After', Math.ceil((reset - Date.now()) / 1000));
  return res.status(429).json({ error: 'Too many requests' });
}
