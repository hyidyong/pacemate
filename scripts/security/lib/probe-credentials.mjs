import { randomBytes } from "node:crypto";

/**
 * Mint one in-memory authentication secret for a single probe execution.
 * The random payload carries 256 bits; the fixed framing keeps common password
 * validators happy without deriving any part from public fixture identifiers.
 */
export function createProbeRunSecret(randomBytesImpl = randomBytes) {
  const entropy = randomBytesImpl(32);
  if (!Buffer.isBuffer(entropy) || entropy.length !== 32) {
    throw new Error("probe secret generation did not return 32 random bytes");
  }
  return `Pm!9_${entropy.toString("base64url")}`;
}
