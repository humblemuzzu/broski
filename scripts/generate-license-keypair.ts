#!/usr/bin/env bun
/**
 * Generate Ed25519 key pair for Broski license signing.
 * 
 * Usage: bun scripts/generate-license-keypair.ts
 * 
 * This outputs:
 * 1. Private key (PKCS#8 DER base64url) - Add to Convex as BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL
 * 2. Public key (SPKI DER base64url) - Update in packages/bridge/src/license/fallback.ts
 */

import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

function main() {
  console.log('🔐 Generating Ed25519 key pair for Broski license signing...\n')
  
  // Generate Ed25519 key pair using Node.js crypto
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'der',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der',
    },
  })
  
  // Convert DER buffers to base64url
  function bufferToB64Url(buf: Buffer): string {
    return buf.toString('base64url')
  }
  
  // Also get PEM format for backup
  const { publicKey: pubPem, privateKey: privPem } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  })
  
  const privateKeyB64Url = bufferToB64Url(privateKey as Buffer)
  const publicKeyB64Url = bufferToB64Url(publicKey as Buffer)
  
  console.log('=' .repeat(80))
  console.log('PRIVATE KEY (Add to Convex Environment Variables)')
  console.log('=' .repeat(80))
  console.log('\nVariable name: BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL')
  console.log('\nValue:')
  console.log(privateKeyB64Url)
  
  console.log('\n')
  console.log('=' .repeat(80))
  console.log('PUBLIC KEY (Update in packages/bridge/src/license/fallback.ts)')
  console.log('=' .repeat(80))
  console.log('\nReplace LICENSE_PUBLIC_KEY_SPKI_DER_B64URL with:')
  console.log(`const LICENSE_PUBLIC_KEY_SPKI_DER_B64URL = '${publicKeyB64Url}'`)
  
  console.log('\n')
  console.log('=' .repeat(80))
  console.log('INSTRUCTIONS')
  console.log('=' .repeat(80))
  console.log(`
1. Copy the PRIVATE KEY value above
2. Go to Convex Dashboard → Settings → Environment Variables
3. Click "Add" and create:
   - Name: BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL
   - Value: (paste the private key)
4. Click Save

5. Update packages/bridge/src/license/fallback.ts:
   - Find LICENSE_PUBLIC_KEY_SPKI_DER_B64URL
   - Replace with the PUBLIC KEY value above

6. Redeploy Convex: npx convex deploy

7. Rebuild the bridge if needed
`)
  
  // Also save to files for convenience
  const outDir = join(dirname(import.meta.path), '..', '.license-keys')
  mkdirSync(outDir, { recursive: true })
  
  writeFileSync(join(outDir, 'private-key.txt'), privateKeyB64Url)
  writeFileSync(join(outDir, 'public-key.txt'), publicKeyB64Url)
  writeFileSync(join(outDir, 'private-key.pem'), privPem as string)
  writeFileSync(join(outDir, 'public-key.pem'), pubPem as string)
  
  console.log(`\n✅ Keys also saved to: ${outDir}/`)
  console.log('   - private-key.txt (base64url for Convex)')
  console.log('   - public-key.txt (base64url for fallback.ts)')
  console.log('   - private-key.pem (PEM format backup)')
  console.log('   - public-key.pem (PEM format backup)')
  console.log('\n⚠️  SECURITY: Delete .license-keys/ after configuring. Do NOT commit to git!')
}

main()
