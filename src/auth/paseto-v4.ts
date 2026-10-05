// PASETO v4.public の署名検証 (Ed25519)。
//
// Cernere の service token (認証集約 P4) を受け側で検証するための最小実装。
// 依存を増やさないため node:crypto だけで組む。 claims の意味 (kind / aud / exp / scope) は
// ここでは見ず、 service-token-verifier.ts が判定する。
//
// 形式: `v4.public.` + base64url(message || signature[64]) [+ `.` + base64url(footer)]
// 署名対象: PAE(header, message, footer, implicit) — implicit assertion は Cernere が使わないので空。

import { createPublicKey, verify, type KeyObject } from 'node:crypto';

export const V4_PUBLIC_HEADER = 'v4.public.';

const SIGNATURE_BYTES = 64;
const ED25519_PUBLIC_KEY_BYTES = 32;
// raw Ed25519 公開鍵 (32 byte) を SPKI DER に包むための固定前置部。
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function isV4PublicToken(value: string): boolean {
  return value.startsWith(V4_PUBLIC_HEADER);
}

export function ed25519KeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new Error(`Ed25519 public key must be ${ED25519_PUBLIC_KEY_BYTES} bytes`);
  }
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

function le64(n: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(n));
  out[7] = out[7]! & 0x7f;
  return out;
}

/** PASETO の Pre-Authentication Encoding。 */
export function pae(pieces: readonly Buffer[]): Buffer {
  const parts: Buffer[] = [le64(pieces.length)];
  for (const piece of pieces) parts.push(le64(piece.length), piece);
  return Buffer.concat(parts);
}

/**
 * 署名を検証し、 message を JSON として返す。 いずれかの鍵で検証できれば成功。
 * 形式違い・署名不一致・JSON でない本文はすべて例外 (理由は呼び出し側で丸める)。
 */
export function verifyV4Public(token: string, keys: readonly KeyObject[]): Record<string, unknown> {
  if (!isV4PublicToken(token)) throw new Error('not a v4.public token');
  const segments = token.slice(V4_PUBLIC_HEADER.length).split('.');
  if (segments.length > 2 || !segments[0]) throw new Error('malformed token');
  const body = Buffer.from(segments[0], 'base64url');
  if (body.length <= SIGNATURE_BYTES) throw new Error('malformed token');
  const footer = segments[1] ? Buffer.from(segments[1], 'base64url') : Buffer.alloc(0);
  const message = body.subarray(0, body.length - SIGNATURE_BYTES);
  const signature = body.subarray(body.length - SIGNATURE_BYTES);
  const signed = pae([Buffer.from(V4_PUBLIC_HEADER), message, footer, Buffer.alloc(0)]);

  if (!keys.some((key) => verify(null, signed, key, signature))) {
    throw new Error('signature mismatch');
  }
  const payload: unknown = JSON.parse(message.toString('utf8'));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload is not an object');
  }
  return payload as Record<string, unknown>;
}
