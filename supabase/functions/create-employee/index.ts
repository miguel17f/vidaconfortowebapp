import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: callerData } = await callerClient.auth.getUser();
    if (!callerData.user) {
      return new Response(JSON.stringify({ error: "Sessão inválida." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerProfile } = await adminClient.from("profiles").select("role").eq("id", callerData.user.id).maybeSingle();
    const callerRole = callerProfile?.role || callerData.user.user_metadata?.role;
    if (callerRole !== "admin") {
      return new Response(JSON.stringify({ error: "Apenas administradores podem criar utilizadores." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { email, password, name, role = "employee", update = false, delete: deleteUser = false, user_id } = await request.json();
    const safeRole = role === "admin" ? "admin" : "employee";
    if (deleteUser && user_id) {
      const { data: targetProfile } = await adminClient.from("profiles").select("role").eq("id", user_id).maybeSingle();
      if (targetProfile?.role === "admin") {
        const { count } = await adminClient.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
        if ((count || 0) <= 1) return new Response(JSON.stringify({ error: "Não é possível eliminar o último administrador." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { error } = await adminClient.auth.admin.deleteUser(user_id);
      if (error) throw error;
      return new Response(JSON.stringify({ deleted: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!email || !name || (!update && !password)) {
      return new Response(JSON.stringify({ error: "Nome, email e palavra-passe são obrigatórios." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (update && user_id) {
      const updatePayload = {
        email,
        user_metadata: { name, role: safeRole },
        ...(password ? { password } : {}),
      };
      const { data, error } = await adminClient.auth.admin.updateUserById(user_id, updatePayload);
      if (error) throw error;
      await adminClient.from("profiles").upsert({ id: user_id, email, name, role: safeRole, updated_at: new Date().toISOString() });
      return new Response(JSON.stringify({ user: data.user }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: safeRole },
    });
    if (error) throw error;

    await adminClient.from("profiles").upsert({ id: data.user.id, email, name, role: safeRole, updated_at: new Date().toISOString() });

    return new Response(JSON.stringify({ user: data.user }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Não foi possível criar o utilizador." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
