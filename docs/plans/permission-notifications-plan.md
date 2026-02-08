# Permission Notification System — Implementation Plan

> Agent needs approval → phone buzzes → user approves → agent continues.
> Works whether the app is open, backgrounded, or fully killed.
> No user code or data ever leaves the local network.

---

## Decision

**Convex + `firebase_messaging` + Bridge Hold Queue**

- **Convex** (already running) stores push tokens and sends FCM pushes via raw HTTP
- **`firebase_messaging`** (Flutter package) gets device token + receives pushes on both iOS and Android
- **Bridge** (daemon, always running) queues permissions when WS is dead + pings Convex
- **FCM** delivers to both Android and iOS (free, unlimited)
- **Android foreground service** keeps WS alive when backgrounded (bonus instant path)

**Privacy guarantee:** The push notification contains ZERO user code, file paths, commands, or tool inputs. It only carries a title like "Agent needs approval" and a count. ALL actual permission data flows exclusively over the private WebSocket (local WiFi or Tailscale). Convex and FCM never see any code or project data.

---

## Architecture

```
CASE 1: App is open (WS alive)
──────────────────────────────
Agent SDK → Bridge → WebSocket → Flutter App → Show inline prompt
                                               (existing behavior, no change)

CASE 2: App backgrounded — Android
────────────────────────────────────
Agent SDK → Bridge → WebSocket (kept alive by foreground service) → Local notification
                                                                     with Approve/Deny buttons

CASE 3: App backgrounded — iOS / App fully killed — both platforms
──────────────────────────────────────────────────────────────────
Agent SDK → Bridge → WS is dead
                  ↓
            1. Queue permission in hold queue (30 min timeout)
            2. POST to Convex: {userId, title, count}
                  ↓
            Convex → FCM raw HTTP call → FCM delivers push
                  ↓
            Phone buzzes: "Claude needs approval (2 pending)"
                  ↓
            User taps → App opens → WS reconnects (local/Tailscale)
                  ↓
            Bridge replays ALL queued permissions over WS
                  ↓
            User approves/denies from app
```

---

## What Goes Where (Privacy Boundaries)

| Data | Where it goes | Stored? |
|------|--------------|---------|
| FCM device token | Convex `pushTokens` table | Yes (needed to send pushes) |
| User ID (appUserId) | Convex (already there) | Yes (already stored) |
| Push notification content | FCM → phone | No storage. Content: "Agent needs approval" + count. Nothing else. |
| Tool name, file paths, commands, code | ONLY over WebSocket (local/Tailscale) | Never leaves network. Never touches Convex or FCM. |
| Permission responses (approve/deny) | ONLY over WebSocket | Never leaves network. |

---

## Timeout Configuration

| Agent | Current timeout | New default | Configurable? |
|-------|----------------|-------------|---------------|
| Claude Code | 120s (server.ts line ~7116) | 30 min | Yes, bridge config |
| Codex | 120s (server.ts line ~1762) | 30 min | Yes, bridge config |
| OpenCode | No timeout (server holds) | No change needed | N/A |

New bridge config field:

```typescript
// packages/bridge/src/config/schema.ts — add to existing schema
permissions: z.object({
  timeoutMs: z.number().default(1_800_000), // 30 minutes
}).default({})
```

---

## Files to Create

### 1. `convex/pushTokens.ts` — Push token CRUD

```
Purpose: Store and retrieve FCM device tokens per user
Table: pushTokens {userId, token, platform, createdAt, updatedAt}
Functions:
  - upsertToken(userId, token, platform) — insert or update-timestamp
  - deleteToken(userId, token) — remove on logout
  - getTokensByUser(userId) — fetch all tokens for push delivery
```

**Estimated lines:** ~60

### 2. `convex/push.ts` — Send push via FCM

```
Purpose: Receive ping from bridge, send FCM push to user's devices
HTTP action: POST /push/notify
  Input: { title: string, body: string, data?: {count: number} }
  Auth: Bearer <sessionToken> (same Convex auth we already use)
  Logic:
    1. Verify session token → get userId
    2. Fetch pushTokens for userId
    3. For each token, POST to FCM HTTP v1 API
    4. Return {ok: true, sent: number}

FCM HTTP v1 API call (from Convex):
  URL: https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send
  Auth: OAuth2 access token from service account
  Body: {message: {token, notification: {title, body}, android: {priority: "high"}, apns: {headers: {"apns-priority": "10"}}}}
```

**Convex env vars needed:**
- `FCM_PROJECT_ID` — Firebase project ID (from Firebase console)
- `FCM_SERVICE_ACCOUNT_JSON` — Service account JSON (for OAuth2 token generation)

**Estimated lines:** ~120

### 3. `convex/schema.ts` — Add pushTokens table

```
Add to existing schema:
  pushTokens: defineTable({
    userId: v.id("users"),
    token: v.string(),
    platform: v.string(),      // "ios" | "android"
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_token", ["token"])
```

**Estimated lines:** ~10 (added to existing file)

### 4. `convex/http.ts` — Add push notify route

```
Add one new route to existing http.ts:
  POST /push/notify
    - requireSession() (already have this helper)
    - Call internal push.sendToUser()
    - Return {ok, sent}

  POST /push/register-token
    - requireSession()
    - Upsert token
    - Return {ok}

  POST /push/unregister-token
    - requireSession()
    - Delete token
    - Return {ok}
```

**Estimated lines:** ~60 (added to existing file)

### 5. `packages/bridge/src/handlers/permission_hold_queue.ts` — Hold queue

```
Purpose: Queue permissions when no WS client is connected, replay on reconnect
Exports:
  - class PermissionHoldQueue
    - add(id, agent, meta) → void          // Queue a permission
    - resolve(id) → boolean                 // Remove when answered
    - getPending() → QueuedPermission[]     // Get all pending
    - replayTo(ws) → void                   // Send all pending to newly connected client
    - setTimeoutMs(ms) → void               // Configure timeout
    - size → number                         // Current queue size

  - type QueuedPermission = {
      id: string
      agent: 'claude-code' | 'opencode' | 'codex'
      sessionId: string
      queuedAt: number
      title: string        // Human readable: "Run: npm test"
      tool: string         // "Bash", "Write", etc.
      category: 'execute' | 'edit' | 'read' | 'delete' | 'other'
    }

Note: This stores ONLY minimal metadata for the notification.
The actual tool input/arguments stay in the existing ccPermissionWaiters/cxApprovalWaiters
maps and are sent over WS when the client reconnects.
```

**Estimated lines:** ~100

### 6. `packages/bridge/src/handlers/push_notifier.ts` — Bridge → Convex push ping

```
Purpose: When WS is dead and permission comes in, ping Convex to send FCM push
Exports:
  - class PushNotifier
    - constructor(convexHttpBaseUrl: string)
    - notify(sessionToken: string, title: string, body: string, count: number): Promise<void>
    - Debounces: if 3 permissions come in within 5 seconds, sends ONE push with count=3
    - Fails silently (push is best-effort, hold queue is the real safety net)
```

**Estimated lines:** ~80

### 7. `lib/services/push_token_service.dart` — Flutter FCM token management

```
Purpose: Get FCM token, register with Convex, handle token refresh
Uses: firebase_messaging package

class PushTokenService {
  static final instance = PushTokenService._();

  Future<void> initialize() async {
    // Request notification permission (iOS)
    // Get FCM token
    // Listen for token refresh
  }

  Future<String?> getToken() async {
    // Return current FCM token
  }

  Future<void> registerWithConvex(String sessionToken) async {
    // POST /push/register-token to Convex
  }

  Future<void> unregisterFromConvex(String sessionToken) async {
    // POST /push/unregister-token to Convex
  }

  void onTokenRefresh(Function(String) callback) {
    // firebase_messaging token refresh stream
  }
}
```

**Estimated lines:** ~100

### 8. `lib/services/permission_notification_service.dart` — Local notification for permissions

```
Purpose: Show local notifications when permission arrives and app is backgrounded
Extends existing NotificationService pattern

class PermissionNotificationService {
  static final instance = PermissionNotificationService._();

  // Android notification channel for permissions (high priority)
  static const permissionChannelId = 'permission_requests';

  Future<void> showPermissionNotification({
    required String id,
    required String agent,       // "Claude Code" / "OpenCode" / "Codex"
    required String title,       // "Run command: npm test"
    required String sessionId,
  }) async {
    // Android: actions [Approve] [Deny] via AndroidNotificationAction
    // iOS: categoryIdentifier for action buttons
    // Both: high priority, sound, vibration
  }

  Future<void> dismissPermission(String id) async {
    // Remove notification when permission is resolved
  }

  void onNotificationAction(String actionId, String? payload) {
    // Handle Approve/Deny tap from notification shade
    // Parse payload → call bridge respond
  }
}
```

**Estimated lines:** ~120

### 9. `lib/services/background_service.dart` — Android foreground service

```
Purpose: Keep WS alive when app is backgrounded on Android
Uses: flutter_foreground_task package

class BackgroundService {
  static final instance = BackgroundService._();

  Future<void> start({int activeSessions = 0}) async {
    // Start Android foreground service
    // Persistent notification: "Broski · monitoring N sessions"
  }

  Future<void> updateNotification({int pending = 0}) async {
    // Update: "Broski · 2 permissions pending"
  }

  Future<void> stop() async {
    // Stop foreground service
  }
}
```

**Estimated lines:** ~80

### 10. `lib/screens/sheets/permission_queue_sheet.dart` — Permission dashboard

```
Purpose: Show ALL pending permissions across all sessions and agents
Accessible from: notification tap, nav bar badge, session list

Widget shows:
  - Grouped by agent → session
  - Each item: [Agent Icon] Session Name · Tool Name
    "Claude wants to run: npm test"
    [Approve] [Always] [Deny]
  - Tap for full details (file paths, command text, etc.)
  - Empty state: "No pending permissions ✓"
```

**Estimated lines:** ~250

### 11. `lib/providers/permission_queue_provider.dart` — Global permission state

```
Purpose: Single source of truth for all pending permissions across all agents/sessions
Riverpod StateNotifier

class PermissionQueueState {
  final List<PendingPermission> pending;
  final int totalCount;
  bool get hasPending;
}

class PermissionQueueNotifier extends StateNotifier<PermissionQueueState> {
  // Called when bridge sends permission_request or permission_queue (replay)
  void onPermissionReceived(PendingPermission p);

  // Called when user responds or permission times out
  void onPermissionResolved(String id);

  // Called on WS reconnect — bridge replays all pending
  void onReconnectReplay(List<PendingPermission> pending);
}

// Separate from chat_provider — this is GLOBAL across all sessions
```

**Estimated lines:** ~120

---

## Files to Modify

### 12. `convex/schema.ts`

**Change:** Add `pushTokens` table definition (see #3 above)

### 13. `convex/http.ts`

**Change:** Add 3 new routes: `/push/notify`, `/push/register-token`, `/push/unregister-token` (see #4 above)

### 14. `packages/bridge/src/config/schema.ts`

**Change:** Add permissions config section

```typescript
// Add inside BroskiConfigSchema:
permissions: z.object({
  timeoutMs: z.number().default(1_800_000), // 30 minutes default
}).default({})
```

### 15. `packages/bridge/src/config/defaults.ts`

**Change:** Add permissions defaults

```typescript
// Add inside getDefaultConfig():
permissions: {
  timeoutMs: 1_800_000, // 30 minutes
}
```

### 16. `packages/bridge/src/server.ts`

**Changes (surgical, no restructuring):**

**a) Import new modules** (top of file):
```typescript
import { PermissionHoldQueue } from './handlers/permission_hold_queue'
import { PushNotifier } from './handlers/push_notifier'
```

**b) Instantiate hold queue and push notifier** (near line ~1035 where ccPermissionWaiters is declared):
```typescript
const permissionHoldQueue = new PermissionHoldQueue()
permissionHoldQueue.setTimeoutMs(config.permissions?.timeoutMs ?? 1_800_000)
const pushNotifier = new PushNotifier(convexHttpBaseUrl)
```

**c) Change CC permission timeout** (line ~7116):
```typescript
// BEFORE:
}, 120_000)
// AFTER:
}, config.permissions?.timeoutMs ?? 1_800_000)
```

**d) Change CX permission timeout** (line ~1762):
```typescript
// BEFORE:
}, 120_000)
// AFTER:
}, config.permissions?.timeoutMs ?? 1_800_000)
```

**e) Add hold queue + push ping when CC permission requested and WS is dead** (around line ~7088):
```typescript
// After sending permission-request to WS, add:
// If no client is connected, queue it and send push
const clientConnected = /* check if ws is still open */
if (!clientConnected) {
  permissionHoldQueue.add({
    id: `${sid}:${req.toolUseId}`,
    agent: 'claude-code',
    sessionId: sid,
    tool: req.tool,
    title: `${req.tool}: ${summarizeInput(req.input)}`,
  })
  const ctx = contexts.get(ws)
  if (ctx?.cloudSessionToken) {
    pushNotifier.notify(ctx.cloudSessionToken, 'Claude Code needs approval',
      `${req.tool}: ${summarizeInput(req.input)}`, permissionHoldQueue.size)
  }
}
```

**f) Add hold queue + push ping for CX** (around line ~1745, similar pattern)

**g) Add hold queue + push ping for OC** (in the `permission.asked` event handler)

**h) Replay hold queue on new WS connection** (in the `ws.open` handler):
```typescript
// When a new client connects and registers:
if (permissionHoldQueue.size > 0) {
  send(ws, {
    type: 'permission_queue',
    data: permissionHoldQueue.getPending(),
  })
}
```

**i) Add new message types to processSingleMessage** (if not using existing ones):
```typescript
case 'register_push_token': {
  // Store push token — forward to Convex via HTTP
  break
}
```

### 17. `packages/bridge/src/types.ts`

**Changes:**

```typescript
// Add to ClientMessage union:
| { type: 'register_push_token'; token: string; platform: string }
| { type: 'unregister_push_token'; token: string }

// Add to ServerMessage union:
| { type: 'permission_queue'; data: QueuedPermission[] }

// Add new type:
export type QueuedPermission = {
  id: string
  agent: AgentType
  sessionId: string
  queuedAt: number
  title: string
  tool: string
  category: 'execute' | 'edit' | 'read' | 'delete' | 'other'
}
```

### 18. `lib/services/bridge_service.dart`

**Changes:**

```dart
// Add method to register push token with bridge (which forwards to Convex):
void registerPushToken({required String token, required String platform}) {
  _socket.send({
    'type': 'register_push_token',
    'token': token,
    'platform': platform,
  });
}

// Add handler for permission_queue message (reconnect replay):
// In the message handler switch:
case 'permission_queue':
  final data = message['data'] as List<dynamic>? ?? [];
  ref.read(permissionQueueProvider.notifier).onReconnectReplay(
    data.map((item) => PendingPermission.fromJson(item)).toList()
  );
  break;
```

### 19. `lib/services/notification_service.dart`

**Changes:**

```dart
// Add permission notification channel (Android):
static const String _permissionChannelId = 'permission_requests';
static const String _permissionChannelName = 'Permission Requests';
static const String _permissionChannelDescription =
    'Urgent notifications when AI agents need your approval';

// Add in initialize():
// Create high-priority permission channel for Android

// Add showPermissionRequest() method:
Future<void> showPermissionRequest({
  required String id,
  required String agentName,
  required String title,
  required String sessionId,
}) async {
  // High priority, sound, vibration
  // Android: action buttons [Approve] [Deny]
  // iOS: interruptionLevel.timeSensitive
}
```

### 20. `lib/providers/chat_provider.dart`

**Changes:**

```dart
// In the stream message handler where permission.asked / permission-request
// is received, ALSO notify the global permission queue provider:
ref.read(permissionQueueProvider.notifier).onPermissionReceived(permission);

// When app is backgrounded, fire local notification instead of showing prompt:
// (Check WidgetsBindingObserver.didChangeAppLifecycleState)
if (appIsBackgrounded) {
  PermissionNotificationService.instance.showPermissionRequest(...);
} else {
  // existing inline prompt behavior
}
```

### 21. `lib/providers/connection_provider.dart`

**Changes:**

```dart
// On successful WS connection, register push token:
final pushToken = await PushTokenService.instance.getToken();
if (pushToken != null) {
  bridge.registerPushToken(token: pushToken, platform: Platform.isIOS ? 'ios' : 'android');
}

// Start Android foreground service when connecting:
if (Platform.isAndroid) {
  BackgroundService.instance.start(activeSessions: sessionCount);
}
```

### 22. `lib/main.dart`

**Changes:**

```dart
// In app initialization:
await PushTokenService.instance.initialize();

// Handle FCM background message:
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // This runs even when app is killed
  // Show local notification from the push data
}

// Register background handler:
FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
```

### 23. `pubspec.yaml`

**Changes:**

```yaml
dependencies:
  firebase_core: ^3.x.x            # Required by firebase_messaging
  firebase_messaging: ^15.x.x       # FCM token + push receiving
  flutter_foreground_task: ^8.x.x   # Android foreground service
```

### 24. `android/app/build.gradle`

**Changes:**

```groovy
// Add at bottom:
apply plugin: 'com.google.gms.google-services'
```

### 25. `android/build.gradle`

**Changes:**

```groovy
// Add to buildscript dependencies:
classpath 'com.google.gms:google-services:4.4.2'
```

### 26. `android/app/google-services.json`

**New file:** Download from Firebase Console after creating project. Contains project ID, API key, app ID. No secrets — this file is safe to commit.

### 27. `ios/Runner/GoogleService-Info.plist`

**New file:** Download from Firebase Console. Same as above for iOS.

### 28. `ios/Runner/Runner.entitlements`

**Changes:**

```xml
<!-- Add push notification capability (may already exist): -->
<key>aps-environment</key>
<string>production</string>
```

---

## Firebase Console Setup (one-time, 10 minutes)

1. Go to https://console.firebase.google.com
2. Create project "broski-push" (or similar)
3. Add Android app: package name `com.muzammil.broski` → download `google-services.json`
4. Add iOS app: bundle ID `com.muzammil.broski` → download `GoogleService-Info.plist`
5. Upload APNs auth key (`.p8` file from Apple Developer — you already have this for App Store)
6. Go to Project Settings → Service Accounts → Generate new private key → download JSON
7. Add to Convex env vars:
   - `FCM_PROJECT_ID` = the project ID from Firebase console
   - `FCM_SERVICE_ACCOUNT_JSON` = the downloaded service account JSON (stringified)

**We only use Firebase for FCM push delivery. No Firestore, no Analytics, no Auth, no nothing else. The Firebase project is just a container for the FCM credentials.**

---

## Convex Env Vars to Add

| Variable | Value | Purpose |
|----------|-------|---------|
| `FCM_PROJECT_ID` | From Firebase console | Used in FCM v1 API URL |
| `FCM_SERVICE_ACCOUNT_JSON` | Service account JSON string | Used to generate OAuth2 token for FCM API |

---

## Message Flow — Complete Example

### Example 1: Claude Code permission, app is open

```
1. User sends "fix the auth bug" from Broski app
2. Claude Code SDK calls canUseTool("Bash", {command: "npm test"})
3. Bridge server.ts receives callback (line ~2046)
4. Bridge sends over WS: {type: "cc_stream", data: {type: "permission-request", ...}}
5. Flutter chat_provider receives it → adds to permissions list
6. chat_screen shows PermissionPrompt bottom sheet (existing behavior)
7. User taps "Approve"
8. Flutter sends: {type: "cc_permission_response", sessionId, toolUseId, response: "once"}
9. Bridge resolves the ccPermissionWaiters Promise → canUseTool returns {behavior: "allow"}
10. Claude Code executes npm test
```

**Nothing changes here. Existing flow works perfectly.**

### Example 2: Codex permission, app is backgrounded on Android

```
1. Codex wants to run a command → onServerRequest fires
2. Bridge sends over WS: {type: "cx_stream", data: {type: "request", ...}}
3. Flutter receives it (WS alive via foreground service)
4. App is backgrounded → PermissionNotificationService fires local notification:
   "Codex · Permission Request"
   "Run command: cargo test"
   [Approve] [Deny]
5. User pulls down notification shade, taps [Approve]
6. Flutter handles action → sends {type: "cx_permission_response", requestId, response: "once"}
7. Bridge resolves → Codex executes
```

**Foreground service keeps WS alive on Android. Instant, no cloud involved.**

### Example 3: OpenCode permission, app is fully killed

```
1. OpenCode emits permission.asked event
2. Bridge forwards to WS → WS is dead (app killed)
3. Bridge does TWO things:
   a. Queues permission in PermissionHoldQueue (30 min timeout)
   b. POSTs to Convex: POST /push/notify
      {title: "OpenCode needs approval", body: "Edit: src/main.rs", data: {count: 1}}
4. Convex verifies session token, fetches user's FCM tokens
5. Convex calls FCM v1 API → FCM delivers push to phone
6. Phone shows push notification:
   "OpenCode needs approval"
   "Edit: src/main.rs"
7. User taps notification → app opens
8. App reconnects WS to bridge (local WiFi or Tailscale)
9. Bridge detects new connection → sends: {type: "permission_queue", data: [...]}
10. Flutter shows permission queue with all pending items
11. User approves → bridge responds to OpenCode SDK
```

**Push notification contains only "OpenCode needs approval" + tool name. No file contents, no code, no sensitive data.**

### Example 4: Multiple agents, app killed, user comes back

```
1. Claude Code permission comes in → queued + push sent (count: 1)
2. 30 seconds later, Codex permission comes in → queued + push sent (count: 2)
3. 1 minute later, OpenCode permission comes in → queued + push sent (count: 3)
   (PushNotifier debounces: only sends if >5s since last push)
4. User sees latest push: "3 agents need approval"
5. User taps → app opens → WS reconnects
6. Bridge replays queue: {type: "permission_queue", data: [3 items]}
7. Flutter shows permission queue dashboard
8. User approves all three, one by one
9. Each approval goes back over WS to respective agent
```

---

## Implementation Order

### Step 1: Bridge hold queue + timeout config
- Create `packages/bridge/src/handlers/permission_hold_queue.ts`
- Add `permissions.timeoutMs` to config schema + defaults
- Change `120_000` to `config.permissions.timeoutMs` in server.ts (2 places)
- Add hold queue logic to CC/OC/CX permission handlers in server.ts
- Add replay on new WS connection
- **Test:** Permissions still work normally when app is connected

### Step 2: Convex push infrastructure
- Add `pushTokens` table to `convex/schema.ts`
- Create `convex/pushTokens.ts` CRUD functions
- Create `convex/push.ts` FCM sending function
- Add routes to `convex/http.ts`
- **Test:** Manual curl to `/push/notify` sends FCM push

### Step 3: Firebase setup + Flutter token registration
- Create Firebase project, download config files
- Add `firebase_core` + `firebase_messaging` to pubspec.yaml
- Add `google-services.json` + `GoogleService-Info.plist`
- Create `lib/services/push_token_service.dart`
- Register token on app startup + on WS connect
- Add `register_push_token` handler to bridge → forward to Convex
- **Test:** App startup logs FCM token, token appears in Convex pushTokens table

### Step 4: Bridge → Convex push ping
- Create `packages/bridge/src/handlers/push_notifier.ts`
- Wire into server.ts: when WS dead + permission comes in → ping Convex
- Add debouncing (one push per 5 seconds max)
- **Test:** Kill app → trigger permission from agent → phone receives push

### Step 5: Flutter permission notifications
- Create `lib/services/permission_notification_service.dart`
- Add permission notification channel (high priority)
- Add Android notification action buttons (Approve/Deny)
- Handle notification tap → open app → navigate to permission
- Handle notification action → respond to bridge without opening app
- Create `lib/providers/permission_queue_provider.dart`
- Wire background message handler in main.dart
- **Test:** Background app → permission → notification with buttons → approve from shade

### Step 6: Permission queue dashboard
- Create `lib/screens/sheets/permission_queue_sheet.dart`
- Create `lib/widgets/permission_card.dart`
- Add badge to nav bar showing pending count
- Handle reconnect replay (permission_queue message)
- **Test:** Kill app → 3 permissions pending → open app → see all 3 → approve

### Step 7: Android foreground service
- Add `flutter_foreground_task` to pubspec.yaml
- Create `lib/services/background_service.dart`
- Start service when WS connects, stop when disconnects
- Update persistent notification with session count / pending count
- **Test:** Background app on Android → permission comes in → instant local notification (no FCM delay)

### Step 8: Polish + edge cases
- Token refresh handling (FCM token changes)
- Logout: unregister push token
- Multiple devices: all get the push, first to respond wins
- Debounce rapid permissions (3 in 2 seconds → one notification)
- Notification dismissal when permission is resolved
- Handle stale notifications (permission already expired)
- Dark mode notification styling

---

## Dependencies to Add

### Flutter (`pubspec.yaml`)
```yaml
firebase_core: ^3.8.1
firebase_messaging: ^15.2.1
flutter_foreground_task: ^8.13.4
```

### Bridge — no new npm packages needed
Convex HTTP calls use native `fetch()`. Hold queue is pure TypeScript.

### Convex — no new npm packages needed
FCM v1 API called via native `fetch()`. OAuth2 token generation uses `jose` (already installed — used for license signing).

---

## Estimated Total Lines of New Code

| Component | Lines |
|-----------|-------|
| Convex (pushTokens + push + http routes) | ~250 |
| Bridge (hold queue + push notifier + server.ts changes) | ~350 |
| Flutter (push token + permission notifications + background + queue UI + provider) | ~900 |
| Config / build files | ~50 |
| **Total** | **~1,550** |

---

## What This Does NOT Do (explicitly out of scope)

- ❌ Store any user code, file contents, or commands in Convex or FCM
- ❌ Add any new cloud service beyond what we already run (Convex)
- ❌ Change the existing WebSocket-based permission flow when app is open
- ❌ Require internet for local WiFi usage (push is only for "app killed" fallback)
- ❌ Build a custom rules engine (SDKs already have "always allow" built in)
- ❌ Change how any of the three SDKs work internally
