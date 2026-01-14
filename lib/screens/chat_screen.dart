import 'dart:async';
import 'dart:convert';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/agent.dart';
import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/command.dart';
import '../models/file_attachment.dart';
import '../models/message.dart';
import '../models/question.dart';
import '../models/permission_rule.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../models/session_context.dart';
import '../models/vcs.dart';
import '../providers/chat_provider.dart';
import '../providers/claude_code_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/codex_settings_provider.dart';
import '../providers/file_search_provider.dart';
import '../providers/input_style_provider.dart';
import '../providers/permission_rules_provider.dart';
import '../providers/prompt_accent_provider.dart';
import '../providers/selection_provider.dart';
import '../models/prompt_accent_color.dart';
import '../providers/service_providers.dart';
import '../providers/tool_settings_provider.dart';
import '../services/haptics_service.dart';
import '../services/image_picker_service.dart';
import '../services/websocket_service.dart';
import '../theme/opencode_theme.dart';
import '../widgets/background_session_widgets.dart';
import '../widgets/diff_viewer.dart';
import '../widgets/export_session_sheet.dart';
import '../widgets/file_tagging.dart';
import '../widgets/message_bubble.dart';
import '../widgets/subtask_notification_card.dart';
import '../widgets/thinking_card.dart';
import '../widgets/permission_prompt.dart';
import '../widgets/permission_rules_sheet.dart';
import '../widgets/question_prompt_sheet.dart';
import '../widgets/rollback_sheet.dart';
import '../widgets/session_sidebar.dart';
import '../widgets/tool_call.dart';
import '../widgets/claude_code_help.dart';
import 'subagents_screen.dart';
import 'custom_tools_screen.dart';
import 'plugins_screen.dart';
import 'sessions_screen.dart';
import '../utils/opencode_id.dart';
import '../widgets/app_background.dart';
import '../widgets/opencode_branding.dart';
import '../widgets/provider_icon.dart';
import '../providers/appearance_provider.dart';
import 'diff_view_screen.dart';

// Utility function for color opacity (from expense_tracker)
Color fade(Color color, double opacity) {
  final clamped = opacity.clamp(0.0, 1.0);
  return color.withValues(alpha: clamped);
}

class ChatScreen extends ConsumerStatefulWidget {
  /// Constructor for OpenCode sessions
  const ChatScreen({
    super.key,
    required this.project,
    required this.session,
    this.initialPrompt,
  }) : ccSession = null,
       ccDraftCwd = null,
       ccDraftTitle = null,
       ccDraftModel = null,
       cxThread = null,
       cxDraftCwd = null,
       cxDraftTitle = null,
       cxDraftModel = null,
       isClaudeCode = false,
       isCodex = false;

  /// Named constructor for Claude Code sessions
  const ChatScreen.claudeCode({
    super.key,
    required this.ccSession,
    this.initialPrompt,
  }) : project = const ProjectSummary(id: '', name: '', path: ''),
       session = const SessionSummary(
         id: '',
         title: '',
         projectID: '',
         directory: '',
         time: SessionTime(created: 0, updated: 0),
       ),
       ccDraftCwd = null,
       ccDraftTitle = null,
       ccDraftModel = null,
       cxThread = null,
       cxDraftCwd = null,
       cxDraftTitle = null,
       cxDraftModel = null,
       isClaudeCode = true,
       isCodex = false;

  /// Named constructor for a new Claude Code chat (session ID assigned on first turn)
  const ChatScreen.claudeCodeDraft({
    super.key,
    required String cwd,
    String? title,
    String? model,
    this.initialPrompt,
  }) : project = const ProjectSummary(id: '', name: '', path: ''),
       session = const SessionSummary(
         id: '',
         title: '',
         projectID: '',
         directory: '',
         time: SessionTime(created: 0, updated: 0),
       ),
       ccSession = null,
       ccDraftCwd = cwd,
       ccDraftTitle = title,
       ccDraftModel = model,
       cxThread = null,
       cxDraftCwd = null,
       cxDraftTitle = null,
       cxDraftModel = null,
       isClaudeCode = true,
       isCodex = false;

  /// Named constructor for Codex threads
  const ChatScreen.codex({
    super.key,
    required this.cxThread,
    this.initialPrompt,
  }) : project = const ProjectSummary(id: '', name: '', path: ''),
       session = const SessionSummary(
         id: '',
         title: '',
         projectID: '',
         directory: '',
         time: SessionTime(created: 0, updated: 0),
       ),
       ccSession = null,
       ccDraftCwd = null,
       ccDraftTitle = null,
       ccDraftModel = null,
       cxDraftCwd = null,
       cxDraftTitle = null,
       cxDraftModel = null,
       isClaudeCode = false,
       isCodex = true;

  /// Named constructor for a new Codex chat (thread ID assigned on first turn)
  const ChatScreen.codexDraft({
    super.key,
    required String cwd,
    String? title,
    String? model,
    this.initialPrompt,
  }) : project = const ProjectSummary(id: '', name: '', path: ''),
       session = const SessionSummary(
         id: '',
         title: '',
         projectID: '',
         directory: '',
         time: SessionTime(created: 0, updated: 0),
       ),
       ccSession = null,
       ccDraftCwd = null,
       ccDraftTitle = null,
       ccDraftModel = null,
       cxThread = null,
       cxDraftCwd = cwd,
       cxDraftTitle = title,
       cxDraftModel = model,
       isClaudeCode = false,
       isCodex = true;

  final ProjectSummary project;
  final SessionSummary session;
  final ClaudeCodeSession? ccSession;
  final String? ccDraftCwd;
  final String? ccDraftTitle;
  final String? ccDraftModel;
  final CodexThread? cxThread;
  final String? cxDraftCwd;
  final String? cxDraftTitle;
  final String? cxDraftModel;
  final bool isClaudeCode;
  final bool isCodex;
  final String? initialPrompt;

  bool get isOpenCode => !isClaudeCode && !isCodex;

  /// Get the effective session ID
  String get effectiveSessionId => isClaudeCode
      ? (ccSession?.id ?? '')
      : isCodex
      ? (cxThread?.id ?? '')
      : session.id;

  /// Get the effective project path
  String get effectivePath => isClaudeCode
      ? (ccSession?.cwd ?? ccDraftCwd ?? '')
      : isCodex
      ? (cxThread?.cwd ?? cxDraftCwd ?? '')
      : project.path;

  /// Get the effective title
  String get effectiveTitle => isClaudeCode
      ? (ccSession?.displayTitle ?? ccDraftTitle ?? 'Claude Code')
      : isCodex
      ? (cxThread?.displayTitle ?? cxDraftTitle ?? 'Codex')
      : session.title;

  /// Get project name from path
  String get projectName {
    final path = effectivePath;
    final parts = path.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen>
    with SingleTickerProviderStateMixin {
  String _newClientMessageId() {
    return OpenCodeId.newMessageId();
  }

  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final HapticsService _haptics = HapticsService();
  String? _activePermissionId;
  String? _activeQuestionId;

  // Auto-scroll state: tracks if user has intentionally scrolled up
  // When true, we don't auto-scroll (respect user's intent to view history)
  // When false (user is at/near bottom), we auto-scroll as new content arrives
  bool _userHasScrolledUp = false;
  // Track previous message count to detect new content
  int _previousMessageCount = 0;
  int _previousContentLength = 0;

  // Sidebar state
  bool _sidebarOpen = false;
  SessionContext _sessionContext = SessionContext.empty();
  bool _loadingContext = false;

  // Feature 2: Slash Commands
  List<SlashCommand> _commands = [];
  bool _showCommandAutocomplete = false;
  String _commandFilter = '';

  // Feature 3: Agent Switching
  List<Agent> _agents = [];
  String? _selectedAgent;

  // Feature 10: VCS/Git info
  VcsInfo _vcsInfo = const VcsInfo();

  // Feature 21: File @ tagging
  final List<FileAttachment> _attachedFiles = [];
  bool _showFileAutocomplete = false;

  // Feature 22: Agent @ mentions
  bool _showAgentAutocomplete = false;
  String _agentQuery = '';

  // Claude Code: Custom tool @ insertion (type "@tool:")
  bool _showCustomToolAutocomplete = false;
  String _customToolQuery = '';

  // Focus node for input bar - needed to restore focus after autocomplete appears
  final FocusNode _inputFocusNode = FocusNode();

  // Message pagination state
  bool _loadingMoreMessages = false;
  bool _hasLoadedAllMessages = false;

  bool _resyncingAfterReconnect = false;
  bool _initialPromptSent = false;

  // FIX: Store listener subscriptions for proper cleanup
  ProviderSubscription<BridgeConnectionState>? _connectionSubscription;
  ProviderSubscription<ChatSessionState>? _chatSubscription;
  ProviderSubscription<AsyncValue<ClaudeCodeConfig>>? _ccConfigSubscription;

  @override
  void initState() {
    super.initState();
    final bridge = ref.read(bridgeServiceProvider);

    // Set up view routing (OpenCode only - CC doesn't need this)
    if (widget.isOpenCode) {
      bridge.setView(
        projectPath: widget.project.path,
        sessionId: widget.session.id,
        agent: 'opencode',
      );
    }

    // FIX: Use listenManual for proper subscription lifecycle management
    _connectionSubscription = ref.listenManual(connectionProvider, (
      previous,
      next,
    ) {
      final wasConnected = previous?.status == ConnectionStatus.connected;
      final isConnected = next.status == ConnectionStatus.connected;
      if (!wasConnected && isConnected) {
        // Re-assert view routing and re-sync session state after network flips.
        if (_resyncingAfterReconnect) return;
        _resyncingAfterReconnect = true;
        if (widget.isOpenCode) {
          bridge.setView(
            projectPath: widget.project.path,
            sessionId: widget.session.id,
            agent: 'opencode',
          );
        }
        _hydrateSession().whenComplete(() {
          _resyncingAfterReconnect = false;
          _maybeSendInitialPrompt();
        });
      }
    });

    // FIX: Use listenManual for proper subscription lifecycle management
    // Auto-scroll: Listen to chat state changes to trigger auto-scroll
    // when new content arrives (streaming text, tool calls, diffs, etc.)
    _chatSubscription = ref.listenManual(
      chatSessionProvider,
      _handleAutoScroll,
    );

    _hydrateSession().whenComplete(_maybeSendInitialPrompt);
    _controller.addListener(_onTextChanged);
    _scrollController.addListener(_onScroll);

    // Load commands for both modes (different implementations)
    _loadCommandsAndAgents();

    if (widget.isOpenCode) {
      _loadVcsInfo();
    } else if (widget.isClaudeCode) {
      // Preload Claude Code config so the tools sheet is instant.
      ref.read(ccConfigProvider.notifier).load();
      // Preload power feature data for @/menu UX.
      ref.read(ccCustomToolsProvider.notifier).load();
      ref.read(ccPluginsProvider.notifier).load(cwd: widget.effectivePath);

      // Keep subagents synced into the @agent autocomplete list.
      _ccConfigSubscription = ref.listenManual(ccConfigProvider, (
        previous,
        next,
      ) {
        final cfg = next.valueOrNull;
        if (cfg == null || !mounted) return;
        final subagentAgents = cfg.subagents
            .where((s) => s.name.isNotEmpty)
            .map(
              (s) => Agent(
                name: s.name,
                description: s.description,
                mode: AgentMode.subagent,
              ),
            )
            .toList();
        setState(() {
          _agents = subagentAgents;
        });
      });
    }
  }

  void _maybeSendInitialPrompt() {
    if (_initialPromptSent) return;
    final prompt = widget.initialPrompt?.trim() ?? '';
    if (prompt.isEmpty) return;

    final connection = ref.read(connectionProvider);
    if (!connection.isConnected) return;

    final chatState = ref.read(chatSessionProvider);
    // Avoid sending twice if we already have messages (e.g., opening an existing session).
    if (chatState.messages.isNotEmpty) {
      _initialPromptSent = true;
      return;
    }

    _initialPromptSent = true;
    _controller.text = prompt;
    _sendMessage(connection, chatState);
  }

  Future<void> _hydrateSession() async {
    final connection = ref.read(connectionProvider);
    final storage = ref.read(storageServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);

    // Reset pagination state
    setState(() {
      _loadingMoreMessages = false;
      _hasLoadedAllMessages = false;
    });

    // Claude Code mode - set up CC session in provider (session ID may be assigned on first turn)
    if (widget.isClaudeCode) {
      final cwd = widget.ccSession?.cwd ?? widget.ccDraftCwd ?? '';
      chat.setCCSession(
        sessionId: widget.ccSession?.id ?? '',
        cwd: cwd,
        model: widget.ccSession?.model ?? widget.ccDraftModel,
        title: widget.ccSession?.displayTitle ?? widget.ccDraftTitle,
      );

      // If this is an existing Claude Code session, hydrate transcript
      final sessionId = widget.ccSession?.id;
      if (sessionId != null && sessionId.isNotEmpty) {
        // Offline mode - use cached CC messages
        if (connection.isOfflineMode) {
          final cachedMessages = await storage.getCachedCCMessages(sessionId);
          if (cachedMessages.isNotEmpty) {
            chat.hydrate(cachedMessages.map((m) => _messageToRaw(m)).toList());
          }
        } else {
          try {
            final items = await ref
                .read(bridgeServiceProvider)
                .ccGetSessionMessages(sessionId, cwd: cwd);
            chat.hydrateClaudeCodeTranscript(items);

            // Cache CC messages for offline use
            final chatState = ref.read(chatSessionProvider);
            if (chatState.messages.isNotEmpty) {
              await storage.cacheCCSessionMessages(
                sessionId,
                chatState.messages,
              );
            }
          } catch (_) {
            // On error, try cached messages
            final cachedMessages = await storage.getCachedCCMessages(sessionId);
            if (cachedMessages.isNotEmpty) {
              chat.hydrate(
                cachedMessages.map((m) => _messageToRaw(m)).toList(),
              );
            }
          }
        }
      }

      _scrollToBottom(animate: false);
      setState(() => _hasLoadedAllMessages = true);
      return;
    }

    // Codex mode - set up thread in provider (thread ID may be assigned on first turn)
    if (widget.isCodex) {
      final cwd = widget.cxThread?.cwd ?? widget.cxDraftCwd ?? '';
      final threadId = widget.cxThread?.id ?? '';
      chat.setCodexThread(
        threadId: threadId,
        cwd: cwd,
        model: widget.cxThread?.modelProvider ?? widget.cxDraftModel,
      );

      if (threadId.isNotEmpty) {
        if (connection.isOfflineMode) {
          final cached = await storage.getCachedCodexMessages(threadId);
          if (cached.isNotEmpty) {
            chat.hydrate(cached.map((m) => _messageToRaw(m)).toList());
          }
        } else {
          try {
            final items = await ref
                .read(bridgeServiceProvider)
                .cxGetThreadMessages(threadId);
            chat.hydrateCodexTranscript(items);

            final chatState = ref.read(chatSessionProvider);
            if (chatState.messages.isNotEmpty) {
              await storage.cacheCodexThreadMessages(
                threadId,
                chatState.messages,
              );
            }
          } catch (_) {
            final cached = await storage.getCachedCodexMessages(threadId);
            if (cached.isNotEmpty) {
              chat.hydrate(cached.map((m) => _messageToRaw(m)).toList());
            }
          }
        }
      }

      _scrollToBottom(animate: false);
      setState(() => _hasLoadedAllMessages = true);
      return;
    }

    // OpenCode mode - set up OC session in provider
    chat.setSession(widget.session, projectPath: widget.project.path);

    // Demo mode - use sample messages from DemoDataService
    if (connection.isDemoMode) {
      chat.hydrateDemoMessages(widget.session.id);
      setState(() => _hasLoadedAllMessages = true);
      _scrollToBottom(animate: false);
      return;
    }

    // In offline mode, load from cache (all messages)
    if (connection.isOfflineMode) {
      final cachedMessages = await storage.getCachedMessages(widget.session.id);
      if (cachedMessages.isNotEmpty) {
        // Hydrate provider with cached messages format
        chat.hydrate(cachedMessages.map((m) => _messageToRaw(m)).toList());
      }
      setState(() => _hasLoadedAllMessages = true); // Cache has all messages
      _scrollToBottom(animate: false);
      return;
    }

    final bridge = ref.read(bridgeServiceProvider);
    final messages = await bridge.getSessionMessages(
      widget.session.id,
      projectPath: widget.project.path,
      limit: 20, // Initial load: only fetch last 20 messages for speed
    );
    chat.hydrate(messages);

    // If we got fewer than 20 messages, we already have all of them
    if (messages.length < 20) {
      setState(() => _hasLoadedAllMessages = true);
    }

    _scrollToBottom(animate: false);
    // Load context after messages
    _loadSessionContext();

    // Cache messages for offline use
    final chatState = ref.read(chatSessionProvider);
    if (chatState.messages.isNotEmpty) {
      await storage.cacheSessionMessages(widget.session.id, chatState.messages);
    }
  }

  /// Convert ChatMessage to raw format for hydrate
  Map<String, dynamic> _messageToRaw(ChatMessage m) {
    return {
      'info': {
        'id': m.id,
        'sessionID': m.sessionId,
        'role': m.role == MessageRole.user ? 'user' : 'assistant',
        'time': {'created': m.createdAt.millisecondsSinceEpoch},
      },
      'parts': [
        if (m.text.isNotEmpty) {'type': 'text', 'text': m.text},
        ...m.toolCalls.map(
          (t) => {
            'type': 'tool',
            'id': t.partId,
            'callID': t.callId,
            'tool': t.name,
            'state': {
              'status': t.status,
              'title': t.title,
              'input': t.input,
              'output': t.output,
              'metadata': t.metadata,
            },
          },
        ),
      ],
    };
  }

  // Feature 2 & 3: Load available commands and agents
  Future<void> _loadCommandsAndAgents() async {
    final bridge = ref.read(bridgeServiceProvider);
    final storage = ref.read(storageServiceProvider);
    final connection = ref.read(connectionProvider);

    // Claude Code mode - load CC commands
    if (widget.isClaudeCode) {
      await _loadClaudeCodeCommands();
      return;
    }

    // Codex mode - built-in commands (app-server features)
    // Full parity with Codex CLI slash commands
    if (widget.isCodex) {
      if (!mounted) return;
      setState(() {
        _agents = const [];
        _commands = const [
          // Core commands
          SlashCommand(
            name: 'model',
            description: 'Change model',
            builtin: true,
          ),
          SlashCommand(
            name: 'approvals',
            description:
                'Set approval policy (untrusted/on-failure/on-request/never)',
            builtin: true,
          ),
          SlashCommand(
            name: 'status',
            description: 'Show thread status, tokens, settings',
            builtin: true,
          ),
          // Reasoning commands
          SlashCommand(
            name: 'reasoning',
            description: 'Set reasoning effort (minimal/low/medium/high/xhigh)',
            builtin: true,
          ),
          SlashCommand(
            name: 'reasoningsummary',
            description: 'Set reasoning summary (auto/concise/detailed/none)',
            builtin: true,
          ),
          // Feature toggles
          SlashCommand(
            name: 'websearch',
            description: 'Toggle web search (on/off)',
            builtin: true,
          ),
          SlashCommand(
            name: 'skills',
            description: 'Toggle skills discovery (on/off)',
            builtin: true,
          ),
          // Session commands
          SlashCommand(
            name: 'compact',
            description: 'Summarize/compact thread context',
            builtin: true,
          ),
          SlashCommand(
            name: 'diff',
            description: 'Show file changes diff',
            builtin: true,
          ),
          SlashCommand(
            name: 'undo',
            description: 'Undo last file changes',
            builtin: true,
          ),
          SlashCommand(
            name: 'review',
            description: 'Start code review of uncommitted changes',
            builtin: true,
          ),
          // Project commands
          SlashCommand(
            name: 'agents',
            description: 'Edit AGENTS.md project instructions',
            builtin: true,
          ),
          SlashCommand(
            name: 'init',
            description: 'Create AGENTS.md with template',
            builtin: true,
          ),
          SlashCommand(
            name: 'mcp',
            description: 'List MCP server status',
            builtin: true,
          ),
        ];
      });
      return;
    }

    // OpenCode mode - offline support
    if (connection.isOfflineMode) {
      final cachedCommands = await storage.getCachedCommands();
      final cachedAgents = await storage.getCachedAgents();
      if (mounted) {
        setState(() {
          _commands = cachedCommands.isNotEmpty ? cachedCommands : [];
          _agents = cachedAgents.isNotEmpty ? cachedAgents : kDefaultAgents;
        });
      }
      return;
    }

    try {
      final commands = await bridge.listCommands(
        projectPath: widget.project.path,
      );
      final agents = await bridge.listAgents(projectPath: widget.project.path);

      // Cache for offline use
      if (commands.isNotEmpty) {
        await storage.cacheCommands(commands);
      }
      if (agents.isNotEmpty) {
        await storage.cacheAgents(agents);
      }

      // Built-in OpenCode commands (matching TUI)
      final builtInCommands = [
        const SlashCommand(
          name: 'undo',
          description: 'Undo last message',
          builtin: true,
        ),
        const SlashCommand(
          name: 'redo',
          description: 'Redo last message',
          builtin: true,
        ),
        const SlashCommand(
          name: 'compact',
          description: 'Compact session',
          builtin: true,
        ),
        const SlashCommand(
          name: 'summarize',
          description: 'Compact session (alias)',
          builtin: true,
        ),
        const SlashCommand(
          name: 'unshare',
          description: 'Unshare session',
          builtin: true,
        ),
        const SlashCommand(
          name: 'rename',
          description: 'Rename session',
          builtin: true,
        ),
        const SlashCommand(
          name: 'copy',
          description: 'Copy transcript to clipboard',
          builtin: true,
        ),
        const SlashCommand(
          name: 'export',
          description: 'Export transcript to file',
          builtin: true,
        ),
        const SlashCommand(
          name: 'timeline',
          description: 'Jump to message',
          builtin: true,
        ),
        const SlashCommand(
          name: 'fork',
          description: 'Fork session',
          builtin: true,
        ),
        const SlashCommand(
          name: 'thinking',
          description: 'Toggle thinking visibility',
          builtin: true,
        ),
        const SlashCommand(
          name: 'share',
          description: 'Share session',
          builtin: true,
        ),
        const SlashCommand(
          name: 'new',
          description: 'Create new session',
          builtin: true,
        ),
        const SlashCommand(
          name: 'clear',
          description: 'Create new session (alias)',
          builtin: true,
        ),
        const SlashCommand(
          name: 'models',
          description: 'List models',
          builtin: true,
        ),
        const SlashCommand(
          name: 'agents',
          description: 'List agents',
          builtin: true,
        ),
        const SlashCommand(
          name: 'session',
          description: 'List sessions',
          builtin: true,
        ),
        const SlashCommand(
          name: 'resume',
          description: 'List sessions (alias)',
          builtin: true,
        ),
        const SlashCommand(
          name: 'continue',
          description: 'List sessions (alias)',
          builtin: true,
        ),
        const SlashCommand(
          name: 'help',
          description: 'Show available commands',
          builtin: true,
        ),
      ];

      if (mounted) {
        setState(() {
          _commands = [...builtInCommands, ...commands];
          _agents = agents.isNotEmpty ? agents : kDefaultAgents;
        });
      }
    } catch (e) {
      // Use defaults if loading fails
      if (mounted) {
        setState(() {
          _agents = kDefaultAgents;
        });
      }
    }
  }

  /// Load slash commands for Claude Code
  Future<void> _loadClaudeCodeCommands() async {
    final bridge = ref.read(bridgeServiceProvider);
    final cwd = widget.ccSession?.cwd ?? widget.ccDraftCwd;

    try {
      // Fetch custom commands from .claude/commands/ directories
      final ccCommands = await bridge.ccListCommands(cwd: cwd);

      // Built-in Claude Code commands
      const builtInCommands = [
        SlashCommand(
          name: 'compact',
          description: 'Summarize conversation to free context',
          builtin: true,
        ),
        SlashCommand(
          name: 'clear',
          description: 'Clear conversation and start fresh',
          builtin: true,
        ),
        SlashCommand(
          name: 'help',
          description: 'Show available commands',
          builtin: true,
        ),
      ];

      // Convert CC commands to SlashCommand and merge
      final customCommands = ccCommands
          .map((c) => c.toSlashCommand(builtin: false))
          .toList();

      if (mounted) {
        setState(() {
          _commands = [...builtInCommands, ...customCommands];
        });
      }
    } catch (e) {
      // Use just built-in commands if loading fails
      if (mounted) {
        setState(() {
          _commands = const [
            SlashCommand(
              name: 'compact',
              description: 'Summarize conversation to free context',
              builtin: true,
            ),
            SlashCommand(
              name: 'clear',
              description: 'Clear conversation and start fresh',
              builtin: true,
            ),
            SlashCommand(
              name: 'help',
              description: 'Show available commands',
              builtin: true,
            ),
          ];
        });
      }
    }
  }

  Future<void> _loadSessionContext() async {
    if (_loadingContext) return;
    setState(() => _loadingContext = true);

    final storage = ref.read(storageServiceProvider);
    final connection = ref.read(connectionProvider);

    // Claude Code mode - build context from stream state
    if (widget.isClaudeCode) {
      final chatState = ref.read(chatSessionProvider);
      final tokenUsage = chatState.ccTokenUsage;

      final context = SessionContext.fromClaudeCode(
        inputTokens: tokenUsage?.inputTokens ?? 0,
        outputTokens: tokenUsage?.outputTokens ?? 0,
        cacheReadTokens: tokenUsage?.cacheReadTokens ?? 0,
        totalCostUsd: tokenUsage?.totalCostUsd,
        // SDK v2.1.6+: Use context window from token usage if available
        contextWindow: tokenUsage?.effectiveContextWindow ?? 200000,
        // Avoid client-side "made up" file summaries for Claude Code.
        // Only show what the SDK reports directly (usage/cost).
        modifiedFiles: const [],
      );

      // Cache CC context for offline
      final sessionId = chatState.ccSessionId ?? widget.ccSession?.id ?? '';
      if (sessionId.isNotEmpty) {
        await storage.cacheSessionContext(sessionId, context);
      }

      setState(() {
        _sessionContext = context;
        _loadingContext = false;
      });
      return;
    }

    // Codex mode - build context from stream token usage
    if (widget.isCodex) {
      final chatState = ref.read(chatSessionProvider);
      final tokenUsage = chatState.cxTokenUsage;

      final total = tokenUsage?.total;
      final contextWindow = tokenUsage?.modelContextWindow ?? 200000;
      final context = SessionContext(
        tokens: TokenUsage(
          input: total?.inputTokens ?? 0,
          output: total?.outputTokens ?? 0,
          total: total?.totalTokens ?? 0,
          contextWindow: contextWindow,
        ),
        cost: 0.0,
        lsp: const [],
        modifiedFiles: const [],
      );

      final threadId = chatState.cxThreadId ?? widget.cxThread?.id ?? '';
      if (threadId.isNotEmpty) {
        await storage.cacheSessionContext(threadId, context);
      }

      setState(() {
        _sessionContext = context;
        _loadingContext = false;
      });
      return;
    }

    // OpenCode offline mode - use cached data
    if (connection.isOfflineMode) {
      final cachedContext = await storage.getCachedSessionContext(
        widget.session.id,
      );
      final cachedTodos = await storage.getCachedSessionTodos(
        widget.session.id,
      );
      if (mounted) {
        setState(() {
          _sessionContext = cachedContext ?? SessionContext.empty();
          _loadingContext = false;
        });
        if (cachedTodos.isNotEmpty) {
          ref.read(chatSessionProvider.notifier).setTodos(cachedTodos);
        }
      }
      return;
    }

    // OpenCode mode - fetch from bridge
    try {
      final bridge = ref.read(bridgeServiceProvider);
      // Load context and todos in parallel
      final contextFuture = bridge.getSessionContext(
        widget.session.id,
        projectPath: widget.project.path,
      );
      final todosFuture = bridge.getTodos(
        widget.session.id,
        projectPath: widget.project.path,
      );
      final contextData = await contextFuture;
      final todosData = await todosFuture;

      final context = SessionContext.fromJson(contextData);

      // Cache for offline use
      await storage.cacheSessionContext(widget.session.id, context);
      if (todosData.isNotEmpty) {
        await storage.cacheSessionTodos(widget.session.id, todosData);
      }

      if (mounted) {
        setState(() {
          _sessionContext = context;
          _loadingContext = false;
        });
        // Update todos in provider
        ref.read(chatSessionProvider.notifier).setTodos(todosData);
      }
    } catch (e) {
      // On error, try cached data
      final cachedContext = await storage.getCachedSessionContext(
        widget.session.id,
      );
      if (mounted) {
        setState(() {
          if (cachedContext != null) {
            _sessionContext = cachedContext;
          }
          _loadingContext = false;
        });
      }
    }
  }

  void _closeSidebar() {
    setState(() => _sidebarOpen = false);
  }

  // Feature 10: Load VCS/Git info
  Future<void> _loadVcsInfo() async {
    final storage = ref.read(storageServiceProvider);
    final connection = ref.read(connectionProvider);

    // Offline mode - use cached VCS info
    if (connection.isOfflineMode) {
      final cachedVcs = await storage.getCachedSessionVcs(widget.session.id);
      if (mounted && cachedVcs != null) {
        setState(() => _vcsInfo = cachedVcs);
        ref.read(chatSessionProvider.notifier).setVcsInfo(cachedVcs);
      }
      return;
    }

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final vcsInfo = await bridge.getVcsInfo(projectPath: widget.project.path);
      if (mounted) {
        setState(() => _vcsInfo = vcsInfo);
        ref.read(chatSessionProvider.notifier).setVcsInfo(vcsInfo);

        // Cache for offline use
        if (vcsInfo.isAvailable) {
          await storage.cacheSessionVcs(widget.session.id, vcsInfo);
        }
      }
    } catch (e) {
      // On error, try cached data
      final cachedVcs = await storage.getCachedSessionVcs(widget.session.id);
      if (mounted && cachedVcs != null) {
        setState(() => _vcsInfo = cachedVcs);
        ref.read(chatSessionProvider.notifier).setVcsInfo(cachedVcs);
      }
    }
  }

  Future<void> _forkSession({String? messageId}) async {
    _haptics.mediumImpact();
    final theme = OpenCodeTheme.of(context);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final chatState = ref.read(chatSessionProvider);

      String? initialPrompt;
      if (messageId != null && messageId.isNotEmpty) {
        final idx = chatState.messages.indexWhere((m) => m.id == messageId);
        if (idx >= 0) {
          for (var i = idx; i >= 0; i--) {
            final m = chatState.messages[i];
            if (m.role == MessageRole.user && m.text.trim().isNotEmpty) {
              initialPrompt = m.text.trim();
              break;
            }
          }
          initialPrompt ??= chatState.messages[idx].text.trim();
        }
      }

      if (widget.isClaudeCode) {
        final sessionId = chatState.ccSessionId ?? widget.ccSession?.id;
        if (sessionId == null || sessionId.isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('Cannot fork: no active session'),
              backgroundColor: theme.error,
            ),
          );
          return;
        }

        final forkedCC = await bridge.ccForkSession(
          sessionId,
          messageId: messageId,
          cwd: chatState.ccCwd ?? widget.ccSession?.cwd,
        );
        if (!mounted) return;

        if (forkedCC == null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('Failed to fork session'),
              backgroundColor: theme.error,
            ),
          );
          return;
        }

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Session forked: ${forkedCC.displayTitle}'),
            backgroundColor: theme.backgroundPanel,
            action: SnackBarAction(
              label: 'Open',
              textColor: theme.primary,
              onPressed: () {
                Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ChatScreen.claudeCode(
                      ccSession: forkedCC,
                      initialPrompt: initialPrompt,
                    ),
                  ),
                );
              },
            ),
          ),
        );
      } else if (widget.isCodex) {
        final threadId = chatState.cxThreadId ?? widget.cxThread?.id;
        if (threadId == null || threadId.isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('Cannot fork: no active thread'),
              backgroundColor: theme.error,
            ),
          );
          return;
        }

        final forked = await bridge.cxThreadFork(threadId: threadId);
        if (!mounted) return;

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Thread forked: ${forked.preview}'),
            backgroundColor: theme.backgroundPanel,
            action: SnackBarAction(
              label: 'Open',
              textColor: theme.primary,
              onPressed: () {
                Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ChatScreen.codex(
                      cxThread: forked,
                      initialPrompt: initialPrompt,
                    ),
                  ),
                );
              },
            ),
          ),
        );
      } else {
        final forkedSession = await bridge.forkSession(
          widget.session.id,
          messageId: messageId,
          projectPath: widget.project.path,
        );
        if (!mounted) return;

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Session forked: ${forkedSession.title}'),
            backgroundColor: theme.backgroundPanel,
            action: SnackBarAction(
              label: 'Open',
              textColor: theme.primary,
              onPressed: () {
                Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ChatScreen(
                      project: widget.project,
                      session: forkedSession,
                      initialPrompt: initialPrompt,
                    ),
                  ),
                );
              },
            ),
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to fork session: $e'),
          backgroundColor: theme.error,
        ),
      );
    }
  }

  // Feature 7: Revert/Undo changes
  Future<void> _revertMessage(String messageId, {String? partId}) async {
    _haptics.mediumImpact();
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.revertMessage(
        widget.session.id,
        messageId: messageId,
        partId: partId,
        projectPath: widget.project.path,
      );
      if (!mounted) return;

      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Changes reverted'),
          backgroundColor: theme.backgroundPanel,
        ),
      );
      // Refresh session context to update modified files
      _loadSessionContext();
    } catch (e) {
      if (!mounted) return;
      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to revert: $e'),
          backgroundColor: theme.error,
        ),
      );
    }
  }

  void _openDiffView(DiffEntry diff, {String? messageId}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => DiffViewScreen(
          diff: diff,
          messageId: messageId,
          onUndo: (msgId, partId) => _revertMessage(msgId, partId: partId),
        ),
      ),
    );
  }

  // Feature 7: Unrevert session (reserved for future use)
  // ignore: unused_element
  Future<void> _unrevertSession() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.unrevertSession(
        widget.session.id,
        projectPath: widget.project.path,
      );
      if (!mounted) return;

      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Revert undone'),
          backgroundColor: theme.backgroundPanel,
        ),
      );
      _loadSessionContext();
    } catch (e) {
      if (!mounted) return;
      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to undo revert: $e'),
          backgroundColor: theme.error,
        ),
      );
    }
  }

  // Claude Code: Rewind files to checkpoint (undo file changes)
  Future<void> _ccRewindToCheckpoint() async {
    _haptics.mediumImpact();
    final theme = OpenCodeTheme.of(context);

    // Check if we have a checkpoint to rewind to
    final ccChatState = ref.read(ccChatProvider);
    if (ccChatState.latestCheckpoint == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('No file changes to undo'),
          backgroundColor: theme.backgroundPanel,
        ),
      );
      return;
    }

    try {
      final ccChat = ref.read(ccChatProvider.notifier);
      final success = await ccChat.rewindToCheckpoint(
        cwd: widget.effectivePath,
      );

      if (!mounted) return;

      if (success) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('File changes reverted'),
            backgroundColor: theme.backgroundPanel,
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Failed to revert file changes'),
            backgroundColor: theme.error,
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to revert: $e'),
          backgroundColor: theme.error,
        ),
      );
    }
  }

  // Feature 8: Share Session
  Future<void> _shareSession() async {
    _haptics.mediumImpact();
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final sharedSession = await bridge.shareSession(
        widget.session.id,
        projectPath: widget.project.path,
      );
      if (!mounted) return;

      final shareUrl = sharedSession.share?.url;
      if (shareUrl == null || shareUrl.isEmpty) {
        final theme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Failed to get share URL'),
            backgroundColor: theme.error,
          ),
        );
        return;
      }

      // Show share dialog
      _showShareDialog(shareUrl);
    } catch (e) {
      if (!mounted) return;
      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to share session: $e'),
          backgroundColor: theme.error,
        ),
      );
    }
  }

  void _showShareDialog(String url) {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Session Shared',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w600,
                color: theme.text,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Anyone with this link can view your session:',
              style: TextStyle(fontSize: 14, color: theme.textMuted),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: theme.bgDeep,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      url,
                      style: TextStyle(fontSize: 13, color: theme.info),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: url));
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: const Text('Link copied'),
                          backgroundColor: theme.backgroundPanel,
                          duration: const Duration(seconds: 2),
                        ),
                      );
                    },
                    icon: Icon(Icons.copy, color: theme.textMuted, size: 20),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      final uri = Uri.parse(url);
                      if (await canLaunchUrl(uri)) {
                        await launchUrl(
                          uri,
                          mode: LaunchMode.externalApplication,
                        );
                      }
                    },
                    icon: const Icon(Icons.open_in_new, size: 18),
                    label: const Text('Open in Browser'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.text,
                      side: BorderSide(color: theme.borderSubtle),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Share.share(url, subject: 'Check out my coding session');
                      Navigator.pop(context);
                    },
                    icon: const Icon(Icons.share, size: 18),
                    label: const Text('Share'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: theme.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }

  // Feature 8: Unshare Session
  Future<void> _unshareSession() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.unshareSession(
        widget.session.id,
        projectPath: widget.project.path,
      );
      if (!mounted) return;

      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Session is no longer shared'),
          backgroundColor: theme.backgroundPanel,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to unshare: $e'),
          backgroundColor: theme.error,
        ),
      );
    }
  }

  // Feature 9: Summarize/Compact Session
  Future<void> _compactSession() async {
    final theme = OpenCodeTheme.of(context);
    final selectedModel = ref.read(selectionProvider).model;
    if (selectedModel == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Please select a model first'),
          backgroundColor: theme.error,
        ),
      );
      return;
    }

    // Confirm compact
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: theme.backgroundPanel,
        title: Text('Compact Session?', style: TextStyle(color: theme.text)),
        content: Text(
          'This will summarize older messages to free up context window space. This cannot be undone.',
          style: TextStyle(color: theme.textMuted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text('Compact', style: TextStyle(color: theme.primary)),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    _haptics.mediumImpact();
    ref.read(chatSessionProvider.notifier).setCompacting(true);

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final success = await bridge.summarizeSession(
        widget.session.id,
        providerID: selectedModel.providerID,
        modelID: selectedModel.modelID,
        projectPath: widget.project.path,
      );

      if (!mounted) return;

      if (success) {
        final theme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Session compacted successfully'),
            backgroundColor: theme.backgroundPanel,
          ),
        );
        // Refresh context to show updated token count
        _loadSessionContext();
      } else {
        ref.read(chatSessionProvider.notifier).setCompacting(false);
        final theme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Failed to compact session'),
            backgroundColor: theme.error,
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ref.read(chatSessionProvider.notifier).setCompacting(false);
      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to compact: $e'),
          backgroundColor: theme.error,
        ),
      );
    }
  }

  // Feature 20: Initialize Project (Create AGENTS.md)
  Future<void> _initializeProject() async {
    final theme = OpenCodeTheme.of(context);
    final selectedModel = ref.read(selectionProvider).model;
    if (selectedModel == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Please select a model first'),
          backgroundColor: theme.error,
        ),
      );
      return;
    }

    // Confirm initialization
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: theme.backgroundPanel,
        title: Text('Initialize Project?', style: TextStyle(color: theme.text)),
        content: Text(
          'This will analyze your project and create an AGENTS.md file with project-specific instructions for the AI.',
          style: TextStyle(color: theme.textMuted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text('Initialize', style: TextStyle(color: theme.success)),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    _haptics.mediumImpact();

    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);

    // Show a loading message
    messenger.showSnackBar(
      SnackBar(
        content: const Text('Initializing project...'),
        backgroundColor: theme.backgroundPanel,
        duration: const Duration(seconds: 2),
      ),
    );

    try {
      final bridge = ref.read(bridgeServiceProvider);

      // Get the latest message ID (used for init)
      final chatState = ref.read(chatSessionProvider);
      final messageId = chatState.messages.isNotEmpty
          ? chatState.messages.last.id
          : 'init';

      final success = await bridge.initSession(
        sessionId: widget.session.id,
        providerID: selectedModel.providerID,
        modelID: selectedModel.modelID,
        messageID: messageId,
        projectPath: widget.project.path,
      );

      if (!mounted) return;

      if (success) {
        final theme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Project initialized! AGENTS.md created.'),
            backgroundColor: theme.success,
          ),
        );
      } else {
        final theme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Failed to initialize project'),
            backgroundColor: theme.error,
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to initialize: $e'),
          backgroundColor: theme.error,
        ),
      );
    }
  }

  /// Dismiss keyboard if the input field is focused.
  /// Called on tap/drag in the chat area for smooth UX.
  void _dismissKeyboardIfFocused() {
    if (_inputFocusNode.hasFocus) {
      _inputFocusNode.unfocus();
    }
  }

  void _onTextChanged() {
    final text = _controller.text;
    final fileSearch = ref.read(fileSearchProvider.notifier);

    // CRITICAL: Capture focus state BEFORE any setState calls.
    // setState can cause focus loss on mobile during widget tree rebuilds.
    final hadFocus = _inputFocusNode.hasFocus;

    // Detect slash command autocomplete - ONLY when input starts fresh with /
    // Once there's a space after the command name, autocomplete closes
    // e.g., "/" or "/init" or "/rev" triggers autocomplete
    // but "/init " (with space) or "hello" does NOT
    final isSlashCommand =
        text.startsWith('/') && text.isNotEmpty && !text.contains(' ');

    // Detect @ mention - check for @something at cursor position
    final atMatch = RegExp(r'@(\S*)$').firstMatch(text);

    if (isSlashCommand) {
      final filter = text.substring(1).toLowerCase();
      if (!_showCommandAutocomplete || _commandFilter != filter) {
        _showCommandAutocomplete = true;
        _showFileAutocomplete = false;
        _showAgentAutocomplete = false;
        _showCustomToolAutocomplete = false;
        _commandFilter = filter;
        _agentQuery = '';
        fileSearch.clear();
        _setStateAndRestoreFocus(hadFocus);
      }
    } else if (atMatch != null) {
      final query = atMatch.group(1) ?? '';
      final lowerQuery = query.toLowerCase();

      // Claude Code: "@tool:" opens custom tools autocomplete
      if (widget.isClaudeCode && lowerQuery.startsWith('tool:')) {
        _showCommandAutocomplete = false;
        _showFileAutocomplete = false;
        _showAgentAutocomplete = false;
        _showCustomToolAutocomplete = true;
        _customToolQuery = query.length > 5 ? query.substring(5) : '';
        _commandFilter = '';
        _agentQuery = '';
        fileSearch.clear();
        _setStateAndRestoreFocus(hadFocus);
        return;
      }

      // Check if this matches any agent name (prioritize agents over files)
      // Only show agent autocomplete if:
      // 1. Query is empty (just typed @) - show both options
      // 2. Query matches an agent name prefix
      final matchesAgent = _agents.any(
        (a) =>
            a.name.toLowerCase().startsWith(lowerQuery) ||
            (a.description?.toLowerCase().contains(lowerQuery) ?? false),
      );

      // If query is short and could be an agent, show agent autocomplete first
      // Once query is longer and doesn't match agents, fall back to file search
      final shouldShowAgents =
          query.isEmpty || (query.length <= 10 && matchesAgent);

      if (shouldShowAgents && _agents.isNotEmpty) {
        // Show agent autocomplete
        _showCommandAutocomplete = false;
        _showFileAutocomplete = false;
        _showAgentAutocomplete = true;
        _showCustomToolAutocomplete = false;
        _agentQuery = query;
        _commandFilter = '';
        fileSearch.clear();
        _setStateAndRestoreFocus(hadFocus);
      } else {
        // Show file autocomplete
        _showCommandAutocomplete = false;
        _showFileAutocomplete = true;
        _showAgentAutocomplete = false;
        _showCustomToolAutocomplete = false;
        _agentQuery = '';
        _commandFilter = '';
        // Trigger file search AFTER updating state flags
        _setStateAndRestoreFocus(hadFocus);
        // Use effectivePath for both OpenCode (project.path) and Claude Code (ccSession.cwd)
        fileSearch.setProjectPath(widget.effectivePath);
        fileSearch.search(query);
      }
    } else {
      // No autocomplete trigger - close any open autocomplete
      final wasShowing =
          _showCommandAutocomplete ||
          _showFileAutocomplete ||
          _showAgentAutocomplete ||
          _showCustomToolAutocomplete;
      if (wasShowing) {
        _showCommandAutocomplete = false;
        _showFileAutocomplete = false;
        _showAgentAutocomplete = false;
        _showCustomToolAutocomplete = false;
        _commandFilter = '';
        _agentQuery = '';
        _customToolQuery = '';
        fileSearch.clear();
      }
      _setStateAndRestoreFocus(hadFocus);
    }
  }

  void _handleCustomToolSelection(ClaudeCodeCustomTool tool) {
    final text = _controller.text;
    final mcpName = tool.mcpToolName;
    final newText = text.replaceFirst(RegExp(r'@\S*$'), '$mcpName ');
    _controller.text = newText;
    _controller.selection = TextSelection.collapsed(offset: newText.length);

    setState(() {
      _showCustomToolAutocomplete = false;
      _customToolQuery = '';
    });
  }

  /// Call setState and restore focus if it was previously focused.
  /// This is the KEY fix - we always restore focus after setState if the
  /// input had focus before the text change. This prevents focus loss
  /// during autocomplete transitions and popup appearances.
  void _setStateAndRestoreFocus(bool hadFocus) {
    setState(() {});
    if (hadFocus) {
      // AGGRESSIVE focus restoration for mobile:
      // 1. Immediate attempt (may work if focus wasn't actually lost yet)
      if (!_inputFocusNode.hasFocus) {
        _inputFocusNode.requestFocus();
      }
      // 2. Post-frame callback (after rebuild completes)
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_inputFocusNode.hasFocus) {
          _inputFocusNode.requestFocus();
        }
      });
      // 3. Delayed attempt (catches edge cases where focus is lost after rebuild)
      Future.delayed(const Duration(milliseconds: 50), () {
        if (mounted && !_inputFocusNode.hasFocus) {
          _inputFocusNode.requestFocus();
        }
      });
    }
  }

  void _handleFileSelection(FileAttachment attachment) {
    // Add as file attachment (OpenCode + Claude Code)
    if (_attachedFiles.contains(attachment)) return;

    final text = _controller.text;
    final newText = text.replaceFirst(RegExp(r'@\S*$'), '');
    _controller.text = newText;
    _controller.selection = TextSelection.collapsed(offset: newText.length);

    setState(() {
      _attachedFiles.add(attachment);
      _showFileAutocomplete = false;
    });
    ref.read(fileSearchProvider.notifier).clear();
  }

  /// Handle @agent selection - replace @query with @agentname and set as selected agent
  void _handleAgentSelection(Agent agent) {
    final text = _controller.text;
    // Replace @query with @agentname (keep the @ and agent name in the message)
    final newText = text.replaceFirst(RegExp(r'@\S*$'), '@${agent.name} ');
    _controller.text = newText;
    _controller.selection = TextSelection.collapsed(offset: newText.length);

    setState(() {
      _showAgentAutocomplete = false;
      _agentQuery = '';
      // OpenCode: set selected agent for this message.
      // Claude Code: keep selection explicit in the prompt (@subagent).
      if (widget.isOpenCode) {
        _selectedAgent = agent.name;
      }
    });
  }

  void _removeAttachedFile(FileAttachment attachment) {
    setState(() {
      _attachedFiles.remove(attachment);
    });
  }

  void _showAttachmentOptions(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      backgroundColor: theme.backgroundPanel,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: Icon(Icons.camera_alt_rounded, color: theme.primary),
                title: Text('Take Photo', style: TextStyle(color: theme.text)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickImageFromCamera();
                },
              ),
              ListTile(
                leading: Icon(
                  Icons.photo_library_rounded,
                  color: theme.primary,
                ),
                title: Text(
                  'Choose from Gallery',
                  style: TextStyle(color: theme.text),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickImageFromGallery();
                },
              ),
              ListTile(
                leading: Icon(Icons.attach_file_rounded, color: theme.info),
                title: Text(
                  'Attach File (@)',
                  style: TextStyle(color: theme.text),
                ),
                subtitle: Text(
                  'Type @ in the input to search files',
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                ),
                onTap: () => Navigator.pop(ctx),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showClaudeCodeToolsSheet() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        final screenHeight = MediaQuery.of(context).size.height;
        final maxSheetHeight = screenHeight * 0.85;

        return Container(
          constraints: BoxConstraints(maxHeight: maxSheetHeight),
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.3),
                blurRadius: 20,
                offset: const Offset(0, -4),
              ),
            ],
          ),
          child: SafeArea(
            top: false,
            child: Consumer(
              builder: (context, ref, _) {
                final chatState = ref.watch(chatSessionProvider);
                final init = chatState.ccInit;
                final configAsync = ref.watch(ccConfigProvider);

                final config =
                    configAsync.valueOrNull ??
                    ClaudeCodeConfig(
                      permissionMode: ClaudeCodePermissionMode.defaultMode,
                      allowedTools: init?.tools ?? const [],
                      disallowedTools: const [],
                      model: init?.model,
                    );

                final toolUniverse = <String>{
                  ...config.allowedTools,
                  ...config.disallowedTools,
                  ...?init?.tools,
                }.toList()..sort();

                void updateConfig(ClaudeCodeConfig next) {
                  ref.read(ccConfigProvider.notifier).updateConfig(next);
                }

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Drag handle
                    Container(
                      margin: const EdgeInsets.only(top: 12, bottom: 8),
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: theme.textMuted.withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),

                    // Header with close button
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 8, 12, 0),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: theme.accent.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Icon(
                              Icons.tune_rounded,
                              color: theme.accent,
                              size: 20,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Claude Code Tools',
                                  style: TextStyle(
                                    color: theme.text,
                                    fontSize: 17,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'Permissions & tool configuration',
                                  style: TextStyle(
                                    color: theme.textMuted,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Material(
                            color: Colors.transparent,
                            child: InkWell(
                              onTap: () => showClaudeCodeHelpSheet(
                                context,
                                topic: ClaudeCodeHelpTopic.toolsOverview,
                              ),
                              borderRadius: BorderRadius.circular(20),
                              child: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: theme.textMuted.withValues(alpha: 0.1),
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(
                                  Icons.help_outline_rounded,
                                  color: theme.textMuted,
                                  size: 20,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Material(
                            color: Colors.transparent,
                            child: InkWell(
                              onTap: () => Navigator.pop(context),
                              borderRadius: BorderRadius.circular(20),
                              child: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: theme.textMuted.withValues(alpha: 0.1),
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(
                                  Icons.close_rounded,
                                  color: theme.textMuted,
                                  size: 20,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 16),
                    Divider(
                      color: theme.borderSubtle.withValues(alpha: 0.5),
                      height: 1,
                    ),

                    // Scrollable content
                    Flexible(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Permission mode
                            _buildSettingsRow(
                              theme,
                              'Permission mode',
                              _buildStyledDropdown<ClaudeCodePermissionMode>(
                                theme: theme,
                                value: config.permissionMode,
                                items: ClaudeCodePermissionMode.values
                                    .map(
                                      (m) => DropdownMenuItem(
                                        value: m,
                                        child: Text(m.displayName),
                                      ),
                                    )
                                    .toList(),
                                onChanged: (value) {
                                  if (value == null) return;
                                  updateConfig(
                                    config.copyWith(permissionMode: value),
                                  );
                                },
                              ),
                            ),

                            const SizedBox(height: 16),

                            // System prompt
                            _buildSettingsRow(
                              theme,
                              'System prompt',
                              _buildStyledDropdown<String>(
                                theme: theme,
                                value: config.systemPrompt?.isEmpty ?? true
                                    ? 'none'
                                    : config.systemPrompt?.preset != null
                                    ? 'preset'
                                    : 'custom',
                                items: const [
                                  DropdownMenuItem(
                                    value: 'none',
                                    child: Text('None'),
                                  ),
                                  DropdownMenuItem(
                                    value: 'preset',
                                    child: Text('Claude Code'),
                                  ),
                                  DropdownMenuItem(
                                    value: 'custom',
                                    child: Text('Custom...'),
                                  ),
                                ],
                                onChanged: (value) async {
                                  if (value == null) return;
                                  if (value == 'none') {
                                    updateConfig(
                                      config.copyWith(
                                        systemPrompt:
                                            const ClaudeCodeSystemPrompt(),
                                      ),
                                    );
                                  } else if (value == 'preset') {
                                    updateConfig(
                                      config.copyWith(
                                        systemPrompt:
                                            const ClaudeCodeSystemPrompt(
                                              preset: 'claude_code',
                                            ),
                                      ),
                                    );
                                  } else if (value == 'custom') {
                                    final customText =
                                        await _promptSystemPromptText();
                                    if (customText != null &&
                                        customText.isNotEmpty) {
                                      updateConfig(
                                        config.copyWith(
                                          systemPrompt: ClaudeCodeSystemPrompt(
                                            text: customText,
                                          ),
                                        ),
                                      );
                                    }
                                  }
                                },
                              ),
                            ),

                            const SizedBox(height: 20),
                            Divider(
                              color: theme.borderSubtle.withValues(alpha: 0.5),
                              height: 1,
                            ),
                            const SizedBox(height: 20),

                            // Subagent selector
                            _buildSettingsTile(
                              theme: theme,
                              icon: Icons.account_tree_rounded,
                              iconColor: theme.info,
                              title: 'Subagents',
                              subtitle: 'Delegate specialized tasks',
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  _buildStyledDropdown<String?>(
                                    theme: theme,
                                    value: config.activeSubagent,
                                    hint: 'None',
                                    items: [
                                      const DropdownMenuItem<String?>(
                                        value: null,
                                        child: Text('None'),
                                      ),
                                      ...config.subagents.map(
                                        (s) => DropdownMenuItem<String?>(
                                          value: s.name,
                                          child: Text(s.name),
                                        ),
                                      ),
                                    ],
                                    onChanged: (value) {
                                      ref
                                          .read(ccConfigProvider.notifier)
                                          .setActiveSubagent(value);
                                    },
                                  ),
                                  const SizedBox(width: 4),
                                  _buildSettingsIconButton(
                                    theme: theme,
                                    icon: Icons.chevron_right_rounded,
                                    onTap: () {
                                      Navigator.pop(context);
                                      Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) =>
                                              const SubagentsScreen(),
                                        ),
                                      );
                                    },
                                  ),
                                ],
                              ),
                            ),

                            const SizedBox(height: 12),

                            // Custom Tools section
                            _buildSettingsTile(
                              theme: theme,
                              icon: Icons.build_rounded,
                              iconColor: theme.warning,
                              title: 'Custom Tools',
                              subtitle: 'mcp__broski-custom-tools__<name>',
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Consumer(
                                    builder: (context, ref, _) {
                                      final customToolsAsync = ref.watch(
                                        ccCustomToolsProvider,
                                      );
                                      return customToolsAsync.when(
                                        data: (tools) {
                                          final enabledCount = tools
                                              .where((t) => t.enabled)
                                              .length;
                                          return _buildCountBadge(
                                            theme,
                                            enabledCount,
                                          );
                                        },
                                        loading: () => SizedBox(
                                          width: 14,
                                          height: 14,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 1.5,
                                            color: theme.textMuted,
                                          ),
                                        ),
                                        error: (_, __) => Icon(
                                          Icons.error_outline,
                                          size: 16,
                                          color: theme.error,
                                        ),
                                      );
                                    },
                                  ),
                                  const SizedBox(width: 8),
                                  _buildSettingsIconButton(
                                    theme: theme,
                                    icon: Icons.chevron_right_rounded,
                                    onTap: () {
                                      Navigator.pop(context);
                                      Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) =>
                                              const CustomToolsScreen(),
                                        ),
                                      );
                                    },
                                  ),
                                ],
                              ),
                            ),

                            const SizedBox(height: 12),

                            // Plugins section
                            _buildSettingsTile(
                              theme: theme,
                              icon: Icons.extension_rounded,
                              iconColor: theme.success,
                              title: 'Plugins',
                              subtitle: 'Commands, skills, hooks, MCP servers',
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Consumer(
                                    builder: (context, ref, _) {
                                      final pluginsAsync = ref.watch(
                                        ccPluginsProvider,
                                      );
                                      return pluginsAsync.when(
                                        data: (plugins) {
                                          final enabledCount = plugins
                                              .where(
                                                (p) =>
                                                    p.status ==
                                                    ClaudeCodePluginStatus
                                                        .enabled,
                                              )
                                              .length;
                                          return _buildCountBadge(
                                            theme,
                                            enabledCount,
                                          );
                                        },
                                        loading: () => SizedBox(
                                          width: 14,
                                          height: 14,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 1.5,
                                            color: theme.textMuted,
                                          ),
                                        ),
                                        error: (_, __) => Icon(
                                          Icons.error_outline,
                                          size: 16,
                                          color: theme.error,
                                        ),
                                      );
                                    },
                                  ),
                                  const SizedBox(width: 8),
                                  _buildSettingsIconButton(
                                    theme: theme,
                                    icon: Icons.chevron_right_rounded,
                                    onTap: () {
                                      Navigator.pop(context);
                                      Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) => const PluginsScreen(),
                                        ),
                                      );
                                    },
                                  ),
                                ],
                              ),
                            ),

                            const SizedBox(height: 20),
                            Divider(
                              color: theme.borderSubtle.withValues(alpha: 0.5),
                              height: 1,
                            ),
                            const SizedBox(height: 16),

                            // Tools list header
                            Row(
                              children: [
                                Icon(
                                  Icons.construction_rounded,
                                  size: 16,
                                  color: theme.textMuted,
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  'Built-in Tools',
                                  style: TextStyle(
                                    color: theme.text,
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const Spacer(),
                                Text(
                                  '${toolUniverse.length} tools',
                                  style: TextStyle(
                                    color: theme.textMuted,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),

                            // Tools list
                            ...toolUniverse.map((tool) {
                              final enabled = !config.disallowedTools.contains(
                                tool,
                              );
                              return _buildToolToggleRow(
                                theme: theme,
                                tool: tool,
                                enabled: enabled,
                                onChanged: (v) {
                                  final allowed = [...config.allowedTools];
                                  final disallowed = [
                                    ...config.disallowedTools,
                                  ];

                                  if (v) {
                                    disallowed.remove(tool);
                                    if (!allowed.contains(tool)) {
                                      allowed.add(tool);
                                    }
                                  } else {
                                    allowed.remove(tool);
                                    if (!disallowed.contains(tool)) {
                                      disallowed.add(tool);
                                    }
                                  }

                                  updateConfig(
                                    config.copyWith(
                                      allowedTools: allowed,
                                      disallowedTools: disallowed,
                                    ),
                                  );
                                },
                              );
                            }),
                          ],
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  // Helper widgets for the Claude Code tools sheet
  Widget _buildSettingsRow(OpenCodeTheme theme, String label, Widget child) {
    return Row(
      children: [
        Text(
          label,
          style: TextStyle(
            color: theme.text,
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
        const Spacer(),
        child,
      ],
    );
  }

  Widget _buildSettingsTile({
    required OpenCodeTheme theme,
    required IconData icon,
    required Color iconColor,
    required String title,
    required String subtitle,
    required Widget trailing,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.background.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, size: 18, color: iconColor),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(color: theme.textMuted, fontSize: 11),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          trailing,
        ],
      ),
    );
  }

  Widget _buildStyledDropdown<T>({
    required OpenCodeTheme theme,
    required T? value,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
    String? hint,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: theme.background.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.borderSubtle.withValues(alpha: 0.3)),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: value,
          dropdownColor: theme.backgroundPanel,
          style: TextStyle(color: theme.text, fontSize: 13),
          hint: hint != null
              ? Text(
                  hint,
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
                )
              : null,
          icon: Icon(
            Icons.keyboard_arrow_down_rounded,
            size: 18,
            color: theme.textMuted,
          ),
          items: items,
          onChanged: onChanged,
          isDense: true,
        ),
      ),
    );
  }

  Widget _buildSettingsIconButton({
    required OpenCodeTheme theme,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Container(
          padding: const EdgeInsets.all(4),
          child: Icon(icon, size: 20, color: theme.textMuted),
        ),
      ),
    );
  }

  Widget _buildCountBadge(OpenCodeTheme theme, int count) {
    final isActive = count > 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: isActive
            ? theme.accent.withValues(alpha: 0.15)
            : theme.textMuted.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        '$count enabled',
        style: TextStyle(
          color: isActive ? theme.accent : theme.textMuted,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _buildToolToggleRow({
    required OpenCodeTheme theme,
    required String tool,
    required bool enabled,
    required ValueChanged<bool> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              tool,
              style: TextStyle(
                color: enabled ? theme.text : theme.textMuted,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          Transform.scale(
            scale: 0.8,
            child: Switch.adaptive(
              value: enabled,
              onChanged: onChanged,
              activeThumbColor: theme.accent,
              activeTrackColor: theme.accent.withValues(alpha: 0.3),
              inactiveThumbColor: theme.textMuted.withValues(alpha: 0.6),
              inactiveTrackColor: theme.textMuted.withValues(alpha: 0.2),
            ),
          ),
        ],
      ),
    );
  }

  Future<String?> _promptSystemPromptText() async {
    final theme = OpenCodeTheme.of(context);
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.backgroundPanel,
        title: Text(
          'Custom System Prompt',
          style: TextStyle(color: theme.text),
        ),
        content: SizedBox(
          width: double.maxFinite,
          child: TextField(
            controller: controller,
            maxLines: 5,
            style: TextStyle(color: theme.text, fontSize: 14),
            decoration: InputDecoration(
              hintText: 'Enter custom instructions for Claude...',
              hintStyle: TextStyle(color: theme.textMuted),
              filled: true,
              fillColor: theme.background,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: theme.borderSubtle),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: theme.borderSubtle),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: theme.primary),
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: Text('Save', style: TextStyle(color: theme.primary)),
          ),
        ],
      ),
    );
  }

  void _showClaudeCodeCommandsSheet() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return SafeArea(
          child: Container(
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(18),
              ),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: Consumer(
              builder: (context, ref, _) {
                final chatState = ref.watch(chatSessionProvider);
                final cwd = chatState.ccCwd;
                final builtins = chatState.ccInit?.slashCommands ?? const [];
                final customAsync = ref.watch(ccCommandsProvider(cwd));

                List<String> custom = const [];
                if (customAsync.hasValue) {
                  custom = customAsync.value!
                      .map((c) => '/${c.name}')
                      .toList(growable: false);
                }

                final all = <String>{...builtins, ...custom}.toList()..sort();

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.bolt_rounded, color: theme.accent, size: 18),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Commands',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: Icon(
                            Icons.close_rounded,
                            color: theme.textMuted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (all.isEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          'No commands found for this project.',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 13,
                          ),
                        ),
                      )
                    else
                      Flexible(
                        child: ListView.builder(
                          shrinkWrap: true,
                          itemCount: all.length,
                          itemBuilder: (context, index) {
                            final cmd = all[index];
                            return ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              leading: Icon(
                                Icons.chevron_right_rounded,
                                color: theme.textMuted,
                                size: 18,
                              ),
                              title: Text(
                                cmd,
                                style: TextStyle(
                                  color: theme.text,
                                  fontSize: 13,
                                ),
                              ),
                              onTap: () {
                                final normalized = cmd.startsWith('/')
                                    ? cmd
                                    : '/$cmd';
                                _controller.text = '$normalized ';
                                _controller
                                    .selection = TextSelection.fromPosition(
                                  TextPosition(offset: _controller.text.length),
                                );
                                Navigator.pop(context);
                                WidgetsBinding.instance.addPostFrameCallback((
                                  _,
                                ) {
                                  if (mounted) _inputFocusNode.requestFocus();
                                });
                              },
                            );
                          },
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  void _showClaudeCodeSkillsSheet() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return SafeArea(
          child: Container(
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(18),
              ),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: Consumer(
              builder: (context, ref, _) {
                final cwd = ref.watch(chatSessionProvider).ccCwd;
                final skillsAsync = ref.watch(ccSkillsProvider(cwd));

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.auto_awesome_rounded,
                          color: theme.accent,
                          size: 18,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Skills',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: Icon(
                            Icons.close_rounded,
                            color: theme.textMuted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    skillsAsync.when(
                      data: (skills) {
                        if (skills.isEmpty) {
                          return Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              'No skills found.',
                              style: TextStyle(
                                color: theme.textMuted,
                                fontSize: 13,
                              ),
                            ),
                          );
                        }
                        return Flexible(
                          child: ListView.builder(
                            shrinkWrap: true,
                            itemCount: skills.length,
                            itemBuilder: (context, index) {
                              final s = skills[index];
                              return ListTile(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                title: Text(
                                  s.name,
                                  style: TextStyle(
                                    color: theme.text,
                                    fontSize: 13,
                                  ),
                                ),
                                subtitle: s.description == null
                                    ? null
                                    : Text(
                                        s.description!,
                                        style: TextStyle(
                                          color: theme.textMuted,
                                          fontSize: 12,
                                        ),
                                      ),
                                trailing: s.autoInvoke
                                    ? Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 8,
                                          vertical: 4,
                                        ),
                                        decoration: BoxDecoration(
                                          color: theme.success.withValues(
                                            alpha: 0.15,
                                          ),
                                          borderRadius: BorderRadius.circular(
                                            8,
                                          ),
                                        ),
                                        child: Text(
                                          'Auto',
                                          style: TextStyle(
                                            color: theme.success,
                                            fontSize: 11,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      )
                                    : null,
                              );
                            },
                          ),
                        );
                      },
                      loading: () => Padding(
                        padding: const EdgeInsets.only(top: 16),
                        child: Center(
                          child: CircularProgressIndicator(
                            color: theme.primary,
                          ),
                        ),
                      ),
                      error: (e, _) => Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          '$e',
                          style: TextStyle(color: theme.error, fontSize: 13),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  void _showClaudeCodeHooksSheet() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return SafeArea(
          child: Container(
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(18),
              ),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: Consumer(
              builder: (context, ref, _) {
                final cwd = ref.watch(chatSessionProvider).ccCwd;
                final hooksAsync = ref.watch(ccHooksProvider(cwd));

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.link_rounded, color: theme.accent, size: 18),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Hooks',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: Icon(
                            Icons.close_rounded,
                            color: theme.textMuted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    hooksAsync.when(
                      data: (hooks) {
                        if (hooks.isEmpty) {
                          return Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              'No hooks found.',
                              style: TextStyle(
                                color: theme.textMuted,
                                fontSize: 13,
                              ),
                            ),
                          );
                        }
                        return Flexible(
                          child: ListView.builder(
                            shrinkWrap: true,
                            itemCount: hooks.length,
                            itemBuilder: (context, index) {
                              final h = hooks[index];
                              return ListTile(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                title: Text(
                                  h.event,
                                  style: TextStyle(
                                    color: theme.text,
                                    fontSize: 13,
                                  ),
                                ),
                                subtitle: Text(
                                  h.matcher == null
                                      ? 'All tools'
                                      : 'Matcher: ${h.matcher}',
                                  style: TextStyle(
                                    color: theme.textMuted,
                                    fontSize: 12,
                                  ),
                                ),
                              );
                            },
                          ),
                        );
                      },
                      loading: () => Padding(
                        padding: const EdgeInsets.only(top: 16),
                        child: Center(
                          child: CircularProgressIndicator(
                            color: theme.primary,
                          ),
                        ),
                      ),
                      error: (e, _) => Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          '$e',
                          style: TextStyle(color: theme.error, fontSize: 13),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  void _showClaudeCodeMcpSheet() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return SafeArea(
          child: Container(
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(18),
              ),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: Consumer(
              builder: (context, ref, _) {
                final init = ref.watch(chatSessionProvider).ccInit;
                final servers = init?.mcpServers ?? const [];

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.hub_rounded, color: theme.accent, size: 18),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'MCP Servers',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: Icon(
                            Icons.close_rounded,
                            color: theme.textMuted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (servers.isEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          'No MCP servers reported yet (start a turn to initialize).',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 13,
                          ),
                        ),
                      )
                    else
                      Flexible(
                        child: ListView.builder(
                          shrinkWrap: true,
                          itemCount: servers.length,
                          itemBuilder: (context, index) {
                            final s = servers[index];
                            final name = s['name']?.toString() ?? 'server';
                            final status = s['status']?.toString() ?? '';
                            return ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              title: Text(
                                name,
                                style: TextStyle(
                                  color: theme.text,
                                  fontSize: 13,
                                ),
                              ),
                              subtitle: Text(
                                status,
                                style: TextStyle(
                                  color: theme.textMuted,
                                  fontSize: 12,
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  void _handleClaudeCodeMenuAction(String value) {
    switch (value) {
      case 'cc_model':
        _showClaudeCodeModelSheet();
        break;
      case 'cc_tools':
        _showClaudeCodeToolsSheet();
        break;
      case 'cc_commands':
        _showClaudeCodeCommandsSheet();
        break;
      case 'cc_skills':
        _showClaudeCodeSkillsSheet();
        break;
      case 'cc_hooks':
        _showClaudeCodeHooksSheet();
        break;
      case 'cc_mcp':
        _showClaudeCodeMcpSheet();
        break;
      case 'cc_fork':
        _forkSession();
        break;
    }
  }

  void _handleCodexMenuAction(String value) {
    switch (value) {
      case 'cx_model':
        _showCodexModelSheet();
        break;
      case 'cx_settings':
        _showCodexSettingsSheet();
        break;
      case 'cx_skills':
        _showCodexSkillsSheet();
        break;
      case 'cx_mcp':
        _showCodexMcpSheet();
        break;
      case 'cx_auth':
        _showCodexAuthSheet();
        break;
      case 'cx_agents':
        _showCodexAgentsSheet();
        break;
      case 'cx_config':
        _showCodexConfigSheet();
        break;
      case 'cx_review':
        _startCodexReview();
        break;
      case 'cx_feedback':
        _showCodexFeedbackSheet();
        break;
    }
  }

  void _showCodexAgentsSheet() {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.cxCwd ?? widget.cxThread?.cwd ?? widget.cxDraftCwd;
    if (cwd == null || cwd.isEmpty) return;

    final controller = TextEditingController();
    bool loaded = false;
    bool exists = false;
    String? path;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            Future<void> load() async {
              if (loaded) return;
              loaded = true;
              final bridge = ref.read(bridgeServiceProvider);
              final res = await bridge.cxReadAgentsMd(cwd);
              exists = res['exists'] == true;
              path = res['path']?.toString();
              controller.text = (res['content'] ?? '').toString();
              setSheetState(() {});
            }

            void insertTemplate() {
              controller.text =
                  '''
# AGENTS.md

<INSTRUCTIONS>
Describe project-specific guidance for Codex here.

- Goal:
- Constraints:
- Style:
- Commands to run:
</INSTRUCTIONS>
'''
                      .trim();
              setSheetState(() {});
            }

            unawaited(load());

            return SafeArea(
              child: Padding(
                padding: EdgeInsets.only(
                  bottom: MediaQuery.of(context).viewInsets.bottom,
                ),
                child: Container(
                  height: MediaQuery.of(context).size.height * 0.75,
                  decoration: BoxDecoration(
                    color: theme.backgroundPanel,
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(18),
                    ),
                    border: Border.all(
                      color: theme.borderSubtle.withValues(alpha: 0.2),
                    ),
                  ),
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'AGENTS.md',
                                  style: TextStyle(
                                    color: theme.text,
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  path ?? cwd,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: theme.textMuted,
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(context),
                            icon: Icon(
                              Icons.close_rounded,
                              color: theme.textMuted,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      if (!exists)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Row(
                            children: [
                              Icon(
                                Icons.info_outline,
                                size: 16,
                                color: theme.textMuted,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'No AGENTS.md found. Create one to guide Codex for this project.',
                                  style: TextStyle(
                                    color: theme.textMuted,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                              TextButton(
                                onPressed: insertTemplate,
                                child: const Text('Insert template'),
                              ),
                            ],
                          ),
                        ),
                      Expanded(
                        child: TextField(
                          controller: controller,
                          expands: true,
                          maxLines: null,
                          minLines: null,
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 12,
                            color: theme.text,
                          ),
                          decoration: InputDecoration(
                            hintText: 'Project instructions for Codex…',
                            filled: true,
                            fillColor: theme.background,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: theme.borderSubtle.withValues(
                                  alpha: 0.35,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: ElevatedButton(
                              onPressed: () async {
                                final ok = await ref
                                    .read(bridgeServiceProvider)
                                    .cxWriteAgentsMd(
                                      cwd: cwd,
                                      content: controller.text,
                                    );
                                if (!context.mounted) return;
                                final messenger = ScaffoldMessenger.of(context);
                                messenger.showSnackBar(
                                  SnackBar(
                                    content: Text(
                                      ok ? 'Saved AGENTS.md' : 'Save failed',
                                    ),
                                    backgroundColor: ok
                                        ? theme.backgroundPanel
                                        : theme.error,
                                  ),
                                );
                                Navigator.pop(context);
                              },
                              child: const Text('Save'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    ).whenComplete(controller.dispose);
  }

  void _showCodexAuthSheet() {
    final theme = OpenCodeTheme.of(context);
    final apiKeyController = TextEditingController();
    String? loginId;
    String? authUrl;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            Future<void> startChatgptLogin() async {
              final bridge = ref.read(bridgeServiceProvider);
              final res = await bridge.cxLoginStartChatgpt();
              loginId = res['loginId']?.toString();
              authUrl = res['authUrl']?.toString();
              setSheetState(() {});
            }

            Future<void> cancelLogin() async {
              final id = loginId;
              if (id == null || id.isEmpty) return;
              final bridge = ref.read(bridgeServiceProvider);
              await bridge.cxLoginCancel(id);
              setSheetState(() {
                loginId = null;
                authUrl = null;
              });
            }

            return SafeArea(
              child: Padding(
                padding: EdgeInsets.only(
                  bottom: MediaQuery.of(context).viewInsets.bottom,
                ),
                child: Container(
                  decoration: BoxDecoration(
                    color: theme.backgroundPanel,
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(18),
                    ),
                    border: Border.all(
                      color: theme.borderSubtle.withValues(alpha: 0.2),
                    ),
                  ),
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Codex auth',
                                style: TextStyle(
                                  color: theme.text,
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            IconButton(
                              onPressed: () => Navigator.pop(context),
                              icon: Icon(
                                Icons.close_rounded,
                                color: theme.textMuted,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        FutureBuilder<Map<String, dynamic>>(
                          future: ref
                              .read(bridgeServiceProvider)
                              .cxAccountRead(),
                          builder: (context, snapshot) {
                            final loading =
                                snapshot.connectionState ==
                                ConnectionState.waiting;
                            if (loading) {
                              return const Padding(
                                padding: EdgeInsets.symmetric(vertical: 16),
                                child: Center(
                                  child: CircularProgressIndicator(),
                                ),
                              );
                            }
                            if (snapshot.hasError) {
                              return Text(
                                'Failed to read account: ${snapshot.error}',
                                style: TextStyle(
                                  color: theme.textMuted,
                                  fontSize: 12,
                                ),
                              );
                            }
                            final account = snapshot.data?['account'];
                            final requires =
                                snapshot.data?['requiresOpenaiAuth'] == true;
                            return Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: theme.background,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: theme.borderSubtle.withValues(
                                    alpha: 0.25,
                                  ),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Status',
                                    style: TextStyle(
                                      color: theme.textMuted,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    account == null
                                        ? (requires
                                              ? 'Not logged in (OpenAI auth required)'
                                              : 'Not logged in (auth not required)')
                                        : 'Logged in: ${account['type'] ?? account['authMode'] ?? ''}',
                                    style: TextStyle(
                                      color: theme.text,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                        const SizedBox(height: 12),
                        FutureBuilder<Map<String, dynamic>>(
                          future: ref
                              .read(bridgeServiceProvider)
                              .cxRateLimitsRead(),
                          builder: (context, snapshot) {
                            if (snapshot.connectionState ==
                                ConnectionState.waiting) {
                              return const SizedBox.shrink();
                            }
                            if (snapshot.hasError) {
                              return const SizedBox.shrink();
                            }
                            final limits = snapshot.data?['rateLimits'];
                            if (limits is! Map) return const SizedBox.shrink();
                            final primary = limits['primary'];
                            if (primary is! Map) return const SizedBox.shrink();
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Text(
                                'Rate limits: ${primary['usedPercent'] ?? 0}% used, resets at ${primary['resetsAt'] ?? ''}',
                                style: TextStyle(
                                  color: theme.textMuted,
                                  fontSize: 12,
                                ),
                              ),
                            );
                          },
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Expanded(
                              child: ElevatedButton(
                                onPressed: startChatgptLogin,
                                child: const Text('Login (ChatGPT)'),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () async {
                                  await ref
                                      .read(bridgeServiceProvider)
                                      .cxLogout();
                                  if (!context.mounted) return;
                                  Navigator.pop(context);
                                },
                                child: const Text('Logout'),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: apiKeyController,
                          obscureText: true,
                          decoration: const InputDecoration(
                            labelText: 'API key (optional)',
                            hintText: 'sk-...',
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () async {
                                  final key = apiKeyController.text.trim();
                                  if (key.isEmpty) return;
                                  await ref
                                      .read(bridgeServiceProvider)
                                      .cxLoginStartApiKey(key);
                                  if (!context.mounted) return;
                                  Navigator.pop(context);
                                },
                                child: const Text('Login (API key)'),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: TextButton(
                                onPressed: cancelLogin,
                                child: const Text('Cancel login'),
                              ),
                            ),
                          ],
                        ),
                        if (authUrl != null && authUrl!.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          Text(
                            'ChatGPT login URL (open on the host machine running Broski Bridge):',
                            style: TextStyle(
                              color: theme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(height: 6),
                          SelectableText(
                            authUrl!,
                            style: TextStyle(
                              fontFamily: 'monospace',
                              color: theme.text,
                              fontSize: 11,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              TextButton(
                                onPressed: () async {
                                  final uri = Uri.tryParse(authUrl!);
                                  if (uri == null) return;
                                  await launchUrl(
                                    uri,
                                    mode: LaunchMode.externalApplication,
                                  );
                                },
                                child: const Text('Open'),
                              ),
                              const SizedBox(width: 8),
                              TextButton(
                                onPressed: () async {
                                  await Clipboard.setData(
                                    ClipboardData(text: authUrl!),
                                  );
                                },
                                child: const Text('Copy'),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
        );
      },
    ).whenComplete(apiKeyController.dispose);
  }

  void _showCodexFeedbackSheet() {
    final theme = OpenCodeTheme.of(context);
    final reasonController = TextEditingController();
    String classification = 'bug';
    bool includeLogs = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return SafeArea(
              child: Padding(
                padding: EdgeInsets.only(
                  bottom: MediaQuery.of(context).viewInsets.bottom,
                ),
                child: Container(
                  decoration: BoxDecoration(
                    color: theme.backgroundPanel,
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(18),
                    ),
                    border: Border.all(
                      color: theme.borderSubtle.withValues(alpha: 0.2),
                    ),
                  ),
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Send feedback',
                              style: TextStyle(
                                color: theme.text,
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(context),
                            icon: Icon(
                              Icons.close_rounded,
                              color: theme.textMuted,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      DropdownButtonFormField<String>(
                        value: classification,
                        items: const [
                          DropdownMenuItem(value: 'bug', child: Text('Bug')),
                          DropdownMenuItem(
                            value: 'feature',
                            child: Text('Feature request'),
                          ),
                          DropdownMenuItem(
                            value: 'bad_output',
                            child: Text('Bad output'),
                          ),
                          DropdownMenuItem(
                            value: 'other',
                            child: Text('Other'),
                          ),
                        ],
                        onChanged: (v) =>
                            setSheetState(() => classification = v ?? 'bug'),
                        decoration: const InputDecoration(
                          labelText: 'Classification',
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: reasonController,
                        maxLines: 3,
                        decoration: const InputDecoration(
                          labelText: 'Reason (optional)',
                        ),
                      ),
                      const SizedBox(height: 8),
                      SwitchListTile(
                        value: includeLogs,
                        onChanged: (v) => setSheetState(() => includeLogs = v),
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          'Include logs',
                          style: TextStyle(
                            color: theme.text,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: Text(
                          'Attach Codex logs from the host machine',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        activeColor: theme.primary,
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: ElevatedButton(
                              onPressed: () async {
                                final bridge = ref.read(bridgeServiceProvider);
                                final chatState = ref.read(chatSessionProvider);
                                final res = await bridge.cxFeedbackUpload(
                                  classification: classification,
                                  reason: reasonController.text.trim().isEmpty
                                      ? null
                                      : reasonController.text.trim(),
                                  threadId: chatState.cxThreadId,
                                  includeLogs: includeLogs,
                                );
                                final threadId =
                                    res['threadId']?.toString() ?? '';
                                if (!context.mounted) return;
                                Navigator.pop(context);
                                if (threadId.isEmpty) return;
                                final thread = await bridge.cxResumeThread(
                                  threadId,
                                );
                                if (!mounted) return;
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        ChatScreen.codex(cxThread: thread),
                                  ),
                                );
                              },
                              child: const Text('Submit'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    ).whenComplete(reasonController.dispose);
  }

  void _showCodexSettingsSheet() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return SafeArea(
          child: Container(
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(18),
              ),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: Consumer(
              builder: (context, ref, _) {
                final settings = ref.watch(codexSettingsProvider);
                final notifier = ref.read(codexSettingsProvider.notifier);

                Widget chipGroup<T>({
                  required String label,
                  required List<T> values,
                  required T selected,
                  required String Function(T) display,
                  required void Function(T) onSelected,
                }) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: TextStyle(
                          color: theme.textMuted,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: values.map((v) {
                          final isSelected = v == selected;
                          return ChoiceChip(
                            label: Text(display(v)),
                            selected: isSelected,
                            onSelected: (_) => onSelected(v),
                            labelStyle: TextStyle(
                              color: isSelected ? theme.background : theme.text,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                            selectedColor: theme.primary,
                            backgroundColor: theme.background,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                              side: BorderSide(
                                color: theme.borderSubtle.withValues(
                                  alpha: 0.3,
                                ),
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    ],
                  );
                }

                return SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Codex settings',
                              style: TextStyle(
                                color: theme.text,
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(context),
                            icon: Icon(
                              Icons.close_rounded,
                              color: theme.textMuted,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      chipGroup<CodexApprovalPolicy>(
                        label: 'Approvals',
                        values: CodexApprovalPolicy.values,
                        selected: settings.approvalPolicy,
                        display: (v) => v.wireValue,
                        onSelected: notifier.setApprovalPolicy,
                      ),
                      const SizedBox(height: 16),
                      chipGroup<CodexSandboxMode>(
                        label: 'Sandbox',
                        values: CodexSandboxMode.values,
                        selected: settings.sandboxMode,
                        display: (v) => v.threadWireValue,
                        onSelected: notifier.setSandboxMode,
                      ),
                      const SizedBox(height: 12),
                      if (settings.sandboxMode ==
                          CodexSandboxMode.workspaceWrite)
                        SwitchListTile(
                          value: settings.networkAccessEnabled,
                          onChanged: notifier.setNetworkAccessEnabled,
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            'Network access',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: Text(
                            'Allow network in Codex sandbox',
                            style: TextStyle(
                              color: theme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                          activeColor: theme.primary,
                        ),
                      const SizedBox(height: 12),
                      chipGroup<CodexReasoningEffort>(
                        label: 'Reasoning effort',
                        values: CodexReasoningEffort.values,
                        selected: settings.reasoningEffort,
                        display: (v) => v.wireValue,
                        onSelected: notifier.setReasoningEffort,
                      ),
                      const SizedBox(height: 16),
                      chipGroup<CodexReasoningSummary>(
                        label: 'Reasoning summary',
                        values: CodexReasoningSummary.values,
                        selected: settings.reasoningSummary,
                        display: (v) => v.wireValue,
                        onSelected: notifier.setReasoningSummary,
                      ),
                      const SizedBox(height: 12),
                      SwitchListTile(
                        value: settings.webSearchEnabled,
                        onChanged: notifier.setWebSearchEnabled,
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          'Web search',
                          style: TextStyle(
                            color: theme.text,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: Text(
                          'Enable web search requests (opt-in)',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        activeColor: theme.primary,
                      ),
                      SwitchListTile(
                        value: settings.skillsEnabled,
                        onChanged: notifier.setSkillsEnabled,
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          'Skills discovery',
                          style: TextStyle(
                            color: theme.text,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: Text(
                          'Allow Codex to discover skills from disk',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        activeColor: theme.primary,
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        );
      },
    );
  }

  void _showCodexSkillsSheet() {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.cxCwd ?? widget.cxThread?.cwd ?? widget.cxDraftCwd;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return SafeArea(
          child: Container(
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(18),
              ),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: ref.read(bridgeServiceProvider).cxListSkills(cwd: cwd),
              builder: (context, snapshot) {
                final loading =
                    snapshot.connectionState == ConnectionState.waiting;
                final data = snapshot.data ?? const <Map<String, dynamic>>[];

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Codex skills',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: Icon(
                            Icons.close_rounded,
                            color: theme.textMuted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (loading)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (snapshot.hasError)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(
                          'Failed to load skills: ${snapshot.error}',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                      )
                    else if (data.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(
                          'No skills found for this project.',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 13,
                          ),
                        ),
                      )
                    else
                      Flexible(
                        child: ListView.builder(
                          shrinkWrap: true,
                          itemCount: data.length,
                          itemBuilder: (context, index) {
                            final entry = data[index];
                            final cwdLabel = (entry['cwd'] ?? '').toString();
                            final skills =
                                (entry['skills'] as List<dynamic>? ?? const [])
                                    .whereType<Map<String, dynamic>>()
                                    .toList();
                            final errors =
                                (entry['errors'] as List<dynamic>? ?? const [])
                                    .whereType<Map<String, dynamic>>()
                                    .toList();

                            return Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  if (cwdLabel.isNotEmpty)
                                    Text(
                                      cwdLabel,
                                      style: TextStyle(
                                        color: theme.textMuted,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  const SizedBox(height: 8),
                                  for (final s in skills)
                                    ListTile(
                                      dense: true,
                                      contentPadding: EdgeInsets.zero,
                                      leading: Icon(
                                        Icons.auto_awesome_rounded,
                                        size: 18,
                                        color: theme.primary,
                                      ),
                                      title: Text(
                                        (s['name'] ?? 'skill').toString(),
                                        style: TextStyle(
                                          color: theme.text,
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      subtitle: Text(
                                        (s['description'] ??
                                                s['shortDescription'] ??
                                                '')
                                            .toString(),
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          color: theme.textMuted,
                                          fontSize: 12,
                                        ),
                                      ),
                                      trailing: Text(
                                        (s['scope'] ?? '').toString(),
                                        style: TextStyle(
                                          color: theme.textMuted,
                                          fontSize: 11,
                                        ),
                                      ),
                                    ),
                                  for (final e in errors)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 6),
                                      child: Text(
                                        'Error: ${(e['message'] ?? '').toString()}',
                                        style: TextStyle(
                                          color: theme.error,
                                          fontSize: 12,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  void _showCodexMcpSheet() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return SafeArea(
          child: Container(
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(18),
              ),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: ref.read(bridgeServiceProvider).cxListMcpServerStatus(),
              builder: (context, snapshot) {
                final loading =
                    snapshot.connectionState == ConnectionState.waiting;
                final servers = snapshot.data ?? const <Map<String, dynamic>>[];

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'MCP servers',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: Icon(
                            Icons.close_rounded,
                            color: theme.textMuted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (loading)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (snapshot.hasError)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(
                          'Failed to load MCP servers: ${snapshot.error}',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                      )
                    else if (servers.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(
                          'No MCP servers configured.',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 13,
                          ),
                        ),
                      )
                    else
                      Flexible(
                        child: ListView.separated(
                          shrinkWrap: true,
                          itemCount: servers.length,
                          separatorBuilder: (_, __) => Divider(
                            color: theme.borderSubtle.withValues(alpha: 0.35),
                          ),
                          itemBuilder: (context, index) {
                            final s = servers[index];
                            final name = (s['name'] ?? '').toString();
                            final auth = (s['authStatus'] ?? '').toString();
                            final tools = (s['tools'] is Map)
                                ? (s['tools'] as Map).length
                                : (s['tools'] as List?)?.length ?? 0;
                            final resources =
                                (s['resources'] as List?)?.length ?? 0;
                            final templates =
                                (s['resourceTemplates'] as List?)?.length ?? 0;

                            final needsLogin =
                                auth.toLowerCase().contains('not') ||
                                auth.toLowerCase().contains('oauth');

                            return ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: Icon(
                                Icons.hub_rounded,
                                color: theme.accent,
                                size: 18,
                              ),
                              title: Text(
                                name.isEmpty ? 'server' : name,
                                style: TextStyle(
                                  color: theme.text,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              subtitle: Text(
                                '$auth • $tools tools • $resources resources • $templates templates',
                                style: TextStyle(
                                  color: theme.textMuted,
                                  fontSize: 12,
                                ),
                              ),
                              trailing: needsLogin
                                  ? TextButton(
                                      onPressed: name.isEmpty
                                          ? null
                                          : () async {
                                              final bridge = ref.read(
                                                bridgeServiceProvider,
                                              );
                                              final url = await bridge
                                                  .cxMcpOauthLogin(name: name);
                                              if (url == null || url.isEmpty)
                                                return;
                                              final uri = Uri.tryParse(url);
                                              if (uri == null) return;
                                              await launchUrl(
                                                uri,
                                                mode: LaunchMode
                                                    .externalApplication,
                                              );
                                            },
                                      child: const Text('Login'),
                                    )
                                  : null,
                            );
                          },
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  void _showCodexRollbackSheet() {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.read(chatSessionProvider);
    final threadId = chatState.cxThreadId;
    if (threadId == null || threadId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('No Codex thread to rollback.'),
          backgroundColor: theme.backgroundPanel,
        ),
      );
      return;
    }

    final turns = chatState.messages
        .where((m) => m.role == MessageRole.user)
        .length;
    final maxTurns = turns <= 0 ? 1 : turns;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return RollbackSheet(
          maxTurns: maxTurns,
          onRollback: (numTurns) async {
            final bridge = ref.read(bridgeServiceProvider);
            await bridge.cxThreadRollback(
              threadId: threadId,
              numTurns: numTurns,
            );
            final items = await bridge.cxGetThreadMessages(threadId);
            ref
                .read(chatSessionProvider.notifier)
                .hydrateCodexTranscript(items);
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    'Rolled back $numTurns turn${numTurns == 1 ? '' : 's'}',
                  ),
                  backgroundColor: theme.backgroundPanel,
                ),
              );
              Navigator.pop(context);
            }
          },
        );
      },
    );
  }

  void _showCodexConfigSheet() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return SafeArea(
          child: Container(
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(18),
              ),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: FutureBuilder<Map<String, dynamic>>(
              future: ref.read(bridgeServiceProvider).cxReadConfig(),
              builder: (context, snapshot) {
                final loading =
                    snapshot.connectionState == ConnectionState.waiting;
                final config = snapshot.data ?? const <String, dynamic>{};
                final configJson = const JsonEncoder.withIndent(
                  '  ',
                ).convert(config);

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Codex config',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: Icon(
                            Icons.close_rounded,
                            color: theme.textMuted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (loading)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (snapshot.hasError)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(
                          'Failed to read config: ${snapshot.error}',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                      )
                    else
                      Flexible(
                        child: SingleChildScrollView(
                          child: SelectableText(
                            configJson,
                            style: TextStyle(
                              fontFamily: 'monospace',
                              color: theme.textMuted,
                              fontSize: 11,
                            ),
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  Future<void> _startCodexReview() async {
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.cxCwd ?? widget.cxThread?.cwd ?? widget.cxDraftCwd;
    if (cwd == null || cwd.isEmpty) return;
    final settings = ref.read(codexSettingsProvider);

    final sandboxPolicy = switch (settings.sandboxMode) {
      CodexSandboxMode.readOnly => const <String, dynamic>{'type': 'readOnly'},
      CodexSandboxMode.dangerFullAccess => const <String, dynamic>{
        'type': 'dangerFullAccess',
      },
      CodexSandboxMode.workspaceWrite => <String, dynamic>{
        'type': 'workspaceWrite',
        'writableRoots': [cwd],
        'networkAccess': settings.networkAccessEnabled,
      },
    };

    final config = <String, dynamic>{
      'features.web_search_request': settings.webSearchEnabled,
      'features.skills': settings.skillsEnabled,
      'model_reasoning_effort': settings.reasoningEffort.wireValue,
      'model_reasoning_summary': settings.reasoningSummary.wireValue,
      if (settings.sandboxMode == CodexSandboxMode.workspaceWrite)
        'sandbox_workspace_write.network_access': settings.networkAccessEnabled,
    };

    ref.read(chatSessionProvider.notifier).appendUserMessage('/review');
    ref.read(chatSessionProvider.notifier).setCodexStreaming(true);

    await ref
        .read(bridgeServiceProvider)
        .cxStartReview(
          threadId: chatState.cxThreadId,
          cwd: cwd,
          delivery: 'inline',
          target: const {'type': 'uncommittedChanges'},
          model: chatState.cxModel,
          approvalPolicy: settings.approvalPolicy.wireValue,
          sandbox: settings.sandboxMode.threadWireValue,
          sandboxPolicy: sandboxPolicy,
          config: config,
        );
  }

  void _showCodexModelSheet() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return SafeArea(
          child: Container(
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(18),
              ),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: Consumer(
              builder: (context, ref, _) {
                final chatState = ref.watch(chatSessionProvider);
                final current = chatState.cxModel ?? 'gpt-5.2-codex';

                Widget modelTile(String model, String label, String desc) {
                  final selected = current == model;
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      selected
                          ? Icons.radio_button_checked_rounded
                          : Icons.radio_button_off_rounded,
                      size: 18,
                      color: selected ? theme.primary : theme.textMuted,
                    ),
                    title: Text(
                      label,
                      style: TextStyle(color: theme.text, fontSize: 13),
                    ),
                    subtitle: Text(
                      desc,
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
                    ),
                    onTap: () {
                      ref
                          .read(chatSessionProvider.notifier)
                          .setCodexModel(model);
                      if (!mounted) return;
                      Navigator.pop(context);
                    },
                  );
                }

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.auto_awesome_rounded,
                          color: theme.primary,
                          size: 18,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Codex model',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: Icon(
                            Icons.close_rounded,
                            color: theme.textMuted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Select the model used for Codex turns.',
                      style: TextStyle(color: theme.textMuted, fontSize: 13),
                    ),
                    const SizedBox(height: 14),
                    // Codex SDK models (from model_presets.rs - show_in_picker: true)
                    modelTile(
                      'gpt-5.2-codex',
                      'gpt-5.2-codex',
                      'Latest frontier agentic coding model',
                    ),
                    modelTile(
                      'gpt-5.1-codex-max',
                      'gpt-5.1-codex-max',
                      'Codex-optimized flagship for deep and fast reasoning',
                    ),
                    modelTile(
                      'gpt-5.1-codex-mini',
                      'gpt-5.1-codex-mini',
                      'Optimized for codex. Cheaper, faster, less capable',
                    ),
                    modelTile(
                      'gpt-5.2',
                      'gpt-5.2',
                      'Latest frontier model with improvements across knowledge, reasoning and coding',
                    ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  Future<String?> _promptCustomClaudeModel() async {
    final controller = TextEditingController();
    final theme = OpenCodeTheme.of(context);
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.backgroundPanel,
        title: const Text('Custom model'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'e.g. sonnet, opus, haiku, or a full model id',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (value) => Navigator.pop(ctx, value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  void _showClaudeCodeModelSheet() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return SafeArea(
          child: Container(
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(18),
              ),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
            child: Consumer(
              builder: (context, ref, _) {
                final chatState = ref.watch(chatSessionProvider);
                final init = chatState.ccInit;
                final configAsync = ref.watch(ccConfigProvider);
                final config =
                    configAsync.valueOrNull ??
                    ClaudeCodeConfig(
                      permissionMode: ClaudeCodePermissionMode.defaultMode,
                      allowedTools: init?.tools ?? const [],
                      disallowedTools: const [],
                      model: init?.model,
                    );

                final current =
                    config.model ??
                    chatState.ccModel ??
                    init?.model ??
                    widget.ccSession?.model ??
                    widget.ccDraftModel ??
                    'sonnet';

                Future<void> setModel(String model) async {
                  await ref
                      .read(ccConfigProvider.notifier)
                      .updateConfig(config.copyWith(model: model));
                  ref.read(chatSessionProvider.notifier).setCCModel(model);
                }

                Widget modelTile(String model, String label) {
                  final selected = current == model;
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      selected
                          ? Icons.radio_button_checked_rounded
                          : Icons.radio_button_off_rounded,
                      size: 18,
                      color: selected ? theme.accent : theme.textMuted,
                    ),
                    title: Text(
                      label,
                      style: TextStyle(color: theme.text, fontSize: 13),
                    ),
                    subtitle: Text(
                      model,
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
                    ),
                    onTap: () async {
                      await setModel(model);
                      if (!mounted) return;
                      Navigator.pop(context);
                    },
                  );
                }

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.auto_awesome_rounded,
                          color: theme.accent,
                          size: 18,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Claude Code model',
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: Icon(
                            Icons.close_rounded,
                            color: theme.textMuted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Select the model used for Claude Code turns.',
                      style: TextStyle(color: theme.textMuted, fontSize: 13),
                    ),
                    const SizedBox(height: 14),
                    modelTile('sonnet', 'Sonnet'),
                    modelTile('opus', 'Opus'),
                    modelTile('haiku', 'Haiku'),
                    const Divider(),
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(
                        Icons.edit_rounded,
                        size: 18,
                        color: theme.textMuted,
                      ),
                      title: Text(
                        'Custom…',
                        style: TextStyle(color: theme.text, fontSize: 13),
                      ),
                      subtitle: Text(
                        current,
                        style: TextStyle(color: theme.textMuted, fontSize: 12),
                      ),
                      onTap: () async {
                        final custom = await _promptCustomClaudeModel();
                        final value = custom?.trim();
                        if (value == null || value.isEmpty) return;
                        await setModel(value);
                        if (!mounted) return;
                        Navigator.pop(context);
                      },
                    ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  bool _modelSupportsImages(SelectedModel? model) {
    if (model == null) return true;
    final id = model.modelID.toLowerCase();
    final provider = model.providerID.toLowerCase();

    if (provider.contains('anthropic')) {
      return id.contains('claude-3') ||
          id.contains('claude-4') ||
          id.contains('sonnet') ||
          id.contains('opus') ||
          id.contains('haiku');
    }
    if (provider.contains('openai')) {
      return id.contains('gpt-4o') ||
          id.contains('gpt-4-vision') ||
          id.contains('gpt-4-turbo') ||
          id.contains('o1') ||
          id.contains('o3');
    }
    if (provider.contains('google')) {
      return id.contains('gemini');
    }
    return true;
  }

  void _showImageNotSupportedWarning() {
    final model = ref.read(selectionProvider).model;
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Warning: ${model?.modelID ?? 'This model'} may not support images',
        ),
        backgroundColor: OpenCodeTheme.of(context).warning,
        behavior: SnackBarBehavior.floating,
        action: SnackBarAction(
          label: 'OK',
          textColor: Colors.white,
          onPressed: () {},
        ),
      ),
    );
  }

  Future<void> _pickImageFromGallery() async {
    final model = ref.read(selectionProvider).model;
    if (!_modelSupportsImages(model)) {
      _showImageNotSupportedWarning();
    }

    final imagePicker = ref.read(imagePickerServiceProvider);
    final attachment = await imagePicker.pickFromGallery();
    if (attachment != null) {
      setState(() => _attachedFiles.add(attachment));
    }
  }

  Future<void> _pickImageFromCamera() async {
    final model = ref.read(selectionProvider).model;
    if (!_modelSupportsImages(model)) {
      _showImageNotSupportedWarning();
    }

    final imagePicker = ref.read(imagePickerServiceProvider);
    final attachment = await imagePicker.pickFromCamera();
    if (attachment != null) {
      setState(() => _attachedFiles.add(attachment));
    }
  }

  // ignore: unused_element
  void _handleFileAutocompleteKeyboard(KeyEvent event) {
    if (!_showFileAutocomplete) return;

    final fileSearch = ref.read(fileSearchProvider.notifier);
    if (event is KeyDownEvent) {
      if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
        fileSearch.selectNext();
      } else if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
        fileSearch.selectPrevious();
      } else if (event.logicalKey == LogicalKeyboardKey.enter) {
        final attachment = fileSearch.getSelectedAttachment();
        if (attachment != null) {
          _handleFileSelection(attachment);
        }
      } else if (event.logicalKey == LogicalKeyboardKey.escape) {
        setState(() => _showFileAutocomplete = false);
        fileSearch.clear();
      }
    }
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;

    final position = _scrollController.position;

    // Detect scroll to top - load more messages
    final isAtTop = position.pixels <= 100;
    if (isAtTop && !_loadingMoreMessages && !_hasLoadedAllMessages) {
      _loadMoreMessages();
    }

    // Detect scroll to bottom - show/hide scroll button
    // Use a threshold of 150px to determine "near bottom"
    final isNearBottom = _isNearBottom();

    // Track user scroll intent for auto-scroll feature
    // If user scrolls up (away from bottom), mark that they've scrolled up
    // If they scroll back to bottom, clear the flag
    if (isNearBottom) {
      _userHasScrolledUp = false;
    } else {
      // User has scrolled up - they want to view history
      _userHasScrolledUp = true;
    }
  }

  /// Check if scroll position is near the bottom (within threshold)
  /// Used for auto-scroll decision making
  bool _isNearBottom() {
    if (!_scrollController.hasClients) return true;
    final position = _scrollController.position;
    // Consider "near bottom" if within 150px of max scroll extent
    return position.pixels >= position.maxScrollExtent - 150;
  }

  // FIX: Removed _calculateContentLength - now using pre-computed contentLength from provider
  // This avoids O(n) iteration on every UI frame during streaming

  /// Handle auto-scroll when new content arrives
  /// Only scrolls if user hasn't intentionally scrolled up
  void _handleAutoScroll(ChatSessionState? previous, ChatSessionState next) {
    // Skip if user has scrolled up to view history
    if (_userHasScrolledUp) return;

    final messages = next.messages;
    final currentCount = messages.length;
    // FIX: Use pre-computed content length instead of recalculating every frame
    final currentLength = next.contentLength;

    // Detect if content has grown (new message or streaming content)
    final hasNewMessage = currentCount > _previousMessageCount;
    final hasNewContent = currentLength > _previousContentLength;
    final isStreaming = _hasStreamingMessage(messages);
    final hasRunningTools = _hasRunningTools(messages);

    // Update tracking variables
    _previousMessageCount = currentCount;
    _previousContentLength = currentLength;

    // Auto-scroll conditions:
    // 1. New message arrived
    // 2. Content grew (streaming text, new tool calls, etc.)
    // 3. Currently streaming (keep scrolling as content flows)
    // 4. Tools are running (OpenCode doesn't stream text during tool execution)
    if (hasNewMessage || hasNewContent || isStreaming || hasRunningTools) {
      // Use a short delay to let the ListView rebuild with new content
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        if (_userHasScrolledUp) return; // Double-check after frame

        // During streaming or tool execution, use jumpTo for smoother continuous scroll
        // After streaming completes, use animated scroll
        if (isStreaming || hasRunningTools) {
          _scrollToBottom(animate: false);
        } else {
          _scrollToBottom(animate: true);
        }
      });
    }
  }

  Future<void> _loadMoreMessages() async {
    if (_loadingMoreMessages || _hasLoadedAllMessages) return;

    final connection = ref.read(connectionProvider);
    if (connection.isOfflineMode) {
      // In offline mode, we already loaded everything from cache
      setState(() => _hasLoadedAllMessages = true);
      return;
    }

    setState(() => _loadingMoreMessages = true);

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final chat = ref.read(chatSessionProvider.notifier);

      // Fetch ALL messages (no limit) to get full history
      final allMessages = await bridge.getSessionMessages(
        widget.session.id,
        projectPath: widget.project.path,
        // No limit = get all messages
      );

      // Remember current scroll position to maintain it after adding messages
      final currentOffset = _scrollController.position.pixels;
      final currentMax = _scrollController.position.maxScrollExtent;

      // Hydrate with all messages
      chat.hydrate(allMessages);

      // After hydration, scroll to maintain relative position
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          final newMax = _scrollController.position.maxScrollExtent;
          final addedHeight = newMax - currentMax;
          _scrollController.jumpTo(currentOffset + addedHeight);
        }
      });

      setState(() {
        _loadingMoreMessages = false;
        _hasLoadedAllMessages = true;
      });
    } catch (e) {
      setState(() => _loadingMoreMessages = false);
    }
  }

  bool _hasStreamingMessage(List<ChatMessage> messages) {
    return messages.any((msg) => msg.isStreaming);
  }

  /// Check if any tools are currently running (for auto-scroll during tool execution)
  bool _hasRunningTools(List<ChatMessage> messages) {
    return messages.any(
      (msg) => msg.toolCalls.any(
        (tool) =>
            tool.status.toLowerCase() == 'running' ||
            tool.status.toLowerCase() == 'pending',
      ),
    );
  }

  // Feature 2: Get filtered commands based on current input
  List<SlashCommand> get _filteredCommands {
    if (_commandFilter.isEmpty) return _commands;
    return _commands
        .where((cmd) => cmd.name.toLowerCase().contains(_commandFilter))
        .toList();
  }

  // Feature 2: Handle command selection from autocomplete
  void _selectCommand(SlashCommand command) async {
    final bridge = ref.read(bridgeServiceProvider);
    final chatState = ref.read(chatSessionProvider);
    final selectedModel = ref.read(selectionProvider).model;

    // Handle built-in commands
    if (command.builtin) {
      switch (command.name) {
        case 'undo':
          if (chatState.messages.isNotEmpty) {
            try {
              await bridge.revertMessage(
                widget.session.id,
                messageId: chatState.messages.last.id,
                projectPath: widget.project.path,
              );
              if (mounted) {
                ScaffoldMessenger.of(
                  context,
                ).showSnackBar(const SnackBar(content: Text('Message undone')));
              }
            } catch (e) {
              if (mounted) {
                ScaffoldMessenger.of(
                  context,
                ).showSnackBar(SnackBar(content: Text('Failed to undo: $e')));
              }
            }
          } else {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('No messages to undo')),
              );
            }
          }
          break;

        case 'redo':
          try {
            await bridge.unrevertSession(
              widget.session.id,
              projectPath: widget.project.path,
            );
            if (mounted) {
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(const SnackBar(content: Text('Message redone')));
            }
          } catch (e) {
            if (mounted) {
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(SnackBar(content: Text('Failed to redo: $e')));
            }
          }
          break;

        case 'compact':
        case 'summarize':
          if (selectedModel != null) {
            try {
              final success = await bridge.summarizeSession(
                widget.session.id,
                providerID: selectedModel.providerID,
                modelID: selectedModel.modelID,
                projectPath: widget.project.path,
              );
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  success
                      ? const SnackBar(content: Text('Session compacted'))
                      : const SnackBar(
                          content: Text('Failed to compact session'),
                        ),
                );
              }
            } catch (e) {
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Failed to compact: $e')),
                );
              }
            }
          } else {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Model not configured')),
              );
            }
          }
          break;

        case 'share':
          _shareSession();
          break;

        case 'unshare':
          _unshareSession();
          break;

        case 'new':
        case 'clear':
          if (mounted) {
            Navigator.of(
              context,
            ).push(MaterialPageRoute(builder: (_) => const SessionsScreen()));
          }
          break;

        case 'session':
        case 'resume':
        case 'continue':
          if (mounted) {
            Navigator.of(
              context,
            ).push(MaterialPageRoute(builder: (_) => const SessionsScreen()));
          }
          break;

        case 'help':
          _showHelpDialog();
          break;

        case 'rename':
          _showRenameSessionDialog();
          break;

        case 'copy':
          _copyTranscriptToClipboard();
          break;

        case 'export':
          _exportTranscript();
          break;

        case 'timeline':
          _showTimelineDialog();
          break;

        case 'fork':
          _showForkDialog();
          break;

        case 'thinking':
          _toggleThinkingVisibility();
          break;

        case 'models':
          _showModelsDialog();
          break;

        case 'agents':
          _showAgentsDialog();
          break;

        default:
          _controller.text = '/${command.name} ';
          _controller.selection = TextSelection.fromPosition(
            TextPosition(offset: _controller.text.length),
          );
          break;
      }

      setState(() {
        _showCommandAutocomplete = false;
        _commandFilter = '';
      });
      return;
    }

    // Handle custom commands (insert text for user to edit)
    _controller.text = '/${command.name} ';
    _controller.selection = TextSelection.fromPosition(
      TextPosition(offset: _controller.text.length),
    );
    setState(() {
      _showCommandAutocomplete = false;
      _commandFilter = '';
    });
  }

  // ============================================================
  // Slash Command Implementations
  // ============================================================

  /// Show help dialog with all available commands
  void _showHelpDialog() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.7,
        minChildSize: 0.5,
        maxChildSize: 0.9,
        builder: (context, scrollController) => Container(
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            children: [
              Container(
                margin: const EdgeInsets.only(top: 12),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.textMuted,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'Available Commands',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: theme.text,
                  ),
                ),
              ),
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  children: [
                    _buildCommandSection('Session Actions', [
                      ('/undo', 'Undo last message'),
                      ('/redo', 'Redo last message'),
                      ('/compact', 'Compact session to free context'),
                      ('/fork', 'Fork session from a message'),
                      ('/rename', 'Rename session'),
                      ('/share', 'Share session publicly'),
                      ('/unshare', 'Remove public share'),
                    ], theme),
                    _buildCommandSection('Navigation', [
                      ('/new', 'Create new session'),
                      ('/clear', 'Alias for /new'),
                      ('/session', 'List all sessions'),
                      ('/resume', 'Alias for /session'),
                      ('/timeline', 'Jump to a message'),
                    ], theme),
                    _buildCommandSection('Configuration', [
                      ('/models', 'List available models'),
                      ('/agents', 'List available agents'),
                      ('/thinking', 'Toggle thinking visibility'),
                    ], theme),
                    _buildCommandSection('Export', [
                      ('/copy', 'Copy transcript to clipboard'),
                      ('/export', 'Export transcript to file'),
                    ], theme),
                    if (_commands.any((c) => !c.builtin))
                      _buildCommandSection(
                        'Custom Commands',
                        _commands
                            .where((c) => !c.builtin)
                            .map(
                              (c) => (
                                '/${c.name}',
                                c.description ?? 'No description',
                              ),
                            )
                            .toList(),
                        theme,
                      ),
                    const SizedBox(height: 20),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCommandSection(
    String title,
    List<(String, String)> commands,
    OpenCodeTheme theme,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(
            title,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: theme.primary,
            ),
          ),
        ),
        ...commands.map(
          (cmd) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: theme.bgDeep,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    cmd.$1,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 13,
                      color: theme.accent,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    cmd.$2,
                    style: TextStyle(fontSize: 13, color: theme.textMuted),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
      ],
    );
  }

  /// Show rename session dialog
  void _showRenameSessionDialog() {
    final theme = OpenCodeTheme.of(context);
    final controller = TextEditingController(text: widget.session.title);

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: theme.backgroundPanel,
        title: Text('Rename Session', style: TextStyle(color: theme.text)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: TextStyle(color: theme.text),
          decoration: InputDecoration(
            hintText: 'Enter new title',
            hintStyle: TextStyle(color: theme.textMuted),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
          ),
          TextButton(
            onPressed: () async {
              final newTitle = controller.text.trim();
              if (newTitle.isEmpty) return;

              Navigator.pop(context);
              try {
                final bridge = ref.read(bridgeServiceProvider);
                await bridge.updateSession(
                  widget.session.id,
                  title: newTitle,
                  projectPath: widget.project.path,
                );
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Session renamed to "$newTitle"')),
                  );
                }
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Failed to rename: $e')),
                  );
                }
              }
            },
            child: Text('Rename', style: TextStyle(color: theme.primary)),
          ),
        ],
      ),
    );
  }

  /// Copy transcript to clipboard
  void _copyTranscriptToClipboard() {
    final chatState = ref.read(chatSessionProvider);
    if (chatState.messages.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('No messages to copy')));
      return;
    }

    final buffer = StringBuffer();
    buffer.writeln('# Session: ${widget.session.title}');
    buffer.writeln('Date: ${DateTime.now().toIso8601String()}');
    buffer.writeln('---\n');

    for (final msg in chatState.messages) {
      final role = msg.role == 'user' ? 'You' : 'Assistant';
      buffer.writeln('## $role');
      buffer.writeln(msg.text);
      buffer.writeln();
    }

    Clipboard.setData(ClipboardData(text: buffer.toString()));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Transcript copied to clipboard')),
    );
  }

  /// Export transcript (show options)
  void _exportTranscript() {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.read(chatSessionProvider);

    if (chatState.messages.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('No messages to export')));
      return;
    }

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Export Transcript',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: theme.text,
              ),
            ),
            const SizedBox(height: 16),
            ListTile(
              leading: Icon(Icons.copy, color: theme.primary),
              title: Text(
                'Copy to Clipboard',
                style: TextStyle(color: theme.text),
              ),
              subtitle: Text(
                'Copy as markdown',
                style: TextStyle(color: theme.textMuted),
              ),
              onTap: () {
                Navigator.pop(context);
                _copyTranscriptToClipboard();
              },
            ),
            ListTile(
              leading: Icon(Icons.share, color: theme.primary),
              title: Text('Share', style: TextStyle(color: theme.text)),
              subtitle: Text(
                'Share transcript via system share',
                style: TextStyle(color: theme.textMuted),
              ),
              onTap: () {
                Navigator.pop(context);
                _shareTranscript();
              },
            ),
            ListTile(
              leading: Icon(Icons.tune_rounded, color: theme.primary),
              title: Text(
                'Export options…',
                style: TextStyle(color: theme.text),
              ),
              subtitle: Text(
                'Choose format, include tools, and more',
                style: TextStyle(color: theme.textMuted),
              ),
              onTap: () {
                Navigator.pop(context);
                showModalBottomSheet(
                  context: context,
                  isScrollControlled: true,
                  backgroundColor: Colors.transparent,
                  builder: (_) => ExportSessionSheet(
                    title: widget.effectiveTitle,
                    messages: chatState.messages,
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  /// Share transcript via system share sheet
  void _shareTranscript() {
    final chatState = ref.read(chatSessionProvider);
    final buffer = StringBuffer();
    buffer.writeln('# Session: ${widget.session.title}');
    buffer.writeln('---\n');

    for (final msg in chatState.messages) {
      final role = msg.role == 'user' ? 'You' : 'Assistant';
      buffer.writeln('## $role');
      buffer.writeln(msg.text);
      buffer.writeln();
    }

    Share.share(
      buffer.toString(),
      subject: 'Chat Session: ${widget.session.title}',
    );
  }

  /// Show timeline dialog to jump to a specific message
  void _showTimelineDialog() {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.read(chatSessionProvider);

    if (chatState.messages.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('No messages in session')));
      return;
    }

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.4,
        maxChildSize: 0.9,
        builder: (context, scrollController) => Container(
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            children: [
              Container(
                margin: const EdgeInsets.only(top: 12),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.textMuted,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'Jump to Message',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: theme.text,
                  ),
                ),
              ),
              Expanded(
                child: ListView.builder(
                  controller: scrollController,
                  itemCount: chatState.messages.length,
                  itemBuilder: (context, index) {
                    final msg = chatState.messages[index];
                    final isUser = msg.role == 'user';
                    return ListTile(
                      leading: CircleAvatar(
                        backgroundColor: isUser ? theme.primary : theme.accent,
                        radius: 16,
                        child: Icon(
                          isUser ? Icons.person : Icons.smart_toy,
                          size: 16,
                          color: Colors.white,
                        ),
                      ),
                      title: Text(
                        isUser ? 'You' : 'Assistant',
                        style: TextStyle(
                          fontWeight: FontWeight.w500,
                          color: theme.text,
                        ),
                      ),
                      subtitle: Text(
                        msg.text.length > 60
                            ? '${msg.text.substring(0, 60)}...'
                            : msg.text,
                        style: TextStyle(color: theme.textMuted),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      onTap: () {
                        Navigator.pop(context);
                        // Scroll to the message
                        final targetIndex =
                            chatState.messages.length - 1 - index;
                        if (_scrollController.hasClients) {
                          _scrollController.animateTo(
                            targetIndex * 120.0, // Approximate message height
                            duration: const Duration(milliseconds: 300),
                            curve: Curves.easeInOut,
                          );
                        }
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Show fork dialog to create a branch from a specific message
  void _showForkDialog() {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.read(chatSessionProvider);

    if (chatState.messages.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('No messages to fork from')));
      return;
    }

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.4,
        maxChildSize: 0.9,
        builder: (context, scrollController) => Container(
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            children: [
              Container(
                margin: const EdgeInsets.only(top: 12),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.textMuted,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Text(
                      'Fork Session',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        color: theme.text,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Select a message to fork from',
                      style: TextStyle(fontSize: 13, color: theme.textMuted),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView.builder(
                  controller: scrollController,
                  itemCount: chatState.messages.length,
                  itemBuilder: (context, index) {
                    final msg = chatState.messages[index];
                    final isUser = msg.role == 'user';
                    return ListTile(
                      leading: CircleAvatar(
                        backgroundColor: isUser ? theme.primary : theme.accent,
                        radius: 16,
                        child: Icon(
                          isUser ? Icons.person : Icons.smart_toy,
                          size: 16,
                          color: Colors.white,
                        ),
                      ),
                      title: Text(
                        isUser ? 'You' : 'Assistant',
                        style: TextStyle(
                          fontWeight: FontWeight.w500,
                          color: theme.text,
                        ),
                      ),
                      subtitle: Text(
                        msg.text.length > 60
                            ? '${msg.text.substring(0, 60)}...'
                            : msg.text,
                        style: TextStyle(color: theme.textMuted),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: Icon(Icons.fork_right, color: theme.primary),
                      onTap: () async {
                        Navigator.pop(context);
                        try {
                          final bridge = ref.read(bridgeServiceProvider);
                          final forkedSession = await bridge.forkSession(
                            widget.session.id,
                            messageId: msg.id,
                            projectPath: widget.project.path,
                          );
                          if (mounted) {
                            String? initialPrompt;
                            final idx = chatState.messages.indexWhere(
                              (m) => m.id == msg.id,
                            );
                            if (idx >= 0) {
                              for (var i = idx; i >= 0; i--) {
                                final m = chatState.messages[i];
                                if (m.role == MessageRole.user &&
                                    m.text.trim().isNotEmpty) {
                                  initialPrompt = m.text.trim();
                                  break;
                                }
                              }
                              initialPrompt ??= msg.text.trim();
                            }
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  'Forked to "${forkedSession.title}"',
                                ),
                                action: SnackBarAction(
                                  label: 'Open',
                                  onPressed: () {
                                    // Navigate to the forked session
                                    Navigator.pushReplacement(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) => ChatScreen(
                                          project: widget.project,
                                          session: forkedSession,
                                          initialPrompt: initialPrompt,
                                        ),
                                      ),
                                    );
                                  },
                                ),
                              ),
                            );
                          }
                        } catch (e) {
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Failed to fork: $e')),
                            );
                          }
                        }
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Toggle thinking/reasoning visibility
  void _toggleThinkingVisibility() {
    // Toggle the state - for now we'll use a simple snackbar notification
    // In a full implementation, this would toggle a provider state
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Thinking visibility toggled'),
        duration: Duration(seconds: 2),
      ),
    );
  }

  /// Show models selection dialog
  void _showModelsDialog() {
    // Use existing model selector
    _showModelSelector(context);
  }

  /// Show agents selection dialog
  void _showAgentsDialog() {
    final theme = OpenCodeTheme.of(context);

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Available Agents',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: theme.text,
              ),
            ),
            const SizedBox(height: 16),
            if (_agents.isEmpty)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'No agents available',
                  style: TextStyle(color: theme.textMuted),
                ),
              )
            else
              ...List.generate(_agents.length, (index) {
                final agent = _agents[index];
                final isSelected = _selectedAgent == agent.name;
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: isSelected ? theme.primary : theme.bgDeep,
                    child: Icon(
                      Icons.smart_toy,
                      color: isSelected ? Colors.white : theme.textMuted,
                      size: 20,
                    ),
                  ),
                  title: Text(
                    agent.name,
                    style: TextStyle(
                      color: theme.text,
                      fontWeight: isSelected
                          ? FontWeight.w600
                          : FontWeight.normal,
                    ),
                  ),
                  subtitle: agent.description != null
                      ? Text(
                          agent.description!,
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        )
                      : null,
                  trailing: isSelected
                      ? Icon(Icons.check_circle, color: theme.primary)
                      : null,
                  onTap: () {
                    setState(() => _selectedAgent = agent.name);
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Selected ${agent.name} agent')),
                    );
                  },
                );
              }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    // FIX: Cancel listener subscriptions to prevent callbacks after dispose
    _connectionSubscription?.close();
    _chatSubscription?.close();
    _ccConfigSubscription?.close();
    ref.read(bridgeServiceProvider).setView(projectPath: 'global');
    _controller.dispose();
    _scrollController.dispose();
    _inputFocusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    // PERF: Use select() to only rebuild when specific parts of state change.
    // The message list is the most expensive part, so we isolate it.
    final messages = ref.watch(chatSessionProvider.select((s) => s.messages));
    final permissions = ref.watch(
      chatSessionProvider.select((s) => s.permissions),
    );
    final pendingQuestion = ref.watch(
      chatSessionProvider.select((s) => s.pendingQuestion),
    );
    final todos = ref.watch(chatSessionProvider.select((s) => s.todos));
    final sessionDiffs = ref.watch(
      chatSessionProvider.select((s) => s.sessionDiffs),
    );
    final isCompacting = ref.watch(
      chatSessionProvider.select((s) => s.isCompacting),
    );
    final sessionStatus = ref.watch(
      chatSessionProvider.select((s) => s.sessionStatus),
    );
    final ccIsStreaming = ref.watch(
      chatSessionProvider.select((s) => s.ccIsStreaming),
    );
    final ccInit = ref.watch(chatSessionProvider.select((s) => s.ccInit));
    final ccModel = ref.watch(chatSessionProvider.select((s) => s.ccModel));
    // Watch these for rebuild triggers (values accessed via ref.read in callbacks)
    ref.watch(chatSessionProvider.select((s) => s.ccCwd));
    ref.watch(chatSessionProvider.select((s) => s.ccSessionId));

    final connection = ref.watch(connectionProvider);

    _maybeShowPermissionPromptFromList(permissions);
    _maybeShowQuestionPrompt(pendingQuestion);

    return Scaffold(
      backgroundColor: theme.background,
      // Use endDrawer for right-side sidebar that can be swiped from edge
      endDrawer: SessionSidebar(
        sessionTitle: widget.isClaudeCode
            ? (widget.ccSession?.displayTitle ??
                  widget.ccDraftTitle ??
                  'Claude Code')
            : widget.session.title,
        sessionContext: _sessionContext,
        todos: todos, // Both OC and CC have todos (CC via TodoWrite tool)
        onClose: _closeSidebar,
        vcsInfo: _vcsInfo,
        sessionDiffs: sessionDiffs,
        onOpenDiff: (diff) => _openDiffView(diff),
        isClaudeCode: widget.isClaudeCode,
        ccInit: widget.isClaudeCode ? ccInit : null,
      ),
      onEndDrawerChanged: (isOpen) {
        if (isOpen && !_sidebarOpen) {
          _loadSessionContext();
        }
        setState(() => _sidebarOpen = isOpen);
      },
      // Allow swipe from right edge to open drawer
      drawerEdgeDragWidth: 40,
      body: Stack(
        children: [
          // Custom background from appearance settings
          const AppBackground(screenId: AppScreen.chat),
          SafeArea(
            child: Column(
              children: [
                // Chat messages with smooth auto-hiding scrollbar
                Expanded(
                  // GestureDetector for tap-to-unfocus with smooth behavior
                  // Handles: tap anywhere, tap-and-drag, long press - all dismiss keyboard
                  child: GestureDetector(
                    behavior: HitTestBehavior.translucent,
                    onTap: _dismissKeyboardIfFocused,
                    onPanDown: (_) => _dismissKeyboardIfFocused(),
                    child: Stack(
                      children: [
                        // OpenCode branding - shown centered when empty
                        if (widget.isOpenCode && messages.isEmpty)
                          const Center(
                            child: OpenCodeBranding(width: 280, opacity: 1.0),
                          ),
                        // Message list
                        ScrollbarTheme(
                          data: ScrollbarThemeData(
                            thumbColor: WidgetStateProperty.all(
                              theme.textMuted.withValues(alpha: 0.3),
                            ),
                            trackColor: WidgetStateProperty.all(
                              Colors.transparent,
                            ),
                            radius: const Radius.circular(4),
                            thickness: WidgetStateProperty.all(6),
                            minThumbLength: 48,
                            interactive: true,
                          ),
                          child: Scrollbar(
                            controller: _scrollController,
                            thumbVisibility:
                                false, // Auto-hide when not scrolling
                            child: ListView.builder(
                              controller: _scrollController,
                              // PERF: Pre-render 500px above/below viewport for smoother scrolling
                              cacheExtent: 500,
                              padding: const EdgeInsets.fromLTRB(
                                20,
                                20,
                                20,
                                90,
                              ),
                              // Add 1 for loading indicator at top when loading more
                              itemCount:
                                  messages.length +
                                  (_loadingMoreMessages ? 1 : 0) +
                                  (!_hasLoadedAllMessages && messages.isNotEmpty
                                      ? 1
                                      : 0),
                              itemBuilder: (context, index) {
                                // Show "load more" indicator at top
                                if (!_hasLoadedAllMessages &&
                                    messages.isNotEmpty &&
                                    index == 0) {
                                  if (_loadingMoreMessages) {
                                    return const Padding(
                                      padding: EdgeInsets.symmetric(
                                        vertical: 16,
                                      ),
                                      child: Center(
                                        child: SizedBox(
                                          width: 20,
                                          height: 20,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                          ),
                                        ),
                                      ),
                                    );
                                  }
                                  // Show "scroll up for more" hint
                                  return Padding(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 12,
                                    ),
                                    child: Center(
                                      child: Text(
                                        '↑ Scroll up to load earlier messages',
                                        style: TextStyle(
                                          color: theme.textMuted,
                                          fontSize: 12,
                                        ),
                                      ),
                                    ),
                                  );
                                }

                                // Adjust index for the loading indicator
                                final messageIndex =
                                    (!_hasLoadedAllMessages &&
                                        messages.isNotEmpty)
                                    ? index - 1
                                    : index;

                                if (messageIndex < 0 ||
                                    messageIndex >= messages.length) {
                                  return const SizedBox.shrink();
                                }

                                final message = messages[messageIndex];
                                // PERF: ValueKey helps Flutter track widget identity across rebuilds
                                return KeyedSubtree(
                                  key: ValueKey(message.id),
                                  child: _buildMessageGroup(message),
                                );
                              },
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Stop button when streaming - centered at bottom
          if (_hasStreamingMessage(messages))
            Positioned(
              bottom: 24,
              left: 0,
              right: 0,
              child: Center(child: _buildStopButton(context)),
            ),

          // Slash command autocomplete popup (kept mounted to avoid focus loss)
          Positioned(
            left: 16,
            right: 16,
            bottom: 70,
            child: Visibility(
              visible: _showCommandAutocomplete && _commands.isNotEmpty,
              maintainState: true,
              child: _CommandAutocomplete(
                commands: _filteredCommands,
                onSelect: _selectCommand,
              ),
            ),
          ),

          // Claude Code: Custom tool autocomplete popup (type "@tool:")
          Positioned(
            left: 16,
            right: 16,
            bottom: 70,
            child: Visibility(
              visible: _showCustomToolAutocomplete,
              maintainState: true,
              child: _CustomToolAutocomplete(
                query: _customToolQuery,
                onSelect: _handleCustomToolSelection,
              ),
            ),
          ),

          // Agent @ mention autocomplete popup (kept mounted to avoid focus loss)
          Positioned(
            left: 16,
            right: 16,
            bottom: 70,
            child: Visibility(
              visible: _showAgentAutocomplete && _agents.isNotEmpty,
              maintainState: true,
              child: AgentAutocomplete(
                agents: _agents,
                query: _agentQuery,
                onSelect: _handleAgentSelection,
                visible: true,
              ),
            ),
          ),

          // Floating input bar at bottom (style based on settings)
          Positioned(
            key: const ValueKey('chat-input-bar'),
            left: 0,
            right: 0,
            bottom: 0,
            child: _buildInputBarWithParams(
              connection: connection,
              messages: messages,
              ccIsStreaming: ccIsStreaming,
              ccInit: ccInit,
              ccModel: ccModel,
            ),
          ),

          // Floating header at top (glass pills)
          Positioned(
            left: 0,
            right: 0,
            top: 0,
            child: _FloatingHeader(
              projectName: widget.projectName,
              isConnected: connection.isConnected,
              currentModel: widget.isOpenCode
                  ? ref.watch(selectionProvider).model
                  : null,
              rttMs: connection.rttMs,
              onBack: () => Navigator.of(context).pop(),
              onModelTap: widget.isOpenCode
                  ? () => _showModelSelector(context)
                  : null,
              onMenu: widget.isClaudeCode
                  ? (value) => _handleClaudeCodeMenuAction(value)
                  : widget.isCodex
                  ? (value) => _handleCodexMenuAction(value)
                  : widget.isOpenCode
                  ? (value) => _handleMenuActionWithMessages(value, messages)
                  : null,
              onOpenSidebar: () => Scaffold.of(context).openEndDrawer(),
              currentAgent: _selectedAgent,
              agents: widget.isOpenCode ? _agents : [],
              onAgentChanged: widget.isOpenCode
                  ? (agent) => setState(() => _selectedAgent = agent)
                  : null,
              vcsInfo: _vcsInfo,
              isSessionShared: widget.isOpenCode
                  ? widget.session.isShared
                  : false,
              isCompacting: isCompacting,
              sessionStatus: sessionStatus,
              isStreaming: widget.isClaudeCode
                  ? ccIsStreaming
                  : widget.isCodex
                  ? ref.watch(
                      chatSessionProvider.select((s) => s.cxIsStreaming),
                    )
                  : _hasStreamingMessage(messages),
              isClaudeCode: widget.isClaudeCode,
              isCodex: widget.isCodex,
              ccModel: widget.isClaudeCode
                  ? (ref.watch(ccConfigProvider).valueOrNull?.model ??
                        ccModel ??
                        ccInit?.model ??
                        widget.ccSession?.model ??
                        widget.ccDraftModel)
                  : null,
              codexModel: widget.isCodex
                  ? ref.watch(chatSessionProvider.select((s) => s.cxModel))
                  : null,
            ),
          ),

          // Floating indicator for other running sessions (OpenCode + Claude Code)
          FloatingActiveIndicator(
            currentSessionId: widget.effectiveSessionId.isNotEmpty
                ? widget.effectiveSessionId
                : null,
            onTap: () {
              // Navigate back to see the sessions list
              Navigator.pop(context);
            },
          ),
        ],
      ),
    );
  }

  // PERF: Input bar version that takes individual params instead of full chatState
  // This allows using select() in the build method for better performance
  Widget _buildInputBarWithParams({
    required BridgeConnectionState connection,
    required List<ChatMessage> messages,
    required bool ccIsStreaming,
    CCSessionInit? ccInit,
    String? ccModel,
  }) {
    final inputStyle = ref.watch(inputStyleProvider);
    final isBusy = widget.isClaudeCode
        ? ccIsStreaming
        : _hasStreamingMessage(messages);
    final hasContent =
        _controller.text.trim().isNotEmpty || _attachedFiles.isNotEmpty;
    final canSend =
        connection.isConnected &&
        !connection.isOfflineMode &&
        !isBusy &&
        hasContent;

    // Get CC config for Claude Code mode
    final ccConfig = widget.isClaudeCode
        ? ref.watch(ccConfigProvider).valueOrNull
        : null;

    // Get custom prompt accent color
    final promptAccent = ref.watch(promptAccentProvider);
    final theme = OpenCodeTheme.of(context);
    final customAccent = promptAccent == PromptAccentColor.themePrimary
        ? null
        : promptAccent.getColor(theme.primary);

    Widget inputBar;
    if (inputStyle == InputBarStyle.cli) {
      inputBar = _CliStyleInputBar(
        controller: _controller,
        focusNode: _inputFocusNode,
        onSend: () =>
            _sendMessageWithParams(connection, messages, ccIsStreaming),
        isBusy: isBusy,
        canSend: canSend,
        isOfflineMode: connection.isOfflineMode,
        currentAgent: widget.isClaudeCode ? null : _selectedAgent,
        agents: widget.isClaudeCode ? const [] : _agents,
        onAgentChanged: widget.isClaudeCode
            ? null
            : (agent) => setState(() => _selectedAgent = agent),
        currentModel: widget.isClaudeCode
            ? null
            : ref.watch(selectionProvider).model,
        onModelTap: widget.isClaudeCode
            ? null
            : () => _showModelSelector(context),
        attachedFiles: _attachedFiles,
        onRemoveAttachment: _removeAttachedFile,
        showFileAutocomplete: _showFileAutocomplete,
        onFileSelect: _handleFileSelection,
        onAttachTap: () => _showAttachmentOptions(context),
        attachIcon: Icons.add_rounded,
        isClaudeCode: widget.isClaudeCode,
        ccPermissionMode: ccConfig?.permissionMode ?? ccInit?.permissionMode,
        ccModel:
            ccConfig?.model ??
            ccModel ??
            ccInit?.model ??
            widget.ccSession?.model ??
            widget.ccDraftModel,
        onCCModelTap: widget.isClaudeCode
            ? () => _showClaudeCodeModelSelector(context)
            : null,
        onCCPermissionModeTap: widget.isClaudeCode
            ? () => _showClaudeCodePermissionModeSelector(context)
            : null,
        // Codex specific
        isCodex: widget.isCodex,
        codexModel: widget.isCodex
            ? ref.watch(chatSessionProvider.select((s) => s.cxModel))
            : null,
        onCodexModelTap: widget.isCodex ? () => _showCodexModelSheet() : null,
        customAccentColor: customAccent,
        // OpenCode Plan Mode (SDK v1.1.18+)
        isOpenCode: widget.isOpenCode,
        ocPlanMode: widget.isOpenCode
            ? ref.watch(chatSessionProvider.select((s) => s.ocAgentMode)) ==
                  'plan'
            : false,
        onPlanModeToggle: widget.isOpenCode
            ? () {
                final current = ref.read(chatSessionProvider).ocAgentMode;
                ref
                    .read(chatSessionProvider.notifier)
                    .setOCAgentMode(current == 'plan' ? 'build' : 'plan');
              }
            : null,
      );
    } else {
      inputBar = _FloatingInputBar(
        controller: _controller,
        focusNode: _inputFocusNode,
        onSend: () =>
            _sendMessageWithParams(connection, messages, ccIsStreaming),
        isBusy: isBusy,
        canSend: canSend,
        isOfflineMode: connection.isOfflineMode,
        attachedFiles: _attachedFiles,
        onRemoveAttachment: _removeAttachedFile,
        showFileAutocomplete: _showFileAutocomplete,
        onFileSelect: _handleFileSelection,
        onAttachTap: () => _showAttachmentOptions(context),
        attachIcon: Icons.add_rounded,
        agents: widget.isClaudeCode ? const [] : _agents,
        currentAgent: widget.isClaudeCode ? null : _selectedAgent,
        onAgentChanged: widget.isClaudeCode
            ? null
            : (agent) => setState(() => _selectedAgent = agent),
        // OpenCode Plan Mode (SDK v1.1.18+)
        isOpenCode: widget.isOpenCode,
        ocPlanMode: widget.isOpenCode
            ? ref.watch(chatSessionProvider.select((s) => s.ocAgentMode)) ==
                  'plan'
            : false,
        onPlanModeToggle: widget.isOpenCode
            ? () {
                final current = ref.read(chatSessionProvider).ocAgentMode;
                ref
                    .read(chatSessionProvider.notifier)
                    .setOCAgentMode(current == 'plan' ? 'build' : 'plan');
              }
            : null,
      );
    }

    return inputBar;
  }

  Widget _buildMessageGroup(ChatMessage message) {
    // PERF: RepaintBoundary isolates this message's painting from others.
    // Changes to one message don't trigger repaints of nearby messages.
    return RepaintBoundary(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Reasoning/thinking content (shows model's thinking process)
          if (message.hasReasoning)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ThinkingCard(message: message),
            ),

          // Claude Code with ordered parts: Render in arrival order (text-tool-text interleaved)
          // OpenCode or no parts: Use fixed order (text first, then all tools)
          if (message.hasOrderedParts)
            ..._buildOrderedParts(message)
          else ...[
            // Feature 6: Pass fork callback to message bubble
            if (message.text.trim().isNotEmpty || message.isStreaming)
              MessageBubble(
                message: message,
                onForkFromHere: message.role == MessageRole.assistant
                    ? (messageId) => _forkSession(messageId: messageId)
                    : null,
                onRollback: widget.isCodex ? _showCodexRollbackSheet : null,
              ),

            // Tool calls with Feature 7: Undo callback
            // For Claude Code, undo rewinds to the latest checkpoint (session-wide).
            // For OpenCode, undo reverts a specific message/part.
            for (final tool in message.toolCalls)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: ToolCallCard(
                  tool: tool,
                  messageId: message.id,
                  onUndo: widget.isClaudeCode
                      ? (_, __) => _ccRewindToCheckpoint()
                      : (messageId, partId) =>
                            _revertMessage(messageId, partId: partId),
                ),
              ),
          ],

          // Diffs with Feature 7: Revert callback (always after parts)
          for (final diff in message.diffs)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: DiffViewer(
                diff: diff,
                messageId: message.id,
                onUndo: widget.isClaudeCode
                    ? (_, __) => _ccRewindToCheckpoint()
                    : (messageId, partId) =>
                          _revertMessage(messageId, partId: partId),
                onViewFull: () => _openDiffView(diff, messageId: message.id),
              ),
            ),

          // Subtask notifications (background task completions)
          for (final subtask in message.subtaskNotifications)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: SubtaskNotificationCard(notification: subtask),
            ),

          const SizedBox(height: 16),
        ],
      ),
    );
  }

  /// Build widgets for ordered parts (Claude Code sequential rendering)
  /// Returns widgets in arrival order: text segments and tool calls interleaved
  List<Widget> _buildOrderedParts(ChatMessage message) {
    final widgets = <Widget>[];
    final toolsById = {for (final t in message.toolCalls) t.callId: t};

    for (final part in message.parts) {
      switch (part) {
        case TextPart(:final text, :final isStreaming):
          if (text.trim().isNotEmpty) {
            // Create a mini ChatMessage for this text segment
            final textMessage = ChatMessage(
              id: '${message.id}-text-${part.sequence}',
              sessionId: message.sessionId,
              role: message.role,
              createdAt: message.createdAt,
              text: text,
              isStreaming: isStreaming,
            );
            widgets.add(
              Padding(
                padding: EdgeInsets.only(top: widgets.isEmpty ? 0 : 8),
                child: MessageBubble(
                  message: textMessage,
                  onForkFromHere: message.role == MessageRole.assistant
                      ? (messageId) => _forkSession(messageId: message.id)
                      : null,
                  onRollback: widget.isCodex ? _showCodexRollbackSheet : null,
                ),
              ),
            );
          }
        case ToolPart(:final callId):
          final tool = toolsById[callId];
          if (tool != null) {
            widgets.add(
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: ToolCallCard(
                  tool: tool,
                  messageId: message.id,
                  onUndo: (_, __) => _ccRewindToCheckpoint(),
                ),
              ),
            );
          }
      }
    }

    // Fallback: if no widgets were built from parts but message has content,
    // add the main text and tools (handles edge cases where parts are malformed)
    if (widgets.isEmpty) {
      if (message.text.trim().isNotEmpty) {
        widgets.add(
          MessageBubble(
            message: message,
            onForkFromHere: message.role == MessageRole.assistant
                ? (messageId) => _forkSession(messageId: message.id)
                : null,
            onRollback: widget.isCodex ? _showCodexRollbackSheet : null,
          ),
        );
      }
      for (final tool in message.toolCalls) {
        widgets.add(
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: ToolCallCard(
              tool: tool,
              messageId: message.id,
              onUndo: (_, __) => _ccRewindToCheckpoint(),
            ),
          ),
        );
      }
    }

    return widgets;
  }

  Widget _buildStopButton(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Material(
      color: theme.backgroundPanel,
      borderRadius: BorderRadius.circular(24),
      elevation: 8,
      shadowColor: Colors.black.withValues(alpha: 0.3),
      child: InkWell(
        onTap: () => _showStopConfirmation(context),
        borderRadius: BorderRadius.circular(24),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: theme.error.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: theme.error,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 10),
              Text(
                'Stop generating',
                style: TextStyle(
                  color: theme.text,
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // PERF: Menu action handler that takes messages list directly (used with select())
  void _handleMenuActionWithMessages(String value, List<ChatMessage> messages) {
    final theme = OpenCodeTheme.of(context);
    switch (value) {
      case 'sidebar':
        Scaffold.of(context).openEndDrawer();
        break;
      case 'new_session':
        // TODO: Implement new session
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('New session - coming soon'),
            backgroundColor: theme.backgroundPanel,
          ),
        );
        break;
      case 'fork':
        _forkSession();
        break;
      case 'share':
        _shareSession();
        break;
      case 'unshare':
        _unshareSession();
        break;
      case 'compact':
        _compactSession();
        break;
      case 'init':
        _initializeProject();
        break;
      case 'undo':
        if (widget.isClaudeCode) {
          // Claude Code uses checkpoint-based revert (session-wide)
          _ccRewindToCheckpoint();
        } else {
          // OpenCode uses per-message revert
          ChatMessage? lastEditMessage;
          for (final msg in messages.reversed) {
            if (msg.role == MessageRole.assistant &&
                msg.toolCalls.any(
                  (tool) => tool.name == 'edit' || tool.name == 'write',
                )) {
              lastEditMessage = msg;
              break;
            }
          }
          if (lastEditMessage != null) {
            _revertMessage(lastEditMessage.id);
          } else {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: const Text('No file changes to undo'),
                backgroundColor: theme.backgroundPanel,
              ),
            );
          }
        }
        break;
      case 'clear_instance':
        _clearInstance();
        break;
    }
  }

  Future<void> _clearInstance() async {
    final theme = OpenCodeTheme.of(context);
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: theme.backgroundPanel,
        title: Text('Clear Instance?', style: TextStyle(color: theme.text)),
        content: Text(
          'This will reset the project context on OpenCode server. '
          'Caches and loaded files will be cleared.\n\n'
          'Your chat history will remain.',
          style: TextStyle(color: theme.textMuted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text('Clear', style: TextStyle(color: theme.warning)),
          ),
        ],
      ),
    );

    if (confirm != true || !mounted) return;

    final bridge = ref.read(bridgeServiceProvider);
    final success = await bridge.disposeInstance(
      projectPath: widget.project.path,
    );

    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          success ? 'Instance cleared' : 'Failed to clear instance',
        ),
        backgroundColor: theme.backgroundPanel,
      ),
    );
  }

  void _showStopConfirmation(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    _haptics.mediumImpact();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: theme.backgroundPanel,
        title: Text('Stop Generation?', style: TextStyle(color: theme.text)),
        content: Text(
          'This will abort the current AI response.',
          style: TextStyle(color: theme.textMuted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              final bridge = ref.read(bridgeServiceProvider);
              if (widget.isClaudeCode) {
                final chatState = ref.read(chatSessionProvider);
                final sid = chatState.ccSessionId;
                if (sid != null && sid.isNotEmpty) {
                  bridge.ccAbort(sid);
                }
                ref.read(chatSessionProvider.notifier).setCCStreaming(false);
              } else if (widget.isCodex) {
                final chatState = ref.read(chatSessionProvider);
                final tid = chatState.cxThreadId;
                if (tid != null && tid.isNotEmpty) {
                  bridge.cxAbort(threadId: tid);
                }
                ref.read(chatSessionProvider.notifier).setCodexStreaming(false);
              } else {
                bridge.abortSession(widget.session.id);
              }
              Navigator.pop(context);
            },
            child: Text('Stop', style: TextStyle(color: theme.error)),
          ),
        ],
      ),
    );
  }

  void _showModelSelector(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ModelSelectorSheet(
        onModelSelected: (model) {
          ref.read(selectionProvider.notifier).selectModelFromString(model);
          Navigator.pop(context);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Switched to $model'),
              backgroundColor: theme.backgroundPanel,
              behavior: SnackBarBehavior.floating,
            ),
          );
        },
      ),
    );
  }

  /// Show Claude Code model selector (Auto/Haiku/Sonnet/Opus)
  void _showClaudeCodeModelSelector(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.read(chatSessionProvider);
    final ccConfig = ref.read(ccConfigProvider).valueOrNull;
    final currentModel =
        ccConfig?.model ??
        chatState.ccModel ??
        chatState.ccInit?.model ??
        widget.ccSession?.model;

    // Claude Code models
    final models = [
      {
        'id': null,
        'name': 'Auto',
        'description': 'Let Claude Code choose the best model',
      },
      {
        'id': 'haiku',
        'name': 'Haiku',
        'description': 'Fastest, most compact model',
      },
      {
        'id': 'sonnet',
        'name': 'Sonnet',
        'description': 'Balanced speed and capability',
      },
      {'id': 'opus', 'name': 'Opus', 'description': 'Most capable model'},
    ];

    showModalBottomSheet(
      context: context,
      backgroundColor: theme.background,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Select Model',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: theme.text,
                ),
              ),
              const SizedBox(height: 16),
              ...models.map((model) {
                final modelId = model['id'];
                final isSelected =
                    (modelId == null &&
                        (currentModel == null || currentModel == 'auto')) ||
                    (modelId != null &&
                        currentModel?.toLowerCase().contains(modelId) == true);
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    isSelected ? Icons.check_circle : Icons.circle_outlined,
                    color: isSelected ? theme.success : theme.borderSubtle,
                  ),
                  title: Text(
                    model['name'] as String,
                    style: TextStyle(
                      color: theme.text,
                      fontWeight: isSelected
                          ? FontWeight.w600
                          : FontWeight.w400,
                    ),
                  ),
                  subtitle: Text(
                    model['description'] as String,
                    style: TextStyle(color: theme.textMuted, fontSize: 12),
                  ),
                  onTap: () {
                    // Update CC config with new model
                    final notifier = ref.read(ccConfigProvider.notifier);
                    notifier.setModel(modelId);
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('Model set to ${model['name']}'),
                        backgroundColor: theme.backgroundPanel,
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                  },
                );
              }),
            ],
          ),
        ),
      ),
    );
  }

  /// Show Claude Code permission mode selector
  void _showClaudeCodePermissionModeSelector(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final ccConfig = ref.read(ccConfigProvider).valueOrNull;
    final chatState = ref.read(chatSessionProvider);
    final currentMode =
        ccConfig?.permissionMode ??
        chatState.ccInit?.permissionMode ??
        ClaudeCodePermissionMode.defaultMode;

    final modes = [
      {
        'mode': ClaudeCodePermissionMode.defaultMode,
        'description': 'Ask before making changes',
        'color': theme.primary,
      },
      {
        'mode': ClaudeCodePermissionMode.acceptEdits,
        'description': 'Auto-accept file edits',
        'color': theme.success,
      },
      {
        'mode': ClaudeCodePermissionMode.plan,
        'description': 'Planning only, no execution',
        'color': theme.warning,
      },
      {
        'mode': ClaudeCodePermissionMode.bypassPermissions,
        'description': 'Skip all permission checks',
        'color': theme.error,
      },
    ];

    showModalBottomSheet(
      context: context,
      backgroundColor: theme.background,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Permission Mode',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: theme.text,
                ),
              ),
              const SizedBox(height: 16),
              ...modes.map((item) {
                final mode = item['mode'] as ClaudeCodePermissionMode;
                final isSelected = mode == currentMode;
                final color = item['color'] as Color;
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Container(
                    width: 24,
                    height: 24,
                    decoration: BoxDecoration(
                      color: isSelected ? color : Colors.transparent,
                      shape: BoxShape.circle,
                      border: Border.all(color: color, width: 2),
                    ),
                    child: isSelected
                        ? Icon(Icons.check, color: theme.background, size: 16)
                        : null,
                  ),
                  title: Text(
                    mode.displayName,
                    style: TextStyle(
                      color: theme.text,
                      fontWeight: isSelected
                          ? FontWeight.w600
                          : FontWeight.w400,
                    ),
                  ),
                  subtitle: Text(
                    item['description'] as String,
                    style: TextStyle(color: theme.textMuted, fontSize: 12),
                  ),
                  onTap: () {
                    // Update CC config with new permission mode
                    final notifier = ref.read(ccConfigProvider.notifier);
                    notifier.setPermissionMode(mode);
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          'Permission mode set to ${mode.displayName}',
                        ),
                        backgroundColor: theme.backgroundPanel,
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                  },
                );
              }),
            ],
          ),
        ),
      ),
    );
  }

  // PERF: Version that takes individual params, used with select()
  void _sendMessageWithParams(
    BridgeConnectionState connection,
    List<ChatMessage> messages,
    bool ccIsStreaming,
  ) {
    // Read the full state from provider for the actual send operation
    final chatState = ref.read(chatSessionProvider);
    _sendMessage(connection, chatState);
  }

  void _sendMessage(
    BridgeConnectionState connection,
    ChatSessionState chatState,
  ) {
    final text = _controller.text.trim();
    final hasAttachments = _attachedFiles.isNotEmpty;
    if (text.isEmpty && !hasAttachments) return;
    if (!connection.isConnected) return;

    // Check for streaming state (different for CC vs OC)
    if (widget.isClaudeCode) {
      if (chatState.ccIsStreaming) return;
    } else if (widget.isCodex) {
      if (chatState.cxIsStreaming) return;
    } else {
      if (_hasStreamingMessage(chatState.messages)) return;
    }

    final bridge = ref.read(bridgeServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);
    final selectedModel = ref.read(selectionProvider).model;

    // Parse @agent mention from message text
    // Pattern: @agentname followed by space or end of string
    // This extracts the agent to use for this message
    String? messageAgent = _selectedAgent;
    final agentMatch = RegExp(r'@(\w+)(?:\s|$)').firstMatch(text);
    if (agentMatch != null) {
      final mentionedAgent = agentMatch.group(1)?.toLowerCase();
      // Check if this matches a known agent
      final matchedAgent = _agents.firstWhere(
        (a) => a.name.toLowerCase() == mentionedAgent,
        orElse: () => Agent(name: '', mode: AgentMode.primary),
      );
      if (matchedAgent.name.isNotEmpty) {
        messageAgent = matchedAgent.name;
      }
    }

    // OpenCode Plan Mode: Use plan agent when in plan mode (unless overridden)
    // SDK v1.1.18+: plan_enter/plan_exit tools toggle between "plan" and "build" agents
    if (widget.isOpenCode && messageAgent == null) {
      final agentMode = chatState.ocAgentMode;
      if (agentMode == 'plan') {
        messageAgent = 'plan';
      }
    }

    // Claude Code mode
    if (widget.isClaudeCode) {
      final ccConfig = ref.read(ccConfigProvider).valueOrNull;
      final cwd = chatState.ccCwd ?? widget.ccSession?.cwd ?? widget.ccDraftCwd;
      final model =
          ccConfig?.model ??
          chatState.ccModel ??
          chatState.ccInit?.model ??
          widget.ccSession?.model ??
          widget.ccDraftModel;
      final activeSubagent = messageAgent ?? ccConfig?.activeSubagent;

      // Build display message with file attachments (same UX as OpenCode)
      String displayText = text;
      if (hasAttachments) {
        final attachmentLabels = <String>[];
        int imageCount = 0;
        for (final f in _attachedFiles) {
          if (f.isImage) {
            imageCount++;
            attachmentLabels.add('[Image $imageCount]');
          } else {
            attachmentLabels.add(f.displayPath);
          }
        }
        if (attachmentLabels.isNotEmpty) {
          displayText = '$text\n${attachmentLabels.join(' ')}';
        }
      }
      chat.appendUserMessage(displayText);
      chat.setCCStreaming(true);
      bridge.ccChat(
        sessionId: chatState.ccSessionId,
        prompt: text,
        cwd: cwd,
        model: model,
        permissionMode: ccConfig?.permissionMode,
        allowedTools: ccConfig?.allowedTools,
        disallowedTools: ccConfig?.disallowedTools,
        activeSubagent: activeSubagent,
        fileAttachments: hasAttachments ? _attachedFiles : null,
      );
      _controller.clear();
      setState(() => _attachedFiles.clear());
      _userHasScrolledUp = false;
      _scrollToBottom();
      return;
    }

    // Codex mode
    if (widget.isCodex) {
      final cwd = chatState.cxCwd ?? widget.cxThread?.cwd ?? widget.cxDraftCwd;
      if (cwd == null || cwd.isEmpty) return;
      final codexSettings = ref.read(codexSettingsProvider);

      // Basic local slash commands (client-side) for Codex draft state
      if (text.startsWith('/model ')) {
        final nextModel = text.substring('/model '.length).trim();
        if (nextModel.isNotEmpty) {
          chat.appendUserMessage(text);
          chat.setCodexModel(nextModel);
          _controller.clear();
          _userHasScrolledUp = false;
          _scrollToBottom();
        }
        return;
      }

      if (text.startsWith('/approvals')) {
        final arg = text.replaceFirst('/approvals', '').trim().toLowerCase();
        final notifier = ref.read(codexSettingsProvider.notifier);
        final next = switch (arg) {
          'untrusted' ||
          'unless-trusted' ||
          'unlessTrusted' => CodexApprovalPolicy.unlessTrusted,
          'on-failure' ||
          'onfailure' ||
          'onFailure' => CodexApprovalPolicy.onFailure,
          'never' => CodexApprovalPolicy.never,
          'on-request' ||
          'onrequest' ||
          'onRequest' ||
          '' => CodexApprovalPolicy.onRequest,
          _ => CodexApprovalPolicy.onRequest,
        };
        chat.appendUserMessage(text);
        notifier.setApprovalPolicy(next);
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      if (text.startsWith('/sandbox')) {
        final arg = text.replaceFirst('/sandbox', '').trim().toLowerCase();
        final notifier = ref.read(codexSettingsProvider.notifier);
        final next = switch (arg) {
          'read-only' || 'readonly' || 'readOnly' => CodexSandboxMode.readOnly,
          'workspace-write' ||
          'workspacewrite' ||
          'workspaceWrite' => CodexSandboxMode.workspaceWrite,
          'danger-full-access' ||
          'dangerfullaccess' ||
          'dangerFullAccess' => CodexSandboxMode.dangerFullAccess,
          _ => CodexSandboxMode.readOnly,
        };
        chat.appendUserMessage(text);
        notifier.setSandboxMode(next);
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      if (text.startsWith('/effort')) {
        final arg = text.replaceFirst('/effort', '').trim().toLowerCase();
        final notifier = ref.read(codexSettingsProvider.notifier);
        final next = switch (arg) {
          'minimal' => CodexReasoningEffort.minimal,
          'low' => CodexReasoningEffort.low,
          'high' => CodexReasoningEffort.high,
          'xhigh' => CodexReasoningEffort.xhigh,
          'medium' || '' => CodexReasoningEffort.medium,
          _ => CodexReasoningEffort.medium,
        };
        chat.appendUserMessage(text);
        notifier.setReasoningEffort(next);
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      if (text.startsWith('/summary')) {
        final arg = text.replaceFirst('/summary', '').trim().toLowerCase();
        final notifier = ref.read(codexSettingsProvider.notifier);
        final next = switch (arg) {
          'concise' => CodexReasoningSummary.concise,
          'detailed' => CodexReasoningSummary.detailed,
          'none' => CodexReasoningSummary.none,
          'auto' || '' => CodexReasoningSummary.auto,
          _ => CodexReasoningSummary.auto,
        };
        chat.appendUserMessage(text);
        notifier.setReasoningSummary(next);
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      if (text.startsWith('/websearch')) {
        final arg = text.replaceFirst('/websearch', '').trim().toLowerCase();
        final enabled = arg == 'on' || arg == 'true' || arg == '1';
        chat.appendUserMessage(text);
        ref.read(codexSettingsProvider.notifier).setWebSearchEnabled(enabled);
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      if (text.startsWith('/skills')) {
        final arg = text.replaceFirst('/skills', '').trim().toLowerCase();
        final enabled = arg == 'on' || arg == 'true' || arg == '1';
        chat.appendUserMessage(text);
        ref.read(codexSettingsProvider.notifier).setSkillsEnabled(enabled);
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      if (text.startsWith('/review')) {
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        unawaited(_startCodexReview());
        return;
      }

      if (text.startsWith('/diff')) {
        chat.appendUserMessage(text);
        final diffs = ref.read(chatSessionProvider).sessionDiffs;
        if (diffs.isEmpty) {
          chat.appendLocalAssistantMessage(
            'No diff reported for this thread yet.',
          );
        } else {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            _openDiffView(diffs.first);
          });
        }
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      if (text.startsWith('/status')) {
        chat.appendUserMessage(text);
        final stateNow = ref.read(chatSessionProvider);
        final tokenUsage = stateNow.cxTokenUsage?.total;
        final contextWindow = stateNow.cxTokenUsage?.modelContextWindow;
        final summary = StringBuffer()
          ..writeln('Codex status')
          ..writeln('- Thread: ${stateNow.cxThreadId ?? '(new)'}')
          ..writeln('- CWD: ${stateNow.cxCwd ?? cwd}')
          ..writeln('- Model: ${stateNow.cxModel ?? 'default'}')
          ..writeln('- Approvals: ${codexSettings.approvalPolicy.wireValue}')
          ..writeln(
            '- Sandbox: ${codexSettings.sandboxMode.threadWireValue}'
            '${codexSettings.sandboxMode == CodexSandboxMode.workspaceWrite ? ' (network=${codexSettings.networkAccessEnabled})' : ''}',
          )
          ..writeln('- Effort: ${codexSettings.reasoningEffort.wireValue}')
          ..writeln('- Summary: ${codexSettings.reasoningSummary.wireValue}')
          ..writeln('- Web search: ${codexSettings.webSearchEnabled}')
          ..writeln('- Skills: ${codexSettings.skillsEnabled}');
        if (tokenUsage != null) {
          summary.writeln(
            '- Tokens: ${tokenUsage.totalTokens} (in ${tokenUsage.inputTokens}, out ${tokenUsage.outputTokens}, cached ${tokenUsage.cachedInputTokens}, reasoning ${tokenUsage.reasoningOutputTokens})',
          );
        }
        if (contextWindow != null) {
          summary.writeln('- Context window: $contextWindow');
        }
        chat.appendLocalAssistantMessage(summary.toString().trim());
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      if (text.startsWith('/compact')) {
        chat.appendUserMessage(text);
        chat.setCodexStreaming(true);
        bridge.cxChat(
          threadId: chatState.cxThreadId,
          cwd: cwd,
          prompt:
              'Compact/summarize this thread so far into a short, reusable memory.\n'
              'Include: goal, constraints, current progress, key decisions, next steps.\n'
              'Keep it concise and actionable.',
          model: chatState.cxModel,
          effort: codexSettings.reasoningEffort.wireValue,
          summary: codexSettings.reasoningSummary.wireValue,
          approvalPolicy: codexSettings.approvalPolicy.wireValue,
          sandbox: codexSettings.sandboxMode.threadWireValue,
          sandboxPolicy: switch (codexSettings.sandboxMode) {
            CodexSandboxMode.readOnly => const <String, dynamic>{
              'type': 'readOnly',
            },
            CodexSandboxMode.dangerFullAccess => const <String, dynamic>{
              'type': 'dangerFullAccess',
            },
            CodexSandboxMode.workspaceWrite => <String, dynamic>{
              'type': 'workspaceWrite',
              'writableRoots': [cwd],
              'networkAccess': codexSettings.networkAccessEnabled,
            },
          },
          config: <String, dynamic>{
            'features.web_search_request': codexSettings.webSearchEnabled,
            'features.skills': codexSettings.skillsEnabled,
            'model_reasoning_effort': codexSettings.reasoningEffort.wireValue,
            'model_reasoning_summary': codexSettings.reasoningSummary.wireValue,
            if (codexSettings.sandboxMode == CodexSandboxMode.workspaceWrite)
              'sandbox_workspace_write.network_access':
                  codexSettings.networkAccessEnabled,
          },
        );
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      if (text.startsWith('/undo')) {
        final threadId = chatState.cxThreadId;
        chat.appendUserMessage(text);
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        if (threadId == null || threadId.isEmpty) {
          chat.appendLocalAssistantMessage('No Codex thread yet to undo.');
        } else {
          // Run async undo operation
          () async {
            try {
              final reverted = await ref
                  .read(bridgeServiceProvider)
                  .cxUndoFiles(threadId: threadId);
              if (reverted.isEmpty) {
                chat.appendLocalAssistantMessage('No file changes to undo.');
              } else {
                chat.appendLocalAssistantMessage(
                  'Reverted ${reverted.length} path(s):\n- ${reverted.join('\n- ')}',
                );
              }
            } catch (e) {
              chat.appendLocalAssistantMessage('Undo failed: $e');
            }
          }();
        }
        return;
      }

      if (text.startsWith('/rollback')) {
        chat.appendUserMessage(text);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          _showCodexRollbackSheet();
        });
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      if (text.startsWith('/agents')) {
        chat.appendUserMessage(text);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          _showCodexAgentsSheet();
        });
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }

      // /init - Create AGENTS.md with template (like Claude Code's /init)
      if (text.startsWith('/init')) {
        chat.appendUserMessage(text);
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        () async {
          try {
            final agentsData = await bridge.cxReadAgentsMd(cwd);
            if (agentsData['exists'] == true) {
              chat.appendLocalAssistantMessage(
                'AGENTS.md already exists at ${agentsData['path']}.\n'
                'Use /agents to edit it.',
              );
            } else {
              // Create with template
              const template = '''# AGENTS.md

## Project Overview
Describe your project here.

## Build Commands
- `flutter run` - Run the app
- `flutter test` - Run tests

## Code Style
- Follow existing patterns
- Use meaningful variable names

## Constraints
- Don't modify generated files
- Always run tests before committing
''';
              final success = await bridge.cxWriteAgentsMd(
                cwd: cwd,
                content: template,
              );
              if (success) {
                chat.appendLocalAssistantMessage(
                  'Created AGENTS.md at ${agentsData['path']}.\n'
                  'Use /agents to customize it.',
                );
              } else {
                chat.appendLocalAssistantMessage('Failed to create AGENTS.md.');
              }
            }
          } catch (e) {
            chat.appendLocalAssistantMessage('Error: $e');
          }
        }();
        return;
      }

      // /mcp - List MCP server status
      if (text.startsWith('/mcp')) {
        chat.appendUserMessage(text);
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        () async {
          try {
            final servers = await bridge.cxListMcpServerStatus();
            if (servers.isEmpty) {
              chat.appendLocalAssistantMessage(
                'No MCP servers configured.\n'
                'Add servers to ~/.codex/config.toml under [mcp_servers].',
              );
            } else {
              final buf = StringBuffer('MCP Servers:\n');
              for (final s in servers) {
                final name = s['name'] ?? 'unknown';
                final status = s['status'] ?? 'unknown';
                final icon = status == 'connected' ? '●' : '○';
                buf.writeln('$icon $name ($status)');
              }
              chat.appendLocalAssistantMessage(buf.toString().trim());
            }
          } catch (e) {
            chat.appendLocalAssistantMessage('Error listing MCP servers: $e');
          }
        }();
        return;
      }

      // Build display message with file attachments (same UX as OpenCode)
      String displayText = text;
      if (hasAttachments) {
        final attachmentLabels = <String>[];
        int imageCount = 0;
        for (final f in _attachedFiles) {
          if (f.isImage) {
            imageCount++;
            attachmentLabels.add('[Image $imageCount]');
          } else {
            attachmentLabels.add(f.displayPath);
          }
        }
        if (attachmentLabels.isNotEmpty) {
          displayText = '$text\n${attachmentLabels.join(' ')}';
        }
      }

      chat.appendUserMessage(displayText);
      chat.setCodexStreaming(true);

      final sandboxPolicy = switch (codexSettings.sandboxMode) {
        CodexSandboxMode.readOnly => const <String, dynamic>{
          'type': 'readOnly',
        },
        CodexSandboxMode.dangerFullAccess => const <String, dynamic>{
          'type': 'dangerFullAccess',
        },
        CodexSandboxMode.workspaceWrite => <String, dynamic>{
          'type': 'workspaceWrite',
          'writableRoots': [cwd],
          'networkAccess': codexSettings.networkAccessEnabled,
        },
      };

      final config = <String, dynamic>{
        'features.web_search_request': codexSettings.webSearchEnabled,
        'features.skills': codexSettings.skillsEnabled,
        'model_reasoning_effort': codexSettings.reasoningEffort.wireValue,
        'model_reasoning_summary': codexSettings.reasoningSummary.wireValue,
        if (codexSettings.sandboxMode == CodexSandboxMode.workspaceWrite)
          'sandbox_workspace_write.network_access':
              codexSettings.networkAccessEnabled,
      };

      bridge.cxChat(
        threadId: chatState.cxThreadId,
        cwd: cwd,
        prompt: text,
        model: chatState.cxModel,
        effort: codexSettings.reasoningEffort.wireValue,
        summary: codexSettings.reasoningSummary.wireValue,
        approvalPolicy: codexSettings.approvalPolicy.wireValue,
        sandbox: codexSettings.sandboxMode.threadWireValue,
        sandboxPolicy: sandboxPolicy,
        config: config,
        fileAttachments: hasAttachments ? _attachedFiles : null,
      );

      _controller.clear();
      setState(() => _attachedFiles.clear());
      _userHasScrolledUp = false;
      _scrollToBottom();
      return;
    }

    // OpenCode mode
    // Feature 2: Check if this is a slash command (attachments not supported for commands)
    if (text.startsWith('/') && !hasAttachments) {
      final parts = text.substring(1).split(' ');
      final commandName = parts[0];
      final arguments = parts.length > 1 ? parts.sublist(1).join(' ') : '';

      // Show user's command in chat
      chat.appendUserMessage(text);

      // Execute the command
      bridge.executeCommand(
        sessionId: widget.session.id,
        command: commandName,
        arguments: arguments,
        projectPath: widget.project.path,
        agent: messageAgent,
        model: selectedModel != null
            ? '${selectedModel.providerID}/${selectedModel.modelID}'
            : null,
      );
    } else {
      // Build display message with file attachments
      // For images: show "[Image 1]" instead of raw filename
      // For files: show the @path
      String displayText = text;
      if (hasAttachments) {
        final attachmentLabels = <String>[];
        int imageCount = 0;
        for (final f in _attachedFiles) {
          if (f.isImage) {
            imageCount++;
            attachmentLabels.add('[Image $imageCount]');
          } else {
            attachmentLabels.add(f.displayPath);
          }
        }
        if (attachmentLabels.isNotEmpty) {
          displayText = '$text\n${attachmentLabels.join(' ')}';
        }
      }
      final clientMessageId = _newClientMessageId();
      chat.appendUserMessage(displayText, messageId: clientMessageId);

      // Get disabled tools from settings
      final toolSettings = ref.read(toolSettingsProvider);
      final disabledTools = toolSettings.disabledTools.toList();

      bridge.sendChat(
        sessionId: widget.session.id,
        content: text,
        messageId: clientMessageId,
        projectPath: widget.project.path,
        providerID: selectedModel?.providerID,
        modelID: selectedModel?.modelID,
        agent: messageAgent,
        disabledTools: disabledTools.isNotEmpty ? disabledTools : null,
        fileAttachments: hasAttachments ? _attachedFiles : null,
      );
    }

    _controller.clear();
    setState(() => _attachedFiles.clear());
    // User sent a message - they want to see the response, so reset scroll intent
    _userHasScrolledUp = false;
    _scrollToBottom();
  }

  void _scrollToBottom({bool animate = true}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      if (animate) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      } else {
        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      }
    });
  }

  // PERF: Separate method that takes just the permissions list, used with select()
  void _maybeShowPermissionPromptFromList(List<PermissionRequest> permissions) {
    if (permissions.isEmpty) {
      _activePermissionId = null;
      return;
    }

    final request = permissions.first;
    if (_activePermissionId == request.id) return;

    _activePermissionId = request.id;
    _haptics.mediumImpact();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) {
          final isCodex = widget.isCodex;
          final alwaysLabel = isCodex ? 'Session' : 'Always';
          VoidCallback? onExecpolicy;
          String? execpolicyLabel;
          if (isCodex) {
            final method = request.metadata['method'] as String?;
            final proposed = request.metadata['proposedExecpolicyAmendment'];
            if (method == 'item/commandExecution/requestApproval' &&
                proposed is List) {
              final prefix = proposed
                  .whereType<String>()
                  .take(3)
                  .toList()
                  .join(' ');
              if (prefix.isNotEmpty) {
                execpolicyLabel = 'Always allow "$prefix…"';
                onExecpolicy = () => _respondToPermission(
                  request,
                  'execpolicy',
                  execpolicyAmendment: proposed,
                );
              }
            }
          }
          return PermissionPrompt(
            request: request,
            onApprove: () => _respondToPermission(request, 'once'),
            onDeny: () => _respondToPermission(request, 'reject'),
            onAlwaysAllow: () => _respondToPermission(request, 'always'),
            approveAlwaysLabel: alwaysLabel,
            onApproveWithExecpolicy: onExecpolicy,
            approveWithExecpolicyLabel: execpolicyLabel,
            onDenyWithMessage: (message) =>
                _respondToPermission(request, 'reject', message: message),
          );
        },
      ).whenComplete(() => _activePermissionId = null);
    });
  }

  void _maybeShowQuestionPrompt(QuestionRequest? request) {
    if (!widget.isOpenCode) return;
    if (request == null || request.id.isEmpty) {
      _activeQuestionId = null;
      return;
    }
    if (_activeQuestionId == request.id) return;

    _activeQuestionId = request.id;
    _haptics.mediumImpact();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) {
          return QuestionPromptSheet(
            request: request,
            onReply: (answers) async {
              try {
                await ref
                    .read(chatSessionProvider.notifier)
                    .replyToPendingQuestion(answers);
              } finally {
                if (mounted) Navigator.pop(context);
              }
            },
            onReject: () async {
              try {
                await ref
                    .read(chatSessionProvider.notifier)
                    .rejectPendingQuestion();
              } finally {
                if (mounted) Navigator.pop(context);
              }
            },
          );
        },
      ).whenComplete(() => _activeQuestionId = null);
    });
  }

  void _respondToPermission(
    PermissionRequest request,
    String response, {
    String? message,
    Object? execpolicyAmendment,
  }) {
    final bridge = ref.read(bridgeServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);
    if (widget.isClaudeCode) {
      bridge.ccRespondToPermission(
        sessionId: request.sessionId,
        toolUseId: request.id,
        response: response,
      );
    } else if (widget.isCodex) {
      bridge.cxRespondToPermission(
        requestId: request.id,
        response: response,
        execpolicyAmendment: execpolicyAmendment,
      );
    } else {
      bridge.respondToPermission(
        sessionId: request.sessionId,
        permissionId: request.id,
        response: response,
        message: message,
        projectPath: widget.project.path,
      );
    }
    chat.resolvePermission(request.id);
    Navigator.pop(context);
  }
}

// Floating header - simplified and compact
class _FloatingHeader extends StatelessWidget {
  const _FloatingHeader({
    required this.projectName,
    required this.isConnected,
    required this.currentModel,
    this.rttMs,
    required this.onBack,
    this.onModelTap,
    this.onMenu,
    this.onOpenSidebar,
    this.currentAgent,
    this.agents = const [],
    this.onAgentChanged,
    this.vcsInfo,
    this.isSessionShared = false,
    this.isCompacting = false,
    this.sessionStatus = const SessionStatus.idle(),
    this.isStreaming = false,
    this.isClaudeCode = false,
    this.ccModel,
    this.isCodex = false,
    this.codexModel,
  });

  final String projectName;
  final bool isConnected;
  final SelectedModel? currentModel;
  final int? rttMs;
  final VoidCallback onBack;
  final VoidCallback? onModelTap;
  final void Function(String)? onMenu;
  final VoidCallback? onOpenSidebar;
  final String? currentAgent;
  final List<Agent> agents;
  final void Function(String?)? onAgentChanged;
  final VcsInfo? vcsInfo;
  final bool isSessionShared;
  final bool isCompacting;
  final SessionStatus sessionStatus;
  final bool isStreaming;
  // Claude Code support
  final bool isClaudeCode;
  final String? ccModel;
  // Codex support
  final bool isCodex;
  final String? codexModel;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final kMuted = theme.textMuted;
    final kOnBackground = theme.text;

    // Get current agent for display
    final primaryAgents = agents.where((a) => a.isPrimary).toList();
    final current = primaryAgents.isNotEmpty
        ? primaryAgents.firstWhere(
            (a) => a.name == currentAgent,
            orElse: () => primaryAgents.first,
          )
        : null;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      padding: EdgeInsets.fromLTRB(
        12,
        MediaQuery.of(context).padding.top + 3,
        12,
        isStreaming ? 1 : 5,
      ),
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 200),
        opacity: isStreaming ? 0.6 : 1.0,
        child: Row(
          children: [
            // Back button
            _GlassPill(
              onTap: onBack,
              child: Icon(
                Icons.arrow_back_rounded,
                color: kOnBackground,
                size: 22,
              ),
            ),
            const SizedBox(width: 8),

            // Combined: Project + Agent (main pill)
            Expanded(
              child: _GlassPill(
                onTap: onAgentChanged != null && agents.isNotEmpty
                    ? () => _showAgentPicker(context)
                    : null,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Status dot
                    _StatusIndicator(
                      isConnected: isConnected,
                      sessionStatus: sessionStatus,
                    ),
                    const SizedBox(width: 8),
                    // Project name (compact)
                    Flexible(
                      child: Text(
                        projectName,
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                          color: kOnBackground,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    // Claude Code badge
                    if (isClaudeCode) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: theme.accent.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.terminal_rounded,
                              size: 10,
                              color: theme.accent,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              'CC',
                              style: TextStyle(
                                color: theme.accent,
                                fontSize: 9,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    // Agent indicator (OpenCode only)
                    if (!isClaudeCode && current != null) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        child: Text(
                          '•',
                          style: TextStyle(
                            color: kMuted.withValues(alpha: 0.5),
                            fontSize: 10,
                          ),
                        ),
                      ),
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: current.displayColor,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        current.displayName,
                        style: TextStyle(
                          fontSize: 12,
                          color: kOnBackground,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      Icon(
                        Icons.keyboard_arrow_down_rounded,
                        size: 16,
                        color: kMuted.withValues(alpha: 0.6),
                      ),
                    ],
                  ],
                ),
              ),
            ),

            const SizedBox(width: 8),

            // Menu button (contains all secondary options)
            // For Claude Code: bottom sheet menu
            if (isClaudeCode && onMenu != null)
              _GlassPill(
                compact: true,
                constraints: const BoxConstraints(maxWidth: 32, maxHeight: 32),
                child: GestureDetector(
                  onTap: () => _showClaudeCodeActionsSheet(
                    context,
                    theme: theme,
                    isConnected: isConnected,
                    rttMs: rttMs,
                    ccModel: ccModel,
                    onMenu: onMenu!,
                  ),
                  child: Icon(
                    Icons.more_horiz_rounded,
                    color: kOnBackground,
                    size: 18,
                  ),
                ),
              )
            // For Codex: bottom sheet menu
            else if (isCodex && onMenu != null)
              _GlassPill(
                compact: true,
                constraints: const BoxConstraints(maxWidth: 32, maxHeight: 32),
                child: GestureDetector(
                  onTap: () => _showCodexActionsSheet(
                    context,
                    theme: theme,
                    isConnected: isConnected,
                    rttMs: rttMs,
                    codexModel: codexModel,
                    onMenu: onMenu!,
                  ),
                  child: Icon(
                    Icons.more_horiz_rounded,
                    color: kOnBackground,
                    size: 18,
                  ),
                ),
              )
            // For OpenCode: bottom sheet menu
            else if (onMenu != null)
              _GlassPill(
                compact: true,
                constraints: const BoxConstraints(maxWidth: 32, maxHeight: 32),
                child: GestureDetector(
                  onTap: () => _showSessionActionsSheet(
                    context,
                    theme: theme,
                    vcsInfo: vcsInfo,
                    isConnected: isConnected,
                    rttMs: rttMs,
                    currentModel: currentModel,
                    onModelTap: onModelTap,
                    isSessionShared: isSessionShared,
                    isCompacting: isCompacting,
                    onMenu: onMenu!,
                    onOpenSidebar: onOpenSidebar,
                  ),
                  child: Icon(
                    Icons.more_horiz_rounded,
                    color: kOnBackground,
                    size: 18,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _showAgentPicker(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final primaryAgents = agents.where((a) => a.isPrimary).toList();

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Select Agent',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: theme.text,
              ),
            ),
            const SizedBox(height: 16),
            for (final agent in primaryAgents)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: agent.displayColor,
                    shape: BoxShape.circle,
                  ),
                ),
                title: Text(
                  agent.displayName,
                  style: TextStyle(
                    color: theme.text,
                    fontWeight: agent.name == currentAgent
                        ? FontWeight.w600
                        : FontWeight.w400,
                  ),
                ),
                subtitle: Text(
                  agent.shortDescription,
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                ),
                trailing: agent.name == currentAgent
                    ? Icon(Icons.check_rounded, color: theme.success, size: 20)
                    : null,
                onTap: () {
                  onAgentChanged?.call(agent.name);
                  Navigator.pop(context);
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  void _showSessionActionsSheet(
    BuildContext context, {
    required OpenCodeTheme theme,
    required VcsInfo? vcsInfo,
    required bool isConnected,
    required int? rttMs,
    required SelectedModel? currentModel,
    required VoidCallback? onModelTap,
    required bool isSessionShared,
    required bool isCompacting,
    required void Function(String) onMenu,
    VoidCallback? onOpenSidebar,
  }) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) => _SessionActionsSheet(
        theme: theme,
        vcsInfo: vcsInfo,
        isConnected: isConnected,
        rttMs: rttMs,
        currentModel: currentModel,
        onModelTap: onModelTap,
        isSessionShared: isSessionShared,
        isCompacting: isCompacting,
        onOpenSidebar: onOpenSidebar,
        onAction: (action) {
          Navigator.pop(ctx);
          onMenu(action);
        },
      ),
    );
  }

  void _showClaudeCodeActionsSheet(
    BuildContext context, {
    required OpenCodeTheme theme,
    required bool isConnected,
    required int? rttMs,
    required String? ccModel,
    required void Function(String) onMenu,
  }) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) => _ClaudeCodeActionsSheet(
        theme: theme,
        isConnected: isConnected,
        rttMs: rttMs,
        ccModel: ccModel,
        onAction: (action) {
          Navigator.pop(ctx);
          onMenu(action);
        },
      ),
    );
  }

  void _showCodexActionsSheet(
    BuildContext context, {
    required OpenCodeTheme theme,
    required bool isConnected,
    required int? rttMs,
    required String? codexModel,
    required void Function(String) onMenu,
  }) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) => _CodexActionsSheet(
        theme: theme,
        isConnected: isConnected,
        rttMs: rttMs,
        codexModel: codexModel,
        onAction: (action) {
          Navigator.pop(ctx);
          onMenu(action);
        },
      ),
    );
  }
}

/// Clean session actions bottom sheet
class _SessionActionsSheet extends StatelessWidget {
  const _SessionActionsSheet({
    required this.theme,
    required this.vcsInfo,
    required this.isConnected,
    required this.rttMs,
    required this.currentModel,
    required this.onModelTap,
    required this.isSessionShared,
    required this.isCompacting,
    required this.onAction,
    this.onOpenSidebar,
  });

  final OpenCodeTheme theme;
  final VcsInfo? vcsInfo;
  final bool isConnected;
  final int? rttMs;
  final SelectedModel? currentModel;
  final VoidCallback? onModelTap;
  final bool isSessionShared;
  final bool isCompacting;
  final void Function(String) onAction;
  final VoidCallback? onOpenSidebar;

  String _getModelName(SelectedModel? model) {
    if (model == null) return 'Auto';
    final parts = model.modelID.split('-');
    if (parts.contains('opus')) return 'Opus';
    if (parts.contains('sonnet')) return 'Sonnet';
    if (parts.contains('haiku')) return 'Haiku';
    if (parts.contains('gpt')) return 'GPT';
    return model.modelID.length > 8
        ? model.modelID.substring(0, 8)
        : model.modelID;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: theme.background,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle bar
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.borderSubtle,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // Status bar (branch, latency, model)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
              child: Row(
                children: [
                  // Branch info
                  if (vcsInfo != null && vcsInfo!.isAvailable) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: theme.success.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.call_split_rounded,
                            size: 14,
                            color: theme.success,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            vcsInfo!.branch ?? 'main',
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.success,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],

                  // Latency
                  if (isConnected && rttMs != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: theme.info.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.speed_rounded,
                            size: 14,
                            color: theme.info,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            '${rttMs}ms',
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.info,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],

                  const Spacer(),

                  // Model selector
                  GestureDetector(
                    onTap: () {
                      Navigator.pop(context);
                      onModelTap?.call();
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: theme.primary.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.auto_awesome_rounded,
                            size: 14,
                            color: theme.primary,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _getModelName(currentModel),
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.primary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Icon(
                            Icons.chevron_right_rounded,
                            size: 16,
                            color: theme.primary,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Divider
            Divider(color: theme.borderSubtle, height: 1),

            // Session actions
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Session section
                  Text(
                    'SESSION',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _ActionTile(
                        icon: Icons.info_outline_rounded,
                        label: 'Info',
                        theme: theme,
                        onTap: () {
                          Navigator.pop(context);
                          // Delay to allow bottom sheet to close first
                          Future.delayed(
                            const Duration(milliseconds: 150),
                            () => onOpenSidebar?.call(),
                          );
                        },
                      ),
                      const SizedBox(width: 10),
                      _ActionTile(
                        icon: Icons.add_rounded,
                        label: 'New',
                        theme: theme,
                        onTap: () => onAction('new_session'),
                      ),
                      const SizedBox(width: 10),
                      _ActionTile(
                        icon: Icons.call_split_rounded,
                        label: 'Fork',
                        theme: theme,
                        onTap: () => onAction('fork'),
                      ),
                      const SizedBox(width: 10),
                      _ActionTile(
                        icon: isSessionShared
                            ? Icons.link_off
                            : Icons.share_rounded,
                        label: isSessionShared ? 'Unshare' : 'Share',
                        theme: theme,
                        onTap: () =>
                            onAction(isSessionShared ? 'unshare' : 'share'),
                      ),
                    ],
                  ),

                  const SizedBox(height: 20),

                  // Tools section
                  Text(
                    'TOOLS',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _ActionRow(
                    icon: Icons.compress_rounded,
                    label: isCompacting ? 'Compacting...' : 'Compact',
                    subtitle: 'Summarize context to free space',
                    theme: theme,
                    enabled: !isCompacting,
                    onTap: () => onAction('compact'),
                  ),
                  const SizedBox(height: 8),
                  _ActionRow(
                    icon: Icons.auto_fix_high_rounded,
                    label: 'Initialize Project',
                    subtitle: 'Create AGENTS.md for this project',
                    theme: theme,
                    color: theme.success,
                    onTap: () => onAction('init'),
                  ),

                  const SizedBox(height: 20),

                  // Danger zone
                  Text(
                    'DANGER ZONE',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.error.withValues(alpha: 0.7),
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _ActionRow(
                    icon: Icons.undo_rounded,
                    label: 'Undo Last Changes',
                    subtitle: 'Revert recent file modifications',
                    theme: theme,
                    color: theme.warning,
                    onTap: () => onAction('undo'),
                  ),
                  const SizedBox(height: 8),
                  _ActionRow(
                    icon: Icons.cleaning_services_outlined,
                    label: 'Clear Instance',
                    subtitle: 'Reset project context completely',
                    theme: theme,
                    color: theme.warning,
                    onTap: () => onAction('clear_instance'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Square action tile for grid layout
class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.label,
    required this.theme,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 22, color: theme.text),
              const SizedBox(height: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  color: theme.text,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Row action item for list layout
class _ActionRow extends StatelessWidget {
  const _ActionRow({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.theme,
    required this.onTap,
    this.color,
    this.enabled = true,
  });

  final IconData icon;
  final String label;
  final String subtitle;
  final OpenCodeTheme theme;
  final VoidCallback onTap;
  final Color? color;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final effectiveColor = enabled ? (color ?? theme.text) : theme.textMuted;

    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: effectiveColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, size: 18, color: effectiveColor),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 14,
                      color: effectiveColor,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: TextStyle(fontSize: 12, color: theme.textMuted),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, size: 20, color: theme.textMuted),
          ],
        ),
      ),
    );
  }
}

/// Claude Code actions bottom sheet
class _ClaudeCodeActionsSheet extends StatelessWidget {
  const _ClaudeCodeActionsSheet({
    required this.theme,
    required this.isConnected,
    required this.rttMs,
    required this.ccModel,
    required this.onAction,
  });

  final OpenCodeTheme theme;
  final bool isConnected;
  final int? rttMs;
  final String? ccModel;
  final void Function(String) onAction;

  String _getModelName(String? model) {
    if (model == null || model.isEmpty) return 'Claude';
    final m = model.toLowerCase();
    if (m.contains('opus')) return 'Opus';
    if (m.contains('sonnet')) return 'Sonnet';
    if (m.contains('haiku')) return 'Haiku';
    return model.length > 12 ? '${model.substring(0, 12)}...' : model;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: theme.background,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle bar
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.borderSubtle,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // Status bar (latency, model)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
              child: Row(
                children: [
                  // Latency
                  if (isConnected && rttMs != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: theme.info.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.speed_rounded,
                            size: 14,
                            color: theme.info,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            '${rttMs}ms',
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.info,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  const Spacer(),

                  // Model selector (onAction handles Navigator.pop)
                  GestureDetector(
                    onTap: () => onAction('cc_model'),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: theme.accent.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.auto_awesome_rounded,
                            size: 14,
                            color: theme.accent,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _getModelName(ccModel),
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.accent,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Icon(
                            Icons.chevron_right_rounded,
                            size: 16,
                            color: theme.accent,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Divider
            Divider(color: theme.borderSubtle, height: 1),

            // Actions
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Configuration section
                  Text(
                    'CONFIGURATION',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _ActionTile(
                        icon: Icons.tune_rounded,
                        label: 'Tools',
                        theme: theme,
                        onTap: () => onAction('cc_tools'),
                      ),
                      const SizedBox(width: 10),
                      _ActionTile(
                        icon: Icons.bolt_rounded,
                        label: 'Commands',
                        theme: theme,
                        onTap: () => onAction('cc_commands'),
                      ),
                      const SizedBox(width: 10),
                      _ActionTile(
                        icon: Icons.auto_awesome_rounded,
                        label: 'Skills',
                        theme: theme,
                        onTap: () => onAction('cc_skills'),
                      ),
                      const SizedBox(width: 10),
                      _ActionTile(
                        icon: Icons.link_rounded,
                        label: 'Hooks',
                        theme: theme,
                        onTap: () => onAction('cc_hooks'),
                      ),
                    ],
                  ),

                  const SizedBox(height: 20),

                  // Integration section
                  Text(
                    'INTEGRATION',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _ActionRow(
                    icon: Icons.hub_rounded,
                    label: 'MCP Servers',
                    subtitle: 'Configure Model Context Protocol servers',
                    theme: theme,
                    onTap: () => onAction('cc_mcp'),
                  ),

                  const SizedBox(height: 20),

                  // Session section
                  Text(
                    'SESSION',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _ActionRow(
                    icon: Icons.call_split_rounded,
                    label: 'Fork Session',
                    subtitle: 'Create a new branch from current conversation',
                    theme: theme,
                    onTap: () => onAction('cc_fork'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Codex actions bottom sheet
class _CodexActionsSheet extends StatelessWidget {
  const _CodexActionsSheet({
    required this.theme,
    required this.isConnected,
    required this.rttMs,
    required this.codexModel,
    required this.onAction,
  });

  final OpenCodeTheme theme;
  final bool isConnected;
  final int? rttMs;
  final String? codexModel;
  final void Function(String) onAction;

  String _getModelName(String? model) {
    if (model == null || model.isEmpty) return 'Default';
    final m = model.toLowerCase();
    if (m.contains('o1')) return 'o1';
    if (m.contains('o3')) return 'o3';
    if (m.contains('gpt-4')) return 'GPT-4';
    return model.length > 12 ? '${model.substring(0, 12)}...' : model;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: theme.background,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle bar
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.borderSubtle,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // Status bar (latency, model)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
              child: Row(
                children: [
                  // Latency
                  if (isConnected && rttMs != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: theme.info.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.speed_rounded,
                            size: 14,
                            color: theme.info,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            '${rttMs}ms',
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.info,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  const Spacer(),

                  // Model selector (onAction handles Navigator.pop)
                  GestureDetector(
                    onTap: () => onAction('cx_model'),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: theme.primary.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.auto_awesome_rounded,
                            size: 14,
                            color: theme.primary,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _getModelName(codexModel),
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.primary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Icon(
                            Icons.chevron_right_rounded,
                            size: 16,
                            color: theme.primary,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Divider
            Divider(color: theme.borderSubtle, height: 1),

            // Actions
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Configuration section
                  Text(
                    'CONFIGURATION',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _ActionTile(
                        icon: Icons.tune_rounded,
                        label: 'Settings',
                        theme: theme,
                        onTap: () => onAction('cx_settings'),
                      ),
                      const SizedBox(width: 10),
                      _ActionTile(
                        icon: Icons.auto_awesome_rounded,
                        label: 'Skills',
                        theme: theme,
                        onTap: () => onAction('cx_skills'),
                      ),
                      const SizedBox(width: 10),
                      _ActionTile(
                        icon: Icons.hub_rounded,
                        label: 'MCP',
                        theme: theme,
                        onTap: () => onAction('cx_mcp'),
                      ),
                      const SizedBox(width: 10),
                      _ActionTile(
                        icon: Icons.verified_user_rounded,
                        label: 'Auth',
                        theme: theme,
                        onTap: () => onAction('cx_auth'),
                      ),
                    ],
                  ),

                  const SizedBox(height: 20),

                  // Project section
                  Text(
                    'PROJECT',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _ActionRow(
                    icon: Icons.description_outlined,
                    label: 'AGENTS.md',
                    subtitle: 'Edit project agent instructions',
                    theme: theme,
                    onTap: () => onAction('cx_agents'),
                  ),
                  const SizedBox(height: 8),
                  _ActionRow(
                    icon: Icons.toc_rounded,
                    label: 'Config',
                    subtitle: 'View and edit Codex configuration',
                    theme: theme,
                    onTap: () => onAction('cx_config'),
                  ),

                  const SizedBox(height: 20),

                  // Actions section
                  Text(
                    'ACTIONS',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _ActionRow(
                          icon: Icons.rate_review_rounded,
                          label: 'Review',
                          subtitle: 'Review pending changes',
                          theme: theme,
                          onTap: () => onAction('cx_review'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  _ActionRow(
                    icon: Icons.feedback_outlined,
                    label: 'Feedback',
                    subtitle: 'Send feedback to Codex team',
                    theme: theme,
                    onTap: () => onAction('cx_feedback'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// Glass pill widget for header elements
// FIX: Removed expensive BackdropFilter - uses simple semi-transparent background instead
// BackdropFilter causes severe frame drops during scrolling as it rasterizes everything behind it
class _GlassPill extends StatelessWidget {
  const _GlassPill({
    required this.child,
    this.onTap,
    this.compact = false,
    this.constraints,
  });

  final Widget child;
  final VoidCallback? onTap;
  final bool compact;
  final BoxConstraints? constraints;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final kCard = theme.backgroundPanel;
    final borderRadius = BorderRadius.circular(compact ? 16 : 20);

    // FIX: Simple semi-transparent container instead of expensive BackdropFilter
    // The visual difference is minimal but performance improvement is significant
    return GestureDetector(
      onTap: onTap,
      child: Container(
        constraints: constraints,
        padding: compact
            ? const EdgeInsets.all(6)
            : const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          // Slightly higher opacity to compensate for lack of blur
          color: kCard.withValues(alpha: 0.85),
          borderRadius: borderRadius,
          // Add subtle border for definition
          border: Border.all(
            color: theme.border.withValues(alpha: 0.3),
            width: 0.5,
          ),
        ),
        child: child,
      ),
    );
  }
}

// Floating input bar with streaming mode support
class _FloatingInputBar extends ConsumerWidget {
  const _FloatingInputBar({
    required this.controller,
    required this.focusNode,
    required this.onSend,
    required this.isBusy,
    required this.canSend,
    this.isOfflineMode = false,
    this.attachedFiles = const [],
    this.onRemoveAttachment,
    this.showFileAutocomplete = false,
    this.onFileSelect,
    this.onAttachTap,
    this.attachIcon = Icons.add_rounded,
    this.agents = const [],
    this.currentAgent,
    this.onAgentChanged,
    // OpenCode Plan Mode (SDK v1.1.18+)
    this.isOpenCode = false,
    this.ocPlanMode = false,
    this.onPlanModeToggle,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onSend;
  final bool isBusy;
  final bool canSend;
  final bool isOfflineMode;
  final List<FileAttachment> attachedFiles;
  final void Function(FileAttachment)? onRemoveAttachment;
  final bool showFileAutocomplete;
  final void Function(FileAttachment)? onFileSelect;
  final VoidCallback? onAttachTap;
  final IconData attachIcon;
  final List<Agent> agents;
  final String? currentAgent;
  final void Function(String?)? onAgentChanged;
  // OpenCode Plan Mode (SDK v1.1.18+)
  final bool isOpenCode;
  final bool ocPlanMode;
  final VoidCallback? onPlanModeToggle;

  void _showFloatingInputMenu(BuildContext context, OpenCodeTheme theme) {
    final primaryAgents = agents.where((a) => a.isPrimary).toList();

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => _FloatingInputMenuSheet(
        theme: theme,
        agents: primaryAgents,
        currentAgent: currentAgent,
        onAgentChanged: onAgentChanged,
        onAttachTap: onAttachTap,
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final kCard = theme.backgroundPanel;
    final kMuted = theme.textMuted;
    final kOnBackground = theme.text;
    final kBackground = theme.background;

    // During streaming, hide the input bar completely
    // (Stop button is shown separately)
    return AnimatedSlide(
      duration: const Duration(milliseconds: 200),
      offset: isBusy ? const Offset(0, 1) : Offset.zero,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 150),
        opacity: isBusy ? 0.0 : 1.0,
        child: Container(
          color: Colors.transparent,
          child: SafeArea(
            top: false,
            minimum: const EdgeInsets.only(bottom: 3),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // File autocomplete dropdown (appears above input)
                if (onFileSelect != null)
                  Visibility(
                    visible: showFileAutocomplete,
                    maintainState: true,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                      child: FileAutocomplete(
                        visible: showFileAutocomplete,
                        onSelect: onFileSelect!,
                      ),
                    ),
                  ),

                // Attached files chips row
                if (onRemoveAttachment != null)
                  Visibility(
                    visible: attachedFiles.isNotEmpty,
                    maintainState: true,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                      child: AttachedFilesChips(
                        attachments: attachedFiles,
                        onRemove: onRemoveAttachment!,
                      ),
                    ),
                  ),

                // Main input row
                Padding(
                  key: const ValueKey('floating-input-row'),
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      // Menu button - shows agent/permission options when agents available, otherwise attach options
                      GestureDetector(
                        onTap: agents.isNotEmpty
                            ? () => _showFloatingInputMenu(context, theme)
                            : onAttachTap,
                        child: Container(
                          height: 42,
                          width: 42,
                          margin: const EdgeInsets.only(right: 8),
                          decoration: BoxDecoration(
                            color: kCard,
                            borderRadius: BorderRadius.circular(21),
                            border: Border.all(color: fade(kMuted, 0.2)),
                          ),
                          child: Center(
                            child: Icon(
                              agents.isNotEmpty
                                  ? Icons.tune_rounded
                                  : attachIcon,
                              color: kOnBackground,
                              size: 22,
                            ),
                          ),
                        ),
                      ),
                      // OpenCode Plan Mode toggle chip (SDK v1.1.18+)
                      if (isOpenCode && onPlanModeToggle != null)
                        GestureDetector(
                          onTap: onPlanModeToggle,
                          child: Container(
                            height: 32,
                            margin: const EdgeInsets.only(right: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 10),
                            decoration: BoxDecoration(
                              color: ocPlanMode
                                  ? theme.warning.withValues(alpha: 0.15)
                                  : kCard,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: ocPlanMode
                                    ? theme.warning.withValues(alpha: 0.4)
                                    : fade(kMuted, 0.2),
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  ocPlanMode
                                      ? Icons.lightbulb_outline_rounded
                                      : Icons.build_rounded,
                                  size: 14,
                                  color: ocPlanMode ? theme.warning : kMuted,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  ocPlanMode ? 'Plan' : 'Build',
                                  style: TextStyle(
                                    color: ocPlanMode ? theme.warning : kMuted,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      // Prompt bar container
                      Expanded(
                        child: Container(
                          constraints: const BoxConstraints(minHeight: 42),
                          decoration: BoxDecoration(
                            color: kCard,
                            borderRadius: BorderRadius.circular(22),
                            border: Border.all(color: fade(kMuted, 0.2)),
                          ),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 4,
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              // Text input
                              Expanded(
                                child: TextField(
                                  controller: controller,
                                  focusNode: focusNode,
                                  enabled: !isOfflineMode && !isBusy,
                                  minLines: 1,
                                  maxLines: 5,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w400,
                                    color: kOnBackground,
                                    fontSize: 15,
                                  ),
                                  decoration: InputDecoration(
                                    hintText: isOfflineMode
                                        ? 'Offline mode - read only'
                                        : 'Ask AI to edit code...',
                                    filled: false,
                                    border: InputBorder.none,
                                    enabledBorder: InputBorder.none,
                                    focusedBorder: InputBorder.none,
                                    disabledBorder: InputBorder.none,
                                    errorBorder: InputBorder.none,
                                    focusedErrorBorder: InputBorder.none,
                                    hintStyle: TextStyle(
                                      color: isOfflineMode
                                          ? theme.warning
                                          : kMuted.withValues(alpha: 0.6),
                                      fontWeight: FontWeight.w400,
                                      fontSize: 15,
                                    ),
                                    contentPadding: const EdgeInsets.symmetric(
                                      horizontal: 0,
                                      vertical: 10,
                                    ),
                                    isDense: true,
                                  ),
                                  onSubmitted: canSend ? (_) => onSend() : null,
                                ),
                              ),
                              const SizedBox(width: 8),
                              // Send button
                              GestureDetector(
                                onTap: canSend ? onSend : null,
                                child: Container(
                                  width: 30,
                                  height: 30,
                                  decoration: BoxDecoration(
                                    color: canSend
                                        ? kOnBackground
                                        : fade(kMuted, 0.1),
                                    borderRadius: BorderRadius.circular(15),
                                  ),
                                  child: Center(
                                    child: Icon(
                                      Icons.arrow_upward_rounded,
                                      color: canSend ? kBackground : kMuted,
                                      size: 16,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Bottom sheet menu for floating input bar with agent selection and quick actions
class _FloatingInputMenuSheet extends ConsumerStatefulWidget {
  const _FloatingInputMenuSheet({
    required this.theme,
    required this.agents,
    this.currentAgent,
    this.onAgentChanged,
    this.onAttachTap,
  });

  final OpenCodeTheme theme;
  final List<Agent> agents;
  final String? currentAgent;
  final void Function(String?)? onAgentChanged;
  final VoidCallback? onAttachTap;

  @override
  ConsumerState<_FloatingInputMenuSheet> createState() =>
      _FloatingInputMenuSheetState();
}

class _FloatingInputMenuSheetState
    extends ConsumerState<_FloatingInputMenuSheet> {
  @override
  Widget build(BuildContext context) {
    final rulesState = ref.watch(permissionRulesProvider);
    final selectedPreset = rulesState.preset;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: widget.theme.backgroundPanel,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Handle bar
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: widget.theme.borderSubtle,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Quick actions row
          Row(
            children: [
              Icon(
                Icons.flash_on_rounded,
                color: widget.theme.textMuted,
                size: 16,
              ),
              const SizedBox(width: 8),
              Text(
                'Quick Actions',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: widget.theme.textMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _QuickActionChip(
                icon: Icons.attach_file_rounded,
                label: 'Attach File',
                theme: widget.theme,
                onTap: () {
                  Navigator.pop(context);
                  widget.onAttachTap?.call();
                },
              ),
              _QuickActionChip(
                icon: Icons.camera_alt_outlined,
                label: 'Take Photo',
                theme: widget.theme,
                onTap: () {
                  Navigator.pop(context);
                  // TODO: Trigger camera
                },
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Agent section
          if (widget.agents.isNotEmpty) ...[
            Divider(color: widget.theme.borderSubtle),
            const SizedBox(height: 16),
            Row(
              children: [
                Icon(
                  Icons.smart_toy_outlined,
                  color: widget.theme.textMuted,
                  size: 16,
                ),
                const SizedBox(width: 8),
                Text(
                  'Agent',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: widget.theme.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 36,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: widget.agents.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final agent = widget.agents[index];
                  final isSelected = agent.name == widget.currentAgent;
                  return GestureDetector(
                    onTap: () {
                      widget.onAgentChanged?.call(agent.name);
                      Navigator.pop(context);
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? agent.displayColor.withValues(alpha: 0.15)
                            : widget.theme.backgroundElement,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(
                          color: isSelected
                              ? agent.displayColor
                              : widget.theme.borderSubtle,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: agent.displayColor,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            agent.displayName,
                            style: TextStyle(
                              color: isSelected
                                  ? agent.displayColor
                                  : widget.theme.text,
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Permission preset section
          Divider(color: widget.theme.borderSubtle),
          const SizedBox(height: 16),
          Row(
            children: [
              Icon(
                Icons.security_outlined,
                color: widget.theme.textMuted,
                size: 16,
              ),
              const SizedBox(width: 8),
              Text(
                'Permission Preset',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: widget.theme.textMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 56,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: PermissionPreset.values.length - 1, // Exclude custom
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final preset = PermissionPreset.values[index];
                if (preset == PermissionPreset.custom) {
                  return const SizedBox.shrink();
                }
                final isSelected = preset == selectedPreset;
                return GestureDetector(
                  onTap: () {
                    ref
                        .read(permissionRulesProvider.notifier)
                        .setPreset(preset);
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? widget.theme.primary.withValues(alpha: 0.15)
                          : widget.theme.backgroundElement,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isSelected
                            ? widget.theme.primary
                            : widget.theme.borderSubtle,
                      ),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          preset.displayName,
                          style: TextStyle(
                            color: isSelected
                                ? widget.theme.primary
                                : widget.theme.text,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          preset.description,
                          style: TextStyle(
                            color: widget.theme.textMuted,
                            fontSize: 9,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          TextButton.icon(
            onPressed: () {
              Navigator.pop(context);
              showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                backgroundColor: Colors.transparent,
                builder: (context) => PermissionRulesSheet(
                  initialRules: rulesState.effectiveRuleset,
                  onApply: (rules) {
                    ref
                        .read(permissionRulesProvider.notifier)
                        .setCustomRules(rules);
                  },
                ),
              );
            },
            icon: Icon(Icons.tune, size: 16, color: widget.theme.primary),
            label: Text(
              'Custom Rules...',
              style: TextStyle(color: widget.theme.primary, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickActionChip extends StatelessWidget {
  const _QuickActionChip({
    required this.icon,
    required this.label,
    required this.theme,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: theme.backgroundElement,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: theme.text),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: theme.text,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// CLI-style input bar (OpenCode terminal aesthetic)
class _CliStyleInputBar extends StatefulWidget {
  const _CliStyleInputBar({
    required this.controller,
    required this.focusNode,
    required this.onSend,
    required this.isBusy,
    required this.canSend,
    this.isOfflineMode = false,
    this.currentAgent,
    this.agents = const [],
    this.onAgentChanged,
    this.currentModel,
    this.onModelTap,
    this.attachedFiles = const [],
    this.onRemoveAttachment,
    this.showFileAutocomplete = false,
    this.onFileSelect,
    this.onAttachTap,
    this.attachIcon = Icons.add_rounded,
    // Claude Code specific props
    this.isClaudeCode = false,
    this.ccPermissionMode,
    this.ccModel,
    this.onCCModelTap,
    this.onCCPermissionModeTap,
    // Codex specific props
    this.isCodex = false,
    this.codexModel,
    this.onCodexModelTap,
    // Custom accent color (null = use agent/permission mode color)
    this.customAccentColor,
    // OpenCode Plan Mode (SDK v1.1.18+)
    this.isOpenCode = false,
    this.ocPlanMode = false,
    this.onPlanModeToggle,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onSend;
  final bool isBusy;
  final bool canSend;
  final bool isOfflineMode;
  final String? currentAgent;
  final List<Agent> agents;
  final void Function(String?)? onAgentChanged;
  final SelectedModel? currentModel;
  final VoidCallback? onModelTap;
  final List<FileAttachment> attachedFiles;
  final void Function(FileAttachment)? onRemoveAttachment;
  final bool showFileAutocomplete;
  final void Function(FileAttachment)? onFileSelect;
  final VoidCallback? onAttachTap;
  final IconData attachIcon;
  // Claude Code specific props
  final bool isClaudeCode;
  final ClaudeCodePermissionMode? ccPermissionMode;
  final String? ccModel;
  final VoidCallback? onCCModelTap;
  final VoidCallback? onCCPermissionModeTap;
  // Codex specific props
  final bool isCodex;
  final String? codexModel;
  final VoidCallback? onCodexModelTap;
  // Custom accent color (null = use agent/permission mode color)
  final Color? customAccentColor;
  // OpenCode Plan Mode (SDK v1.1.18+)
  final bool isOpenCode;
  final bool ocPlanMode; // true = "plan" mode, false = "build" mode
  final VoidCallback? onPlanModeToggle;

  @override
  State<_CliStyleInputBar> createState() => _CliStyleInputBarState();
}

class _CliStyleInputBarState extends State<_CliStyleInputBar> {
  static const _placeholders = [
    'Fix a TODO in the codebase',
    'What is the tech stack of this project?',
    'Fix broken tests',
    'Explain how authentication works',
    'Find and fix security vulnerabilities',
    'Add unit tests for the user service',
    'Refactor this function to be more readable',
    'Help me debug this issue',
    'Optimize database queries',
    'Add error handling to this function',
  ];

  int _placeholderIndex = 0;
  Timer?
  _placeholderTimer; // FIX: Use cancellable Timer instead of Future.doWhile

  @override
  void initState() {
    super.initState();
    _placeholderIndex = DateTime.now().millisecond % _placeholders.length;
    // FIX: Use periodic Timer that can be cancelled on dispose
    _placeholderTimer = Timer.periodic(const Duration(seconds: 6), (_) {
      if (!mounted) return;
      setState(() {
        _placeholderIndex = (_placeholderIndex + 1) % _placeholders.length;
      });
    });
  }

  @override
  void dispose() {
    _placeholderTimer?.cancel(); // FIX: Cancel timer to prevent memory leak
    super.dispose();
  }

  String _getModelDisplayName(SelectedModel? model) {
    if (model == null) return 'Auto';
    // Try to extract clean model name
    final id = model.modelID;
    if (id.contains('opus')) return 'Claude Opus 4.5 (latest)';
    if (id.contains('sonnet')) return 'Claude Sonnet 4';
    if (id.contains('haiku')) return 'Claude Haiku';
    if (id.contains('gpt-4')) return 'GPT-4';
    if (id.contains('gpt-3')) return 'GPT-3.5';
    return id;
  }

  String _getProviderName(SelectedModel? model) {
    if (model == null) return '';
    final provider = model.providerID.toLowerCase();
    if (provider.contains('anthropic')) return 'Anthropic';
    if (provider.contains('openai')) return 'OpenAI';
    if (provider.contains('google')) return 'Google';
    if (provider.contains('openrouter')) return 'OpenRouter';
    return model.providerID;
  }

  /// Get Claude Code model display name from model string
  String _getCCModelDisplayName(String? model) {
    if (model == null || model.isEmpty) return 'Auto';
    final m = model.toLowerCase();
    if (m.contains('opus')) return 'Opus';
    if (m.contains('sonnet')) return 'Sonnet';
    if (m.contains('haiku')) return 'Haiku';
    if (m == 'auto') return 'Auto';
    // Return just the model part if it's a full model ID
    final parts = model.split('/');
    return parts.last;
  }

  /// Get Codex model display name from model string
  String _getCodexModelDisplayName(String? model) {
    if (model == null || model.isEmpty) return 'gpt-5.2-codex';
    // Keep it short for display
    if (model.length > 16) return '${model.substring(0, 14)}...';
    return model;
  }

  /// Get color for permission mode
  Color _getPermissionModeColor(
    ClaudeCodePermissionMode? mode,
    OpenCodeTheme theme,
  ) {
    switch (mode) {
      case ClaudeCodePermissionMode.defaultMode:
        return theme.primary; // Normal mode - primary color
      case ClaudeCodePermissionMode.acceptEdits:
        return theme.success; // Auto-accept edits - green
      case ClaudeCodePermissionMode.plan:
        return theme.warning; // Plan mode - amber/yellow
      case ClaudeCodePermissionMode.bypassPermissions:
        return theme.error; // Dangerous mode - red
      case null:
        return theme.primary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final agent = _getCurrentAgent();
    // Priority: custom accent color > permission mode color (CC) > agent color (OC)
    final Color agentColor;
    if (widget.customAccentColor != null) {
      agentColor = widget.customAccentColor!;
    } else if (widget.isClaudeCode) {
      agentColor = _getPermissionModeColor(widget.ccPermissionMode, theme);
    } else {
      agentColor = agent?.displayColor ?? theme.primary;
    }

    // During streaming, hide the input bar
    return AnimatedSlide(
      duration: const Duration(milliseconds: 200),
      offset: widget.isBusy ? const Offset(0, 1) : Offset.zero,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 150),
        opacity: widget.isBusy ? 0.0 : 1.0,
        child: Container(
          color: Colors.transparent,
          child: SafeArea(
            top: false,
            bottom: false, // Let the bar touch the screen bottom
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // File autocomplete dropdown (appears above input)
                if (widget.onFileSelect != null)
                  Visibility(
                    visible: widget.showFileAutocomplete,
                    maintainState: true,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(8, 0, 0, 8),
                      child: FileAutocomplete(
                        visible: widget.showFileAutocomplete,
                        onSelect: widget.onFileSelect!,
                      ),
                    ),
                  ),

                // Main CLI input container
                Container(
                  key: const ValueKey('cli-input-container'),
                  margin: EdgeInsets.zero, // Touch screen edges
                  // Use theme background for proper theming
                  decoration: BoxDecoration(
                    color: theme.backgroundElement,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(20),
                      topRight: Radius.circular(20),
                    ),
                  ),
                  child: IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // Glowing accent line on the left - fills full height with rounded top
                        Container(
                          width: 4,
                          decoration: BoxDecoration(
                            color: agentColor,
                            borderRadius: const BorderRadius.only(
                              topLeft: Radius.circular(20),
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: agentColor.withValues(alpha: 0.6),
                                blurRadius: 8,
                                spreadRadius: 1,
                              ),
                            ],
                          ),
                        ),

                        // Main content area
                        Expanded(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Attached files chips row
                              if (widget.onRemoveAttachment != null)
                                Visibility(
                                  visible: widget.attachedFiles.isNotEmpty,
                                  maintainState: true,
                                  child: Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                      12,
                                      8,
                                      12,
                                      0,
                                    ),
                                    child: AttachedFilesChips(
                                      attachments: widget.attachedFiles,
                                      onRemove: widget.onRemoveAttachment!,
                                    ),
                                  ),
                                ),

                              // Text input area
                              Container(
                                constraints: const BoxConstraints(
                                  minHeight: 44,
                                  maxHeight: 140,
                                ),
                                child: TextField(
                                  controller: widget.controller,
                                  focusNode: widget.focusNode,
                                  enabled:
                                      !widget.isOfflineMode && !widget.isBusy,
                                  minLines: 1,
                                  maxLines: 5,
                                  style: TextStyle(
                                    color: theme.text,
                                    fontSize: 14,
                                    height: 1.5,
                                  ),
                                  decoration: InputDecoration(
                                    hintText: widget.isOfflineMode
                                        ? 'Offline mode - read only'
                                        : _placeholders[_placeholderIndex],
                                    filled: false,
                                    border: InputBorder.none,
                                    enabledBorder: InputBorder.none,
                                    focusedBorder: InputBorder.none,
                                    disabledBorder: InputBorder.none,
                                    hintStyle: TextStyle(
                                      color: widget.isOfflineMode
                                          ? theme.warning
                                          : theme.textMuted.withValues(
                                              alpha: 0.4,
                                            ),
                                      fontSize: 14,
                                    ),
                                    contentPadding: const EdgeInsets.fromLTRB(
                                      16,
                                      12,
                                      16,
                                      4,
                                    ),
                                    isDense: true,
                                  ),
                                  onSubmitted: widget.canSend
                                      ? (_) => widget.onSend()
                                      : null,
                                ),
                              ),

                              // Bottom info row - like OpenCode CLI
                              Padding(
                                padding: EdgeInsets.fromLTRB(
                                  16,
                                  0,
                                  12,
                                  MediaQuery.of(context).padding.bottom + 12,
                                ),
                                child: Row(
                                  children: [
                                    // For Claude Code: Permission mode (tappable)
                                    // For OpenCode: Agent name (tappable)
                                    if (widget.isClaudeCode) ...[
                                      GestureDetector(
                                        onTap: widget.onCCPermissionModeTap,
                                        child: Text(
                                          widget
                                                  .ccPermissionMode
                                                  ?.displayName ??
                                              'Default',
                                          style: TextStyle(
                                            color: agentColor,
                                            fontSize: 13,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                    ] else ...[
                                      GestureDetector(
                                        onTap:
                                            widget.onAgentChanged != null &&
                                                widget.agents.isNotEmpty
                                            ? () => _showAgentPicker(context)
                                            : null,
                                        child: Text(
                                          agent?.displayName ?? 'Build',
                                          style: TextStyle(
                                            color: agentColor,
                                            fontSize: 13,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                    ],

                                    // OpenCode Plan Mode toggle chip (SDK v1.1.18+)
                                    if (widget.isOpenCode &&
                                        widget.onPlanModeToggle != null) ...[
                                      const SizedBox(width: 8),
                                      GestureDetector(
                                        onTap: widget.onPlanModeToggle,
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 8,
                                            vertical: 3,
                                          ),
                                          decoration: BoxDecoration(
                                            color: widget.ocPlanMode
                                                ? theme.warning.withValues(
                                                    alpha: 0.15,
                                                  )
                                                : theme.backgroundPanel,
                                            borderRadius: BorderRadius.circular(
                                              12,
                                            ),
                                            border: Border.all(
                                              color: widget.ocPlanMode
                                                  ? theme.warning.withValues(
                                                      alpha: 0.4,
                                                    )
                                                  : theme.borderSubtle,
                                            ),
                                          ),
                                          child: Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              Icon(
                                                widget.ocPlanMode
                                                    ? Icons
                                                          .lightbulb_outline_rounded
                                                    : Icons.build_rounded,
                                                size: 12,
                                                color: widget.ocPlanMode
                                                    ? theme.warning
                                                    : theme.textMuted,
                                              ),
                                              const SizedBox(width: 4),
                                              Text(
                                                widget.ocPlanMode
                                                    ? 'Plan'
                                                    : 'Build',
                                                style: TextStyle(
                                                  color: widget.ocPlanMode
                                                      ? theme.warning
                                                      : theme.textMuted,
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.w500,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
                                    ],

                                    // Separator dot
                                    Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 8,
                                      ),
                                      child: Text(
                                        '·',
                                        style: TextStyle(
                                          color: theme.textMuted.withValues(
                                            alpha: 0.4,
                                          ),
                                          fontSize: 13,
                                        ),
                                      ),
                                    ),

                                    // Model selector (tappable) - different per backend
                                    if (widget.isClaudeCode) ...[
                                      // Claude Code model selector
                                      GestureDetector(
                                        onTap: widget.onCCModelTap,
                                        child: Text(
                                          _getCCModelDisplayName(
                                            widget.ccModel,
                                          ),
                                          style: TextStyle(
                                            color: theme.text,
                                            fontSize: 13,
                                            fontWeight: FontWeight.w500,
                                          ),
                                        ),
                                      ),
                                    ] else if (widget.isCodex) ...[
                                      // Codex model selector
                                      GestureDetector(
                                        onTap: widget.onCodexModelTap,
                                        child: Text(
                                          _getCodexModelDisplayName(
                                            widget.codexModel,
                                          ),
                                          style: TextStyle(
                                            color: theme.text,
                                            fontSize: 13,
                                            fontWeight: FontWeight.w500,
                                          ),
                                        ),
                                      ),
                                    ] else ...[
                                      // OpenCode model selector
                                      GestureDetector(
                                        onTap: widget.onModelTap,
                                        child: Text(
                                          _getModelDisplayName(
                                            widget.currentModel,
                                          ),
                                          style: TextStyle(
                                            color: theme.text,
                                            fontSize: 13,
                                            fontWeight: FontWeight.w500,
                                          ),
                                        ),
                                      ),

                                      // Provider name (muted) - only for OpenCode
                                      if (_getProviderName(
                                        widget.currentModel,
                                      ).isNotEmpty) ...[
                                        const SizedBox(width: 6),
                                        Text(
                                          _getProviderName(widget.currentModel),
                                          style: TextStyle(
                                            color: theme.textMuted.withValues(
                                              alpha: 0.5,
                                            ),
                                            fontSize: 13,
                                          ),
                                        ),
                                      ],
                                    ],

                                    const Spacer(),

                                    // Attachment button
                                    if (widget.onAttachTap != null)
                                      GestureDetector(
                                        onTap: widget.onAttachTap,
                                        child: Padding(
                                          padding: const EdgeInsets.only(
                                            right: 12,
                                          ),
                                          child: Icon(
                                            widget.attachIcon,
                                            color: theme.textMuted,
                                            size: 22,
                                          ),
                                        ),
                                      ),

                                    // Send button (minimal)
                                    GestureDetector(
                                      onTap: widget.canSend
                                          ? widget.onSend
                                          : null,
                                      child: Container(
                                        width: 28,
                                        height: 28,
                                        decoration: BoxDecoration(
                                          color: widget.canSend
                                              ? theme.text
                                              : theme.textMuted.withValues(
                                                  alpha: 0.15,
                                                ),
                                          borderRadius: BorderRadius.circular(
                                            6,
                                          ),
                                        ),
                                        child: Center(
                                          child: Icon(
                                            Icons.arrow_upward_rounded,
                                            color: widget.canSend
                                                ? theme.background
                                                : theme.textMuted.withValues(
                                                    alpha: 0.4,
                                                  ),
                                            size: 16,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Agent? _getCurrentAgent() {
    final primaryAgents = widget.agents.where((a) => a.isPrimary).toList();
    if (primaryAgents.isEmpty) return null;
    return primaryAgents.firstWhere(
      (a) => a.name == widget.currentAgent,
      orElse: () => primaryAgents.first,
    );
  }

  void _showAgentPicker(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final primaryAgents = widget.agents.where((a) => a.isPrimary).toList();

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => _AgentAndPermissionSheet(
        theme: theme,
        agents: primaryAgents,
        currentAgent: widget.currentAgent,
        onAgentChanged: widget.onAgentChanged,
      ),
    );
  }
}

/// Bottom sheet for selecting agent and viewing permission presets
class _AgentAndPermissionSheet extends ConsumerStatefulWidget {
  const _AgentAndPermissionSheet({
    required this.theme,
    required this.agents,
    this.currentAgent,
    this.onAgentChanged,
  });

  final OpenCodeTheme theme;
  final List<Agent> agents;
  final String? currentAgent;
  final void Function(String?)? onAgentChanged;

  @override
  ConsumerState<_AgentAndPermissionSheet> createState() =>
      _AgentAndPermissionSheetState();
}

class _AgentAndPermissionSheetState
    extends ConsumerState<_AgentAndPermissionSheet> {
  @override
  Widget build(BuildContext context) {
    final rulesState = ref.watch(permissionRulesProvider);
    final selectedPreset = rulesState.preset;

    // Separate primary (Build/Plan) from secondary agents
    final primaryAgents = widget.agents
        .where((a) => a.name == 'build' || a.name == 'plan')
        .toList();
    final secondaryAgents = widget.agents
        .where((a) => a.name != 'build' && a.name != 'plan')
        .toList();

    return Container(
      decoration: BoxDecoration(
        color: widget.theme.background,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle bar
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: widget.theme.borderSubtle,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // Content with proper padding
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Agent section
                  if (widget.agents.isNotEmpty) ...[
                    // Section header
                    Row(
                      children: [
                        Icon(
                          Icons.smart_toy_outlined,
                          color: widget.theme.textMuted,
                          size: 18,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'Agent',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: widget.theme.textMuted,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Primary agents as prominent cards in a row
                    if (primaryAgents.isNotEmpty) ...[
                      Row(
                        children: primaryAgents.map((agent) {
                          final isSelected = agent.name == widget.currentAgent;
                          return Expanded(
                            child: Padding(
                              padding: EdgeInsets.only(
                                right: agent == primaryAgents.last ? 0 : 10,
                              ),
                              child: _AgentCard(
                                agent: agent,
                                isSelected: isSelected,
                                theme: widget.theme,
                                onTap: () {
                                  widget.onAgentChanged?.call(agent.name);
                                  Navigator.pop(context);
                                },
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                      const SizedBox(height: 12),
                    ],

                    // Secondary agents as smaller list
                    if (secondaryAgents.isNotEmpty) ...[
                      Container(
                        decoration: BoxDecoration(
                          color: widget.theme.backgroundPanel,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: widget.theme.borderSubtle),
                        ),
                        child: Column(
                          children: secondaryAgents.asMap().entries.map((
                            entry,
                          ) {
                            final index = entry.key;
                            final agent = entry.value;
                            final isSelected =
                                agent.name == widget.currentAgent;
                            final isLast = index == secondaryAgents.length - 1;
                            return Column(
                              children: [
                                InkWell(
                                  onTap: () {
                                    widget.onAgentChanged?.call(agent.name);
                                    Navigator.pop(context);
                                  },
                                  borderRadius: BorderRadius.vertical(
                                    top: index == 0
                                        ? const Radius.circular(12)
                                        : Radius.zero,
                                    bottom: isLast
                                        ? const Radius.circular(12)
                                        : Radius.zero,
                                  ),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 14,
                                      vertical: 12,
                                    ),
                                    child: Row(
                                      children: [
                                        Container(
                                          width: 8,
                                          height: 8,
                                          decoration: BoxDecoration(
                                            color: agent.displayColor,
                                            shape: BoxShape.circle,
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                agent.displayName,
                                                style: TextStyle(
                                                  color: widget.theme.text,
                                                  fontSize: 14,
                                                  fontWeight: isSelected
                                                      ? FontWeight.w600
                                                      : FontWeight.w500,
                                                ),
                                              ),
                                              Text(
                                                agent.shortDescription,
                                                style: TextStyle(
                                                  color: widget.theme.textMuted,
                                                  fontSize: 12,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        if (isSelected)
                                          Icon(
                                            Icons.check_rounded,
                                            color: widget.theme.primary,
                                            size: 18,
                                          ),
                                      ],
                                    ),
                                  ),
                                ),
                                if (!isLast)
                                  Divider(
                                    height: 1,
                                    indent: 34,
                                    color: widget.theme.borderSubtle,
                                  ),
                              ],
                            );
                          }).toList(),
                        ),
                      ),
                    ],

                    const SizedBox(height: 24),
                  ],

                  // Permission preset section
                  Row(
                    children: [
                      Icon(
                        Icons.shield_outlined,
                        color: widget.theme.textMuted,
                        size: 18,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Permissions',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: widget.theme.textMuted,
                          letterSpacing: 0.5,
                        ),
                      ),
                      const Spacer(),
                      // Custom rules button inline
                      GestureDetector(
                        onTap: () {
                          Navigator.pop(context);
                          showModalBottomSheet(
                            context: context,
                            isScrollControlled: true,
                            backgroundColor: Colors.transparent,
                            builder: (context) => PermissionRulesSheet(
                              initialRules: rulesState.effectiveRuleset,
                              onApply: (rules) {
                                ref
                                    .read(permissionRulesProvider.notifier)
                                    .setCustomRules(rules);
                              },
                            ),
                          );
                        },
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.tune_rounded,
                              size: 14,
                              color: widget.theme.primary,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              'Custom',
                              style: TextStyle(
                                color: widget.theme.primary,
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),

                  // Permission presets as 2x2 grid
                  GridView.count(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisCount: 2,
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    childAspectRatio: 2.4,
                    children: PermissionPreset.values
                        .where((p) => p != PermissionPreset.custom)
                        .map(
                          (preset) => _PermissionPresetCard(
                            preset: preset,
                            isSelected: preset == selectedPreset,
                            theme: widget.theme,
                            onTap: () {
                              ref
                                  .read(permissionRulesProvider.notifier)
                                  .setPreset(preset);
                            },
                          ),
                        )
                        .toList(),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Card for primary agents (Build/Plan)
class _AgentCard extends StatelessWidget {
  const _AgentCard({
    required this.agent,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final Agent agent;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isSelected
              ? agent.displayColor.withValues(alpha: 0.12)
              : theme.backgroundPanel,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isSelected ? agent.displayColor : theme.borderSubtle,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: agent.displayColor,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    agent.displayName,
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    agent.shortDescription,
                    style: TextStyle(color: theme.textMuted, fontSize: 11),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(
                Icons.check_circle_rounded,
                color: agent.displayColor,
                size: 20,
              ),
          ],
        ),
      ),
    );
  }
}

/// Compact permission preset card for grid
class _PermissionPresetCard extends StatelessWidget {
  const _PermissionPresetCard({
    required this.preset,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final PermissionPreset preset;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected
              ? theme.primary.withValues(alpha: 0.1)
              : theme.backgroundPanel,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? theme.primary : theme.borderSubtle,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              preset.displayName,
              style: TextStyle(
                color: isSelected ? theme.primary : theme.text,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Text(
              preset.description,
              style: TextStyle(color: theme.textMuted, fontSize: 10),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

// Model selector bottom sheet
class _ModelSelectorSheet extends ConsumerStatefulWidget {
  const _ModelSelectorSheet({required this.onModelSelected});

  final void Function(String model) onModelSelected;

  @override
  ConsumerState<_ModelSelectorSheet> createState() =>
      _ModelSelectorSheetState();
}

class _ModelSelectorSheetState extends ConsumerState<_ModelSelectorSheet> {
  Map<String, dynamic>? _providersData;
  String? _currentModel;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final results = await Future.wait([
        bridge.listProviders(),
        bridge.getConfig(),
      ]);
      if (!mounted) return;
      setState(() {
        _providersData = results[0];
        _currentModel =
            selection.model?.displayString ?? (results[1])['model'] as String?;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _selectModel(String providerId, String modelId) async {
    final model = '$providerId/$modelId';
    final bridge = ref.read(bridgeServiceProvider);
    await bridge.setModel(model);
    setState(() {
      _currentModel = model;
    });
    widget.onModelSelected(model);
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final kBackground = theme.background;
    final kOnBackground = theme.text;
    final kMuted = theme.textMuted;

    return Container(
      decoration: BoxDecoration(
        color: kBackground,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (context, scrollController) {
          if (_loading) {
            return Center(
              child: CircularProgressIndicator(color: theme.primary),
            );
          }

          if (_error != null) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Text(
                  'Failed to load models: $_error',
                  style: TextStyle(color: kMuted),
                ),
              ),
            );
          }

          final rawProviders =
              _providersData?['providers'] as List<dynamic>? ?? [];

          // Sort providers: Anthropic first, then alphabetically
          final providers = List<dynamic>.from(rawProviders)
            ..sort((a, b) {
              final aId = (a as Map<String, dynamic>)['id'] as String? ?? '';
              final bId = (b as Map<String, dynamic>)['id'] as String? ?? '';

              // Priority order: anthropic first
              const priorityOrder = ['anthropic', 'openai', 'google'];
              final aPriority = priorityOrder.indexOf(aId.toLowerCase());
              final bPriority = priorityOrder.indexOf(bId.toLowerCase());

              // If both have priority, sort by priority order
              if (aPriority >= 0 && bPriority >= 0) {
                return aPriority.compareTo(bPriority);
              }
              // If only a has priority, a comes first
              if (aPriority >= 0) return -1;
              // If only b has priority, b comes first
              if (bPriority >= 0) return 1;
              // Otherwise sort alphabetically by name
              final aName = (a)['name'] as String? ?? aId;
              final bName = (b)['name'] as String? ?? bId;
              return aName.toLowerCase().compareTo(bName.toLowerCase());
            });

          return ListView(
            controller: scrollController,
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                'Select Model',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                  color: kOnBackground,
                ),
              ),
              const SizedBox(height: 8),
              if (_currentModel != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    'Current: $_currentModel',
                    style: TextStyle(fontSize: 13, color: kMuted),
                  ),
                ),
              if (providers.isEmpty)
                Text(
                  'No providers configured.',
                  style: TextStyle(color: kMuted),
                )
              else
                for (final provider in providers) ...[
                  _buildProviderSection(provider as Map<String, dynamic>),
                  const SizedBox(height: 16),
                ],
            ],
          );
        },
      ),
    );
  }

  Widget _buildProviderSection(Map<String, dynamic> provider) {
    final theme = OpenCodeTheme.of(context);
    final kOnBackground = theme.text;
    final kMuted = theme.textMuted;

    final id = provider['id'] as String? ?? 'provider';
    final name = provider['name'] as String? ?? id;
    final models = provider['models'] as Map<String, dynamic>? ?? {};

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Provider header with icon (SDK v1.1.18 provider-icon)
        Row(
          children: [
            ProviderIcon(providerId: id, size: 22),
            const SizedBox(width: 8),
            Text(
              name,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: kOnBackground,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        for (final entry in models.entries)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: _currentModel == '$id/${entry.key}'
                ? Icon(Icons.check_circle, color: theme.success)
                : Icon(Icons.circle_outlined, color: theme.borderSubtle),
            title: Text(
              entry.value['name'] as String? ?? entry.key,
              style: TextStyle(color: kOnBackground),
            ),
            subtitle: Text(
              entry.key,
              style: TextStyle(fontSize: 12, color: kMuted),
            ),
            onTap: () => _selectModel(id, entry.key),
          ),
      ],
    );
  }
}

// Feature 2: Slash command autocomplete popup with grouping
class _CommandAutocomplete extends StatelessWidget {
  const _CommandAutocomplete({required this.commands, required this.onSelect});

  final List<SlashCommand> commands;
  final void Function(SlashCommand) onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final kCard = theme.backgroundPanel;
    final kBorder = theme.borderSubtle;
    final kOnBackground = theme.text;
    final kMuted = theme.textMuted;
    final kAccent = theme.primary;
    final kSuccess = theme.success;
    final kInfo = theme.info;

    if (commands.isEmpty) {
      return const SizedBox.shrink();
    }

    // Group commands by built-in vs custom
    final groups = CommandGroups.fromCommands(commands);

    return Container(
      constraints: const BoxConstraints(maxHeight: 280),
      decoration: BoxDecoration(
        color: kCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: kBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.3),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.symmetric(vertical: 8),
          children: [
            // Built-in commands section
            if (groups.hasBuiltIn) ...[
              _buildSectionHeader(
                'Built-in',
                Icons.terminal,
                kAccent,
                kMuted,
                groups.builtIn.length,
              ),
              ...groups.builtIn.map(
                (cmd) => _buildCommandTile(
                  cmd,
                  kOnBackground,
                  kMuted,
                  kAccent,
                  kSuccess,
                  kInfo,
                ),
              ),
            ],
            // Custom commands section
            if (groups.hasCustom) ...[
              if (groups.hasBuiltIn) const SizedBox(height: 8),
              _buildSectionHeader(
                'Custom',
                Icons.extension,
                kSuccess,
                kMuted,
                groups.custom.length,
              ),
              ...groups.custom.map(
                (cmd) => _buildCommandTile(
                  cmd,
                  kOnBackground,
                  kMuted,
                  kSuccess,
                  kSuccess,
                  kInfo,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(
    String title,
    IconData icon,
    Color iconColor,
    Color textColor,
    int count,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 14, color: iconColor),
          const SizedBox(width: 6),
          Text(
            title,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: textColor,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            '($count)',
            style: TextStyle(
              fontSize: 11,
              color: textColor.withValues(alpha: 0.6),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCommandTile(
    SlashCommand command,
    Color textColor,
    Color mutedColor,
    Color accentColor,
    Color agentColor,
    Color modelColor,
  ) {
    return InkWell(
      onTap: () => onSelect(command),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            // Command icon
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: accentColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                command.builtin ? Icons.terminal : Icons.extension,
                size: 16,
                color: accentColor,
              ),
            ),
            const SizedBox(width: 12),
            // Command name and description
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        command.displayName,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: textColor,
                        ),
                      ),
                      // Agent badge
                      if (command.hasAgent) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: agentColor.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            '@${command.agent}',
                            style: TextStyle(
                              fontSize: 9,
                              color: agentColor,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                      // Model badge
                      if (command.hasModel) ...[
                        const SizedBox(width: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: modelColor.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            command.shortModelName ?? '',
                            style: TextStyle(
                              fontSize: 9,
                              color: modelColor,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                      // Subtask badge
                      if (command.subtask) ...[
                        const SizedBox(width: 4),
                        Icon(
                          Icons.subdirectory_arrow_right,
                          size: 12,
                          color: mutedColor,
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    command.shortDescription,
                    style: TextStyle(fontSize: 12, color: mutedColor),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CustomToolAutocomplete extends ConsumerWidget {
  const _CustomToolAutocomplete({required this.query, required this.onSelect});

  final String query;
  final void Function(ClaudeCodeCustomTool tool) onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final toolsAsync = ref.watch(ccCustomToolsProvider);

    final kCard = theme.backgroundPanel;
    final kBorder = theme.borderSubtle;
    final kText = theme.text;
    final kMuted = theme.textMuted;

    return toolsAsync.when(
      loading: () => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: kCard,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: kBorder),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2, color: kMuted),
            ),
            const SizedBox(width: 10),
            Text('Loading tools…', style: TextStyle(color: kMuted)),
          ],
        ),
      ),
      error: (e, _) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: kCard,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: kBorder),
        ),
        child: Text(
          'Failed to load tools: $e',
          style: TextStyle(color: theme.error),
        ),
      ),
      data: (tools) {
        final enabled = tools.where((t) => t.enabled).toList();
        final q = query.trim().toLowerCase();
        final filtered = q.isEmpty
            ? enabled
            : enabled
                  .where(
                    (t) =>
                        t.name.toLowerCase().contains(q) ||
                        t.description.toLowerCase().contains(q),
                  )
                  .toList();

        if (filtered.isEmpty) {
          return Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: kCard,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: kBorder),
            ),
            child: Text('No matching tools', style: TextStyle(color: kMuted)),
          );
        }

        return Container(
          constraints: const BoxConstraints(maxHeight: 280),
          decoration: BoxDecoration(
            color: kCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: kBorder),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.3),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: filtered.length,
              itemBuilder: (context, index) {
                final tool = filtered[index];
                return InkWell(
                  onTap: () => onSelect(tool),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 10,
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 32,
                          height: 32,
                          decoration: BoxDecoration(
                            color: theme.warning.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Icon(
                            Icons.build_rounded,
                            size: 16,
                            color: theme.warning,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                tool.name,
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: kText,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                tool.mcpToolName,
                                style: TextStyle(fontSize: 11, color: kMuted),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          Icons.chevron_right_rounded,
                          color: kMuted.withValues(alpha: 0.7),
                          size: 18,
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        );
      },
    );
  }
}

// Feature 13: Animated status indicator for session state
class _StatusIndicator extends StatefulWidget {
  const _StatusIndicator({
    required this.isConnected,
    required this.sessionStatus,
  });

  final bool isConnected;
  final SessionStatus sessionStatus;

  @override
  State<_StatusIndicator> createState() => _StatusIndicatorState();
}

class _StatusIndicatorState extends State<_StatusIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 1200),
      vsync: this,
    );
    _updateAnimation();
  }

  @override
  void didUpdateWidget(_StatusIndicator oldWidget) {
    super.didUpdateWidget(oldWidget);
    _updateAnimation();
  }

  void _updateAnimation() {
    if (widget.sessionStatus.isBusy || widget.sessionStatus.isRetry) {
      _controller.repeat();
    } else {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final status = widget.sessionStatus;

    // Connection color
    Color baseColor;
    if (!widget.isConnected) {
      baseColor = theme.error; // Red - disconnected
    } else if (status.isBusy) {
      baseColor = theme.info; // Blue - busy/working
    } else if (status.isRetry) {
      baseColor = theme.warning; // Yellow - retry
    } else {
      baseColor = theme.success; // Green - idle/connected
    }

    // Pulsing animation for busy/retry states
    if (status.isBusy || status.isRetry) {
      return AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          final opacity =
              0.4 + (0.6 * (0.5 + 0.5 * (_controller.value * 2 - 1).abs()));
          return Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: baseColor.withValues(alpha: opacity),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: baseColor.withValues(alpha: 0.3),
                  blurRadius: 4,
                  spreadRadius: 1,
                ),
              ],
            ),
          );
        },
      );
    }

    // Static indicator for idle/disconnected
    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(color: baseColor, shape: BoxShape.circle),
    );
  }
}
