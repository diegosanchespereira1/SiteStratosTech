function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getAesKeyFromPassphrase(passphrase: string): Promise<CryptoKey> {
  const hashed = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(passphrase),
  );
  return crypto.subtle.importKey("raw", hashed, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plainText: string, passphrase: string): Promise<string> {
  const key = await getAesKeyFromPassphrase(passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plainText),
  );
  return `${toBase64(iv)}:${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(cipherText: string, passphrase: string): Promise<string> {
  const [ivB64, dataB64] = cipherText.split(":");
  if (!ivB64 || !dataB64) throw new Error("Ciphertext invalido.");
  const key = await getAesKeyFromPassphrase(passphrase);
  const iv = fromBase64(ivB64);
  const encryptedBytes = fromBase64(dataB64);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedBytes,
  );
  return new TextDecoder().decode(plainBuffer);
}
