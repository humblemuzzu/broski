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
  static const subdirectory = LucideIcons.cornerDownRight;

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
  static const loop = LucideIcons.repeat;

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
  static const photoLibrary = LucideIcons.image;
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
  static const science = LucideIcons.flaskConical;
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
  static const lockOpen = LucideIcons.unlock;
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
  static const viewAgenda = LucideIcons.rows;
  static const toc = LucideIcons.list;
  static const unfoldMore = LucideIcons.chevronsUpDown;

  // ── Extensions & Plugins ──
  static const extension_ = LucideIcons.puzzle;
  static const extensionOff = LucideIcons.puzzle; // no puzzleX in this version
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
  static const hub = LucideIcons.network;
  static const dataUsage = LucideIcons.pieChart;
  static const allInclusive = LucideIcons.infinity;
  static const altRoute = LucideIcons.split;
  static const blurOn = LucideIcons.sparkles;
  static const borderAll = LucideIcons.grid;
  static const borderLeft = LucideIcons.panelLeft;
  static const borderStyle = LucideIcons.square;
  static const apple = LucideIcons.apple;
  static const radioChecked = LucideIcons.circleDot;
  static const radioUnchecked = LucideIcons.circle;
  static const checkBox = LucideIcons.checkSquare;
  static const checkBoxBlank = LucideIcons.square;
  static const circleOutlined = LucideIcons.circle;
  static const cleaning = LucideIcons.sparkles;
  static const rateReview = LucideIcons.messageSquare;
  static const feedback = LucideIcons.messageCircle;
  static const workspace = LucideIcons.crown;
  static const developer = LucideIcons.code2;
  static const chatBubble = LucideIcons.messageSquare;
}
