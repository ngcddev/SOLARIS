import sodium from "libsodium-wrappers";

let readyPromise: Promise<void> | null = null;

/** Must be awaited before any other call in this module. */
export function initCrypto(): Promise<void> {
  readyPromise ??= sodium.ready;
  return readyPromise;
}

export interface SigningIdentity {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}
export interface CenterKeys {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export async function generateIdentity(): Promise<SigningIdentity> {
  await initCrypto();
  const kp = sodium.crypto_sign_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

export async function generateCenterKeys(): Promise<CenterKeys> {
  await initCrypto();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

export function randomBytes(n: number): Uint8Array {
  return sodium.randombytes_buf(n);
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return sodium.crypto_sign_detached(message, secretKey);
}

export function verify(sig: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return sodium.crypto_sign_verify_detached(sig, message, publicKey);
  } catch {
    return false;
  }
}

/** Anonymous sealed box towards the command center public key. */
export function seal(plain: Uint8Array, centerPublicKey: Uint8Array): Uint8Array {
  return sodium.crypto_box_seal(plain, centerPublicKey);
}

export function unseal(cipher: Uint8Array, keys: CenterKeys): Uint8Array | null {
  try {
    return sodium.crypto_box_seal_open(cipher, keys.publicKey, keys.secretKey);
  } catch {
    return null;
  }
}

export function toHex(b: Uint8Array): string {
  return sodium.to_hex(b);
}
export function fromHex(h: string): Uint8Array {
  return sodium.from_hex(h);
}
export function toBase64(b: Uint8Array): string {
  return sodium.to_base64(b, sodium.base64_variants.URLSAFE_NO_PADDING);
}
export function fromBase64(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
}
