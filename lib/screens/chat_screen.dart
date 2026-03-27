import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/design_tokens.dart';
import 'package:share_plus/share_plus.dart';

import '../models/agent.dart';
import '../models/agent_type.dart';
import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/pi.dart';
import 'sheets/cx_apps_sheet.dart';
import 'sheets/cx_agents_sheet.dart';
import 'sheets/cx_rollback_sheet.dart';
import 'sheets/cx_model_sheet.dart';
import 'sheets/cx_remote_skills_sheet.dart';
import 'sheets/cc_mcp_sheet.dart';
import 'sheets/cc_tools_sheet.dart';
import 'sheets/cc_commands_sheet.dart';
import 'sheets/cc_model_sheet.dart';
import 'sheets/pi_model_sheet.dart';
import 'sheets/cc_memory_scope_picker.dart';
import 'sheets/attachment_options_sheet.dart';
import 'dialogs/share_dialog.dart';
import 'dialogs/help_dialog.dart';
import 'dialogs/timeline_dialog.dart';
import 'dialogs/fork_dialog.dart';
import 'dialogs/rename_dialog.dart';
import 'dialogs/models_dialog.dart';
import 'dialogs/agents_dialog.dart';
import '../widgets/chat/floating_header.dart';
import '../widgets/chat/input_bar_content.dart';
import '../widgets/chat/command_autocomplete.dart';
import '../widgets/chat/custom_tool_autocomplete.dart';
import '../widgets/chat/cc_queue_bar.dart';

import 'sheets/cx_skills_sheet_content.dart';
import '../models/command.dart';
import '../models/file_attachment.dart';
import '../models/message.dart';
import '../models/question.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../models/session_context.dart';
import '../models/vcs.dart';
import '../providers/chat_provider.dart';
import 'chat/mcp_oauth_snackbar.dart';
import 'chat/oc_message_delete_action.dart';
import 'chat/cc_elicitation_form_dialog.dart';
import 'chat/command_handler.dart';
import 'chat/menu_handlers.dart';
import 'chat/send_message.dart';
import 'chat/session_hydrator.dart';
import 'chat/commands_loader.dart';
import 'chat/context_loader.dart';
import 'chat/session_forker.dart';
import 'chat/session_compactor.dart';
import 'chat/project_initializer.dart';
import 'chat/permission_responder.dart';
import 'chat/transcript_exporter.dart';
import '../widgets/chat/variant_card_builder.dart';
import '../providers/claude_code_provider.dart';
import '../providers/connection_provider.dart';

import '../providers/codex_settings_provider.dart';
import '../providers/pi_provider.dart';
import 'pi/pi_extension_ui_request_handler.dart';
import 'sheets/pi_session_sidebar_sheet.dart';
import '../providers/file_search_provider.dart';
import '../providers/opencode_variant_provider.dart';
import '../providers/claude_code_variant_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../services/haptics_service.dart';
import '../services/image_picker_service.dart';
import '../services/websocket_service.dart';
import '../theme/opencode_theme.dart';
import '../widgets/file_tagging.dart';
import '../widgets/retry_indicator.dart';
import '../widgets/message_bubble.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/permission_prompt.dart';
import '../widgets/question_prompt_sheet.dart';
import '../widgets/session_sidebar.dart';
import '../widgets/chat/compact_tool_card.dart';
import '../widgets/chat/compact_edit_card.dart';
import '../widgets/chat/compact_write_card.dart';
import '../widgets/chat/compact_todos_card.dart';
import '../widgets/chat/compact_agent_card.dart';

import '../models/todo.dart';
import '../widgets/multi_agent_tree.dart';
import '../widgets/power_sheet.dart';
import '../widgets/project_tools_sheet.dart';
import '../widgets/app_background.dart';
import '../widgets/opencode_branding.dart';
import '../providers/appearance_provider.dart';
import 'diff_view_screen.dart';
import '../utils/error_utils.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import '../widgets/chat/retry_status_banner.dart';
import '../widgets/chat/revert_state_banner.dart';
import '../widgets/chat/subagent_activity.dart';
import '../widgets/chat/message_group.dart';
import '../widgets/chat/message_helpers.dart';

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
       isCodex = false,
       isPi = false,
       piSession = null,
       piDraftCwd = null,
       piDraftTitle = null;

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
       isCodex = false,
       isPi = false,
       piSession = null,
       piDraftCwd = null,
       piDraftTitle = null;

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
       isCodex = false,
       isPi = false,
       piSession = null,
       piDraftCwd = null,
       piDraftTitle = null;

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
       isCodex = true,
       isPi = false,
       piSession = null,
       piDraftCwd = null,
       piDraftTitle = null;

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
       isCodex = true,
       isPi = false,
       piSession = null,
       piDraftCwd = null,
       piDraftTitle = null;

  /// Named constructor for Pi sessions
  const ChatScreen.pi({super.key, required this.piSession, this.initialPrompt})
    : project = const ProjectSummary(id: '', name: '', path: ''),
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
      cxDraftCwd = null,
      cxDraftTitle = null,
      cxDraftModel = null,
      isClaudeCode = false,
      isCodex = false,
      isPi = true,
      piDraftCwd = null,
      piDraftTitle = null;

  /// Named constructor for a new Pi chat (draft, no session yet)
  const ChatScreen.piDraft({
    super.key,
    required String cwd,
    String? title,
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
       cxDraftCwd = null,
       cxDraftTitle = null,
       cxDraftModel = null,
       isClaudeCode = false,
       isCodex = false,
       isPi = true,
       piSession = null,
       piDraftCwd = cwd,
       piDraftTitle = title;
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
  final bool isPi;
  final PiSessionInfo? piSession;
  final String? piDraftCwd;
  final String? piDraftTitle;
  final String? initialPrompt;
  bool get isOpenCode => !isClaudeCode && !isCodex && !isPi;

  /// Get the effective session ID
  String get effectiveSessionId => isClaudeCode
      ? (ccSession?.id ?? '')
      : isCodex
      ? (cxThread?.id ?? '')
      : isPi
      ? (piSession?.id ?? '')
      : session.id;

  /// Get the effective project path
  String get effectivePath => isClaudeCode
      ? (ccSession?.cwd ?? ccDraftCwd ?? '')
      : isCodex
      ? (cxThread?.cwd ?? cxDraftCwd ?? '')
      : isPi
      ? (piSession?.cwd ?? piDraftCwd ?? '')
      : project.path;

  /// Get the effective title
  String get effectiveTitle => isClaudeCode
      ? (ccSession?.displayTitle ?? ccDraftTitle ?? 'Claude Code')
      : isCodex
      ? (cxThread?.displayTitle ?? cxDraftTitle ?? 'Codex')
      : isPi
      ? (piSession?.name ?? piSession?.firstMessage ?? piDraftTitle ?? 'Pi')
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
  String? _lastShownMcpOAuthUrl;
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
  // CC queue: listen for ccIsStreaming true→false to auto-send pending message
  ProviderSubscription<bool>? _ccQueueSubscription;
  // Pi extension UI stream subscription
  StreamSubscription<PiStreamMessage>? _piExtensionUiSub;
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
      } else if (widget.isPi) {
        final sessionId = widget.piSession?.id ?? '';
        if (sessionId.isNotEmpty) {
          bridge.setView(sessionId: sessionId, agent: 'pi');
        }
      }
      // Set up Pi power menu callback so PowerSheet can trigger Pi actions
      if (widget.isPi) {
        piPowerMenuCallback = _handlePiMenuAction;
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
        } else if (widget.isPi) {
          final sessionId = widget.piSession?.id ?? '';
          if (sessionId.isNotEmpty) {
            bridge.setView(sessionId: sessionId, agent: 'pi');
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
      // CC queue: auto-send pending message when turn completes
      _ccQueueSubscription = ref.listenManual(
        chatSessionProvider.select((s) => s.ccIsStreaming),
        (previous, next) {
          // Detect transition from streaming → idle
          if (previous == true && next == false) {
            _autoSendPendingCCMessage();
          }
        },
      );
    }
    // Refresh header context pill when token usage changes (CC/CX turn ends)
    if (widget.isClaudeCode) {
      ref.listenManual(
        chatSessionProvider.select((s) => s.ccTokenUsage),
        (_, __) => _loadSessionContext(),
      );
    } else if (widget.isCodex) {
      ref.listenManual(
        chatSessionProvider.select((s) => s.cxTokenUsage),
        (_, __) => _loadSessionContext(),
      );
    }
    // Pi: listen for extension UI requests from pi_stream
    if (widget.isPi) {
      final piBridge = ref.read(piBridgeServiceProvider);
      _piExtensionUiSub = piBridge.streamMessages.listen((message) {
        if (!mounted) return;
        if (message.type == 'extension-ui-request') {
          handlePiExtensionUiRequest(
            context: context,
            bridge: piBridge,
            request: message,
            projectPath: widget.piSession?.cwd ?? widget.piDraftCwd,
            composerController: _controller,
          );
        } else if (message.type == 'agent-end') {
          // Refresh context/usage after agent completes a turn.
          // Session list + state updates are handled by the bridge broadcast
          // path (runtime_sessions / runtime_state) which flows through
          // GlobalSessionStatusNotifier → piSessionsProvider invalidation.
          _loadSessionContext();
        }
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
    final shouldLoadContext = await hydrateSession(
      ref: ref,
      widget: widget,
      resyncingAfterReconnect: _resyncingAfterReconnect,
      setPaginationState:
          ({required bool loadingMore, required bool loadedAll}) {
            if (mounted) {
              setState(() {
                _loadingMoreMessages = loadingMore;
                _hasLoadedAllMessages = loadedAll;
              });
            }
          },
      scrollToBottom: ({bool animate = true}) =>
          _scrollToBottom(animate: animate),
    );
    if (shouldLoadContext) _loadSessionContext();
  }

  // Feature 2 & 3: Load available commands and agents
  Future<void> _loadCommandsAndAgents() async {
    // Claude Code mode
    if (widget.isClaudeCode) {
      final commands = await loadClaudeCodeCommands(
        ref: ref,
        cwd: widget.ccSession?.cwd ?? widget.ccDraftCwd,
      );
      if (mounted) setState(() => _commands = commands);
      return;
    }
    // Codex mode
    if (widget.isCodex) {
      if (mounted) {
        setState(() {
          _agents = const [];
          _commands = kCodexBuiltinCommands;
        });
      }
      return;
    }
    // Pi mode
    if (widget.isPi) {
      final commands = await loadPiCommands(
        ref: ref,
        cwd: widget.piSession?.cwd ?? widget.piDraftCwd,
      );
      if (mounted)
        setState(() {
          _agents = const [];
          _commands = commands;
        });
      return;
    }
    // OpenCode mode
    final result = await loadOpenCodeCommandsAndAgents(
      ref: ref,
      projectPath: widget.project.path,
    );
    if (mounted) {
      setState(() {
        _commands = result.commands;
        _agents = result.agents;
      });
    }
    // Also load variants for thinking level support (SDK v1.1.23+)
    if (result.commands.isNotEmpty) _loadOpenCodeVariants();
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

  Future<void> _loadSessionContext() async {
    if (_loadingContext) return;
    setState(() => _loadingContext = true);
    final result = await loadSessionContext(ref: ref, widget: widget);
    if (mounted) {
      setState(() {
        _sessionContext = result;
        _loadingContext = false;
      });
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
    return forkSession(
      context: context,
      ref: ref,
      widget: widget,
      haptics: _haptics,
      messageId: messageId,
    );
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
          content: Text('Failed to revert: ${humanizeError(e)}'),
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
          content: Text('Failed to undo revert: ${humanizeError(e)}'),
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
          content: Text('Failed to revert: ${humanizeError(e)}'),
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
          content: Text('Failed to share session: ${humanizeError(e)}'),
          backgroundColor: theme.error,
        ),
      );
    }
  }

  void _showShareDialog(String url) => showShareDialog(context, url);

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
          content: Text('Failed to unshare: ${humanizeError(e)}'),
          backgroundColor: theme.error,
        ),
      );
    }
  }

  // Feature 9: Summarize/Compact Session
  Future<void> _compactSession() async {
    return compactSession(
      context: context,
      ref: ref,
      sessionId: widget.session.id,
      projectPath: widget.project.path,
      haptics: _haptics,
      onRefreshContext: _loadSessionContext,
    );
  }

  // Feature 20: Initialize Project (Create AGENTS.md)
  Future<void> _initializeProject() async {
    return initializeProject(
      context: context,
      ref: ref,
      sessionId: widget.session.id,
      projectPath: widget.project.path,
      haptics: _haptics,
    );
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

  void _showMemoryScopePicker() => showMemoryScopePicker(
    context,
    onScopeSelected: _insertMemoryPromptTemplate,
  );

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

  void _showAttachmentOptions(BuildContext context) => showAttachmentOptions(
    context,
    onPickCamera: _pickImageFromCamera,
    onPickGallery: _pickImageFromGallery,
  );

  void _showClaudeCodeToolsSheet() => showCcToolsSheet(
    context,
    onShowMemoryScopePicker: _showMemoryScopePicker,
  );

  void _showClaudeCodeCommandsSheet() => showCcCommandsSheet(
    context,
    controller: _controller,
    inputFocusNode: _inputFocusNode,
  );

  void _showClaudeCodeMcpSheet() => showCcMcpSheet(
    context,
    fallbackCwd: widget.ccSession?.cwd ?? widget.ccDraftCwd,
  );

  void _handleClaudeCodeMenuAction(String value) => handleClaudeCodeMenuAction(
    context,
    value,
    onStop: _stopGeneration,
    onShowProjectTools: _showProjectToolsSheet,
    onShowModel: _showClaudeCodeModelSheet,
    onShowTools: _showClaudeCodeToolsSheet,
    onShowCommands: _showClaudeCodeCommandsSheet,
    onShowMcp: _showClaudeCodeMcpSheet,
    onFork: _forkSession,
  );

  void _handleCodexMenuAction(String value) => handleCodexMenuAction(
    context,
    ref,
    value,
    onStop: _stopGeneration,
    onShowProjectTools: _showProjectToolsSheet,
    onShowSkills: _showCodexSkillsSheet,
    onShowAgents: _showCodexAgentsSheet,
    onStartReview: _startCodexReview,
  );

  void _handlePiMenuAction(String value) => handlePiMenuAction(
    context,
    value,
    onStop: _stopGeneration,
    onCycleThinking: _cyclePiThinkingLevel,
    onShowSidebar: _showPiSidebarSheet,
    onCompact: _piCompact,
    onNewSession: _piNewSession,
  );

  Future<void> _piCompact() async {
    final piBridge = ref.read(piBridgeServiceProvider);
    final chatState = ref.read(chatSessionProvider);
    try {
      await piBridge.compact(projectPath: chatState.piCwd);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Context compacted')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Compact failed: $e')));
      }
    }
  }

  Future<void> _piNewSession() async {
    final piBridge = ref.read(piBridgeServiceProvider);
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.piCwd ?? '';
    try {
      await piBridge.newSession(projectPath: cwd);
      // Fetch the new state to get new session ID
      final piState = await piBridge.getState(projectPath: cwd);
      ref
          .read(chatSessionProvider.notifier)
          .setPiSession(
            sessionId: piState.sessionId,
            cwd: cwd,
            model: piState.model != null
                ? '${piState.model!.provider}/${piState.model!.id}'
                : null,
            thinkingLevel: piState.thinkingLevel,
          );
      ref.invalidate(piSessionsProvider(null));
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('New session created')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed: $e')));
      }
    }
  }

  void _showPiModelSheet() => showPiModelSheet(context);

  Future<void> _cyclePiThinkingLevel() async {
    final piBridge = ref.read(piBridgeServiceProvider);
    final chatState = ref.read(chatSessionProvider);
    try {
      final newLevel = await piBridge.cycleThinkingLevel(
        projectPath: chatState.piCwd,
      );
      ref.read(chatSessionProvider.notifier).setPiThinkingLevel(newLevel);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to cycle thinking level: $e')),
      );
    }
  }

  void _showPiSidebarSheet() {
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.piCwd;
    if (cwd == null || cwd.isEmpty) return;
    showPiSessionSidebarSheet(
      context: context,
      cwd: cwd,
      currentSessionId: chatState.piSessionId ?? '',
      state: null,
      onOpenSession: (session) {
        Navigator.pop(context);
        ref
            .read(chatSessionProvider.notifier)
            .setPiSession(sessionId: session.id, cwd: session.cwd);
      },
      onForkFromEntry: (entryId) {
        Navigator.pop(context);
        _forkPiSessionFromEntry(entryId);
      },
    );
  }

  Future<void> _forkPiSessionFromEntry(String entryId) async {
    final piBridge = ref.read(piBridgeServiceProvider);
    final chatState = ref.read(chatSessionProvider);
    try {
      final result = await piBridge.fork(
        entryId: entryId,
        projectPath: chatState.piCwd,
      );
      if (!mounted) return;
      if (!result.cancelled) {
        // After fork, reload state to pick up the new session branch
        ref.invalidate(piStateProvider(chatState.piCwd));
        ref.invalidate(piSessionsProvider(null));
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Session forked')));
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Failed to fork session: $e')));
    }
  }

  void _showCodexAppsSheet() {
    // Delegate to modular sheet
    CxAppsSheet.show(context);
  }

  void _showCodexRemoteSkillsSheet() {
    // Delegate to modular sheet
    CxRemoteSkillsSheet.show(context);
  }

  void _showCodexAgentsSheet() {
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.cxCwd ?? widget.cxThread?.cwd ?? widget.cxDraftCwd;
    if (cwd == null || cwd.isEmpty) return;
    showCodexAgentsSheet(context, ref, cwd);
  }

  void _showCodexSkillsSheet() {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.cxCwd ?? widget.cxThread?.cwd ?? widget.cxDraftCwd;
    DetailSheet.show(
      context: context,
      title: 'Codex Skills',
      initialSize: 0.6,
      child: CxSkillsSheetContent(
        bridge: ref.read(bridgeServiceProvider),
        cwd: cwd,
        theme: theme,
        onBrowseRemote: () {
          Navigator.pop(context); // close current sheet
          CxRemoteSkillsSheet.show(context);
        },
      ),
    );
  }

  void _showCodexRollbackSheet() => showCodexRollbackSheet(context, ref);

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

  void _setPiThinkingLevel(String? wireValue) {
    if (wireValue == null) return;
    final level = PiThinkingLevel.fromWireValue(wireValue);
    final piBridge = ref.read(piBridgeServiceProvider);
    final chatState = ref.read(chatSessionProvider);
    piBridge
        .setThinkingLevel(level: level, projectPath: chatState.piCwd)
        .then(
          (_) =>
              ref.read(chatSessionProvider.notifier).setPiThinkingLevel(level),
        );
  }

  void _showCodexModelSheet() {
    // Delegate to modular dynamic sheet (fetches from Codex model/list API)
    CxModelSheet.show(context);
  }

  void _showClaudeCodeModelSheet() => showCcModelSheet(
    context,
    ccSessionCwd: widget.ccSession?.cwd,
    ccSessionModel: widget.ccSession?.model,
    ccDraftCwd: widget.ccDraftCwd,
    ccDraftModel: widget.ccDraftModel,
  );

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
          textColor: OpenCodeTheme.of(context).selectedListItemText,
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
    if (widget.isOpenCode) {
      _lastShownMcpOAuthUrl = maybeShowMcpOAuthFailureSnackbar(
        context: context,
        previous: previous?.mcpOAuthPending,
        next: next.mcpOAuthPending,
        lastShownUrl: _lastShownMcpOAuthUrl,
      );
    }

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
  void _selectCommand(SlashCommand command) => handleSlashCommand(
    context: context,
    ref: ref,
    command: command,
    session: widget.session,
    project: widget.project,
    controller: _controller,
    callbacks: CommandCallbacks(
      shareSession: _shareSession,
      unshareSession: _unshareSession,
      showHelp: _showHelpDialog,
      showRename: _showRenameSessionDialog,
      copyTranscript: _copyTranscriptToClipboard,
      exportTranscript: _exportTranscript,
      showTimeline: _showTimelineDialog,
      showFork: _showForkDialog,
      toggleThinking: _toggleThinkingVisibility,
      showModels: _showModelsDialog,
      showAgents: _showAgentsDialog,
    ),
    onDismiss: () => setState(() {
      _showCommandAutocomplete = false;
      _commandFilter = '';
    }),
  );

  // ============================================================
  // Slash Command Implementations
  // ============================================================
  /// Show help dialog with all available commands
  void _showHelpDialog() => showHelpDialog(context, commands: _commands);

  /// Show rename session dialog
  void _showRenameSessionDialog() => showRenameSessionDialog(
    context,
    ref: ref,
    session: widget.session,
    project: widget.project,
  );

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
  void _exportTranscript() => exportTranscript(
    context: context,
    ref: ref,
    effectiveTitle: widget.effectiveTitle,
    onCopyToClipboard: _copyTranscriptToClipboard,
    onShare: _shareTranscript,
  );

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
    final chatState = ref.read(chatSessionProvider);
    if (chatState.messages.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('No messages in session')));
      return;
    }
    showTimelineDialog(context, scrollController: _scrollController);
  }

  /// Show fork dialog to create a branch from a specific message
  void _showForkDialog() {
    final chatState = ref.read(chatSessionProvider);
    if (chatState.messages.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('No messages to fork from')));
      return;
    }
    showForkDialog(context, session: widget.session, project: widget.project);
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
  void _showModelsDialog() => showModelsDialog(context, ref);

  /// Show agents selection dialog
  void _showAgentsDialog() => showAgentsDialog(
    context,
    agents: _agents,
    selectedAgent: _selectedAgent,
    onAgentSelected: (name) => setState(() => _selectedAgent = name),
  );

  @override
  void dispose() {
    // FIX: Cancel listener subscriptions to prevent callbacks after dispose
    _connectionSubscription?.close();
    _chatSubscription?.close();
    _ccConfigSubscription?.close();
    _ccQueueSubscription?.close();
    _piExtensionUiSub?.cancel();
    // Clear Pi power menu callback
    if (widget.isPi && piPowerMenuCallback == _handlePiMenuAction) {
      piPowerMenuCallback = null;
    }
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
            : widget.isCodex
            ? (widget.cxThread?.displayTitle ?? 'Codex')
            : widget.isPi
            ? (widget.piDraftTitle ?? 'Pi')
            : widget.session.title,
        sessionContext: _sessionContext,
        todos: todos, // Both OC and CC have todos (CC via TodoWrite tool)
        onClose: _closeSidebar,
        vcsInfo: _vcsInfo,
        sessionDiffs: sessionDiffs,
        onOpenDiff: (diff) => _openDiffView(diff),
        isClaudeCode: widget.isClaudeCode,
        isCodex: widget.isCodex,
        ccInit: widget.isClaudeCode ? ccInit : null,
        cxInfo: widget.isCodex
            ? () {
                final cxState = ref.read(chatSessionProvider);
                return CodexSessionInfo(
                  threadId: cxState.cxThreadId,
                  model: cxState.cxModel,
                  cwd: cxState.cxCwd,
                  settings: ref.read(codexSettingsProvider),
                );
              }()
            : null,
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
            child: AdaptiveContainer(
              width: ContentWidth.wide,
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
                                    (!_hasLoadedAllMessages &&
                                            messages.isNotEmpty
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
          ),
          // Stop agent is available via the action sheet menu (⋯ button)
          // when streaming — no floating overlay needed.
          // Slash command autocomplete popup (kept mounted to avoid focus loss)
          Positioned(
            left: 16,
            right: 16,
            bottom: 70,
            child: Visibility(
              visible: _showCommandAutocomplete && _commands.isNotEmpty,
              maintainState: true,
              child: CommandAutocomplete(
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
              child: CustomToolAutocomplete(
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
          // When Codex is streaming, show a steer bar above the main input
          Positioned(
            key: const ValueKey('chat-input-bar'),
            left: 0,
            right: 0,
            bottom: 0,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Claude Code: show queued message bar when a message is pending
                if (widget.isClaudeCode && ccIsStreaming)
                  Consumer(
                    builder: (context, ref, _) {
                      final pending = ref.watch(
                        chatSessionProvider.select((s) => s.pendingCCMessage),
                      );
                      if (pending == null) return const SizedBox.shrink();
                      final theme = OpenCodeTheme.of(context);
                      return CCQueueBar(
                        pendingMessage: pending,
                        onCancel: () {
                          ref
                              .read(chatSessionProvider.notifier)
                              .clearPendingCCMessage();
                        },
                        primaryColor: theme.primary,
                        textColor: theme.text,
                        mutedColor: theme.textMuted,
                        surfaceColor: theme.backgroundPanel,
                      );
                    },
                  ),
                _buildInputBarWithParams(
                  connection: connection,
                  messages: messages,
                  ccIsStreaming: ccIsStreaming,
                  ccInit: ccInit,
                  ccModel: ccModel,
                ),
              ],
            ),
          ),
          // Task 1: Retry status countdown banner
          if (sessionStatus.isRetry)
            Positioned(
              left: 16,
              right: 16,
              top: MediaQuery.of(context).padding.top + 50,
              child: RetryStatusBanner(status: sessionStatus),
            ),
          // Task 2: Revert state banner
          if (widget.isOpenCode && sessionRevert != null)
            Positioned(
              left: 16,
              right: 16,
              top:
                  MediaQuery.of(context).padding.top +
                  (sessionStatus.isRetry ? 90 : 50),
              child: RevertStateBanner(onUndoRevert: _unrevertSession),
            ),
          // Floating header at top (glass pills)
          Positioned(
            left: 0,
            right: 0,
            top: 0,
            child: FloatingHeader(
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
                  : widget.isPi
                  ? (value) => _handlePiMenuAction(value)
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
                  : widget.isPi
                  ? ref.watch(
                      chatSessionProvider.select((s) => s.piIsStreaming),
                    )
                  : _hasStreamingMessage(messages),
              isClaudeCode: widget.isClaudeCode,
              isCodex: widget.isCodex,
              isPi: widget.isPi,
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
              sessionContext: _sessionContext,
              piModel: widget.isPi
                  ? ref.watch(chatSessionProvider.select((s) => s.piModel))
                  : null,
            ),
          ),
          // Subagent activity indicator (Claude Code only)
          if (widget.isClaudeCode)
            Positioned(
              left: 0,
              right: 0,
              top: MediaQuery.of(context).padding.top + 44,
              child: SubagentActivityIndicator(
                messages: messages,
                isStreaming: ccIsStreaming,
              ),
            ),
        ],
      ),
    );
  }

  // PERF: Input bar version that takes individual params instead of full chatState
  // This allows using select() in the build method for better performance.
  // Delegates to ChatInputBarContent (extracted widget).
  Widget _buildInputBarWithParams({
    required BridgeConnectionState connection,
    required List<ChatMessage> messages,
    required bool ccIsStreaming,
    CCSessionInit? ccInit,
    String? ccModel,
  }) {
    return ChatInputBarContent(
      controller: _controller,
      focusNode: _inputFocusNode,
      attachedFiles: _attachedFiles,
      showFileAutocomplete: _showFileAutocomplete,
      connection: connection,
      ccIsStreaming: ccIsStreaming,
      ccInit: ccInit,
      ccModel: ccModel,
      isClaudeCode: widget.isClaudeCode,
      isCodex: widget.isCodex,
      isPi: widget.isPi,
      selectedAgent: _selectedAgent,
      agents: _agents,
      project: widget.project,
      projectName: widget.projectName,
      effectivePath: widget.effectivePath,
      ccSessionModel: widget.ccSession?.model,
      ccDraftModel: widget.ccDraftModel,
      onSend: () => _sendMessageWithParams(connection, messages, ccIsStreaming),
      onRemoveAttachment: _removeAttachedFile,
      onFileSelect: _handleFileSelection,
      onAttachTap: () => _showAttachmentOptions(context),
      onTakePhoto: _pickImageFromCamera,
      onAgentChanged: (agent) => setState(() => _selectedAgent = agent),
      onModelTap: widget.isClaudeCode
          ? _showClaudeCodeModelSheet
          : widget.isCodex
          ? _showCodexModelSheet
          : widget.isPi
          ? _showPiModelSheet
          : _showModelsDialog,
      onSetCodexReasoningEffort: _setCodexReasoningEffort,
      onSetPiThinkingLevel: _setPiThinkingLevel,
    );
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

  // _buildSubtaskChip removed — using CompactAgentCard.fromNotification() instead
  /// Task 7: Build a muted retry indicator
  Widget _buildRetryIndicator(int attempt, String? errorMessage) {
    return RetryIndicator(
      retryInfo: RetryInfo(attempt: attempt, errorMessage: errorMessage),
    );
  }

  /// SDK v1.2.1: Agent indicator pill badge (like VariantBadge)
  Widget _buildAgentPill(String agentName) {
    final theme = OpenCodeTheme.of(context);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: theme.accent.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          '🤖 $agentName',
          style: TextStyle(
            color: theme.accent,
            fontSize: 11,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  /// SDK v1.2.1: Enhanced compaction divider — delegates to message_group.dart.
  Widget _buildCompactionDividerEnhanced({
    required bool auto,
    bool overflow = false,
  }) => buildCompactionDividerEnhanced(context, auto: auto, overflow: overflow);

  /// SDK v1.2.1: Patch card — compact file list (like CompactEditCard style)
  Widget _buildPatchCard(List<String> files) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '📝 Patched ${files.length} file${files.length != 1 ? 's' : ''}',
            style: TextStyle(
              color: theme.text,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          for (final file in files)
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Text(
                file,
                style: TextStyle(
                  color: theme.textMuted,
                  fontSize: 11,
                  fontFamily: 'monospace',
                ),
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

  /// Edit tool check — delegates to message_helpers.dart.
  bool _isEditTool(String toolName) => isEditTool(toolName);

  /// Delegates to MessageGroup widget — extracted to message_group.dart.
  Widget _buildMessageGroup(ChatMessage message) {
    return MessageGroup(
      message: message,
      isClaudeCode: widget.isClaudeCode,
      isOpenCode: widget.isOpenCode,
      isCodex: widget.isCodex,
      projectPath: widget.project.path,
      onFork: ({String? messageId}) => _forkSession(messageId: messageId),
      onResumeFromHere: _setClaudeResumeFromHere,
      onRevert: (messageId, {String? partId}) =>
          _revertMessage(messageId, partId: partId),
      onOpenDiffView: (diff, {String? messageId}) =>
          _openDiffView(diff, messageId: messageId),
      onCcRewind: _ccRewindToCheckpoint,
      onCodexRollback: _showCodexRollbackSheet,
      buildVariantCard: _buildVariantCard,
      buildOrderedParts: _buildOrderedParts,
      buildToolCard: _buildToolCard,
    );
  }

  /// Build a compact card widget for variant-tagged system messages.
  Widget? _buildVariantCard(ChatMessage message) =>
      buildVariantCard(context: context, ref: ref, message: message);

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
                  onDeleteMessage:
                      widget.isOpenCode && message.role == MessageRole.assistant
                      ? (messageId) => deleteOpenCodeMessageFromChat(
                          context: context,
                          ref: ref,
                          sessionId: message.sessionId,
                          messageId: message.id,
                          projectPath:
                              ref.read(chatSessionProvider).projectPath ??
                              widget.project.path,
                        )
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
                padding: Insets.topSm,
                child: _buildToolCard(tool, message.id),
              ),
            );
          }
        // Task 6: Subtask/agent delegation part — use existing CompactAgentCard
        case SubtaskPart(:final agentName, :final description):
          widgets.add(
            Padding(
              padding: Insets.topSm,
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
              padding: Insets.topSm,
              child: _buildRetryIndicator(attempt, errorMessage),
            ),
          );
        // SDK v1.2.1: Agent indicator — small tinted pill badge
        case AgentIndicatorPart(:final agentName):
          widgets.add(
            Padding(padding: Insets.topSm, child: _buildAgentPill(agentName)),
          );
        // SDK v1.2.1: Compaction divider with auto/manual indicator
        case CompactionIndicatorPart(:final auto, :final overflow):
          widgets.add(
            _buildCompactionDividerEnhanced(auto: auto, overflow: overflow),
          );
        // SDK v1.2.1: Patch — compact file list
        case PatchIndicatorPart(:final files):
          widgets.add(
            Padding(padding: Insets.topSm, child: _buildPatchCard(files)),
          );

        // Not rendered visually — internal plumbing data
        case SnapshotPart():
          break;
        case StepStartIndicatorPart():
          break;
        case StepFinishIndicatorPart():
          break;
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
            onDeleteMessage:
                widget.isOpenCode && message.role == MessageRole.assistant
                ? (messageId) => deleteOpenCodeMessageFromChat(
                    context: context,
                    ref: ref,
                    sessionId: message.sessionId,
                    messageId: message.id,
                    projectPath:
                        ref.read(chatSessionProvider).projectPath ??
                        widget.project.path,
                  )
                : null,
            onRollback: widget.isCodex ? _showCodexRollbackSheet : null,
          ),
        );
      }
      for (final tool in message.toolCalls) {
        widgets.add(
          Padding(
            padding: Insets.topSm,
            child: _buildToolCard(tool, message.id),
          ),
        );
      }
    }
    return widgets;
  }

  // PERF: Menu action handler that takes messages list directly (used with select())
  void _handleMenuActionWithMessages(String value, List<ChatMessage> messages) {
    final theme = OpenCodeTheme.of(context);
    switch (value) {
      case 'stop':
        _stopGeneration();
        break;
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
        : widget.isPi
        ? AgentType.pi
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
    } else if (widget.isPi) {
      final chatState = ref.read(chatSessionProvider);
      final piBridge = ref.read(piBridgeServiceProvider);
      piBridge.abort(projectPath: chatState.piCwd);
      notifier.setPiStreaming(false);
    } else {
      // OpenCode - send abort and clear all streaming states
      bridge.abortSession(widget.session.id, projectPath: widget.project.path);
      // Also mark all streaming messages as complete to unstick the UI
      notifier.markAllStreamingComplete();
    }
  }

  void _showModelSelector(BuildContext context) =>
      showModelsDialog(context, ref);

  /// Auto-send a pending CC message when the turn completes.
  /// Uses the same CC send flow as _sendMessage (config, model, sessionId, etc.)
  void _autoSendPendingCCMessage() {
    if (!widget.isClaudeCode || !mounted) return;
    final chat = ref.read(chatSessionProvider.notifier);
    final chatState = ref.read(chatSessionProvider);
    final pendingText = chatState.pendingCCMessage;
    final pendingAttachments = chatState.pendingCCAttachments;
    if (pendingText == null || pendingText.isEmpty) return;
    // Clear pending state first to prevent re-entry
    chat.clearPendingCCMessage();
    // Read all the same config values that _sendMessage reads for CC
    final bridge = ref.read(bridgeServiceProvider);
    final ccConfig = ref.read(ccConfigProvider).valueOrNull;
    final cwd = chatState.ccCwd ?? widget.ccSession?.cwd ?? widget.ccDraftCwd;
    final model =
        ccConfig?.model ??
        chatState.ccModel ??
        chatState.ccInit?.model ??
        widget.ccSession?.model ??
        widget.ccDraftModel;
    final activeSubagent = ccConfig?.activeSubagent;
    final hasAttachments =
        pendingAttachments != null && pendingAttachments.isNotEmpty;
    // Build display message with file attachments
    String displayText = pendingText;
    if (hasAttachments) {
      final attachmentLabels = <String>[];
      int imageCount = 0;
      for (final f in pendingAttachments) {
        if (f.isImage) {
          imageCount++;
          attachmentLabels.add('[Image $imageCount]');
        } else {
          attachmentLabels.add(f.displayPath);
        }
      }
      if (attachmentLabels.isNotEmpty) {
        displayText = '$pendingText\n${attachmentLabels.join(' ')}';
      }
    }
    chat.appendUserMessage(displayText);
    chat.setCCStreaming(true);
    final ccVariant = ref.read(claudeCodeVariantProvider).selectedVariant;
    bridge.ccChat(
      sessionId: chatState.ccSessionId,
      prompt: pendingText,
      cwd: cwd,
      model: model,
      permissionMode: ccConfig?.permissionMode,
      allowedTools: ccConfig?.allowedTools,
      disallowedTools: ccConfig?.disallowedTools,
      maxTurns: ccConfig?.maxTurns,
      maxBudgetUsd: ccConfig?.maxBudgetUsd,
      betas: ccConfig?.betas,
      variant: ccVariant,
      thinking: ccConfig?.thinking,
      effort: ccConfig?.effort,
      activeSubagent: activeSubagent,
      outputFormat: ccConfig?.outputFormat,
      sandbox: ccConfig?.sandbox,
      enableAgentTeams: ccConfig?.enableAgentTeams,
      enableClaudeAiMcpServers: ccConfig?.enableClaudeAiMcpServers,
      fileAttachments: hasAttachments ? pendingAttachments : null,
    );
    _userHasScrolledUp = false;
    _scrollToBottom();
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
    sendMessage(
      context: context,
      ref: ref,
      connection: connection,
      chatState: chatState,
      controller: _controller,
      attachedFiles: _attachedFiles,
      selectedAgent: _selectedAgent,
      agents: _agents,
      isClaudeCode: widget.isClaudeCode,
      isCodex: widget.isCodex,
      isPi: widget.isPi,
      ccSession: widget.ccSession,
      ccDraftCwd: widget.ccDraftCwd,
      ccDraftModel: widget.ccDraftModel,
      ccResumeSessionAtMessageId: _ccResumeSessionAtMessageId,
      cxThread: widget.cxThread,
      cxDraftCwd: widget.cxDraftCwd,
      piSession: widget.piSession,
      piDraftCwd: widget.piDraftCwd,
      sessionId: widget.session.id,
      projectPath: widget.project.path,
      clearAttachments: () => setState(() => _attachedFiles.clear()),
      scrollToBottom: () {
        _userHasScrolledUp = false;
        _scrollToBottom();
      },
      onCcResumeIdCleared: () => _ccResumeSessionAtMessageId = null,
      isMounted: () => mounted,
      showCodexAppsSheet: _showCodexAppsSheet,
      showCodexRemoteSkillsSheet: _showCodexRemoteSkillsSheet,
      startCodexReview: _startCodexReview,
      openDiffView: (diff) => _openDiffView(diff),
      loadSessionContext: _loadSessionContext,
      showCodexRollbackSheet: _showCodexRollbackSheet,
      showCodexAgentsSheet: _showCodexAgentsSheet,
    );
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
      final isClaudeElicitation =
          request.metadata['ccElicitationRequestId'] != null;
      final alwaysLabel = isCodex
          ? 'Session'
          : isClaudeElicitation
          ? 'Approve'
          : 'Always';
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
          onAlwaysAllow: isClaudeElicitation
              ? () => _respondToPermission(request, 'once')
              : () => _respondToPermission(request, 'always'),
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
    if (!widget.isOpenCode && !widget.isClaudeCode) return;
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

  Future<Map<String, dynamic>?> _showElicitationFormInputDialog(
    PermissionRequest request,
  ) {
    return showCcElicitationFormInputDialog(context, request);
  }

  Future<void> _respondToPermission(
    PermissionRequest request,
    String response, {
    String? message,
    Object? execpolicyAmendment,
  }) async {
    return respondToPermission(
      context: context,
      ref: ref,
      request: request,
      response: response,
      isClaudeCode: widget.isClaudeCode,
      isCodex: widget.isCodex,
      projectPath: widget.project.path,
      showElicitationFormDialog: _showElicitationFormInputDialog,
      message: message,
      execpolicyAmendment: execpolicyAmendment,
    );
  }
}

// Floating header - simplified and compact

/// Session actions content for DetailSheet

/// Claude Code actions content for DetailSheet

/// Codex actions content for DetailSheet

/// Pi actions content for DetailSheet

// Extracted to lib/widgets/chat/glass_pill.dart

// Floating input bar with streaming mode support

// Extracted to lib/widgets/chat/pill_glow_painter.dart

// Extracted to lib/widgets/chat/cli_input_bar.dart (CliStyleInputBar + VariantChip)

// Model selector content for DetailSheet

// Extracted to lib/widgets/chat/retry_status_banner.dart
// Extracted to lib/widgets/chat/revert_state_banner.dart
// Extracted to lib/widgets/chat/cc_undo_turn_bar.dart
// Extracted to lib/widgets/chat/subagent_activity.dart
// Extracted to lib/widgets/chat/status_indicator.dart
