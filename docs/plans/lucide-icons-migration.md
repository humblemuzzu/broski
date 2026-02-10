# Lucide Icons Migration Plan

## Context — What You're Walking Into

Broski is a Flutter mobile app. We just completed a design system migration:
- **Font:** Switched from Google Fonts Inter → bundled Geist Sans (Vercel's font)
- **Typography:** Created `lib/theme/app_typography.dart` with named styles (h1, body, label, code, etc.)
- **Spacing:** Created `lib/theme/design_tokens.dart` with `Spacing`, `Radii`, `Insets` token classes
- **All 105 screen/widget files** now use these tokens

The ONE remaining piece is **icons**. The app uses **948 Material Icons** (`Icons.*`) across 295 unique icon names, scattered ad-hoc across every file. They look stock-Android, have inconsistent styles (mixed `_rounded`, `_outlined`, and bare suffixes), and don't match the modern Geist Sans aesthetic.

We're replacing them with **Lucide Icons** — same Vercel ecosystem as Geist, thin stroke, geometric, consistent, font-based (drop-in `Icon()` widget, no API changes).

## What to Install

```yaml
# pubspec.yaml
dependencies:
  lucide_icons: ^0.257.0  # or latest

# REMOVE this (0 usages in the entire codebase):
  cupertino_icons: ^1.0.8  # DELETE THIS LINE
```

Run `flutter pub get` after.

## Architecture — Create `lib/theme/app_icons.dart`

Create ONE centralized icon mapping file. Every icon used in the app gets a constant here. Screens never reference `LucideIcons.*` or `Icons.*` directly — they use `AppIcons.*`.

```dart
import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';

/// Centralized icon constants for consistent iconography.
///
/// Usage:
/// ```dart
/// Icon(AppIcons.settings)
/// Icon(AppIcons.terminal, size: 16)
/// ```
///
/// Rules:
/// - NEVER use `Icons.*` or `LucideIcons.*` directly in screens/widgets
/// - All icons go through this file
/// - Name by MEANING, not by visual (e.g., `delete` not `trash2`)
abstract final class AppIcons {
  // ── Navigation ──
  static const back = LucideIcons.arrowLeft;
  static const forward = LucideIcons.arrowRight;
  static const chevronRight = LucideIcons.chevronRight;
  static const chevronLeft = LucideIcons.chevronLeft;
  static const chevronDown = LucideIcons.chevronDown;
  static const chevronUp = LucideIcons.chevronUp;
  static const expandMore = LucideIcons.chevronDown;
  static const expandLess = LucideIcons.chevronUp;
  static const arrowUp = LucideIcons.arrowUp;
  static const arrowDown = LucideIcons.arrowDown;
  static const home = LucideIcons.home;
  static const menu = LucideIcons.menu;

  // ── Actions ──
  static const add = LucideIcons.plus;
  static const remove = LucideIcons.minus;
  static const close = LucideIcons.x;
  static const check = LucideIcons.check;
  static const checkCircle = LucideIcons.checkCircle;
  static const search = LucideIcons.search;
  static const refresh = LucideIcons.refreshCw;
  static const sync = LucideIcons.refreshCw;
  static const edit = LucideIcons.pencil;
  static const delete = LucideIcons.trash2;
  static const copy = LucideIcons.copy;
  static const paste = LucideIcons.clipboardPaste;
  static const share = LucideIcons.share2;
  static const download = LucideIcons.download;
  static const upload = LucideIcons.upload;
  static const save = LucideIcons.save;
  static const undo = LucideIcons.undo2;
  static const send = LucideIcons.send;
  static const filter = LucideIcons.filter;
  static const sort = LucideIcons.arrowUpDown;
  static const moreHorizontal = LucideIcons.moreHorizontal;
  static const moreVertical = LucideIcons.moreVertical;
  static const openExternal = LucideIcons.externalLink;
  static const expand = LucideIcons.maximize2;
  static const compress = LucideIcons.minimize2;
  static const link = LucideIcons.link;
  static const unlink = LucideIcons.unlink;
  static const attach = LucideIcons.paperclip;
  static const replay = LucideIcons.rotateCcw;
  static const restart = LucideIcons.rotateCcw;
  static const restore = LucideIcons.rotateCcw;
  static const skip = LucideIcons.skipForward;
  static const block = LucideIcons.ban;
  static const cancel = LucideIcons.xCircle;
  static const archive = LucideIcons.archive;
  static const unarchive = LucideIcons.archiveRestore;

  // ── Status / Feedback ──
  static const error = LucideIcons.alertCircle;
  static const errorOutline = LucideIcons.alertCircle;
  static const warning = LucideIcons.alertTriangle;
  static const info = LucideIcons.info;
  static const infoOutline = LucideIcons.info;
  static const success = LucideIcons.checkCircle;
  static const help = LucideIcons.helpCircle;
  static const pending = LucideIcons.clock;
  static const schedule = LucideIcons.clock;
  static const hourglass = LucideIcons.hourglass;
  static const timer = LucideIcons.timer;
  static const notification = LucideIcons.bell;
  static const notificationActive = LucideIcons.bellRing;

  // ── Files & Folders ──
  static const file = LucideIcons.file;
  static const fileText = LucideIcons.fileText;
  static const filePlus = LucideIcons.filePlus;
  static const fileCode = LucideIcons.fileCode;
  static const fileEdit = LucideIcons.fileEdit;
  static const folder = LucideIcons.folder;
  static const folderOpen = LucideIcons.folderOpen;
  static const folderPlus = LucideIcons.folderPlus;
  static const folderOff = LucideIcons.folderX;
  static const image = LucideIcons.image;
  static const imageOff = LucideIcons.imageOff;
  static const pdf = LucideIcons.fileText;
  static const table = LucideIcons.table;
  static const photoLibrary = LucideIcons.images;
  static const camera = LucideIcons.camera;

  // ── Terminal & Code ──
  static const terminal = LucideIcons.terminal;
  static const code = LucideIcons.code;
  static const braces = LucideIcons.braces;
  static const build = LucideIcons.hammer;
  static const bug = LucideIcons.bug;
  static const construction = LucideIcons.construction;
  static const tools = LucideIcons.wrench;
  static const handyman = LucideIcons.wrench;
  static const science = LucideIcons.flask;
  static const keyboard = LucideIcons.keyboard;
  static const javascript = LucideIcons.fileCode;
  static const dataObject = LucideIcons.braces;
  static const sourceCode = LucideIcons.fileCode;

  // ── AI & Agents ──
  static const smartToy = LucideIcons.bot;
  static const agent = LucideIcons.bot;
  static const psychology = LucideIcons.brain;
  static const autoAwesome = LucideIcons.sparkles;
  static const autoFix = LucideIcons.wand2;
  static const lightbulb = LucideIcons.lightbulb;
  static const school = LucideIcons.graduationCap;

  // ── Git & Version Control ──
  static const gitBranch = LucideIcons.gitBranch;
  static const gitCommit = LucideIcons.gitCommit;
  static const gitMerge = LucideIcons.gitMerge;
  static const gitFork = LucideIcons.gitFork;
  static const gitPullRequest = LucideIcons.gitPullRequest;
  static const diff = LucideIcons.diff;
  static const history = LucideIcons.history;
  static const forkRight = LucideIcons.gitFork;
  static const callSplit = LucideIcons.split;

  // ── Connectivity & Network ──
  static const wifi = LucideIcons.wifi;
  static const wifiOff = LucideIcons.wifiOff;
  static const cloud = LucideIcons.cloud;
  static const cloudOff = LucideIcons.cloudOff;
  static const signal = LucideIcons.signal;
  static const signalOff = LucideIcons.signalZero;
  static const network = LucideIcons.network;
  static const globe = LucideIcons.globe;
  static const http = LucideIcons.globe;
  static const dns = LucideIcons.server;
  static const webhook = LucideIcons.webhook;
  static const vpn = LucideIcons.shield;

  // ── Devices ──
  static const computer = LucideIcons.monitor;
  static const laptop = LucideIcons.laptop;
  static const phone = LucideIcons.smartphone;
  static const devices = LucideIcons.monitor;
  static const smartphone = LucideIcons.smartphone;

  // ── Settings & Config ──
  static const settings = LucideIcons.settings;
  static const tune = LucideIcons.sliders;
  static const palette = LucideIcons.palette;
  static const wallpaper = LucideIcons.image;
  static const dashboard = LucideIcons.layoutDashboard;
  static const customize = LucideIcons.paintbrush;
  static const fingerprint = LucideIcons.fingerprint;
  static const security = LucideIcons.shield;
  static const shieldCheck = LucideIcons.shieldCheck;
  static const lock = LucideIcons.lock;
  static const lockOpen = LucideIcons.lockOpen;
  static const privacy = LucideIcons.eye;

  // ── User & Account ──
  static const person = LucideIcons.user;
  static const personOutline = LucideIcons.user;
  static const group = LucideIcons.users;
  static const logout = LucideIcons.logOut;
  static const wallet = LucideIcons.wallet;
  static const creditCard = LucideIcons.creditCard;
  static const subscription = LucideIcons.crown;

  // ── Media & Voice ──
  static const mic = LucideIcons.mic;
  static const micOff = LucideIcons.micOff;
  static const play = LucideIcons.play;
  static const pause = LucideIcons.pause;
  static const stop = LucideIcons.square;
  static const flashOn = LucideIcons.zap;
  static const flashOff = LucideIcons.zapOff;

  // ── Visibility ──
  static const visibility = LucideIcons.eye;
  static const visibilityOff = LucideIcons.eyeOff;

  // ── Content & Layout ──
  static const list = LucideIcons.list;
  static const checklist = LucideIcons.listChecks;
  static const gridView = LucideIcons.layoutGrid;
  static const layers = LucideIcons.layers;
  static const preview = LucideIcons.eye;
  static const description = LucideIcons.fileText;
  static const textFields = LucideIcons.type;
  static const menuBook = LucideIcons.bookOpen;
  static const viewAgenda = LucideIcons.rows3;
  static const toc = LucideIcons.list;
  static const unfoldMore = LucideIcons.chevronsUpDown;

  // ── Extensions & Plugins ──
  static const extension_ = LucideIcons.puzzle;
  static const extensionOff = LucideIcons.puzzleX; // may not exist, use puzzle
  static const plugin = LucideIcons.plug;

  // ── Misc ──
  static const star = LucideIcons.star;
  static const starOutline = LucideIcons.star;
  static const bolt = LucideIcons.zap;
  static const speed = LucideIcons.gauge;
  static const memory = LucideIcons.cpu;
  static const work = LucideIcons.briefcase;
  static const gavel = LucideIcons.gavel;
  static const explore = LucideIcons.compass;
  static const loop = LucideIcons.repeat;
  static const hub = LucideIcons.network;
  static const dataUsage = LucideIcons.pieChart;
  static const allInclusive = LucideIcons.infinity;
  static const altRoute = LucideIcons.route;
  static const blurOn = LucideIcons.sparkles;
  static const borderAll = LucideIcons.grid3x3;
  static const borderLeft = LucideIcons.panelLeft;
  static const borderStyle = LucideIcons.square;
  static const apple = LucideIcons.apple;
  static const radioChecked = LucideIcons.circleDot;
  static const radioUnchecked = LucideIcons.circle;
  static const checkBox = LucideIcons.squareCheck; // may need checkSquare
  static const checkBoxBlank = LucideIcons.square;
  static const circleOutlined = LucideIcons.circle;
  static const cleaning = LucideIcons.sparkles;
  static const rateReview = LucideIcons.messageSquare;
  static const feedback = LucideIcons.messageCircle;
  static const workspace = LucideIcons.crown;
  static const developer = LucideIcons.code2;
}
```

**IMPORTANT:** After creating this file, verify every `LucideIcons.*` constant actually exists in the package. Some names may differ slightly. Run `flutter analyze` after creating the file and fix any undefined references by checking the lucide_icons package source for the correct name.

## Migration Strategy

### How to Replace Icons in Each File

The replacement is mechanical:

```dart
// BEFORE:
import 'package:flutter/material.dart';
Icon(Icons.terminal_rounded, size: 16, color: theme.primary)
Icon(Icons.chevron_right_rounded)
Icon(Icons.delete_outline_rounded, color: theme.error)

// AFTER:
import 'package:broski/theme/app_icons.dart';
Icon(AppIcons.terminal, size: 16, color: theme.primary)
Icon(AppIcons.chevronRight)
Icon(AppIcons.delete, color: theme.error)
```

Key rules:
- Drop all `_rounded`, `_outlined`, `_outline` suffixes — Lucide has ONE consistent style
- `Icons.smart_toy_outlined` → `AppIcons.agent` (name by meaning)
- `Icons.auto_awesome_rounded` → `AppIcons.autoAwesome`
- The `Icon()` widget stays the same — Lucide uses standard `IconData`, no API change
- `size:` and `color:` parameters are unchanged

### File Processing Order

Process in this order (highest icon count first = biggest visual impact):

| Priority | File | Icon Count |
|----------|------|-----------|
| 1 | `lib/screens/chat_screen.dart` | 119 |
| 2 | `lib/screens/sessions_screen.dart` | 83 |
| 3 | `lib/screens/settings_screen.dart` | 58 |
| 4 | `lib/widgets/session_sidebar.dart` | 35 |
| 5 | `lib/screens/mcp_servers_screen.dart` | 33 |
| 6 | `lib/widgets/permission_rules_sheet.dart` | 31 |
| 7 | `lib/screens/browse_screen.dart` | 29 |
| 8 | `lib/screens/plugins_screen.dart` | 22 |
| 9 | `lib/widgets/project_tools_sheet.dart` | 21 |
| 10 | `lib/screens/tools_screen.dart` | 19 |
| 11 | `lib/screens/customization_screen.dart` | 19 |
| 12 | `lib/screens/projects_screen.dart` | 17 |
| 13 | `lib/screens/onboarding_screen.dart` | 17 |
| 14 | `lib/screens/background_screen.dart` | 17 |
| 15 | `lib/screens/subagents_screen.dart` | 16 |
| 16+ | All remaining screens/widgets with <15 icons each | ~300 total |

### Top 40 Icons to Map (covers ~60% of all usages)

These are the most frequently used — get these right and most of the app is covered:

| Material Icon | Count | AppIcons Name |
|--------------|-------|---------------|
| `Icons.chevron_right_rounded` | 34 | `AppIcons.chevronRight` |
| `Icons.refresh_rounded` | 28 | `AppIcons.refresh` |
| `Icons.add_rounded` | 22 | `AppIcons.add` |
| `Icons.terminal_rounded` | 20 | `AppIcons.terminal` |
| `Icons.error_outline` | 19 | `AppIcons.errorOutline` |
| `Icons.delete_outline_rounded` | 17 | `AppIcons.delete` |
| `Icons.check_rounded` | 17 | `AppIcons.check` |
| `Icons.folder_outlined` | 16 | `AppIcons.folder` |
| `Icons.smart_toy_outlined` | 14 | `AppIcons.agent` |
| `Icons.extension_rounded` | 14 | `AppIcons.extension_` |
| `Icons.error_outline_rounded` | 14 | `AppIcons.error` |
| `Icons.description_outlined` | 13 | `AppIcons.description` |
| `Icons.auto_awesome_rounded` | 13 | `AppIcons.autoAwesome` |
| `Icons.star_rounded` | 12 | `AppIcons.star` |
| `Icons.close_rounded` | 12 | `AppIcons.close` |
| `Icons.arrow_back_rounded` | 12 | `AppIcons.back` |
| `Icons.info_outline_rounded` | 10 | `AppIcons.info` |
| `Icons.check_circle` | 10 | `AppIcons.checkCircle` |
| `Icons.add` | 10 | `AppIcons.add` |
| `Icons.tune_rounded` | 9 | `AppIcons.tune` |
| `Icons.copy_rounded` | 9 | `AppIcons.copy` |
| `Icons.check_circle_rounded` | 9 | `AppIcons.checkCircle` |
| `Icons.auto_fix_high_rounded` | 9 | `AppIcons.autoFix` |
| `Icons.extension` | 8 | `AppIcons.extension_` |
| `Icons.edit_outlined` | 8 | `AppIcons.edit` |
| `Icons.code_rounded` | 8 | `AppIcons.code` |
| `Icons.code` | 8 | `AppIcons.code` |
| `Icons.close` | 8 | `AppIcons.close` |
| `Icons.chevron_right` | 8 | `AppIcons.chevronRight` |
| `Icons.bolt_rounded` | 8 | `AppIcons.bolt` |
| `Icons.terminal` | 7 | `AppIcons.terminal` |
| `Icons.dns_rounded` | 7 | `AppIcons.dns` |
| `Icons.call_split_rounded` | 7 | `AppIcons.callSplit` |
| `Icons.speed_rounded` | 6 | `AppIcons.speed` |
| `Icons.shield_outlined` | 6 | `AppIcons.security` |
| `Icons.refresh` | 6 | `AppIcons.refresh` |
| `Icons.keyboard_arrow_down_rounded` | 6 | `AppIcons.chevronDown` |
| `Icons.info_outline` | 6 | `AppIcons.info` |
| `Icons.history_rounded` | 6 | `AppIcons.history` |
| `Icons.help_outline_rounded` | 6 | `AppIcons.help` |

### Complete Icon Mapping Reference

All 295 unique Material Icons used in the app → their AppIcons equivalent. Use this as your lookup table when processing each file:

**Navigation:** `arrow_back`/`arrow_back_rounded`/`arrow_back_ios_new_rounded` → `back` · `arrow_forward`/`arrow_forward_rounded` → `forward` · `chevron_right`/`chevron_right_rounded` → `chevronRight` · `chevron_left`/`chevron_left_rounded` → `chevronLeft` · `expand_more`/`expand_more_rounded`/`keyboard_arrow_down`/`keyboard_arrow_down_rounded` → `expandMore` · `expand_less_rounded`/`keyboard_arrow_up` → `expandLess` · `arrow_upward`/`arrow_upward_rounded` → `arrowUp` · `arrow_downward` → `arrowDown` · `home_rounded` → `home` · `subdirectory_arrow_right` → `chevronRight`

**Actions:** `add`/`add_rounded`/`add_circle_outline_rounded` → `add` · `close`/`close_rounded`/`clear`/`clear_rounded` → `close` · `check`/`check_rounded` → `check` · `check_circle`/`check_circle_rounded`/`check_circle_outline`/`check_circle_outline_rounded` → `checkCircle` · `search`/`search_rounded` → `search` · `refresh`/`refresh_rounded` → `refresh` · `sync_rounded` → `sync` · `edit`/`edit_outlined`/`edit_rounded`/`edit_note_rounded`/`edit_document` → `edit` · `delete_outline`/`delete_outline_rounded`/`delete_forever_rounded` → `delete` · `copy`/`copy_rounded`/`content_paste_rounded` → `copy` · `share`/`share_rounded` → `share` · `download` → `download` · `save_outlined`/`save_rounded` → `save` · `undo`/`undo_rounded` → `undo` · `send_rounded` → `send` · `filter_alt_rounded`/`filter_list_rounded` → `filter` · `sort_rounded` → `sort` · `more_horiz_rounded` → `moreHorizontal` · `more_vert`/`more_vert_rounded` → `moreVertical` · `open_in_new`/`open_in_new_rounded` → `openExternal` · `open_in_full_rounded` → `expand` · `compress_rounded` → `compress` · `link`/`link_rounded` → `link` · `link_off`/`link_off_rounded` → `unlink` · `attach_file_rounded` → `attach` · `replay_rounded`/`restart_alt_rounded`/`restore_rounded` → `replay` · `skip_next_rounded` → `skip` · `block`/`block_rounded` → `block` · `cancel_outlined` → `cancel` · `archive_outlined` → `archive` · `unarchive_outlined` → `unarchive` · `loop_rounded` → `loop` · `remove_circle_outline_rounded` → `remove` · `play_arrow_rounded`/`play_circle_outline`/`play_circle_rounded` → `play` · `pause_circle_outline_rounded` → `pause` · `stop_circle_outlined`/`stop_rounded` → `stop`

**Status:** `error`/`error_rounded`/`error_outline`/`error_outline_rounded` → `error` · `warning`/`warning_amber_rounded` → `warning` · `info_outline`/`info_outline_rounded` → `info` · `help_outline`/`help_outline_rounded` → `help` · `pending_rounded` → `pending` · `schedule_rounded`/`access_time_rounded` → `schedule` · `hourglass_empty` → `hourglass` · `timer_outlined` → `timer` · `notifications_rounded`/`notifications_active_rounded` → `notification`

**Files:** `insert_drive_file_outlined`/`insert_drive_file_rounded` → `file` · `description`/`description_outlined` → `description` · `file_open` → `fileText` · `create_new_folder_rounded` → `folderPlus` · `folder_outlined`/`folder_rounded` → `folder` · `folder_open`/`folder_open_outlined`/`folder_open_rounded` → `folderOpen` · `folder_off_outlined`/`folder_off_rounded`/`folder_copy` → `folderOff` · `image`/`image_outlined`/`image_rounded`/`broken_image`/`broken_image_rounded` → `image` · `photo_library_outlined`/`photo_library_rounded` → `photoLibrary` · `camera_alt_outlined`/`camera_alt_rounded`/`add_photo_alternate_outlined` → `camera` · `picture_as_pdf` → `pdf` · `table_chart`/`table_chart_outlined` → `table`

**Terminal & Code:** `terminal`/`terminal_rounded` → `terminal` · `code`/`code_rounded` → `code` · `data_object` → `dataObject` · `build`/`build_outlined`/`build_rounded` → `build` · `construction_rounded` → `construction` · `handyman_rounded` → `handyman` · `science_rounded` → `science` · `keyboard_rounded` → `keyboard` · `javascript` → `javascript` · `source_rounded` → `sourceCode`

**AI & Agents:** `smart_toy`/`smart_toy_outlined`/`smart_toy_rounded` → `agent` · `psychology_outlined`/`psychology_rounded` → `psychology` · `auto_awesome`/`auto_awesome_outlined`/`auto_awesome_rounded` → `autoAwesome` · `auto_fix_high_rounded` → `autoFix` · `lightbulb_outline_rounded` → `lightbulb` · `school` → `school`

**Git:** `fork_right`/`fork_right_outlined` → `forkRight` · `call_split_rounded` → `callSplit` · `difference_rounded` → `diff` · `history_rounded` → `history` · `account_tree`/`account_tree_outlined`/`account_tree_rounded` → `gitBranch`

**Network:** `wifi`/`wifi_rounded` → `wifi` · `wifi_off` → `wifiOff` · `cloud_outlined`/`cloud_off_rounded` → `cloud`/`cloudOff` · `signal_cellular_alt`/`signal_cellular_off` → `signal`/`signalOff` · `network_wifi` → `network` · `language`/`language_rounded`/`web` → `globe` · `http_rounded` → `http` · `dns`/`dns_outlined`/`dns_rounded` → `dns` · `webhook_outlined` → `webhook` · `vpn_lock`/`vpn_lock_rounded` → `vpn`

**Devices:** `computer`/`computer_outlined`/`computer_rounded` → `computer` · `laptop_mac`/`laptop_mac_rounded`/`laptop_windows` → `laptop` · `phone_android`/`phone_iphone`/`smartphone_rounded` → `phone` · `devices`/`devices_rounded` → `devices`

**Settings:** `settings`/`settings_outlined`/`settings_rounded` → `settings` · `tune`/`tune_rounded` → `tune` · `palette_outlined`/`palette_rounded` → `palette` · `wallpaper_rounded` → `wallpaper` · `dashboard_rounded`/`dashboard_customize_rounded` → `dashboard` · `fingerprint_rounded` → `fingerprint` · `security`/`security_rounded` → `security` · `shield_outlined`/`verified_user_outlined`/`verified_user_rounded` → `shieldCheck` · `lock_outline`/`lock_outline_rounded`/`lock_rounded` → `lock` · `lock_open_rounded` → `lockOpen` · `privacy_tip_outlined` → `privacy` · `settings_ethernet_rounded` → `settings`

**User:** `person`/`person_rounded`/`person_outline`/`person_outline_rounded` → `person` · `groups_rounded` → `group` · `account_circle_outlined` → `person` · `logout_rounded` → `logout` · `account_balance_wallet_outlined`/`account_balance_wallet_rounded` → `wallet` · `credit_card_rounded` → `creditCard` · `attach_money` → `wallet` · `workspace_premium_rounded` → `subscription`

**Media:** `mic`/`mic_rounded` → `mic` · `mic_off` → `micOff` · `flash_on_rounded` → `flashOn` · `flash_off_rounded` → `flashOff` · `visibility`/`visibility_rounded`/`visibility_outlined` → `visibility` · `visibility_off`/`visibility_off_rounded` → `visibilityOff`

**Content:** `checklist`/`checklist_rounded` → `checklist` · `grid_view_rounded` → `gridView` · `layers_rounded` → `layers` · `preview_rounded` → `preview` · `text_fields`/`text_fields_rounded` → `textFields` · `menu_book_rounded` → `menuBook` · `view_agenda_rounded` → `viewAgenda` · `toc_rounded` → `toc` · `unfold_more_rounded` → `unfoldMore` · `border_all_rounded` → `borderAll` · `border_left_rounded` → `borderLeft` · `border_style_rounded` → `borderStyle`

**Extensions:** `extension`/`extension_rounded` → `extension_` · `extension_off`/`extension_off_rounded` → `extensionOff` · `apps_rounded` → `dashboard`

**Misc:** `star_rounded`/`star_border_rounded` → `star` · `bolt`/`bolt_rounded` → `bolt` · `speed_rounded` → `speed` · `memory`/`memory_outlined`/`memory_rounded` → `memory` · `work_outline_rounded` → `work` · `gavel_rounded` → `gavel` · `explore_rounded` → `explore` · `hub_rounded` → `hub` · `data_usage_outlined`/`data_usage_rounded` → `dataUsage` · `all_inclusive_rounded` → `allInclusive` · `alt_route_rounded` → `altRoute` · `blur_on_rounded` → `blurOn` · `apple`/`apple_rounded`/`g_mobiledata_rounded` → `apple` · `radio_button_checked`/`radio_button_checked_rounded` → `radioChecked` · `radio_button_off`/`radio_button_off_rounded`/`radio_button_unchecked` → `radioUnchecked` · `check_box` → `checkBox` · `check_box_outline_blank` → `checkBoxBlank` · `circle_outlined` → `circleOutlined` · `cleaning_services_outlined` → `cleaning` · `rate_review_rounded`/`add_comment_rounded` → `rateReview` · `feedback_outlined` → `feedback` · `developer_board_rounded` → `developer` · `find_in_page_outlined` → `search` · `disabled_by_default_outlined` → `cancel` · `chat_bubble_outline_rounded`/`chat_bubble_rounded` → `rateReview`

## Post-Migration Cleanup

After all files are migrated:

1. **Remove `cupertino_icons`** from `pubspec.yaml` (0 usages confirmed)
2. **Verify no `Icons.*` remain:** `grep -rn 'Icons\.' lib/screens/ lib/widgets/ --include="*.dart"` should return nothing
3. **Run `flutter analyze`** — must be 0 errors
4. **Run `flutter build ios --no-codesign`** or `flutter build apk` to verify build succeeds

## Constraints

- **Do NOT touch** `lib/theme/` files (design tokens, typography, themes — already migrated)
- **Do NOT change** any logic, state management, or functionality — only icon references
- **Do NOT use** `LucideIcons.*` directly in screens/widgets — always go through `AppIcons`
- **Monster files** (`chat_screen.dart` 12K lines, `sessions_screen.dart` 6K lines) — be extra careful, surgical edits only
- If a Lucide icon name doesn't exist, check the package source or find the closest equivalent
- Keep the `Icon()` widget — Lucide is font-based IconData, same API as Material
- Some Material icons may not have a perfect Lucide equivalent — pick the closest match and note it in a comment
