import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/agent.dart';
import '../models/agent_type.dart';
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
import '../providers/app_subscription_provider.dart';
import '../providers/codex_settings_provider.dart';
import '../providers/file_search_provider.dart';
import '../providers/input_style_provider.dart';
import '../providers/opencode_variant_provider.dart';
import '../providers/claude_code_variant_provider.dart';
import '../providers/permission_rules_provider.dart';
import '../providers/glow_style_provider.dart';
import '../providers/prompt_accent_provider.dart';
import '../providers/selection_provider.dart';
import '../models/glow_style.dart';
import '../models/prompt_accent_color.dart';
import '../providers/service_providers.dart';
import '../services/haptics_service.dart';
import '../services/image_picker_service.dart';
import '../services/websocket_service.dart';
import '../theme/opencode_theme.dart';
import '../widgets/diff_viewer.dart';
import '../widgets/export_session_sheet.dart';
import '../widgets/file_tagging.dart';
import '../widgets/message_bubble.dart';
import '../widgets/chat/compact_thinking_card.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/permission_prompt.dart';
import '../widgets/permission_rules_sheet.dart';
import '../widgets/question_prompt_sheet.dart';
import '../widgets/rollback_sheet.dart';
import '../widgets/session_sidebar.dart';
import '../widgets/chat/compact_tool_card.dart';
import '../widgets/chat/compact_edit_card.dart';
import '../widgets/chat/compact_write_card.dart';
import '../widgets/chat/compact_todos_card.dart';
import '../widgets/chat/compact_agent_card.dart';

import '../models/todo.dart';
import '../widgets/multi_agent_tree.dart';
import '../widgets/claude_code_help.dart';
import '../widgets/power_sheet.dart';
import '../widgets/project_tools_sheet.dart';
import '../widgets/voice_input_button.dart';
import 'subagents_screen.dart';
import 'claude_code_memory_screen.dart';
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
  final Set<String> _answeredQuestionIds =
      {}; // Prevent re-showing answered questions
  String? _activeCxQuestionId; // Codex request_user_input

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
  String? _ccResumeSessionAtMessageId;

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

    // Defer state modifications to after the first frame to avoid
    // "Tried to modify a provider while the widget tree was building" error
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      final selection = ref.read(selectionProvider.notifier);

      // Keep power-feature screens consistent: always set a project context when
      // a chat opens (even for Claude/Codex draft/session routes).
      final initialProject = widget.isOpenCode
          ? widget.project
          : ProjectSummary(
              id: '',
              name: widget.projectName,
              path: widget.effectivePath,
            );
      selection.selectProject(initialProject);
      if (widget.isOpenCode && widget.session.id.isNotEmpty) {
        selection.selectSession(widget.session);
      }

      // Set up view routing for all backends
      // This enables real-time cross-device session sync (external session watching)
      if (widget.isOpenCode) {
        bridge.setView(
          projectPath: widget.project.path,
          sessionId: widget.session.id,
          agent: 'opencode',
        );
      } else if (widget.isClaudeCode) {
        final sessionId = widget.ccSession?.id ?? '';
        if (sessionId.isNotEmpty) {
          bridge.setView(sessionId: sessionId, agent: 'claude-code');
        }
      } else if (widget.isCodex) {
        final threadId = widget.cxThread?.id ?? '';
        if (threadId.isNotEmpty) {
          bridge.setView(sessionId: threadId, agent: 'codex');
        }
      }
    });

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

        // Re-establish view routing for all backends (enables real-time sync)
        if (widget.isOpenCode) {
          bridge.setView(
            projectPath: widget.project.path,
            sessionId: widget.session.id,
            agent: 'opencode',
          );
        } else if (widget.isClaudeCode) {
          final sessionId = widget.ccSession?.id ?? '';
          if (sessionId.isNotEmpty) {
            bridge.setView(sessionId: sessionId, agent: 'claude-code');
          }
        } else if (widget.isCodex) {
          final threadId = widget.cxThread?.id ?? '';
          if (threadId.isNotEmpty) {
            bridge.setView(sessionId: threadId, agent: 'codex');
          }
        }

        _hydrateSession().whenComplete(() {
          _resyncingAfterReconnect = false;
          if (widget.isOpenCode &&
              !ref.read(connectionProvider).isOfflineMode) {
            ref
                .read(chatSessionProvider.notifier)
                .rehydrateOpenCodePending(projectPath: widget.project.path);
          }
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

    // Defer _hydrateSession to after first frame - it modifies provider state
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _hydrateSession().whenComplete(() {
        if (widget.isOpenCode && !ref.read(connectionProvider).isOfflineMode) {
          ref
              .read(chatSessionProvider.notifier)
              .rehydrateOpenCodePending(projectPath: widget.project.path);
        }
        _maybeSendInitialPrompt();
      });
    });
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

      // Also load variants for thinking level support (SDK v1.1.23+)
      _loadOpenCodeVariants();
    } catch (e) {
      // Use defaults if loading fails
      if (mounted) {
        setState(() {
          _agents = kDefaultAgents;
        });
      }
    }
  }

  /// Load available variants (thinking levels) for OpenCode models.
  Future<void> _loadOpenCodeVariants() async {
    if (!widget.isOpenCode) return;
    final bridge = ref.read(bridgeServiceProvider);
    try {
      final providersData = await bridge.listProviders();
      if (!mounted) return;
      ref
          .read(openCodeVariantProvider.notifier)
          .updateAvailableVariants(providersData);
    } catch (e) {
      // Silently fail - variants are optional
      debugPrint('Failed to load OpenCode variants: $e');
    }
  }

  /// Load slash commands for Claude Code
  Future<void> _loadClaudeCodeCommands() async {
    final bridge = ref.read(bridgeServiceProvider);
    final cwd = widget.ccSession?.cwd ?? widget.ccDraftCwd;

    try {
      // Fetch custom commands from .claude/commands/ directories
      final ccCommands = await bridge.ccListCommands(cwd: cwd);

      // Built-in slash commands (from Claude Code init payload when available).
      // Fallback to a small default list when init is not available (e.g. draft screen).
      const builtInDescriptions = <String, String>{
        'compact': 'Summarize conversation to free context',
        'clear': 'Clear conversation and start fresh',
        'help': 'Show available commands',
      };
      final initSlash =
          ref.read(chatSessionProvider).ccInit?.slashCommands ??
          const <String>[];
      final builtInNames = initSlash.isNotEmpty
          ? initSlash
                .map((s) => s.toString().trim())
                .where((s) => s.startsWith('/'))
                .map((s) => s.replaceFirst('/', ''))
                .where((s) => s.isNotEmpty)
                .toSet()
                .toList()
          : const ['compact', 'clear', 'help'];
      final builtInCommands = builtInNames
          .map(
            (name) => SlashCommand(
              name: name,
              description: builtInDescriptions[name] ?? 'Claude Code command',
              builtin: true,
            ),
          )
          .toList();

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
      final ccConfig = ref.read(ccConfigProvider).valueOrNull;

      final context = SessionContext.fromClaudeCode(
        inputTokens: tokenUsage?.inputTokens ?? 0,
        outputTokens: tokenUsage?.outputTokens ?? 0,
        cacheReadTokens: tokenUsage?.cacheReadTokens ?? 0,
        cacheWriteTokens: tokenUsage?.cacheCreationTokens ?? 0,
        reasoningTokens: 0, // SDK doesn't report reasoning in cumulative usage
        totalCostUsd: tokenUsage?.totalCostUsd,
        budgetLimitUsd: ccConfig?.maxBudgetUsd,
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

  void _setClaudeResumeFromHere(String messageId) {
    if (messageId.isEmpty) return;
    _haptics.lightImpact();
    setState(() => _ccResumeSessionAtMessageId = messageId);
    final theme = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text(
          'Claude will resume from this message on your next send.',
        ),
        backgroundColor: theme.backgroundPanel,
      ),
    );
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

  // Claude Code: Rewind files to the most recent checkpoint.
  // Uses the SDK's `rewindFiles(userMessageId)` which reverts ALL tracked files
  // to their state at that user message. Pops the checkpoint from the stack so
  // subsequent undos go further back.
  Future<void> _ccRewindToCheckpoint() async {
    _haptics.mediumImpact();
    final theme = OpenCodeTheme.of(context);

    final ccChatState = ref.read(ccChatProvider);
    if (!ccChatState.canUndo) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('No file changes to undo'),
          backgroundColor: theme.backgroundPanel,
        ),
      );
      return;
    }

    final remaining = ccChatState.checkpoints.length - 1;

    try {
      final ccChat = ref.read(ccChatProvider.notifier);
      final success = await ccChat.rewindToCheckpoint(
        cwd: widget.effectivePath,
      );

      if (!mounted) return;

      if (success) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              remaining > 0
                  ? 'File changes reverted ($remaining more undo${remaining == 1 ? '' : 's'} available)'
                  : 'File changes reverted',
            ),
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
    DetailSheet.show(
      context: context,
      title: 'Session Shared',
      initialSize: 0.35,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
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

  void _insertMemoryPromptTemplate(String scope) {
    final template = switch (scope) {
      'user' => 'When this is useful later, store it in user memory: ',
      'project' =>
        'If this should persist for the project, store it in project memory: ',
      'local' =>
        'If this should remain local to this machine, store it in local memory: ',
      _ => 'Store this memory appropriately: ',
    };
    final currentText = _controller.text;
    final prefix = currentText.trim().isEmpty
        ? template
        : '$currentText\n$template';
    _controller.text = prefix;
    _controller.selection = TextSelection.collapsed(
      offset: _controller.text.length,
    );
    _inputFocusNode.requestFocus();
  }

  void _showMemoryScopePicker() {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Memory Scope',
      initialSize: 0.35,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: Icon(Icons.person_outline_rounded, color: theme.info),
            title: Text('User memory', style: TextStyle(color: theme.text)),
            subtitle: Text(
              'Persists across projects for your account.',
              style: TextStyle(color: theme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _insertMemoryPromptTemplate('user');
            },
          ),
          ListTile(
            leading: Icon(Icons.work_outline_rounded, color: theme.accent),
            title: Text('Project memory', style: TextStyle(color: theme.text)),
            subtitle: Text(
              'Shared context for this project.',
              style: TextStyle(color: theme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _insertMemoryPromptTemplate('project');
            },
          ),
          ListTile(
            leading: Icon(Icons.computer_rounded, color: theme.warning),
            title: Text('Local memory', style: TextStyle(color: theme.text)),
            subtitle: Text(
              'Only for this machine/workspace.',
              style: TextStyle(color: theme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _insertMemoryPromptTemplate('local');
            },
          ),
        ],
      ),
    );
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
    DetailSheet.show(
      context: context,
      title: 'Add Attachment',
      initialSize: 0.3,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: Icon(Icons.camera_alt_rounded, color: theme.primary),
            title: Text('Take Photo', style: TextStyle(color: theme.text)),
            onTap: () {
              Navigator.pop(context);
              _pickImageFromCamera();
            },
          ),
          ListTile(
            leading: Icon(Icons.photo_library_rounded, color: theme.primary),
            title: Text(
              'Choose from Gallery',
              style: TextStyle(color: theme.text),
            ),
            onTap: () {
              Navigator.pop(context);
              _pickImageFromGallery();
            },
          ),
          ListTile(
            leading: Icon(Icons.attach_file_rounded, color: theme.info),
            title: Text('Attach File (@)', style: TextStyle(color: theme.text)),
            subtitle: Text(
              'Type @ in the input to search files',
              style: TextStyle(color: theme.textMuted, fontSize: 12),
            ),
            onTap: () => Navigator.pop(context),
          ),
        ],
      ),
    );
  }

  void _showClaudeCodeToolsSheet() {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Claude Code Tools',
      initialSize: 0.75,
      trailing: Material(
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
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
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
                          updateConfig(config.copyWith(permissionMode: value));
                        },
                      ),
                    ),

                    const SizedBox(height: 12),

                    _buildSettingsRow(
                      theme,
                      'Sandbox',
                      Switch.adaptive(
                        value: config.sandbox?.enabled ?? false,
                        onChanged: (enabled) {
                          final sandbox =
                              config.sandbox ??
                              const ClaudeCodeSandboxSettings();
                          updateConfig(
                            config.copyWith(
                              sandbox: ClaudeCodeSandboxSettings(
                                enabled: enabled,
                                autoAllowBashIfSandboxed:
                                    sandbox.autoAllowBashIfSandboxed,
                                allowUnsandboxedCommands:
                                    sandbox.allowUnsandboxedCommands,
                                network: sandbox.network,
                                ignoreViolations: sandbox.ignoreViolations,
                                enableWeakerNestedSandbox:
                                    sandbox.enableWeakerNestedSandbox,
                                excludedCommands: sandbox.excludedCommands,
                              ),
                            ),
                          );
                        },
                        activeColor: theme.accent,
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
                          DropdownMenuItem(value: 'none', child: Text('None')),
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
                                systemPrompt: const ClaudeCodeSystemPrompt(),
                              ),
                            );
                          } else if (value == 'preset') {
                            updateConfig(
                              config.copyWith(
                                systemPrompt: const ClaudeCodeSystemPrompt(
                                  preset: 'claude_code',
                                ),
                              ),
                            );
                          } else if (value == 'custom') {
                            final customText = await _promptSystemPromptText();
                            if (customText != null && customText.isNotEmpty) {
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
                                  builder: (_) => const SubagentsScreen(),
                                ),
                              );
                            },
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 12),

                    _buildSettingsTile(
                      theme: theme,
                      icon: Icons.memory_rounded,
                      iconColor: theme.accent,
                      title: 'Memory',
                      subtitle: 'Scopes and prompt helpers',
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _buildSettingsIconButton(
                            theme: theme,
                            icon: Icons.add_comment_rounded,
                            onTap: _showMemoryScopePicker,
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
                                      const ClaudeCodeMemoryScreen(),
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
                                  return _buildCountBadge(theme, enabledCount);
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
                                  builder: (_) => const CustomToolsScreen(),
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
                              final pluginsAsync = ref.watch(ccPluginsProvider);
                              return pluginsAsync.when(
                                data: (plugins) {
                                  final enabledCount = plugins
                                      .where(
                                        (p) =>
                                            p.status ==
                                            ClaudeCodePluginStatus.enabled,
                                      )
                                      .length;
                                  return _buildCountBadge(theme, enabledCount);
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
                      final enabled = !config.disallowedTools.contains(tool);
                      return _buildToolToggleRow(
                        theme: theme,
                        tool: tool,
                        enabled: enabled,
                        onChanged: (v) {
                          final allowed = [...config.allowedTools];
                          final disallowed = [...config.disallowedTools];

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
            ],
          );
        },
      ),
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
    DetailSheet.show(
      context: context,
      title: 'Commands',
      initialSize: 0.5,
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

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (all.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'No commands found for this project.',
                      style: TextStyle(color: theme.textMuted, fontSize: 13),
                    ),
                  )
                else
                  ...all.map(
                    (cmd) => ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(
                        Icons.chevron_right_rounded,
                        color: theme.textMuted,
                        size: 18,
                      ),
                      title: Text(
                        cmd,
                        style: TextStyle(color: theme.text, fontSize: 13),
                      ),
                      onTap: () {
                        final normalized = cmd.startsWith('/') ? cmd : '/$cmd';
                        _controller.text = '$normalized ';
                        _controller.selection = TextSelection.fromPosition(
                          TextPosition(offset: _controller.text.length),
                        );
                        Navigator.pop(context);
                        WidgetsBinding.instance.addPostFrameCallback((_) {
                          if (mounted) _inputFocusNode.requestFocus();
                        });
                      },
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _showClaudeCodeSkillsSheet() {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Skills',
      initialSize: 0.5,
      child: Consumer(
        builder: (context, ref, _) {
          final cwd = ref.watch(chatSessionProvider).ccCwd;
          final skillsAsync = ref.watch(ccSkillsProvider(cwd));

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: skillsAsync.when(
              data: (skills) {
                if (skills.isEmpty) {
                  return Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'No skills found.',
                      style: TextStyle(color: theme.textMuted, fontSize: 13),
                    ),
                  );
                }
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: skills
                      .map(
                        (s) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            s.name,
                            style: TextStyle(color: theme.text, fontSize: 13),
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
                                    borderRadius: BorderRadius.circular(8),
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
                        ),
                      )
                      .toList(),
                );
              },
              loading: () => Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Center(
                  child: CircularProgressIndicator(color: theme.primary),
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
          );
        },
      ),
    );
  }

  void _showClaudeCodeHooksSheet() {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Hooks',
      initialSize: 0.5,
      child: Consumer(
        builder: (context, ref, _) {
          final cwd = ref.watch(chatSessionProvider).ccCwd;
          final hooksAsync = ref.watch(ccHooksProvider(cwd));

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: hooksAsync.when(
              data: (hooks) {
                if (hooks.isEmpty) {
                  return Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'No hooks found.',
                      style: TextStyle(color: theme.textMuted, fontSize: 13),
                    ),
                  );
                }
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: hooks
                      .map(
                        (h) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            h.event,
                            style: TextStyle(color: theme.text, fontSize: 13),
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
                        ),
                      )
                      .toList(),
                );
              },
              loading: () => Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Center(
                  child: CircularProgressIndicator(color: theme.primary),
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
          );
        },
      ),
    );
  }

  void _showClaudeCodeMcpSheet() {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'MCP Servers',
      initialSize: 0.5,
      child: Consumer(
        builder: (context, ref, _) {
          final chatState = ref.watch(chatSessionProvider);
          final init = chatState.ccInit;
          final cwd =
              chatState.ccCwd ?? widget.ccSession?.cwd ?? widget.ccDraftCwd;
          final statusesAsync = ref.watch(ccMcpServerStatusProvider(cwd));
          final initServers = init?.mcpServers ?? const [];

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: statusesAsync.when(
              data: (statuses) {
                if (statuses.isNotEmpty) {
                  return Column(
                    mainAxisSize: MainAxisSize.min,
                    children: statuses
                        .map(
                          (status) => ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            leading: Icon(
                              status.status == 'connected'
                                  ? Icons.check_circle_rounded
                                  : status.status == 'needs-auth'
                                  ? Icons.lock_outline_rounded
                                  : status.status == 'pending'
                                  ? Icons.pending_rounded
                                  : Icons.error_outline_rounded,
                              color: status.status == 'connected'
                                  ? theme.success
                                  : status.status == 'needs-auth'
                                  ? theme.warning
                                  : status.status == 'pending'
                                  ? theme.accent
                                  : theme.error,
                              size: 18,
                            ),
                            title: Text(
                              status.name,
                              style: TextStyle(color: theme.text, fontSize: 13),
                            ),
                            subtitle: Text(
                              status.serverName != null &&
                                      status.serverVersion != null
                                  ? '${status.status} • ${status.serverName} ${status.serverVersion}'
                                  : status.status,
                              style: TextStyle(
                                color: theme.textMuted,
                                fontSize: 12,
                              ),
                            ),
                          ),
                        )
                        .toList(),
                  );
                }
                if (initServers.isEmpty) {
                  return Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'No MCP servers reported yet (start a turn to initialize).',
                      style: TextStyle(color: theme.textMuted, fontSize: 13),
                    ),
                  );
                }
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: initServers
                      .map(
                        (s) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            s['name']?.toString() ?? 'server',
                            style: TextStyle(color: theme.text, fontSize: 13),
                          ),
                          subtitle: Text(
                            s['status']?.toString() ?? '',
                            style: TextStyle(
                              color: theme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                        ),
                      )
                      .toList(),
                );
              },
              loading: () => Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Center(
                  child: CircularProgressIndicator(color: theme.accent),
                ),
              ),
              error: (_, __) => Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Unable to load MCP server status.',
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  void _handleClaudeCodeMenuAction(String value) {
    switch (value) {
      case 'project_tools':
        _showProjectToolsSheet();
        break;
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
      case 'project_tools':
        _showProjectToolsSheet();
        break;
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

    DetailSheet.show(
      context: context,
      title: 'Agents',
      initialSize: 0.6,
      child: StatefulBuilder(
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

          return Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.of(context).viewInsets.bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                  child: Text(
                    path ?? cwd,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: theme.textMuted, fontSize: 11),
                  ),
                ),
                if (!exists)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
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
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: SizedBox(
                    height: 300,
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
                            color: theme.borderSubtle.withValues(alpha: 0.35),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: Row(
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
                ),
              ],
            ),
          );
        },
      ),
    ).whenComplete(controller.dispose);
  }

  void _showCodexAuthSheet() {
    final theme = OpenCodeTheme.of(context);
    final apiKeyController = TextEditingController();
    String? loginId;
    String? authUrl;

    DetailSheet.show(
      context: context,
      title: 'Authentication',
      initialSize: 0.5,
      child: StatefulBuilder(
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

          return Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.of(context).viewInsets.bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: FutureBuilder<Map<String, dynamic>>(
                    future: ref.read(bridgeServiceProvider).cxAccountRead(),
                    builder: (context, snapshot) {
                      final loading =
                          snapshot.connectionState == ConnectionState.waiting;
                      if (loading) {
                        return const Padding(
                          padding: EdgeInsets.symmetric(vertical: 16),
                          child: Center(child: CircularProgressIndicator()),
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
                            color: theme.borderSubtle.withValues(alpha: 0.25),
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
                ),
                const SizedBox(height: 12),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: FutureBuilder<Map<String, dynamic>>(
                    future: ref.read(bridgeServiceProvider).cxRateLimitsRead(),
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting) {
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
                ),
                const SizedBox(height: 6),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
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
                            await ref.read(bridgeServiceProvider).cxLogout();
                            if (!context.mounted) return;
                            Navigator.pop(context);
                          },
                          child: const Text('Logout'),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: TextField(
                    controller: apiKeyController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'API key (optional)',
                      hintText: 'sk-...',
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
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
                ),
                if (authUrl != null && authUrl!.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Text(
                      'ChatGPT login URL (open on the host machine running Broski Bridge):',
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: SelectableText(
                      authUrl!,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        color: theme.text,
                        fontSize: 11,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
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
                  ),
                ],
                const SizedBox(height: 16),
              ],
            ),
          );
        },
      ),
    ).whenComplete(apiKeyController.dispose);
  }

  void _showCodexFeedbackSheet() {
    final theme = OpenCodeTheme.of(context);
    final reasonController = TextEditingController();
    String classification = 'bug';
    bool includeLogs = false;

    DetailSheet.show(
      context: context,
      title: 'Feedback',
      initialSize: 0.6,
      child: StatefulBuilder(
        builder: (context, setSheetState) {
          return Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.of(context).viewInsets.bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: DropdownButtonFormField<String>(
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
                      DropdownMenuItem(value: 'other', child: Text('Other')),
                    ],
                    onChanged: (v) =>
                        setSheetState(() => classification = v ?? 'bug'),
                    decoration: const InputDecoration(
                      labelText: 'Classification',
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: TextField(
                    controller: reasonController,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Reason (optional)',
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: SwitchListTile(
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
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
                    ),
                    activeThumbColor: theme.primary,
                  ),
                ),
                const SizedBox(height: 12),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: Row(
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
                            final threadId = res['threadId']?.toString() ?? '';
                            if (!context.mounted) return;
                            Navigator.pop(context);
                            if (threadId.isEmpty) return;
                            final thread = await bridge.cxResumeThread(
                              threadId,
                            );
                            if (!context.mounted) return;
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
                ),
              ],
            ),
          );
        },
      ),
    ).whenComplete(reasonController.dispose);
  }

  void _showCodexSettingsSheet() {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Codex Settings',
      initialSize: 0.7,
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
                          color: theme.borderSubtle.withValues(alpha: 0.3),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ],
            );
          }

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
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
                if (settings.sandboxMode == CodexSandboxMode.workspaceWrite)
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
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
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
                chipGroup<CodexWebSearchMode>(
                  label: 'Web search',
                  values: CodexWebSearchMode.values,
                  selected: settings.webSearchMode,
                  display: (v) => v.name[0].toUpperCase() + v.name.substring(1),
                  onSelected: notifier.setWebSearchMode,
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
                    style: TextStyle(color: theme.textMuted, fontSize: 12),
                  ),
                  activeColor: theme.primary,
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _showCodexSkillsSheet() {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.cxCwd ?? widget.cxThread?.cwd ?? widget.cxDraftCwd;
    DetailSheet.show(
      context: context,
      title: 'Codex Skills',
      initialSize: 0.6,
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: ref.read(bridgeServiceProvider).cxListSkills(cwd: cwd),
        builder: (context, snapshot) {
          final loading = snapshot.connectionState == ConnectionState.waiting;
          final data = snapshot.data ?? const <Map<String, dynamic>>[];

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: loading
                ? const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: CircularProgressIndicator()),
                  )
                : snapshot.hasError
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'Failed to load skills: ${snapshot.error}',
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
                    ),
                  )
                : data.isEmpty
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'No skills found for this project.',
                      style: TextStyle(color: theme.textMuted, fontSize: 13),
                    ),
                  )
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: data.map((entry) {
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
                    }).toList(),
                  ),
          );
        },
      ),
    );
  }

  void _showCodexMcpSheet() {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'MCP Servers',
      initialSize: 0.5,
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: ref.read(bridgeServiceProvider).cxListMcpServerStatus(),
        builder: (context, snapshot) {
          final loading = snapshot.connectionState == ConnectionState.waiting;
          final servers = snapshot.data ?? const <Map<String, dynamic>>[];

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: loading
                ? const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: CircularProgressIndicator()),
                  )
                : snapshot.hasError
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'Failed to load MCP servers: ${snapshot.error}',
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
                    ),
                  )
                : servers.isEmpty
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'No MCP servers configured.',
                      style: TextStyle(color: theme.textMuted, fontSize: 13),
                    ),
                  )
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: servers.asMap().entries.map((entry) {
                      final index = entry.key;
                      final s = entry.value;
                      final name = (s['name'] ?? '').toString();
                      final auth = (s['authStatus'] ?? '').toString();
                      final tools = (s['tools'] is Map)
                          ? (s['tools'] as Map).length
                          : (s['tools'] as List?)?.length ?? 0;
                      final resources = (s['resources'] as List?)?.length ?? 0;
                      final templates =
                          (s['resourceTemplates'] as List?)?.length ?? 0;

                      return Column(
                        children: [
                          if (index > 0)
                            Divider(
                              color: theme.borderSubtle.withValues(alpha: 0.35),
                            ),
                          ListTile(
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
                            trailing: null,
                          ),
                        ],
                      );
                    }).toList(),
                  ),
          );
        },
      ),
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
    DetailSheet.show(
      context: context,
      title: 'Codex Config',
      initialSize: 0.6,
      child: FutureBuilder<Map<String, dynamic>>(
        future: ref.read(bridgeServiceProvider).cxReadConfig(),
        builder: (context, snapshot) {
          final loading = snapshot.connectionState == ConnectionState.waiting;
          final config = snapshot.data ?? const <String, dynamic>{};
          final configJson = const JsonEncoder.withIndent('  ').convert(config);

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: loading
                ? const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: CircularProgressIndicator()),
                  )
                : snapshot.hasError
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'Failed to read config: ${snapshot.error}',
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
                    ),
                  )
                : SingleChildScrollView(
                    child: SelectableText(
                      configJson,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        color: theme.textMuted,
                        fontSize: 11,
                      ),
                    ),
                  ),
          );
        },
      ),
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
      'web_search': settings.webSearchMode.wireValue,
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

  /// Set Codex reasoning effort by wireValue string (e.g., 'high', 'xhigh')
  void _setCodexReasoningEffort(String? wireValue) {
    if (wireValue == null) return;
    final effort = CodexReasoningEffort.values.firstWhere(
      (e) => e.wireValue == wireValue,
      orElse: () => CodexReasoningEffort.medium,
    );
    ref.read(codexSettingsProvider.notifier).setReasoningEffort(effort);
  }

  void _showCodexModelSheet() {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Codex Model',
      initialSize: 0.5,
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
                ref.read(chatSessionProvider.notifier).setCodexModel(model);
                if (!mounted) return;
                Navigator.pop(context);
              },
            );
          }

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
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
            ),
          );
        },
      ),
    );
  }

  void _showClaudeCodeModelSheet() {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Claude Code Model',
      initialSize: 0.5,
      child: Consumer(
        builder: (context, ref, _) {
          final chatState = ref.watch(chatSessionProvider);
          final init = chatState.ccInit;
          final cwd =
              chatState.ccCwd ?? widget.ccSession?.cwd ?? widget.ccDraftCwd;
          final supportedModelsAsync = ref.watch(
            ccSupportedModelsProvider(cwd),
          );
          final configAsync = ref.watch(ccConfigProvider);
          final config =
              configAsync.valueOrNull ??
              ClaudeCodeConfig(
                permissionMode: ClaudeCodePermissionMode.defaultMode,
                allowedTools: init?.tools ?? const [],
                disallowedTools: const [],
                model: init?.model,
              );

          // null = default/recommended (SDK picks latest)
          final current = config.model ??
              chatState.ccModel ??
              init?.model ??
              widget.ccSession?.model ??
              widget.ccDraftModel;
          final isDefaultModel = current == null;
          final currentBetas = <String>{...(config.betas ?? const <String>[])};
          final oneMillionBeta = 'context-1m-2025-08-07';
          final oneMillionEnabled = currentBetas.contains(oneMillionBeta);

          Future<void> setModel(String? model) async {
            await ref
                .read(ccConfigProvider.notifier)
                .setModel(model);
            ref.read(chatSessionProvider.notifier).setCCModel(model ?? '');
          }

          Future<void> setOneMillionContext(bool enabled) async {
            final nextBetas = <String>{...currentBetas};
            if (enabled) {
              nextBetas.add(oneMillionBeta);
            } else {
              nextBetas.remove(oneMillionBeta);
            }
            await ref
                .read(ccConfigProvider.notifier)
                .updateConfig(config.copyWith(betas: nextBetas.toList()));
          }

          Widget modelTile(ClaudeCodeSupportedModel model) {
            final selected = current == model.value;
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
              title: Row(
                children: [
                  Expanded(
                    child: Text(
                      model.displayName,
                      style: TextStyle(color: theme.text, fontSize: 13),
                    ),
                  ),
                  if (model.supportsOneMillionContext)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: theme.accent.withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '1M',
                        style: TextStyle(
                          color: theme.accent,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                ],
              ),
              subtitle: Text(
                model.value,
                style: TextStyle(color: theme.textMuted, fontSize: 12),
              ),
              onTap: () async {
                await setModel(model.value);
                if (!mounted) return;
                Navigator.pop(context);
              },
            );
          }

          return supportedModelsAsync.when(
            data: (models) {
              final fallback = const <ClaudeCodeSupportedModel>[
                ClaudeCodeSupportedModel(
                  value: 'sonnet',
                  displayName: 'Claude Sonnet',
                  description: 'Balanced model for coding and reasoning',
                ),
                ClaudeCodeSupportedModel(
                  value: 'opus',
                  displayName: 'Claude Opus',
                  description: 'High-capability model for complex tasks',
                ),
                ClaudeCodeSupportedModel(
                  value: 'haiku',
                  displayName: 'Claude Haiku',
                  description: 'Fast and efficient model for lightweight tasks',
                ),
              ];
              final list = models.isNotEmpty ? models : fallback;
              final supportsOneMillion = list.any(
                (model) => model.supportsOneMillionContext,
              );

              return Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Select the model used for Claude Code turns.',
                      style: TextStyle(color: theme.textMuted, fontSize: 13),
                    ),
                    const SizedBox(height: 14),
                    // Default (Recommended) — lets the SDK pick the latest model
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(
                        isDefaultModel
                            ? Icons.radio_button_checked_rounded
                            : Icons.radio_button_off_rounded,
                        size: 18,
                        color: isDefaultModel ? theme.accent : theme.textMuted,
                      ),
                      title: Text(
                        'Default (Recommended)',
                        style: TextStyle(
                          color: theme.text,
                          fontSize: 13,
                          fontWeight:
                              isDefaultModel ? FontWeight.w600 : FontWeight.normal,
                        ),
                      ),
                      subtitle: Text(
                        'Uses the latest recommended model',
                        style: TextStyle(color: theme.textMuted, fontSize: 12),
                      ),
                      onTap: () async {
                        await setModel(null);
                        if (!mounted) return;
                        Navigator.pop(context);
                      },
                    ),
                    Divider(
                      color: theme.borderSubtle.withValues(alpha: 0.3),
                      height: 8,
                    ),
                    ...list.map(modelTile),
                    if (supportsOneMillion) ...[
                      const SizedBox(height: 12),
                      Divider(color: theme.borderSubtle.withValues(alpha: 0.3)),
                      SwitchListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        value: oneMillionEnabled,
                        onChanged: (value) => setOneMillionContext(value),
                        title: Text(
                          'Enable 1M context (beta)',
                          style: TextStyle(
                            color: theme.text,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: Text(
                          'Uses beta header for expanded Claude context window.',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              );
            },
            loading: () => Padding(
              padding: const EdgeInsets.only(top: 20),
              child: Center(
                child: CircularProgressIndicator(color: theme.accent),
              ),
            ),
            error: (_, __) => Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Unable to load model list.',
                style: TextStyle(color: theme.textMuted, fontSize: 13),
              ),
            ),
          );
        },
      ),
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
    DetailSheet.show(
      context: context,
      title: 'Available Commands',
      initialSize: 0.7,
      maxSize: 0.9,
      minSize: 0.5,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
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
                      (c) => ('/${c.name}', c.description ?? 'No description'),
                    )
                    .toList(),
                theme,
              ),
            const SizedBox(height: 20),
          ],
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
      final role = msg.role == MessageRole.user ? 'You' : 'Assistant';
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

    DetailSheet.show(
      context: context,
      title: 'Export Transcript',
      initialSize: 0.4,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
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
            title: Text('Export options…', style: TextStyle(color: theme.text)),
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
    );
  }

  /// Share transcript via system share sheet
  void _shareTranscript() {
    final chatState = ref.read(chatSessionProvider);
    final buffer = StringBuffer();
    buffer.writeln('# Session: ${widget.session.title}');
    buffer.writeln('---\n');

    for (final msg in chatState.messages) {
      final role = msg.role == MessageRole.user ? 'You' : 'Assistant';
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

    DetailSheet.show(
      context: context,
      title: 'Jump to Message',
      initialSize: 0.6,
      minSize: 0.4,
      maxSize: 0.9,
      child: ListView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: chatState.messages.length,
        itemBuilder: (context, index) {
          final msg = chatState.messages[index];
          final isUser = msg.role == MessageRole.user;
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
              style: TextStyle(fontWeight: FontWeight.w500, color: theme.text),
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
              final targetIndex = chatState.messages.length - 1 - index;
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

    DetailSheet.show(
      context: context,
      title: 'Fork Session',
      initialSize: 0.6,
      minSize: 0.4,
      maxSize: 0.9,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              'Select a message to fork from',
              style: TextStyle(fontSize: 13, color: theme.textMuted),
            ),
          ),
          ListView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: chatState.messages.length,
            itemBuilder: (context, index) {
              final msg = chatState.messages[index];
              final isUser = msg.role == MessageRole.user;
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
                          content: Text('Forked to "${forkedSession.title}"'),
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
        ],
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

    DetailSheet.show(
      context: context,
      title: 'Available Agents',
      initialSize: 0.4,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
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
                        style: TextStyle(color: theme.textMuted, fontSize: 12),
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
    final cxPendingUserInput = ref.watch(
      chatSessionProvider.select((s) => s.cxPendingUserInput),
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
    final cxIsStreaming = ref.watch(
      chatSessionProvider.select((s) => s.cxIsStreaming),
    );
    final ccInit = ref.watch(chatSessionProvider.select((s) => s.ccInit));
    final ccModel = ref.watch(chatSessionProvider.select((s) => s.ccModel));
    // Watch these for rebuild triggers (values accessed via ref.read in callbacks)
    ref.watch(chatSessionProvider.select((s) => s.ccCwd));
    ref.watch(chatSessionProvider.select((s) => s.ccSessionId));

    final connection = ref.watch(connectionProvider);
    // Watch session revert state for revert banner (Task 2)
    final sessionRevert = ref.watch(
      chatSessionProvider.select((s) => s.session?.revert),
    );

    _maybeShowPermissionPromptFromList(permissions);
    _maybeShowQuestionPrompt(pendingQuestion);
    _maybeShowCodexQuestionPrompt(cxPendingUserInput);

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
                        // Codex Multi-Agent Collaboration Tree (SDK v0.87.0+)
                        if (widget.isCodex)
                          Consumer(
                            builder: (context, ref, _) {
                              final collabTree = ref.watch(
                                chatSessionProvider.select(
                                  (s) => s.cxCollabTree,
                                ),
                              );
                              if (collabTree == null ||
                                  collabTree.totalAgents <= 1) {
                                return const SizedBox.shrink();
                              }
                              return Positioned(
                                top: 70,
                                left: 16,
                                right: 16,
                                child: MultiAgentTreeWidget(
                                  tree: collabTree,
                                  compact: true,
                                  onAgentTap: (threadId) {
                                    // TODO: Switch to view that thread's messages
                                    if (kDebugMode) {
                                      debugPrint(
                                        'Tapped on agent thread: $threadId',
                                      );
                                    }
                                  },
                                ),
                              );
                            },
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

          // Stop button when AI is processing - centered at bottom
          // Show for: streaming messages, CC/CX streaming states, or running tools
          if (_hasStreamingMessage(messages) ||
              (widget.isClaudeCode && ccIsStreaming) ||
              (widget.isCodex && cxIsStreaming) ||
              _hasRunningTools(messages))
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

          // Task 1: Retry status countdown banner
          if (sessionStatus.isRetry)
            Positioned(
              left: 16,
              right: 16,
              top: MediaQuery.of(context).padding.top + 50,
              child: _RetryStatusBanner(status: sessionStatus),
            ),

          // Task 2: Revert state banner
          if (widget.isOpenCode && sessionRevert != null)
            Positioned(
              left: 16,
              right: 16,
              top:
                  MediaQuery.of(context).padding.top +
                  (sessionStatus.isRetry ? 90 : 50),
              child: _RevertStateBanner(onUndoRevert: _unrevertSession),
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

          // Subagent activity indicator (Claude Code only)
          if (widget.isClaudeCode)
            Positioned(
              left: 0,
              right: 0,
              top: MediaQuery.of(context).padding.top + 44,
              child: _SubagentActivityIndicator(
                messages: messages,
                isStreaming: ccIsStreaming,
              ),
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

    // Get custom prompt accent color and glow style
    final promptAccent = ref.watch(promptAccentProvider);
    final glowStyle = ref.watch(glowStyleProvider);
    final theme = OpenCodeTheme.of(context);
    final customAccent = promptAccent == PromptAccentColor.themePrimary
        ? null
        : promptAccent.getColor(theme.primary);

    // Determine backend type for both input bar styles
    final backend = widget.isClaudeCode
        ? AgentType.claudeCode
        : widget.isCodex
        ? AgentType.codex
        : AgentType.opencode;

    // Build project for power sheet
    final powerProject = widget.isOpenCode
        ? widget.project
        : ProjectSummary(
            id: '',
            name: widget.projectName,
            path: widget.effectivePath,
          );

    Widget inputBar;
    if (inputStyle == InputBarStyle.cli) {
      inputBar = _CliStyleInputBar(
        controller: _controller,
        focusNode: _inputFocusNode,
        onSend: () =>
            _sendMessageWithParams(connection, messages, ccIsStreaming),
        isBusy: isBusy,
        canSend: canSend,
        backend: backend,
        project: powerProject,
        isOfflineMode: connection.isOfflineMode,
        currentAgent: widget.isOpenCode ? _selectedAgent : null,
        agents: widget.isOpenCode ? _agents : const [],
        onAgentChanged: widget.isOpenCode
            ? (agent) => setState(() => _selectedAgent = agent)
            : null,
        currentModel: widget.isOpenCode
            ? ref.watch(selectionProvider).model
            : null,
        onModelTap: widget.isClaudeCode
            ? () => _showClaudeCodeModelSheet()
            : widget.isCodex
            ? () => _showCodexModelSheet()
            : () => _showModelsDialog(),
        attachedFiles: _attachedFiles,
        onRemoveAttachment: _removeAttachedFile,
        showFileAutocomplete: _showFileAutocomplete,
        onFileSelect: _handleFileSelection,
        onAttachTap: () => _showAttachmentOptions(context),
        onTakePhoto: _pickImageFromCamera,
        attachIcon: Icons.add_rounded,
        // Claude Code specific
        ccPermissionMode: widget.isClaudeCode
            ? (ccConfig?.permissionMode ?? ccInit?.permissionMode)
            : null,
        ccModel: widget.isClaudeCode
            ? (ccConfig?.model ??
                  ccModel ??
                  ccInit?.model ??
                  widget.ccSession?.model ??
                  widget.ccDraftModel)
            : null,
        onCCModelTap: widget.isClaudeCode
            ? () => _showClaudeCodeModelSheet()
            : null,
        onCCPermissionModeChanged: widget.isClaudeCode
            ? (mode) {
                final notifier = ref.read(ccConfigProvider.notifier);
                final existing = ref.read(ccConfigProvider).valueOrNull;
                notifier.updateConfig(
                  existing?.copyWith(permissionMode: mode) ??
                      ClaudeCodeConfig(
                        permissionMode: mode,
                        allowedTools: const [],
                        disallowedTools: const [],
                      ),
                );
              }
            : null,
        // Codex specific
        codexModel: widget.isCodex
            ? ref.watch(chatSessionProvider.select((s) => s.cxModel))
            : null,
        onCodexModelTap: widget.isCodex ? () => _showCodexModelSheet() : null,
        // Codex Collaboration Mode (SDK v0.87.0+)
        codexCollabMode: widget.isCodex
            ? ref.watch(codexSettingsProvider).collaborationMode
            : null,
        onCodexCollabModeChanged: widget.isCodex
            ? (mode) => ref
                  .read(codexSettingsProvider.notifier)
                  .setCollaborationMode(mode)
            : null,
        customAccentColor: customAccent,
        glowStyle: glowStyle,
        // Variant/Thinking Level (all backends)
        currentVariant: widget.isOpenCode
            ? ref
                  .watch(openCodeVariantProvider)
                  .getVariant(ref.watch(selectionProvider).model)
            : widget.isClaudeCode
            ? ref.watch(claudeCodeVariantProvider).selectedVariant
            : widget.isCodex
            ? ref.watch(codexSettingsProvider).reasoningEffort.wireValue
            : null,
        availableVariants: widget.isOpenCode
            ? ref
                  .watch(openCodeVariantProvider)
                  .getAvailableVariants(ref.watch(selectionProvider).model)
            : widget.isClaudeCode
            ? claudeCodeVariants
            : widget.isCodex
            ? CodexReasoningEffort.values.map((e) => e.wireValue).toList()
            : const [],
        onVariantChanged: widget.isOpenCode
            ? (v) {
                final model = ref.read(selectionProvider).model;
                if (model != null && v != null) {
                  ref
                      .read(openCodeVariantProvider.notifier)
                      .setVariant(model, v);
                } else if (model != null && v == null) {
                  ref
                      .read(openCodeVariantProvider.notifier)
                      .clearVariant(model);
                }
              }
            : widget.isClaudeCode
            ? (v) => ref.read(claudeCodeVariantProvider.notifier).setVariant(v)
            : widget.isCodex
            ? (v) => _setCodexReasoningEffort(v)
            : null,
      );
    } else {
      // FloatingInputBar uses the backend/project declared above
      inputBar = _FloatingInputBar(
        controller: _controller,
        focusNode: _inputFocusNode,
        onSend: () =>
            _sendMessageWithParams(connection, messages, ccIsStreaming),
        isBusy: isBusy,
        canSend: canSend,
        backend: backend,
        project: powerProject,
        isOfflineMode: connection.isOfflineMode,
        attachedFiles: _attachedFiles,
        onRemoveAttachment: _removeAttachedFile,
        showFileAutocomplete: _showFileAutocomplete,
        onFileSelect: _handleFileSelection,
        onAttachTap: () => _showAttachmentOptions(context),
        onTakePhoto: _pickImageFromCamera,
        attachIcon: Icons.add_rounded,
        // Model selector
        currentModel: widget.isClaudeCode
            ? ref.watch(chatSessionProvider.select((s) => s.ccModel))
            : widget.isCodex
            ? ref.watch(chatSessionProvider.select((s) => s.cxModel))
            : ref.watch(selectionProvider).model?.displayString,
        onModelTap: widget.isClaudeCode
            ? () => _showClaudeCodeModelSheet()
            : widget.isCodex
            ? () => _showCodexModelSheet()
            : () => _showModelsDialog(),
        // OpenCode specific
        agents: widget.isOpenCode ? _agents : const [],
        currentAgent: widget.isOpenCode ? _selectedAgent : null,
        onAgentChanged: widget.isOpenCode
            ? (agent) => setState(() => _selectedAgent = agent)
            : null,
        // Claude Code specific
        ccPermissionMode: widget.isClaudeCode
            ? (ref.watch(ccConfigProvider).valueOrNull?.permissionMode ??
                  ref
                      .watch(chatSessionProvider.select((s) => s.ccInit))
                      ?.permissionMode)
            : null,
        onCCPermissionModeChanged: widget.isClaudeCode
            ? (mode) {
                final notifier = ref.read(ccConfigProvider.notifier);
                final existing = ref.read(ccConfigProvider).valueOrNull;
                notifier.updateConfig(
                  existing?.copyWith(permissionMode: mode) ??
                      ClaudeCodeConfig(
                        permissionMode: mode,
                        allowedTools: const [],
                        disallowedTools: const [],
                      ),
                );
              }
            : null,
        // Codex specific
        codexCollabMode: widget.isCodex
            ? ref.watch(codexSettingsProvider).collaborationMode
            : null,
        onCodexCollabModeChanged: widget.isCodex
            ? (mode) => ref
                  .read(codexSettingsProvider.notifier)
                  .setCollaborationMode(mode)
            : null,
        // Variant/Thinking Level (all backends)
        currentVariant: widget.isOpenCode
            ? ref
                  .watch(openCodeVariantProvider)
                  .getVariant(ref.watch(selectionProvider).model)
            : widget.isClaudeCode
            ? ref.watch(claudeCodeVariantProvider).selectedVariant
            : widget.isCodex
            ? ref.watch(codexSettingsProvider).reasoningEffort.wireValue
            : null,
        availableVariants: widget.isOpenCode
            ? ref
                  .watch(openCodeVariantProvider)
                  .getAvailableVariants(ref.watch(selectionProvider).model)
            : widget.isClaudeCode
            ? claudeCodeVariants
            : widget.isCodex
            ? CodexReasoningEffort.values.map((e) => e.wireValue).toList()
            : const [],
        onVariantChanged: widget.isOpenCode
            ? (v) {
                final model = ref.read(selectionProvider).model;
                if (model != null && v != null) {
                  ref
                      .read(openCodeVariantProvider.notifier)
                      .setVariant(model, v);
                } else if (model != null && v == null) {
                  ref
                      .read(openCodeVariantProvider.notifier)
                      .clearVariant(model);
                }
              }
            : widget.isClaudeCode
            ? (v) => ref.read(claudeCodeVariantProvider.notifier).setVariant(v)
            : widget.isCodex
            ? (v) => _setCodexReasoningEffort(v)
            : null,
        // Glow style and accent color
        glowStyle: glowStyle,
        accentColor: customAccent,
      );
    }

    return inputBar;
  }

  /// Builds the appropriate compact card for a tool call
  Widget _buildToolCard(ToolCall tool, String messageId) {
    final toolName = tool.name.toLowerCase().replaceFirst('mcp_', '');

    // Edit/Patch tools -> CompactEditCard
    // Handle different backend tool names:
    // - OpenCode: 'edit', 'patch'
    // - Claude Code: 'str_replace_editor', 'edit'
    // - Codex: 'applypatch', 'ApplyPatch'
    if (_isEditTool(toolName)) {
      return CompactEditCard(
        tool: tool,
        messageId: messageId,
        // Claude Code + Codex: no per-card undo (CC uses turn-level rewind
        // via SDK's rewindFiles(); Codex uses /undo command with custom snapshots).
        // OpenCode: per-message/part revert via SDK's session.revert().
        onUndo: widget.isClaudeCode || widget.isCodex
            ? null
            : (msgId, partId) => _revertMessage(msgId, partId: partId),
      );
    }

    // Write tool -> CompactWriteCard (new file creation with inline preview)
    if (toolName == 'write') {
      return CompactWriteCard(
        tool: tool,
        messageId: messageId,
        // Claude Code: no per-card undo (turn-level rewind only)
        onUndo: widget.isClaudeCode
            ? null
            : (msgId, partId) => _revertMessage(msgId, partId: partId),
      );
    }

    // Task/subtask/agent tool -> CompactAgentCard
    if (toolName == 'task' || toolName == 'subtask' || toolName == 'agent') {
      return CompactAgentCard(tool: tool, messageId: messageId);
    }

    // TodoWrite tool -> CompactTodosCard
    if (toolName == 'todowrite') {
      final todos = _extractTodosFromTool(tool);
      if (todos.isNotEmpty) {
        return CompactTodosCard(todos: todos);
      }
    }

    // All other tools -> CompactToolCard
    return CompactToolCard(
      tool: tool,
      messageId: messageId,
      onUndo: _canUndoTool(toolName)
          ? (msgId, partId) => _revertMessage(msgId, partId: partId)
          : null,
    );
  }

  /// Task 3: Build a compaction divider marker
  Widget _buildCompactionDivider() {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Row(
        children: [
          Expanded(
            child: Divider(
              color: theme.textMuted.withValues(alpha: 0.3),
              thickness: 1,
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(
              'Context compacted',
              style: TextStyle(
                color: theme.textMuted,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          Expanded(
            child: Divider(
              color: theme.textMuted.withValues(alpha: 0.3),
              thickness: 1,
            ),
          ),
        ],
      ),
    );
  }

  // _buildSubtaskChip removed — using CompactAgentCard.fromNotification() instead

  /// Task 7: Build a muted retry indicator
  Widget _buildRetryIndicator(int attempt, String? errorMessage) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.warning.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.warning_amber_rounded,
            color: theme.warning.withValues(alpha: 0.7),
            size: 16,
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              'Retry attempt #$attempt${errorMessage != null && errorMessage.isNotEmpty ? ': $errorMessage' : ''}',
              style: TextStyle(color: theme.textMuted, fontSize: 13),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  /// Extract todos from TodoWrite tool input
  List<Todo> _extractTodosFromTool(ToolCall tool) {
    try {
      final todosRaw = tool.input['todos'];
      if (todosRaw is! List) return [];
      return todosRaw
          .whereType<Map<String, dynamic>>()
          .map((t) => Todo.fromJson(t))
          .toList();
    } catch (e) {
      return [];
    }
  }

  /// Check if a tool can be undone (write operations)
  bool _canUndoTool(String toolName) {
    return toolName == 'write';
  }

  /// Check if a tool is an edit/patch tool (handles all backend naming conventions)
  /// - OpenCode: 'edit', 'patch'
  /// - Claude Code: 'str_replace_editor', 'edit'
  /// - Codex: 'applypatch', 'ApplyPatch'
  bool _isEditTool(String toolName) {
    return toolName == 'edit' ||
        toolName == 'patch' ||
        toolName == 'applypatch' ||
        toolName == 'str_replace_editor' ||
        toolName == 'str_replace' ||
        toolName == 'file_editor';
  }

  /// Whether an assistant message contains any file-modifying tool calls.
  bool _messageHasFileChanges(ChatMessage message) {
    return message.toolCalls.any((t) {
      final name = t.name.toLowerCase().replaceFirst('mcp_', '');
      return _isFileModificationTool(name);
    });
  }

  /// Extract file paths from file-modifying tool calls in a message.
  /// Uses the same field-name heuristics as CompactEditCard._getFilePath().
  List<String> _extractChangedFilePaths(ChatMessage message) {
    final paths = <String>{};
    for (final tool in message.toolCalls) {
      final name = tool.name.toLowerCase().replaceFirst('mcp_', '');
      if (!_isFileModificationTool(name)) continue;
      final path =
          tool.input['filePath'] as String? ??
          tool.input['path'] as String? ??
          tool.input['file_path'] as String? ??
          tool.input['file'] as String?;
      if (path != null && path.isNotEmpty) {
        paths.add(path);
        continue;
      }
      // Codex live: changes array
      final changes = tool.input['changes'];
      if (changes is List && changes.isNotEmpty) {
        for (final c in changes) {
          if (c is Map<String, dynamic>) {
            final cp = c['path'] as String?;
            if (cp != null && cp.isNotEmpty) paths.add(cp);
          }
        }
      }
    }
    return paths.toList();
  }

  /// Check if a tool is a file modification tool (edit, write, patch)
  /// These tools produce diffs that are shown inline in their compact cards
  bool _isFileModificationTool(String toolName) {
    return _isEditTool(toolName) ||
        toolName == 'write' ||
        toolName == 'create' ||
        toolName == 'touch';
  }

  /// Check if a diff came from a file modification tool (to avoid duplicate display)
  /// For Claude Code and Codex, file tools and diffs represent the same changes,
  /// so we hide diffs when file modification tools are present.
  bool _isDiffFromEditTool(DiffEntry diff, List<ToolCall> tools) {
    // If there are any file modification tools in this message, hide all diffs
    // The CompactEditCard/CompactWriteCard already show the changes inline
    return tools.any((t) {
      final name = t.name.toLowerCase().replaceFirst('mcp_', '');
      return _isFileModificationTool(name);
    });
  }

  Widget _buildMessageGroup(ChatMessage message) {
    // Task 3: Compaction marker — render as centered divider instead of error bubble
    if (message.error == 'context_compacted') {
      return _buildCompactionDivider();
    }

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
              child: CompactThinkingCard(message: message),
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
                onResumeFromHere:
                    widget.isClaudeCode && message.role == MessageRole.assistant
                    ? (messageId) => _setClaudeResumeFromHere(messageId)
                    : null,
                onRollback: widget.isCodex ? _showCodexRollbackSheet : null,
              ),

            // Tool calls - using new compact card components
            for (final tool in message.toolCalls)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _buildToolCard(tool, message.id),
              ),
          ],

          // Diffs - only show standalone diffs that aren't from edit tools
          // (edit tool diffs are now shown inline in CompactEditCard)
          for (final diff in message.diffs)
            if (!_isDiffFromEditTool(diff, message.toolCalls))
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: DiffViewer(
                  diff: diff,
                  messageId: message.id,
                  // Claude Code: no per-diff undo (turn-level rewind only)
                  onUndo: widget.isClaudeCode
                      ? null
                      : (messageId, partId) =>
                            _revertMessage(messageId, partId: partId),
                  onViewFull: () => _openDiffView(diff, messageId: message.id),
                ),
              ),

          // Subtask notifications (background task completions)
          for (final subtask in message.subtaskNotifications)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: CompactAgentCard.fromNotification(notification: subtask),
            ),

          // Claude Code: Turn-level undo bar after assistant messages with file changes.
          // Uses the SDK's rewindFiles(userMessageId) which reverts ALL files to a
          // checkpoint — no per-file undo exists in the SDK.
          if (widget.isClaudeCode &&
              message.role == MessageRole.assistant &&
              !message.isStreaming &&
              _messageHasFileChanges(message))
            Builder(
              builder: (context) {
                final ccState = ref.watch(ccChatProvider);
                if (!ccState.canUndo) return const SizedBox.shrink();
                return _CCUndoTurnBar(
                  changedFiles: _extractChangedFilePaths(message),
                  onUndo: _ccRewindToCheckpoint,
                );
              },
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
                  onResumeFromHere:
                      widget.isClaudeCode &&
                          message.role == MessageRole.assistant
                      ? (messageId) => _setClaudeResumeFromHere(message.id)
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
                child: _buildToolCard(tool, message.id),
              ),
            );
          }
        // Task 6: Subtask/agent delegation part — use existing CompactAgentCard
        case SubtaskPart(:final agentName, :final description):
          widgets.add(
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: CompactAgentCard.fromNotification(
                notification: SubtaskNotification(
                  id: 'subtask-${message.id}-${part.sequence}',
                  description: description ?? '',
                  agent: agentName,
                  sessionId: message.sessionId,
                ),
                messageId: message.id,
              ),
            ),
          );
        // Task 7: Retry attempt part
        case RetryPart(:final attempt, :final errorMessage):
          widgets.add(
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _buildRetryIndicator(attempt, errorMessage),
            ),
          );
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
            onResumeFromHere:
                widget.isClaudeCode && message.role == MessageRole.assistant
                ? (messageId) => _setClaudeResumeFromHere(messageId)
                : null,
            onRollback: widget.isCodex ? _showCodexRollbackSheet : null,
          ),
        );
      }
      for (final tool in message.toolCalls) {
        widgets.add(
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: _buildToolCard(tool, message.id),
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
      case 'project_tools':
        _showProjectToolsSheet();
        break;
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

  void _showProjectToolsSheet() {
    final backend = widget.isClaudeCode
        ? AgentType.claudeCode
        : widget.isCodex
        ? AgentType.codex
        : AgentType.opencode;

    final project = backend == AgentType.opencode
        ? widget.project
        : ProjectSummary(
            id: '',
            name: widget.projectName,
            path: widget.effectivePath,
          );

    // Ensure downstream power-feature screens resolve the correct cwd.
    ref.read(selectionProvider.notifier).selectProject(project);
    if (backend == AgentType.opencode && widget.session.id.isNotEmpty) {
      ref.read(selectionProvider.notifier).selectSession(widget.session);
    }

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ProjectToolsSheet(backend: backend, project: project),
    );
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
              _stopGeneration();
              Navigator.pop(context);
            },
            child: Text('Stop', style: TextStyle(color: theme.error)),
          ),
        ],
      ),
    );
  }

  /// Stop AI generation for all backends
  /// Sends abort to bridge and clears local streaming states
  void _stopGeneration() {
    final bridge = ref.read(bridgeServiceProvider);
    final notifier = ref.read(chatSessionProvider.notifier);

    if (widget.isClaudeCode) {
      final chatState = ref.read(chatSessionProvider);
      final sid = chatState.ccSessionId;
      if (sid != null && sid.isNotEmpty) {
        bridge.ccAbort(sid);
      }
      notifier.setCCStreaming(false);
    } else if (widget.isCodex) {
      final chatState = ref.read(chatSessionProvider);
      final tid = chatState.cxThreadId;
      if (tid != null && tid.isNotEmpty) {
        bridge.cxAbort(threadId: tid);
      }
      notifier.setCodexStreaming(false);
    } else {
      // OpenCode - send abort and clear all streaming states
      bridge.abortSession(widget.session.id, projectPath: widget.project.path);
      // Also mark all streaming messages as complete to unstick the UI
      notifier.markAllStreamingComplete();
    }
  }

  void _showModelSelector(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Select Model',
      initialSize: 0.5,
      child: _ModelSelectorContent(
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
    final entitlement = ref.read(appSubscriptionProvider).entitled;
    if (!entitlement) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Subscription required to send messages.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

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
      // Get Claude Code thinking level variant
      final ccVariant = ref.read(claudeCodeVariantProvider).selectedVariant;
      bridge.ccChat(
        sessionId: chatState.ccSessionId,
        prompt: text,
        cwd: cwd,
        model: model,
        permissionMode: ccConfig?.permissionMode,
        allowedTools: ccConfig?.allowedTools,
        disallowedTools: ccConfig?.disallowedTools,
        maxTurns: ccConfig?.maxTurns,
        maxBudgetUsd: ccConfig?.maxBudgetUsd,
        betas: ccConfig?.betas,
        variant: ccVariant,
        activeSubagent: activeSubagent,
        resumeSessionAt: _ccResumeSessionAtMessageId,
        outputFormat: ccConfig?.outputFormat,
        sandbox: ccConfig?.sandbox,
        enableAgentTeams: ccConfig?.enableAgentTeams,
        fileAttachments: hasAttachments ? _attachedFiles : null,
      );
      _ccResumeSessionAtMessageId = null;
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
        final mode = switch (arg) {
          'live' || 'on' || 'true' || '1' => CodexWebSearchMode.live,
          'cached' => CodexWebSearchMode.cached,
          _ => CodexWebSearchMode.disabled,
        };
        chat.appendUserMessage(text);
        ref.read(codexSettingsProvider.notifier).setWebSearchMode(mode);
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
          ..writeln('- Web search: ${codexSettings.webSearchMode.wireValue}')
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
            'web_search': codexSettings.webSearchMode.wireValue,
            'features.skills': codexSettings.skillsEnabled,
            'model_reasoning_effort': codexSettings.reasoningEffort.wireValue,
            'model_reasoning_summary': codexSettings.reasoningSummary.wireValue,
            if (codexSettings.sandboxMode == CodexSandboxMode.workspaceWrite)
              'sandbox_workspace_write.network_access':
                  codexSettings.networkAccessEnabled,
          },
          collaborationMode: codexSettings.collaborationMode.wireValue,
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
        'web_search': codexSettings.webSearchMode.wireValue,
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
        collaborationMode: codexSettings.collaborationMode.wireValue,
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

      // Get variant (thinking level) for OpenCode models
      final variantState = ref.read(openCodeVariantProvider);
      final variant = variantState.getVariant(selectedModel);

      bridge.sendChat(
        sessionId: widget.session.id,
        content: text,
        messageId: clientMessageId,
        projectPath: widget.project.path,
        providerID: selectedModel?.providerID,
        modelID: selectedModel?.modelID,
        agent: messageAgent,
        fileAttachments: hasAttachments ? _attachedFiles : null,
        variant: variant,
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
      // Note: PermissionPrompt has its own DraggableScrollableSheet with pinned
      // action buttons, so we use showModalBottomSheet directly instead of
      // DetailSheet.show() which would create nested scrollable sheets.
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) => PermissionPrompt(
          request: request,
          onApprove: () => _respondToPermission(request, 'once'),
          onDeny: () => _respondToPermission(request, 'reject'),
          onAlwaysAllow: () => _respondToPermission(request, 'always'),
          approveAlwaysLabel: alwaysLabel,
          onApproveWithExecpolicy: onExecpolicy,
          approveWithExecpolicyLabel: execpolicyLabel,
          onDenyWithMessage: (message) =>
              _respondToPermission(request, 'reject', message: message),
        ),
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
    // Skip questions we already answered (prevents re-show on rebuild race)
    if (_answeredQuestionIds.contains(request.id)) return;

    _activeQuestionId = request.id;
    _haptics.mediumImpact();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        isDismissible: false,
        enableDrag: false,
        builder: (_) {
          return QuestionPromptSheet(
            request: request,
            onReply: (answers) {
              _answeredQuestionIds.add(request.id);
              ref
                  .read(chatSessionProvider.notifier)
                  .replyToPendingQuestion(answers);
              if (mounted) Navigator.pop(context);
            },
            onReject: () {
              _answeredQuestionIds.add(request.id);
              ref.read(chatSessionProvider.notifier).rejectPendingQuestion();
              if (mounted) Navigator.pop(context);
            },
          );
        },
      ).whenComplete(() => _activeQuestionId = null);
    });
  }

  void _maybeShowCodexQuestionPrompt(CodexUserInputRequest? request) {
    if (!widget.isCodex) return;
    if (request == null || request.requestId.isEmpty) {
      _activeCxQuestionId = null;
      return;
    }
    if (_activeCxQuestionId == request.requestId) return;

    _activeCxQuestionId = request.requestId;
    _haptics.mediumImpact();

    // Convert CodexUserInputRequest to QuestionRequest for the existing UI
    final convertedRequest = QuestionRequest(
      id: request.requestId,
      sessionId: request.threadId,
      questions: request.questions
          .map(
            (q) => QuestionInfo(
              question: q.question,
              header: q.header,
              options: q.options
                  .map(
                    (o) => QuestionOption(
                      label: o.label,
                      description: o.description,
                    ),
                  )
                  .toList(),
              multiple: false, // Codex questions are single-select by default
            ),
          )
          .toList(),
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        isDismissible: false,
        enableDrag: false,
        builder: (_) {
          return QuestionPromptSheet(
            request: convertedRequest,
            onReply: (answers) {
              ref
                  .read(chatSessionProvider.notifier)
                  .replyToCodexUserInput(answers);
              if (mounted) Navigator.pop(context);
            },
            onReject: () {
              ref.read(chatSessionProvider.notifier).rejectCodexUserInput();
              if (mounted) Navigator.pop(context);
            },
          );
        },
      ).whenComplete(() => _activeCxQuestionId = null);
    });
  }

  void _respondToPermission(
    PermissionRequest request,
    String response, {
    String? message,
    Object? execpolicyAmendment,
  }) {
    final entitlement = ref.read(appSubscriptionProvider).entitled;
    if (!entitlement) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Subscription required to approve tools.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      Navigator.pop(context);
      return;
    }

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
    final primaryAgents = agents.where((a) => a.isPrimary).toList();
    final theme = OpenCodeTheme.of(context);

    DetailSheet.show(
      context: context,
      title: 'Select Agent',
      initialSize: 0.4,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          for (final agent in primaryAgents)
            ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16),
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
    DetailSheet.show(
      context: context,
      title: 'Session',
      initialSize: 0.5,
      child: _SessionActionsContent(
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
          Navigator.pop(context);
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
    DetailSheet.show(
      context: context,
      title: 'Claude Code',
      initialSize: 0.5,
      child: _ClaudeCodeActionsContent(
        theme: theme,
        isConnected: isConnected,
        rttMs: rttMs,
        ccModel: ccModel,
        onAction: (action) {
          Navigator.pop(context);
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
    DetailSheet.show(
      context: context,
      title: 'Codex',
      initialSize: 0.5,
      child: _CodexActionsContent(
        theme: theme,
        isConnected: isConnected,
        rttMs: rttMs,
        codexModel: codexModel,
        onAction: (action) {
          Navigator.pop(context);
          onMenu(action);
        },
      ),
    );
  }
}

/// Session actions content for DetailSheet
class _SessionActionsContent extends StatelessWidget {
  const _SessionActionsContent({
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
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
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
                      Icon(Icons.speed_rounded, size: 14, color: theme.info),
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

        // Session actions
        Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Project tools (Option 3 entrypoint)
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
                icon: Icons.grid_view_rounded,
                label: 'Project Tools',
                subtitle: 'Skills, commands, agents, MCP, plugins',
                theme: theme,
                color: theme.accent,
                onTap: () => onAction('project_tools'),
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

/// Claude Code actions content for DetailSheet
class _ClaudeCodeActionsContent extends StatelessWidget {
  const _ClaudeCodeActionsContent({
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
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
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
                      Icon(Icons.speed_rounded, size: 14, color: theme.info),
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
              _ActionRow(
                icon: Icons.grid_view_rounded,
                label: 'Project Tools',
                subtitle: 'Manage skills, commands, hooks, MCP, plugins',
                theme: theme,
                color: theme.accent,
                onTap: () => onAction('project_tools'),
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
    );
  }
}

/// Codex actions content for DetailSheet
class _CodexActionsContent extends StatelessWidget {
  const _CodexActionsContent({
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
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
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
                      Icon(Icons.speed_rounded, size: 14, color: theme.info),
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

        // Actions
        Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _ActionRow(
                icon: Icons.grid_view_rounded,
                label: 'Project Tools',
                subtitle: 'Skills, agents, MCP, config',
                theme: theme,
                color: theme.accent,
                onTap: () => onAction('project_tools'),
              ),
              const SizedBox(height: 20),

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
    required this.backend,
    required this.project,
    this.isOfflineMode = false,
    this.attachedFiles = const [],
    this.onRemoveAttachment,
    this.showFileAutocomplete = false,
    this.onFileSelect,
    this.onAttachTap,
    this.onTakePhoto,
    this.attachIcon = Icons.add_rounded,
    // Model selector
    this.currentModel,
    this.onModelTap,
    // OpenCode specific
    this.agents = const [],
    this.currentAgent,
    this.onAgentChanged,
    // Claude Code specific
    this.ccPermissionMode,
    this.onCCPermissionModeChanged,
    // Codex specific
    this.codexCollabMode,
    this.onCodexCollabModeChanged,
    // Variant/Thinking Level (all backends)
    this.currentVariant,
    this.availableVariants = const [],
    this.onVariantChanged,
    // Glow style and accent color
    this.glowStyle = GlowStyle.none,
    this.accentColor,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onSend;
  final bool isBusy;
  final bool canSend;
  final AgentType backend;
  final ProjectSummary project;
  final bool isOfflineMode;
  final List<FileAttachment> attachedFiles;
  final void Function(FileAttachment)? onRemoveAttachment;
  final bool showFileAutocomplete;
  final void Function(FileAttachment)? onFileSelect;
  final VoidCallback? onAttachTap;
  final VoidCallback? onTakePhoto;
  final IconData attachIcon;
  // Model selector
  final String? currentModel;
  final VoidCallback? onModelTap;
  // OpenCode specific
  final List<Agent> agents;
  final String? currentAgent;
  final void Function(String?)? onAgentChanged;
  // Claude Code specific
  final ClaudeCodePermissionMode? ccPermissionMode;
  final void Function(ClaudeCodePermissionMode)? onCCPermissionModeChanged;
  // Codex specific
  final CodexCollaborationMode? codexCollabMode;
  final void Function(CodexCollaborationMode)? onCodexCollabModeChanged;
  // Variant/Thinking Level (all backends)
  final String? currentVariant;
  final List<String> availableVariants;
  final void Function(String?)? onVariantChanged;
  // Glow style and accent color
  final GlowStyle glowStyle;
  final Color? accentColor;

  void _showPowerSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => PowerSheet(
        backend: backend,
        project: project,
        onAttachFile: onAttachTap,
        onTakePhoto: onTakePhoto,
        currentModel: currentModel,
        onModelTap: onModelTap,
        currentVariant: currentVariant,
        availableVariants: availableVariants,
        onVariantChanged: onVariantChanged,
        // OpenCode
        agents: agents,
        currentAgent: currentAgent,
        onAgentChanged: onAgentChanged,
        // Claude Code
        ccPermissionMode: ccPermissionMode,
        onCCPermissionModeChanged: onCCPermissionModeChanged,
        // Codex
        codexCollabMode: codexCollabMode,
        onCodexCollabModeChanged: onCodexCollabModeChanged,
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

                // Main input container - ChatGPT-style unified card
                Padding(
                  key: const ValueKey('floating-input-row'),
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
                  child: _buildFloatingContainer(
                    glowStyle: glowStyle,
                    accentColor: accentColor,
                    kCard: kCard,
                    kMuted: kMuted,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Top: Text input (full width)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(18, 6, 18, 0),
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
                                    : kMuted.withValues(alpha: 0.5),
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
                        // Bottom: Action row
                        Padding(
                          padding: const EdgeInsets.fromLTRB(12, 2, 10, 10),
                          child: Row(
                            children: [
                              // Project chip (left)
                              GestureDetector(
                                onTap: () => _showPowerSheet(context),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 6,
                                  ),
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(18),
                                    border: Border.all(
                                      color: fade(kMuted, 0.25),
                                    ),
                                  ),
                                  child: Text(
                                    project.name.isNotEmpty
                                        ? project.name
                                        : 'Project',
                                    style: TextStyle(
                                      color: kMuted,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w400,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                              const Spacer(),
                              // Attach button (+)
                              if (onAttachTap != null)
                                GestureDetector(
                                  onTap: onAttachTap,
                                  child: Padding(
                                    padding: const EdgeInsets.all(6),
                                    child: Icon(
                                      Icons.add_rounded,
                                      color: kMuted,
                                      size: 22,
                                    ),
                                  ),
                                ),
                              const SizedBox(width: 4),
                              // Voice input button
                              VoiceInputButton(
                                size: 20,
                                padding: const EdgeInsets.all(6),
                                onTranscription: (text) {
                                  if (text.isEmpty) return;
                                  final current = controller.text;
                                  final newText = current.isEmpty
                                      ? text
                                      : (current.endsWith(' ')
                                            ? '$current$text'
                                            : '$current $text');
                                  controller.value = TextEditingValue(
                                    text: newText,
                                    selection: TextSelection.collapsed(
                                      offset: newText.length,
                                    ),
                                  );
                                  Future.microtask(
                                    () => focusNode.requestFocus(),
                                  );
                                },
                              ),
                              const SizedBox(width: 4),
                              // Tune / PowerSheet button
                              GestureDetector(
                                onTap: () => _showPowerSheet(context),
                                child: Padding(
                                  padding: const EdgeInsets.all(6),
                                  child: Icon(
                                    Icons.tune_rounded,
                                    color: kMuted,
                                    size: 20,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              // Send button
                              GestureDetector(
                                onTap: canSend ? onSend : null,
                                child: Container(
                                  width: 32,
                                  height: 32,
                                  decoration: BoxDecoration(
                                    color: canSend
                                        ? kOnBackground
                                        : fade(kMuted, 0.08),
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                  child: Center(
                                    child: Icon(
                                      Icons.arrow_upward_rounded,
                                      color: canSend
                                          ? kBackground
                                          : fade(kMuted, 0.4),
                                      size: 18,
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
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Builds the floating pill container with the appropriate glow style.
  Widget _buildFloatingContainer({
    required GlowStyle glowStyle,
    required Color? accentColor,
    required Color kCard,
    required Color kMuted,
    required Widget child,
  }) {
    Color fade(Color c, double a) => c.withValues(alpha: a);
    const radius = 24.0;

    switch (glowStyle) {
      case GlowStyle.none:
        // No glow — original plain pill
        return Container(
          decoration: BoxDecoration(
            color: kCard,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: fade(kMuted, 0.18)),
          ),
          child: child,
        );

      case GlowStyle.leftOnly:
        // Left-only glow strip inside the pill
        final color = accentColor ?? kMuted;
        return Container(
          decoration: BoxDecoration(
            color: kCard,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: fade(kMuted, 0.18)),
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  width: 4,
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(radius),
                      bottomLeft: Radius.circular(radius),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: color.withValues(alpha: 0.6),
                        blurRadius: 8,
                        spreadRadius: 1,
                      ),
                    ],
                  ),
                ),
                Expanded(child: child),
              ],
            ),
          ),
        );

      case GlowStyle.fullBorder:
        // Full pill glow — accent border all around
        final color = accentColor ?? kMuted;
        return CustomPaint(
          foregroundPainter: _PillGlowPainter(
            color: color,
            radius: radius,
            strokeWidth: 3.0,
          ),
          child: Container(
            decoration: BoxDecoration(
              color: kCard,
              borderRadius: BorderRadius.circular(radius),
            ),
            child: child,
          ),
        );
    }
  }
}

/// CustomPainter that draws a glowing border around a fully rounded pill shape.
class _PillGlowPainter extends CustomPainter {
  _PillGlowPainter({
    required this.color,
    required this.radius,
    required this.strokeWidth,
  });

  final Color color;
  final double radius;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final hw = strokeWidth / 2;
    final rect = RRect.fromRectAndRadius(
      Rect.fromLTWH(
        hw,
        hw,
        size.width - strokeWidth,
        size.height - strokeWidth,
      ),
      Radius.circular(radius - hw),
    );

    // 1) Outer glow
    final glowPaint = Paint()
      ..color = color.withValues(alpha: 0.45)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth + 8
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8);
    canvas.drawRRect(rect, glowPaint);

    // 2) Solid accent line
    final solidPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    canvas.drawRRect(rect, solidPaint);
  }

  @override
  bool shouldRepaint(covariant _PillGlowPainter oldDelegate) =>
      oldDelegate.color != color ||
      oldDelegate.radius != radius ||
      oldDelegate.strokeWidth != strokeWidth;
}

// CLI-style input bar (OpenCode terminal aesthetic)
class _CliStyleInputBar extends StatefulWidget {
  const _CliStyleInputBar({
    required this.controller,
    required this.focusNode,
    required this.onSend,
    required this.isBusy,
    required this.canSend,
    required this.backend,
    required this.project,
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
    this.onTakePhoto,
    this.attachIcon = Icons.add_rounded,
    // Claude Code specific props
    this.ccPermissionMode,
    this.ccModel,
    this.onCCModelTap,
    this.onCCPermissionModeChanged,
    // Codex specific props
    this.codexModel,
    this.onCodexModelTap,
    // Codex Collaboration Mode (SDK v0.87.0+)
    this.codexCollabMode,
    this.onCodexCollabModeChanged,
    // Custom accent color (null = use agent/permission mode color)
    this.customAccentColor,
    // Glow style for border accent
    this.glowStyle = GlowStyle.fullBorder,
    // Variant/Thinking Level (all backends)
    this.currentVariant,
    this.availableVariants = const [],
    this.onVariantChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onSend;
  final bool isBusy;
  final bool canSend;
  final AgentType backend;
  final ProjectSummary project;
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
  final VoidCallback? onTakePhoto;
  final IconData attachIcon;
  // Claude Code specific props
  final ClaudeCodePermissionMode? ccPermissionMode;
  final String? ccModel;
  final VoidCallback? onCCModelTap;
  final void Function(ClaudeCodePermissionMode)? onCCPermissionModeChanged;
  // Codex specific props
  final String? codexModel;
  final VoidCallback? onCodexModelTap;
  // Codex Collaboration Mode (SDK v0.87.0+)
  final CodexCollaborationMode? codexCollabMode;
  final void Function(CodexCollaborationMode)? onCodexCollabModeChanged;
  // Custom accent color (null = use agent/permission mode color)
  final Color? customAccentColor;
  // Glow style for border accent
  final GlowStyle glowStyle;
  // Variant/Thinking Level (all backends)
  final String? currentVariant;
  final List<String> availableVariants;
  final void Function(String?)? onVariantChanged;

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

  /// Cycle through variants/thinking levels
  void _cycleVariant() {
    if (widget.availableVariants.isEmpty) return;
    final current = widget.currentVariant;
    if (current == null) {
      widget.onVariantChanged?.call(widget.availableVariants.first);
    } else {
      final currentIndex = widget.availableVariants.indexOf(current);
      final nextIndex = (currentIndex + 1) % widget.availableVariants.length;
      widget.onVariantChanged?.call(widget.availableVariants[nextIndex]);
    }
  }

  /// Show the unified PowerSheet for all backends
  void _showPowerSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => PowerSheet(
        backend: widget.backend,
        project: widget.project,
        onAttachFile: widget.onAttachTap,
        onTakePhoto: widget.onTakePhoto,
        // Model - depends on backend
        currentModel: widget.backend == AgentType.claudeCode
            ? widget.ccModel
            : widget.backend == AgentType.codex
            ? widget.codexModel
            : widget.currentModel?.modelID,
        onModelTap: widget.backend == AgentType.claudeCode
            ? widget.onCCModelTap
            : widget.backend == AgentType.codex
            ? widget.onCodexModelTap
            : widget.onModelTap,
        // Thinking level / variants
        currentVariant: widget.currentVariant,
        availableVariants: widget.availableVariants,
        onVariantChanged: widget.onVariantChanged,
        // OpenCode agents
        agents: widget.agents,
        currentAgent: widget.currentAgent,
        onAgentChanged: widget.onAgentChanged,
        // Claude Code permission mode
        ccPermissionMode: widget.ccPermissionMode,
        onCCPermissionModeChanged: widget.onCCPermissionModeChanged,
        // Codex collaboration mode
        codexCollabMode: widget.codexCollabMode,
        onCodexCollabModeChanged: widget.onCodexCollabModeChanged,
      ),
    );
  }

  /// Format thinking level display for CLI prompt bar
  String _formatThinkingLevelDisplay(String variant) {
    final backend = widget.backend;
    if (backend == AgentType.claudeCode) {
      switch (variant.toLowerCase()) {
        case 'low':
          return 'Low';
        case 'medium':
          return 'Med';
        case 'high':
          return 'High';
        case 'max':
          return 'Max';
        default:
          return variant;
      }
    } else if (backend == AgentType.codex) {
      switch (variant.toLowerCase()) {
        case 'none':
          return 'None';
        case 'minimal':
          return 'Min';
        case 'low':
          return 'Low';
        case 'medium':
          return 'Med';
        case 'high':
          return 'High';
        case 'xhigh':
          return 'XHigh';
        default:
          return variant;
      }
    }
    // OpenCode: capitalize first letter
    if (variant.isEmpty) return 'Default';
    return variant[0].toUpperCase() + variant.substring(1);
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

  /// Get Codex collaboration mode display name
  String _getCodexCollabModeDisplay(CodexCollaborationMode? mode) {
    switch (mode) {
      case CodexCollaborationMode.plan:
        return 'Plan';
      case CodexCollaborationMode.code:
        return 'Code';
      case CodexCollaborationMode.pairProgramming:
        return 'Pair';
      case CodexCollaborationMode.execute:
        return 'Exec';
      case CodexCollaborationMode.custom:
        return 'Custom';
      case null:
        return 'Pair';
    }
  }

  /// Get color for Codex collaboration mode
  Color _getCodexCollabModeColor(
    CodexCollaborationMode? mode,
    OpenCodeTheme theme,
  ) {
    switch (mode) {
      case CodexCollaborationMode.plan:
        return theme.warning; // Planning mode - amber
      case CodexCollaborationMode.code:
        return theme.info; // Code mode - cyan/blue
      case CodexCollaborationMode.pairProgramming:
        return theme.primary; // Default interactive - primary
      case CodexCollaborationMode.execute:
        return theme.success; // Autonomous execution - green
      case CodexCollaborationMode.custom:
        return theme.accent; // Custom - accent
      case null:
        return theme.primary;
    }
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
      case ClaudeCodePermissionMode.delegate:
        return theme.info;
      case ClaudeCodePermissionMode.dontAsk:
        return theme.warning;
      case null:
        return theme.primary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final agent = _getCurrentAgent();
    // Priority: custom accent color > permission mode color (CC) > agent color (OC)
    final isClaudeCode = widget.backend == AgentType.claudeCode;
    final isCodex = widget.backend == AgentType.codex;
    final isOpenCode = widget.backend == AgentType.opencode;
    final Color agentColor;
    if (widget.customAccentColor != null) {
      agentColor = widget.customAccentColor!;
    } else if (isClaudeCode) {
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

                // Main CLI input container with configurable glow style
                _buildCliContainer(
                  theme: theme,
                  agentColor: agentColor,
                  glowStyle: widget.glowStyle,
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
                            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
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
                          enabled: !widget.isOfflineMode && !widget.isBusy,
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
                                  : theme.textMuted.withValues(alpha: 0.4),
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

                      // Bottom info rows - agent + actions on top, model below
                      Padding(
                        padding: EdgeInsets.fromLTRB(
                          16,
                          0,
                          12,
                          MediaQuery.of(context).padding.bottom + 12,
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // ROW 1: Agent/mode + action buttons
                            Row(
                              children: [
                                // Agent/mode selector - opens PowerSheet
                                GestureDetector(
                                  onTap: () => _showPowerSheet(context),
                                  child: Text(
                                    isClaudeCode
                                        ? (widget
                                                  .ccPermissionMode
                                                  ?.displayName ??
                                              'Default')
                                        : isCodex
                                        ? _getCodexCollabModeDisplay(
                                            widget.codexCollabMode,
                                          )
                                        : (agent?.displayName ?? 'Build'),
                                    style: TextStyle(
                                      color: isCodex
                                          ? _getCodexCollabModeColor(
                                              widget.codexCollabMode,
                                              theme,
                                            )
                                          : agentColor,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),

                                const Spacer(),

                                // Attachment button
                                if (widget.onAttachTap != null)
                                  GestureDetector(
                                    onTap: widget.onAttachTap,
                                    child: Padding(
                                      padding: const EdgeInsets.only(right: 12),
                                      child: Icon(
                                        widget.attachIcon,
                                        color: theme.textMuted,
                                        size: 22,
                                      ),
                                    ),
                                  ),

                                // Voice input button
                                Consumer(
                                  builder: (context, ref, _) {
                                    return VoiceInputButton(
                                      size: 22,
                                      padding: const EdgeInsets.only(right: 10),
                                      onTranscription: (text) {
                                        if (text.isEmpty) return;
                                        final ctrl = widget.controller;
                                        final current = ctrl.text;
                                        final newText = current.isEmpty
                                            ? text
                                            : (current.endsWith(' ')
                                                  ? '$current$text'
                                                  : '$current $text');
                                        ctrl.value = TextEditingValue(
                                          text: newText,
                                          selection: TextSelection.collapsed(
                                            offset: newText.length,
                                          ),
                                        );
                                        Future.microtask(
                                          () => widget.focusNode.requestFocus(),
                                        );
                                      },
                                    );
                                  },
                                ),

                                // Send button (minimal)
                                GestureDetector(
                                  onTap: widget.canSend ? widget.onSend : null,
                                  child: Container(
                                    width: 28,
                                    height: 28,
                                    decoration: BoxDecoration(
                                      color: widget.canSend
                                          ? theme.text
                                          : theme.textMuted.withValues(
                                              alpha: 0.15,
                                            ),
                                      borderRadius: BorderRadius.circular(6),
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

                            const SizedBox(height: 6),

                            // ROW 2: Model + variant/thinking level
                            GestureDetector(
                              onTap: isClaudeCode
                                  ? widget.onCCModelTap
                                  : isCodex
                                  ? widget.onCodexModelTap
                                  : widget.onModelTap,
                              child: Row(
                                children: [
                                  // Model name
                                  if (isClaudeCode)
                                    Text(
                                      _getCCModelDisplayName(widget.ccModel),
                                      style: TextStyle(
                                        color: theme.textMuted,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    )
                                  else if (isCodex)
                                    Text(
                                      _getCodexModelDisplayName(
                                        widget.codexModel,
                                      ),
                                      style: TextStyle(
                                        color: theme.textMuted,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    )
                                  else ...[
                                    Text(
                                      _getModelDisplayName(widget.currentModel),
                                      style: TextStyle(
                                        color: theme.textMuted,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                    // Provider name (muted) - only for OpenCode
                                    if (_getProviderName(
                                      widget.currentModel,
                                    ).isNotEmpty) ...[
                                      const SizedBox(width: 5),
                                      Text(
                                        _getProviderName(widget.currentModel),
                                        style: TextStyle(
                                          color: theme.textMuted.withValues(
                                            alpha: 0.4,
                                          ),
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],
                                  ],

                                  // Variant / thinking level (if applicable)
                                  if (isClaudeCode &&
                                      widget.currentVariant != null) ...[
                                    Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                      ),
                                      child: Text(
                                        '·',
                                        style: TextStyle(
                                          color: theme.textMuted.withValues(
                                            alpha: 0.3,
                                          ),
                                          fontSize: 12,
                                        ),
                                      ),
                                    ),
                                    GestureDetector(
                                      onTap: () => _showPowerSheet(context),
                                      child: Text(
                                        _formatThinkingLevelDisplay(
                                          widget.currentVariant!,
                                        ),
                                        style: TextStyle(
                                          color: theme.primary.withValues(
                                            alpha: 0.7,
                                          ),
                                          fontSize: 12,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ),
                                  ] else if (isCodex &&
                                      widget.currentVariant != null &&
                                      widget.currentVariant != 'medium') ...[
                                    Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                      ),
                                      child: Text(
                                        '·',
                                        style: TextStyle(
                                          color: theme.textMuted.withValues(
                                            alpha: 0.3,
                                          ),
                                          fontSize: 12,
                                        ),
                                      ),
                                    ),
                                    GestureDetector(
                                      onTap: () => _showPowerSheet(context),
                                      child: Text(
                                        _formatThinkingLevelDisplay(
                                          widget.currentVariant!,
                                        ),
                                        style: TextStyle(
                                          color: theme.primary.withValues(
                                            alpha: 0.7,
                                          ),
                                          fontSize: 12,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ),
                                  ] else if (isOpenCode &&
                                      widget.availableVariants.isNotEmpty) ...[
                                    Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                      ),
                                      child: Text(
                                        '·',
                                        style: TextStyle(
                                          color: theme.textMuted.withValues(
                                            alpha: 0.3,
                                          ),
                                          fontSize: 12,
                                        ),
                                      ),
                                    ),
                                    GestureDetector(
                                      onTap: widget.onVariantChanged != null
                                          ? () => _cycleVariant()
                                          : null,
                                      child: Text(
                                        widget.currentVariant ?? 'Default',
                                        style: TextStyle(
                                          color: widget.currentVariant != null
                                              ? theme.primary.withValues(
                                                  alpha: 0.7,
                                                )
                                              : theme.textMuted,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
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
      ),
    );
  }

  /// Builds the CLI input container with the appropriate glow style.
  Widget _buildCliContainer({
    required OpenCodeTheme theme,
    required Color agentColor,
    required GlowStyle glowStyle,
    required Widget child,
  }) {
    const radius = 20.0;
    final baseDecoration = BoxDecoration(
      color: theme.backgroundElement,
      borderRadius: const BorderRadius.only(
        topLeft: Radius.circular(radius),
        topRight: Radius.circular(radius),
      ),
    );

    switch (glowStyle) {
      case GlowStyle.none:
        // No glow — plain container
        return Container(
          key: const ValueKey('cli-input-container'),
          margin: EdgeInsets.zero,
          decoration: baseDecoration,
          child: child,
        );

      case GlowStyle.leftOnly:
        // Left-only glow strip (original design)
        return Container(
          key: const ValueKey('cli-input-container'),
          margin: EdgeInsets.zero,
          decoration: baseDecoration,
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  width: 4,
                  decoration: BoxDecoration(
                    color: agentColor,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(radius),
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
                Expanded(child: child),
              ],
            ),
          ),
        );

      case GlowStyle.fullBorder:
        // Full ∩-shaped glow border (left + top + right)
        return CustomPaint(
          key: const ValueKey('cli-input-container'),
          foregroundPainter: _GlowBorderPainter(
            color: agentColor,
            radius: radius,
            strokeWidth: 3.5,
          ),
          child: Container(
            margin: EdgeInsets.zero,
            decoration: baseDecoration,
            child: child,
          ),
        );
    }
  }

  Agent? _getCurrentAgent() {
    final primaryAgents = widget.agents.where((a) => a.isPrimary).toList();
    if (primaryAgents.isEmpty) return null;
    return primaryAgents.firstWhere(
      (a) => a.name == widget.currentAgent,
      orElse: () => primaryAgents.first,
    );
  }
}

/// CustomPainter that draws a glowing ∩-shaped border (left + top + right)
/// on the CLI input bar container.
class _GlowBorderPainter extends CustomPainter {
  _GlowBorderPainter({
    required this.color,
    required this.radius,
    required this.strokeWidth,
  });

  final Color color;
  final double radius;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    // Inset the path by half stroke width so the stroke sits on the container edge
    final hw = strokeWidth / 2;
    final r = radius - hw; // adjusted corner radius

    final path = Path()
      // Start at bottom-left edge
      ..moveTo(hw, size.height)
      // Up the left side to the start of the top-left corner
      ..lineTo(hw, radius)
      // Top-left rounded corner
      ..arcToPoint(Offset(radius, hw), radius: Radius.circular(r))
      // Across the top
      ..lineTo(size.width - radius, hw)
      // Top-right rounded corner
      ..arcToPoint(Offset(size.width - hw, radius), radius: Radius.circular(r))
      // Down the right side to the bottom
      ..lineTo(size.width - hw, size.height);

    // 1) Draw the outer glow (blurred, wider stroke)
    final glowPaint = Paint()
      ..color = color.withValues(alpha: 0.45)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth + 8
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8);
    canvas.drawPath(path, glowPaint);

    // 2) Draw the solid accent line on top
    final solidPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.butt;
    canvas.drawPath(path, solidPaint);
  }

  @override
  bool shouldRepaint(covariant _GlowBorderPainter oldDelegate) =>
      oldDelegate.color != color ||
      oldDelegate.radius != radius ||
      oldDelegate.strokeWidth != strokeWidth;
}

/// Content widget for agent and permission selection in DetailSheet
class _AgentAndPermissionContent extends ConsumerStatefulWidget {
  const _AgentAndPermissionContent({
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
  ConsumerState<_AgentAndPermissionContent> createState() =>
      _AgentAndPermissionContentState();
}

class _AgentAndPermissionContentState
    extends ConsumerState<_AgentAndPermissionContent> {
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

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
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
                      children: secondaryAgents.asMap().entries.map((entry) {
                        final index = entry.key;
                        final agent = entry.value;
                        final isSelected = agent.name == widget.currentAgent;
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
              preset.shortName,
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
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

/// Chip widget for variant/thinking level selection
class _VariantChip extends StatelessWidget {
  const _VariantChip({
    required this.label,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final String label;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected
              ? theme.primary.withValues(alpha: 0.15)
              : theme.backgroundPanel,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? theme.primary : theme.borderSubtle,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? theme.primary : theme.text,
            fontSize: 13,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

// Model selector content for DetailSheet
class _ModelSelectorContent extends ConsumerStatefulWidget {
  const _ModelSelectorContent({required this.onModelSelected});

  final void Function(String model) onModelSelected;

  @override
  ConsumerState<_ModelSelectorContent> createState() =>
      _ModelSelectorContentState();
}

class _ModelSelectorContentState extends ConsumerState<_ModelSelectorContent> {
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
      // Update available variants for OpenCode thinking levels
      if (_providersData != null) {
        ref
            .read(openCodeVariantProvider.notifier)
            .updateAvailableVariants(_providersData!);
      }
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
    final kOnBackground = theme.text;
    final kMuted = theme.textMuted;

    if (_loading) {
      return const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: Text(
          'Failed to load models: $_error',
          style: TextStyle(color: kMuted),
        ),
      );
    }

    final rawProviders = _providersData?['providers'] as List<dynamic>? ?? [];

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

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        if (_currentModel != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text(
              'Current: $_currentModel',
              style: TextStyle(fontSize: 13, color: kMuted),
            ),
          ),
        if (providers.isEmpty)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'No providers configured.',
              style: TextStyle(color: kMuted),
            ),
          )
        else
          for (final provider in providers) ...[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _buildProviderSection(provider as Map<String, dynamic>),
            ),
            const SizedBox(height: 16),
          ],
      ],
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

// Task 1: Retry status countdown banner
class _RetryStatusBanner extends StatefulWidget {
  const _RetryStatusBanner({required this.status});

  final SessionStatus status;

  @override
  State<_RetryStatusBanner> createState() => _RetryStatusBannerState();
}

class _RetryStatusBannerState extends State<_RetryStatusBanner> {
  Timer? _countdownTimer;
  int _remainingSeconds = 0;

  @override
  void initState() {
    super.initState();
    _startCountdown();
  }

  @override
  void didUpdateWidget(_RetryStatusBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.status.next != oldWidget.status.next) {
      _startCountdown();
    }
  }

  void _startCountdown() {
    _countdownTimer?.cancel();
    final nextTimestamp = widget.status.next;
    if (nextTimestamp == null || nextTimestamp == 0) {
      _remainingSeconds = 0;
      return;
    }
    _updateRemaining();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      _updateRemaining();
    });
  }

  void _updateRemaining() {
    final now = DateTime.now().millisecondsSinceEpoch;
    final next = widget.status.next ?? 0;
    // next could be seconds or milliseconds — handle both
    final nextMs = next > 1e12 ? next : next * 1000;
    final remaining = ((nextMs - now) / 1000).ceil();
    setState(() {
      _remainingSeconds = remaining > 0 ? remaining : 0;
    });
    if (remaining <= 0) {
      _countdownTimer?.cancel();
    }
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final attempt = widget.status.attempt ?? 0;
    final message = widget.status.message ?? 'Retrying...';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: theme.warning.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.warning.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(Icons.refresh_rounded, color: theme.warning, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Retry #$attempt: $message'
              '${_remainingSeconds > 0 ? '. Next attempt in ${_remainingSeconds}s' : ''}',
              style: TextStyle(
                color: theme.text,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

// Task 2: Revert state banner
class _RevertStateBanner extends StatelessWidget {
  const _RevertStateBanner({required this.onUndoRevert});

  final VoidCallback onUndoRevert;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: theme.info.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.info.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(Icons.history_rounded, color: theme.info, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Session reverted',
              style: TextStyle(
                color: theme.text,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          TextButton(
            onPressed: onUndoRevert,
            style: TextButton.styleFrom(
              foregroundColor: theme.info,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text(
              'Undo Revert',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// Claude Code: Turn-level undo bar shown after assistant messages that
/// modified files. The SDK only supports `rewindFiles(userMessageId)` which
/// reverts ALL file changes back to a checkpoint — there is no per-file undo.
/// This bar makes that behaviour transparent instead of misleading per-card
/// undo buttons.
///
/// Design matches the compact card system: bgRaised, circular(12), cardBorderSubtle,
/// JetBrains Mono for paths, DetailSheet for the expanded file list.
class _CCUndoTurnBar extends StatelessWidget {
  const _CCUndoTurnBar({required this.changedFiles, required this.onUndo});

  /// Paths of files changed in this turn (extracted from tool call inputs).
  final List<String> changedFiles;

  /// Called when the user taps undo. Should call rewindToCheckpoint().
  final VoidCallback onUndo;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final fileCount = changedFiles.length;
    final label = fileCount == 1
        ? '1 file changed'
        : '$fileCount files changed';

    return GestureDetector(
      onTap: () => _showChangedFilesSheet(context),
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: theme.cardBorderSubtle),
        ),
        child: Row(
          children: [
            Icon(Icons.history_rounded, color: theme.warning, size: 16),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: theme.cardHeaderText,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                changedFiles.map((p) => p.split('/').last).join(', '),
                style: TextStyle(color: theme.textMuted, fontSize: 12),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              height: 28,
              child: OutlinedButton.icon(
                onPressed: onUndo,
                icon: Icon(Icons.undo_rounded, size: 14, color: theme.warning),
                label: Text(
                  'Undo',
                  style: TextStyle(
                    color: theme.warning,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  side: BorderSide(color: theme.warning.withValues(alpha: 0.5)),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showChangedFilesSheet(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    DetailSheet.show(
      context: context,
      title: 'Undo File Changes',
      initialSize: 0.35,
      minSize: 0.2,
      maxSize: 0.6,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // File list section
          DetailSection(
            label: '${changedFiles.length} files changed this turn',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final path in changedFiles)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      children: [
                        Icon(
                          Icons.description_outlined,
                          color: theme.textMuted,
                          size: 15,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            path,
                            style: TextStyle(
                              fontFamily: 'monospace',
                              color: theme.text,
                              fontSize: 12,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),

          // Undo button (matches edit/write card undo style: OutlinedButton, warning color)
          Padding(
            padding: const EdgeInsets.all(16),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () {
                  Navigator.of(context).pop();
                  onUndo();
                },
                icon: const Icon(Icons.undo, size: 18),
                label: const Text('Undo all changes from this turn'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: theme.warning,
                  side: BorderSide(color: theme.warning.withValues(alpha: 0.5)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact indicator shown below the floating header when Claude Code
/// subagents (Task tool calls) are actively running.
class _SubagentActivityIndicator extends StatelessWidget {
  const _SubagentActivityIndicator({
    required this.messages,
    required this.isStreaming,
  });

  final List<ChatMessage> messages;
  final bool isStreaming;

  @override
  Widget build(BuildContext context) {
    if (!isStreaming) return const SizedBox.shrink();

    // Find running Task tool calls from the most recent assistant message
    final activeSubagentNames = <String>[];
    for (var i = messages.length - 1; i >= 0; i--) {
      final msg = messages[i];
      if (msg.role != MessageRole.assistant) continue;
      for (final tool in msg.toolCalls) {
        final name = tool.name.toLowerCase();
        if ((name == 'task' || name == 'dispatch_agent') &&
            (tool.status == 'running' || tool.status == 'pending')) {
          final subagentType =
              tool.input['subagent_type'] as String? ??
              tool.input['agent'] as String? ??
              tool.input['agentName'] as String? ??
              tool.title ??
              'subagent';
          activeSubagentNames.add(subagentType);
        }
      }
      // Only check the most recent assistant message
      break;
    }

    if (activeSubagentNames.isEmpty) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final label = activeSubagentNames.join(', ');

    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: theme.info.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: theme.info.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 10,
              height: 10,
              child: CircularProgressIndicator(
                strokeWidth: 1.5,
                color: theme.info,
              ),
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                label,
                style: TextStyle(color: theme.info, fontSize: 11),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
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
