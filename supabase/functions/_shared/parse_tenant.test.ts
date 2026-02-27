import { assertEquals } from "https://deno.land/std@0.190.0/assert/mod.ts";
import { parseTenantIdFromInstance } from "./parse_tenant.ts";

Deno.test("parseTenantIdFromInstance retorna null para string vazia", () => {
  assertEquals(parseTenantIdFromInstance(""), null);
});

Deno.test("parseTenantIdFromInstance retorna null para menos de 32 caracteres", () => {
  assertEquals(parseTenantIdFromInstance("tenant_123456789012345678901234"), null);
});

Deno.test("parseTenantIdFromInstance remove prefixo tenant_ e formata UUID", () => {
  const raw32 = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  assertEquals(
    parseTenantIdFromInstance(`tenant_${raw32}`),
    "a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6",
  );
});

Deno.test("parseTenantIdFromInstance aceita instanceKey sem prefixo com 32+ chars", () => {
  const raw32 = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  assertEquals(
    parseTenantIdFromInstance(raw32),
    "a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6",
  );
});
