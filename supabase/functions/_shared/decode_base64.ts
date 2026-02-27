export function decodeBase64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.includes(",") ? base64.split(",").pop() ?? "" : base64;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
