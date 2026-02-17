export const corsHeaders = {
  // "*" to allow local file:// (origin "null") and GitHub Pages.
  // If you want to lock it down later, replace with your domain.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-audit-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
