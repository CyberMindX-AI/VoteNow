import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { password } = await req.json();
    const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "admin1234";

    if (password === ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({ error: "Invalid password" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
