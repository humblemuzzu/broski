#!/usr/bin/env bun
/**
 * Test RevenueCat API to see what entitlements a user has.
 */

const REVENUECAT_API_KEY = process.env.REVENUECAT_SECRET_API_KEY || 'sk_SXGhkInoEyIGRcGBVrVFcXXVVhjny';

async function checkSubscription(appUserId: string) {
  console.log('='.repeat(60));
  console.log('RevenueCat FULL API Response');
  console.log('='.repeat(60));
  console.log(`App User ID: ${appUserId}`);
  console.log('');

  const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;
  
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${REVENUECAT_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json();
  
  console.log('--- RAW ENTITLEMENTS (ALL, not just active) ---');
  console.log(JSON.stringify(data.subscriber?.entitlements, null, 2));
  
  console.log('');
  console.log('--- RAW SUBSCRIPTIONS ---');
  console.log(JSON.stringify(data.subscriber?.subscriptions, null, 2));
  
  console.log('');
  console.log('--- ENTITLEMENT KEYS ---');
  const allEnts = data.subscriber?.entitlements || {};
  console.log('All entitlement IDs:', Object.keys(allEnts));
  console.log('Active entitlement IDs:', Object.keys(allEnts.active || {}));
}

const appUserId = process.argv[2] || 'cdfe544e-090a-4a1f-b342-237b4ab092ba';
checkSubscription(appUserId);
