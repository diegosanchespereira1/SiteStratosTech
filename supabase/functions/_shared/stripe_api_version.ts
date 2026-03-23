/**
 * Versão da API Stripe usada nas chamadas HTTP das Edge Functions.
 * Mantém o mesmo default do stripe-node instalado no repo (package `stripe` → cjs/apiVersion.js).
 * Override opcional: secret STRIPE_API_VERSION (ex.: ao alinhar com o Workbench antes de atualizar o SDK).
 */
export const STRIPE_API_VERSION_DEFAULT = "2026-02-25.clover";

export function getStripeApiVersion(): string {
  const fromEnv = Deno.env.get("STRIPE_API_VERSION")?.trim();
  return fromEnv || STRIPE_API_VERSION_DEFAULT;
}
