import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT                  = process.env.PORT || 3000;
const SUPABASE_URL          = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY   = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_PASSWORD        = process.env.ADMIN_PASSWORD || 'admin1234';
const PAYSTACK_SECRET_KEY   = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY   = process.env.PAYSTACK_PUBLIC_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}

// ─── Supabase REST helper (server-side, secret key) ─────────────────────────
async function supa(method, endpoint, body = null) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'apikey':        SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase error [${res.status}]: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Server ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url      = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method   = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  try {

    // ── Serve HTML (inject public keys for client-side realtime & paystack) ──
    if (method === 'GET' && (pathname === '/' || pathname === '/admin')) {
      let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      html = html.replace(/__SUPABASE_URL__/g,      SUPABASE_URL);
      html = html.replace(/__SUPABASE_ANON_KEY__/g, SUPABASE_PUBLISHABLE_KEY);
      html = html.replace(/__PAYSTACK_PUBLIC_KEY__/g, PAYSTACK_PUBLIC_KEY);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ══════════════════════════════════════════════════════════════════════

    // Verify Paystack Payment and Cast Vote
    if (method === 'POST' && pathname === '/api/vote/verify') {
      const { contestId, contestantId, voterName, reference } = await parseBody(req);
      if (!reference) return json(res, 400, { error: 'Payment reference missing' });

      // 1. Verify payment with Paystack
      let paystackData;
      try {
        const psRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
          headers: {
            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`
          }
        });
        const psJson = await psRes.json();
        if (!psJson.status || psJson.data.status !== 'success') {
          return json(res, 400, { error: 'Payment verification failed' });
        }
        paystackData = psJson.data;
      } catch (e) {
        return json(res, 500, { error: 'Paystack connection error' });
      }

      // 2. Verify contestant + contest exist and are active
      const rows = await supa('GET',
        `contestants?id=eq.${contestantId}&select=id,name,contest_id,contests(id,name,active,vote_price)`
      );
      const contestant = rows?.[0];
      if (!contestant)                    return json(res, 404, { error: 'Contestant not found' });
      if (!contestant.contests?.active)   return json(res, 400, { error: 'Contest is not active' });

      // 3. Verify amount paid matches the vote price (Paystack uses kobo, so * 100)
      const expectedAmountKobo = parseInt(contestant.contests.vote_price) * 100;
      if (paystackData.amount < expectedAmountKobo) {
        return json(res, 400, { error: `Insufficient payment. Expected ₦${contestant.contests.vote_price}` });
      }

      // 4. Atomic vote increment via RPC
      await supa('POST', 'rpc/increment_votes', { p_contestant_id: contestantId });

      // 5. Log to feed
      await supa('POST', 'feed', {
        voter_name:      (voterName || 'Someone').trim().slice(0, 60),
        contestant_id:   contestantId,
        contestant_name: contestant.name,
        contest_id:      contestId,
        contest_name:    contestant.contests.name,
      });

      return json(res, 200, { success: true });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  ADMIN API
    // ══════════════════════════════════════════════════════════════════════

    // Login
    if (method === 'POST' && pathname === '/api/admin/login') {
      const { password } = await parseBody(req);
      if (password === ADMIN_PASSWORD) return json(res, 200, { success: true });
      return json(res, 401, { error: 'Invalid password' });
    }

    // Create contest
    if (method === 'POST' && pathname === '/api/admin/contest/create') {
      const { name, description, votePrice } = await parseBody(req);
      if (!name) return json(res, 400, { error: 'Name is required' });
      const result = await supa('POST', 'contests', {
        name,
        description: description || '',
        vote_price:  parseFloat(votePrice) || 100,
        active:      true,
      });
      return json(res, 200, { success: true, contest: result?.[0] });
    }

    // Toggle contest active/inactive
    if (method === 'POST' && pathname === '/api/admin/contest/toggle') {
      const { contestId, active } = await parseBody(req);
      await supa('PATCH', `contests?id=eq.${contestId}`, { active });
      return json(res, 200, { success: true });
    }

    // Delete contest (cascades to contestants + feed via FK)
    if (method === 'POST' && pathname === '/api/admin/contest/delete') {
      const { contestId } = await parseBody(req);
      await supa('DELETE', `contests?id=eq.${contestId}`);
      return json(res, 200, { success: true });
    }

    // Add contestant
    if (method === 'POST' && pathname === '/api/admin/contestant/add') {
      const { contestId, name, photo } = await parseBody(req);
      if (!contestId || !name) return json(res, 400, { error: 'contestId and name required' });
      const result = await supa('POST', 'contestants', {
        contest_id: contestId,
        name,
        photo: photo || '',
        votes: 0,
      });
      return json(res, 200, { success: true, contestant: result?.[0] });
    }

    // Delete contestant
    if (method === 'POST' && pathname === '/api/admin/contestant/delete') {
      const { contestantId } = await parseBody(req);
      await supa('DELETE', `contestants?id=eq.${contestantId}`);
      return json(res, 200, { success: true });
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');

  } catch (err) {
    console.error('Server error:', err.message);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`✅  VoteNow running → http://localhost:${PORT}`);
  console.log(`🔒  Admin panel   → http://localhost:${PORT}/admin`);
  console.log(`☁️   Supabase URL  → ${SUPABASE_URL}`);
});
