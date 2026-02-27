import { assertEquals, assertRejects } from "https://deno.land/std@0.190.0/assert/mod.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "./supabase.ts";

Deno.test("createAdminClient lança quando SUPABASE_URL está vazio", () => {
  const origUrl = Deno.env.get("SUPABASE_URL");
  const origKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.set("SUPABASE_URL", "");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "key");
    assertRejects(
      () => createAdminClient(),
      Error,
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.",
    );
  } finally {
    if (origUrl !== undefined) Deno.env.set("SUPABASE_URL", origUrl);
    if (origKey !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", origKey);
  }
});

Deno.test("createAdminClient lança quando SUPABASE_SERVICE_ROLE_KEY está vazio", () => {
  const origUrl = Deno.env.get("SUPABASE_URL");
  const origKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.set("SUPABASE_URL", "https://x.supabase.co");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "");
    assertRejects(
      () => createAdminClient(),
      Error,
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.",
    );
  } finally {
    if (origUrl !== undefined) Deno.env.set("SUPABASE_URL", origUrl);
    if (origKey !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", origKey);
  }
});

Deno.test("createAdminClient retorna cliente quando env está preenchido", () => {
  const origUrl = Deno.env.get("SUPABASE_URL");
  const origKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.set("SUPABASE_URL", "https://x.supabase.co");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    const client = createAdminClient();
    assertEquals(typeof client.auth.getUser, "function");
    assertEquals(typeof client.from, "function");
  } finally {
    if (origUrl !== undefined) Deno.env.set("SUPABASE_URL", origUrl);
    if (origKey !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", origKey);
  }
});

Deno.test("getAuthenticatedUserId lança quando Authorization está ausente", async () => {
  const req = new Request("https://x.com", { headers: {} });
  await assertRejects(
    () => getAuthenticatedUserId(req),
    Error,
    "Token Bearer ausente.",
  );
});

Deno.test("getAuthenticatedUserId lança quando Authorization não é Bearer", async () => {
  const req = new Request("https://x.com", {
    headers: { Authorization: "Basic xyz" },
  });
  await assertRejects(
    () => getAuthenticatedUserId(req),
    Error,
    "Token Bearer ausente.",
  );
});

Deno.test("getAuthenticatedUserId lança quando Bearer está vazio", async () => {
  const origUrl = Deno.env.get("SUPABASE_URL");
  const origKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.set("SUPABASE_URL", "https://x.supabase.co");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "key");
    const req = new Request("https://x.com", {
      headers: { Authorization: "Bearer   " },
    });
    await assertRejects(
      () => getAuthenticatedUserId(req),
      Error,
      "Token Bearer invalido.",
    );
  } finally {
    if (origUrl !== undefined) Deno.env.set("SUPABASE_URL", origUrl);
    if (origKey !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", origKey);
  }
});

Deno.test("getAuthenticatedUserId lança quando usuário não autenticado (token inválido)", async () => {
  const origUrl = Deno.env.get("SUPABASE_URL");
  const origKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.set("SUPABASE_URL", "https://x.supabase.co");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "key");
    const req = new Request("https://x.com", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    await assertRejects(
      () => getAuthenticatedUserId(req),
      Error,
      "Usuario nao autenticado.",
    );
  } finally {
    if (origUrl !== undefined) Deno.env.set("SUPABASE_URL", origUrl);
    if (origKey !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", origKey);
  }
});

Deno.test("getAuthenticatedUserId retorna user id com token válido", async () => {
  const origUrl = Deno.env.get("SUPABASE_URL");
  const origKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.set("SUPABASE_URL", "https://x.supabase.co");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "key");
    const req = new Request("https://x.com", {
      headers: { Authorization: "Bearer valid-jwt" },
    });
    const userId = await getAuthenticatedUserId(req);
    assertEquals(userId, "user-123");
  } finally {
    if (origUrl !== undefined) Deno.env.set("SUPABASE_URL", origUrl);
    if (origKey !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", origKey);
  }
});

Deno.test("getUserTenantId retorna tenant_id do mock", async () => {
  const origUrl = Deno.env.get("SUPABASE_URL");
  const origKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.set("SUPABASE_URL", "https://x.supabase.co");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "key");
    const tenantId = await getUserTenantId("user-123");
    assertEquals(tenantId, "tenant-456");
  } finally {
    if (origUrl !== undefined) Deno.env.set("SUPABASE_URL", origUrl);
    if (origKey !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", origKey);
  }
});

Deno.test("getUserTenantId lança quando não há tenant para o usuário", async () => {
  const origUrl = Deno.env.get("SUPABASE_URL");
  const origKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.set("SUPABASE_URL", "https://x.supabase.co");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "key");
    await assertRejects(
      () => getUserTenantId("user-no-tenant"),
      Error,
      "Nenhum tenant encontrado para o usuario.",
    );
  } finally {
    if (origUrl !== undefined) Deno.env.set("SUPABASE_URL", origUrl);
    if (origKey !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", origKey);
  }
});
