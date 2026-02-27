import { assertEquals } from "https://deno.land/std@0.190.0/assert/mod.ts";
import { decodeBase64ToBytes } from "./decode_base64.ts";

Deno.test("decodeBase64ToBytes decodifica string simples", () => {
  const b64 = "SGVsbG8="; // "Hello"
  const bytes = decodeBase64ToBytes(b64);
  assertEquals(bytes.byteLength, 5);
  assertEquals(bytes[0], 72);
  assertEquals(bytes[1], 101);
  assertEquals(bytes[2], 108);
  assertEquals(bytes[3], 108);
  assertEquals(bytes[4], 111);
});

Deno.test("decodeBase64ToBytes remove data URL prefix (data:...;base64,)", () => {
  const b64 = "data:application/octet-stream;base64,SGVsbG8=";
  const bytes = decodeBase64ToBytes(b64);
  assertEquals(bytes.byteLength, 5);
  assertEquals(String.fromCharCode(...bytes), "Hello");
});

Deno.test("decodeBase64ToBytes retorna Uint8Array vazio para base64 vazio", () => {
  const bytes = decodeBase64ToBytes("");
  assertEquals(bytes.byteLength, 0);
});
