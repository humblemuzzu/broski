#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')

const publicSpkiDer = publicKey.export({ format: 'der', type: 'spki' })
const privatePkcs8Der = privateKey.export({ format: 'der', type: 'pkcs8' })

const pubB64Url = Buffer.from(publicSpkiDer).toString('base64url')
const privB64Url = Buffer.from(privatePkcs8Der).toString('base64url')

console.log('Broski license signing keys (Ed25519)\n')
console.log('Set this in Convex env (secret):')
console.log(`  BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL=${privB64Url}\n`)
console.log('Embed this in the bridge (safe to commit):')
console.log(`  LICENSE_PUBLIC_KEY_SPKI_DER_B64URL=${pubB64Url}\n`)
console.log('Notes:')
console.log('- Do NOT commit the private key anywhere.')
console.log('- Update packages/bridge/src/license/fallback.ts to match the public key.')

