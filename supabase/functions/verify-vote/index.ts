import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { contestId, contestantId, voterName, reference } = await req.json();

    const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!reference) {
      return new Response(JSON.stringify({ error: "Payment reference missing" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // 1. Verify payment with Paystack
    const psRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const psJson = await psRes.json();
    if (!psJson.status || psJson.data.status !== "success") {
      return new Response(JSON.stringify({ error: "Payment verification failed" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const paystackData = psJson.data;

    // 2. Verify contestant + contest exist and are active
    const rowsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/contestants?id=eq.${contestantId}&select=id,name,contest_id,contests(id,name,active,vote_price)`,
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY!,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        },
      }
    );
    const rows = await rowsRes.json();
    const contestant = rows?.[0];
    if (!contestant) {
      return new Response(JSON.stringify({ error: "Contestant not found" }), {
        status: 404,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    if (!contestant.contests?.active) {
      return new Response(JSON.stringify({ error: "Contest is not active" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // 3. Verify amount paid matches vote price
    const expectedAmountKobo = parseInt(contestant.contests.vote_price) * 100;
    if (paystackData.amount < expectedAmountKobo) {
      return new Response(JSON.stringify({ error: `Insufficient payment. Expected ₦${contestant.contests.vote_price}` }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // 4. Atomic vote increment via RPC
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_votes`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SECRET_KEY!,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_contestant_id: contestantId }),
    });

    // 5. Log to feed
    await fetch(`${SUPABASE_URL}/rest/v1/feed`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SECRET_KEY!,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        voter_name: (voterName || "Someone").trim().slice(0, 60),
        contestant_id: contestantId,
        contestant_name: contestant.name,
        contest_id: contestId,
        contest_name: contestant.contests.name,
      }),
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
