export function parseTenantIdFromInstance(instanceKey: string): string | null {
  const raw = instanceKey.replace(/^tenant_/, "");
  if (!raw || raw.length < 32) return null;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}
