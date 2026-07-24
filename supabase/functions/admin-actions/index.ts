import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function supaFetch(url: string, method: string, body?: object, secretKey?: string) {
  const res = await fetch(url, {
    method,
    headers: {
      apikey: secretKey!,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    const body = await req.json();

    // Create contest
    if (action === "create-contest") {
      const { name, description, votePrice } = body;
      if (!name) return new Response(JSON.stringify({ error: "Name is required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      const result = await supaFetch(`${SUPABASE_URL}/rest/v1/contests`, "POST", {
        name, description: description || "", vote_price: parseFloat(votePrice) || 100, active: true,
      }, SUPABASE_SECRET_KEY);
      return new Response(JSON.stringify({ success: true, contest: result?.[0] }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Toggle contest
    if (action === "toggle-contest") {
      const { contestId, active } = body;
      await supaFetch(`${SUPABASE_URL}/rest/v1/contests?id=eq.${contestId}`, "PATCH", { active }, SUPABASE_SECRET_KEY);
      return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Delete contest
    if (action === "delete-contest") {
      const { contestId } = body;
      await supaFetch(`${SUPABASE_URL}/rest/v1/contests?id=eq.${contestId}`, "DELETE", undefined, SUPABASE_SECRET_KEY);
      return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Add contestant
    if (action === "add-contestant") {
      const { contestId, name, photo } = body;
      if (!contestId || !name) return new Response(JSON.stringify({ error: "contestId and name required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      const result = await supaFetch(`${SUPABASE_URL}/rest/v1/contestants`, "POST", {
        contest_id: contestId, name, photo: photo || "", votes: 0,
      }, SUPABASE_SECRET_KEY);
      return new Response(JSON.stringify({ success: true, contestant: result?.[0] }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Delete contestant
    if (action === "delete-contestant") {
      const { contestantId } = body;
      await supaFetch(`${SUPABASE_URL}/rest/v1/contestants?id=eq.${contestantId}`, "DELETE", undefined, SUPABASE_SECRET_KEY);
      return new Response(JSON.stringify({ success: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
