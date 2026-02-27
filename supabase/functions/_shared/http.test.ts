import { assertEquals } from "https://deno.land/std@0.190.0/assert/mod.ts";
import { corsHeaders, handleCors, jsonResponse } from "./http.ts";

Deno.test("corsHeaders contém Access-Control-Allow-Origin e Headers esperados", () => {
  assertEquals(corsHeaders["Access-Control-Allow-Origin"], "*");
  assertEquals(
    corsHeaders["Access-Control-Allow-Headers"],
    "authorization, x-client-info, apikey, content-type, stripe-signature, x-webhook-signature",
  );
});

Deno.test("jsonResponse retorna Response com status e JSON no body", async () => {
  const res = jsonResponse(200, { ok: true, id: 1 });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await res.json();
  assertEquals(body, { ok: true, id: 1 });
});

Deno.test("jsonResponse com status 201", () => {
  const res = jsonResponse(201, { created: true });
  assertEquals(res.status, 201);
});

Deno.test("jsonResponse com status 400 e mensagem de erro", async () => {
  const res = jsonResponse(400, { error: "Bad request" });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Bad request");
});

Deno.test("handleCors retorna Response para OPTIONS", () => {
  const req = new Request("https://example.com", { method: "OPTIONS" });
  const res = handleCors(req);
  assertEquals(res !== null, true);
  assertEquals(res!.status, 204);
  assertEquals(res!.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleCors retorna null para GET", () => {
  const req = new Request("https://example.com", { method: "GET" });
  assertEquals(handleCors(req), null);
});

Deno.test("handleCors retorna null para POST", () => {
  const req = new Request("https://example.com", { method: "POST" });
  assertEquals(handleCors(req), null);
});
