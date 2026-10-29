import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const arrayOr = (value: unknown, fallback: unknown[] = []) => Array.isArray(value) ? value : fallback;
const objectOr = (value: unknown, fallback: Record<string, unknown> = {}) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fallback;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("Authorization");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return json({ error: "Sessão inválida." }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await adminClient.from("profiles").select("role,name,email").eq("id", authData.user.id).maybeSingle();
    const user = authData.user;
    const callerName = String(profile?.name || user.user_metadata?.name || user.email?.split("@")[0] || "Funcionário");
    const callerEmail = String(profile?.email || user.email || "").toLowerCase();
    const role = profile?.role || user.app_metadata?.role || user.user_metadata?.role || "employee";
    const body = await request.json();
    const { data: current, error: readError } = await adminClient.from("app_state").select("*").eq("id", "default").maybeSingle();
    if (readError) throw readError;

    const incoming = {
      clients: arrayOr(body.clients, current?.clients || []),
      employees: arrayOr(body.employees, current?.employees || []),
      services: arrayOr(body.services, current?.services || []),
      reports: arrayOr(body.reports, current?.reports || []),
      time_entries: arrayOr(body.time_entries, current?.time_entries || []),
      company_settings: objectOr(body.company_settings, current?.company_settings || {}),
      employee_profile: objectOr(body.employee_profile, current?.employee_profile || {}),
    };

    const isMine = (item: Record<string, unknown>) => {
      const employee = String(item.employee || item.name || "").toLowerCase();
      return employee === callerName.toLowerCase() || (!!callerEmail && employee === callerEmail);
    };

    const payload = role === "admin" ? incoming : {
      clients: current?.clients || [],
      employees: current?.employees || [],
      services: current?.services || [],
      company_settings: current?.company_settings || {},
      reports: incoming.reports.filter((item) => isMine(item as Record<string, unknown>)),
      time_entries: incoming.time_entries.filter((item) => isMine(item as Record<string, unknown>)),
      employee_profile: { ...(current?.employee_profile || {}), [user.id]: { ...incoming.employee_profile, name: callerName, email: user.email || callerEmail } },
    };

    const { data: saved, error: saveError } = await adminClient.from("app_state").upsert({
      id: "default",
      ...payload,
      updated_at: new Date().toISOString(),
    }).select("*").single();
    if (saveError) throw saveError;
    return json({ state: saved });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Não foi possível guardar os dados." }, 400);
  }
});
