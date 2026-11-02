#!/usr/bin/env node
// Генерация VAPID-ключей для Web Push.
//  - публичный ключ (base64url) → web/config.js (vapidPublicKey) — он публичный, это безопасно;
//  - приватный ключ (JWK) → секрет Cloudflare Worker: `npx wrangler secret put VAPID_PRIVATE_JWK`.
import { webcrypto as crypto } from 'node:crypto';

const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
console.log('VAPID public key (в web/config.js и в Worker как VAPID_PUBLIC_KEY):\n' + raw.toString('base64url'));
console.log('\nVAPID private JWK (ТОЛЬКО в секрет Worker VAPID_PRIVATE_JWK, не коммитить!):\n' + JSON.stringify(jwk));
