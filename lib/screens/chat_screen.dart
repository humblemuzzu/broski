import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent.dart';
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

import '../models/command.dart';
import '../models/file_attachment.dart';
import '../models/message.dart';
import '../models/question.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../models/session_context.dart';
import '../models/vcs.dart';
import '../providers/chat_provider.dart';
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
import 'chat/session_actions.dart';
import 'chat/session_setup.dart';
import 'chat/project_initializer.dart';
import 'chat/permission_responder.dart';
import 'chat/transcript_exporter.dart';
import 'chat/tool_card_builder.dart' as tcb;
import 'chat/ordered_parts_builder.dart' as opb;
import 'chat/question_prompt_handler.dart' as qph;
import 'chat/auto_send_cc.dart' as ascc;
import 'chat/oc_menu_handler.dart' as omh;
import 'chat/stop_generation.dart' as sg;
import 'chat/clear_instance_dialog.dart' as cid;
import 'chat/pi_session_actions.dart' as psa;
import 'chat/codex_actions.dart' as ca;
import 'chat/project_tools_handler.dart' as pth;
import 'chat/transcript_clipboard.dart' as tc;
import 'chat/image_picker_handler.dart' as iph;
import 'chat/text_change_handler.dart' as tch;
import 'chat/scroll_handler.dart' as sh;
import '../widgets/chat/variant_card_builder.dart';
import '../providers/claude_code_provider.dart';
import '../providers/connection_provider.dart';

import '../providers/codex_settings_provider.dart';
import '../providers/pi_provider.dart';
import 'pi/pi_extension_ui_request_handler.dart';
import '../providers/file_search_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../services/haptics_service.dart';
import '../services/image_picker_service.dart';
import '../services/websocket_service.dart';
import '../theme/opencode_theme.dart';
import '../widgets/file_tagging.dart';
import '../widgets/session_sidebar.dart';

import '../widgets/multi_agent_tree.dart';
import '../widgets/power_sheet.dart';
import '../widgets/app_background.dart';
import '../widgets/opencode_branding.dart';
import '../providers/appearance_provider.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import '../widgets/chat/retry_status_banner.dart';
import '../widgets/chat/revert_state_banner.dart';
import '../widgets/chat/subagent_activity.dart';
import '../widgets/chat/message_group.dart';

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
    _initialPromptSent = maybeSendInitialPrompt(
      ref: ref,
      initialPrompt: widget.initialPrompt,
      alreadySent: _initialPromptSent,
      controller: _controller,
      sendMessage: _sendMessage,
    );
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
  Future<void> _loadOpenCodeVariants() =>
      loadOpenCodeVariants(ref: ref, isOpenCode: widget.isOpenCode);

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
    final vcsInfo = await loadVcsInfo(
      ref: ref,
      sessionId: widget.session.id,
      projectPath: widget.project.path,
    );
    if (mounted && vcsInfo != null) {
      setState(() => _vcsInfo = vcsInfo);
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

  void _setClaudeResumeFromHere(String messageId) => setClaudeResumeFromHere(
    context: context,
    messageId: messageId,
    haptics: _haptics,
    onResumeIdChanged: (id) => setState(() => _ccResumeSessionAtMessageId = id),
  );

  // Feature 7: Revert/Undo changes
  Future<void> _revertMessage(String messageId, {String? partId}) =>
      revertMessage(
        context: context,
        ref: ref,
        sessionId: widget.session.id,
        messageId: messageId,
        projectPath: widget.project.path,
        haptics: _haptics,
        onRefreshContext: _loadSessionContext,
        partId: partId,
      );

  void _openDiffView(DiffEntry diff, {String? messageId}) => openDiffView(
    context: context,
    diff: diff,
    messageId: messageId,
    onUndo: _revertMessage,
  );

  // Feature 7: Unrevert session (reserved for future use)
  // ignore: unused_element
  Future<void> _unrevertSession() => unrevertSession(
    context: context,
    ref: ref,
    sessionId: widget.session.id,
    projectPath: widget.project.path,
    onRefreshContext: _loadSessionContext,
  );

  // Claude Code: Rewind files to the most recent checkpoint.
  Future<void> _ccRewindToCheckpoint() => ccRewindToCheckpoint(
    context: context,
    ref: ref,
    effectivePath: widget.effectivePath,
    haptics: _haptics,
  );

  // Feature 8: Share Session
  Future<void> _shareSession() => shareSession(
    context: context,
    ref: ref,
    sessionId: widget.session.id,
    projectPath: widget.project.path,
    haptics: _haptics,
  );
  // Feature 8: Unshare Session
  Future<void> _unshareSession() => unshareSession(
    context: context,
    ref: ref,
    sessionId: widget.session.id,
    projectPath: widget.project.path,
  );

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
    final hadFocus = _inputFocusNode.hasFocus;
    final result = tch.computeAutocomplete(
      text: text,
      agents: _agents,
      isClaudeCode: widget.isClaudeCode,
      effectivePath: widget.effectivePath,
      currentShowCommand: _showCommandAutocomplete,
      currentCommandFilter: _commandFilter,
    );
    _showCommandAutocomplete = result.showCommand;
    _showFileAutocomplete = result.showFile;
    _showAgentAutocomplete = result.showAgent;
    _showCustomToolAutocomplete = result.showCustomTool;
    _commandFilter = result.commandFilter;
    _agentQuery = result.agentQuery;
    _customToolQuery = result.customToolQuery;
    if (result.clearFileSearch) fileSearch.clear();
    _setStateAndRestoreFocus(hadFocus);
    if (result.fileSearchQuery != null) {
      fileSearch.setProjectPath(result.fileSearchProjectPath!);
      fileSearch.search(result.fileSearchQuery!);
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

  void _insertMemoryPromptTemplate(String scope) =>
      tch.insertMemoryPromptTemplate(
        controller: _controller,
        focusNode: _inputFocusNode,
        scope: scope,
      );

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

  Future<void> _piCompact() => psa.piCompact(context: context, ref: ref);

  Future<void> _piNewSession() => psa.piNewSession(context: context, ref: ref);

  void _showPiModelSheet() => showPiModelSheet(context);

  Future<void> _cyclePiThinkingLevel() =>
      psa.cyclePiThinkingLevel(context: context, ref: ref);

  void _showPiSidebarSheet() => psa.showPiSidebarSheetAction(
    context: context,
    ref: ref,
    onForkFromEntry: _forkPiSessionFromEntry,
  );

  Future<void> _forkPiSessionFromEntry(String entryId) =>
      psa.forkPiSessionFromEntry(context: context, ref: ref, entryId: entryId);

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
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.cxCwd ?? widget.cxThread?.cwd ?? widget.cxDraftCwd;
    ca.showCodexSkillsSheet(context: context, ref: ref, cwd: cwd);
  }

  void _showCodexRollbackSheet() => showCodexRollbackSheet(context, ref);

  Future<void> _startCodexReview() async {
    final chatState = ref.read(chatSessionProvider);
    final cwd = chatState.cxCwd ?? widget.cxThread?.cwd ?? widget.cxDraftCwd;
    await ca.startCodexReview(ref: ref, cwd: cwd);
  }

  /// Set Codex reasoning effort by wireValue string (e.g., 'high', 'xhigh')
  void _setCodexReasoningEffort(String? wireValue) =>
      ca.setCodexReasoningEffort(ref: ref, wireValue: wireValue);

  void _setPiThinkingLevel(String? wireValue) =>
      psa.setPiThinkingLevel(ref: ref, wireValue: wireValue);

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

  bool _modelSupportsImages(SelectedModel? model) =>
      iph.modelSupportsImages(model);

  void _showImageNotSupportedWarning() =>
      iph.showImageNotSupportedWarning(context, ref);

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
    sh.handleAutoScroll(
      context: context,
      isOpenCode: widget.isOpenCode,
      previous: previous,
      next: next,
      userHasScrolledUp: _userHasScrolledUp,
      previousMessageCount: _previousMessageCount,
      previousContentLength: _previousContentLength,
      setPreviousMessageCount: (v) => _previousMessageCount = v,
      setPreviousContentLength: (v) => _previousContentLength = v,
      scrollToBottom: ({bool animate = true}) =>
          _scrollToBottom(animate: animate),
      lastShownMcpOAuthUrl: _lastShownMcpOAuthUrl,
      setLastShownMcpOAuthUrl: (v) => _lastShownMcpOAuthUrl = v,
    );
  }

  Future<void> _loadMoreMessages() => sh.loadMoreMessages(
    ref: ref,
    loadingMoreMessages: _loadingMoreMessages,
    hasLoadedAllMessages: _hasLoadedAllMessages,
    sessionId: widget.session.id,
    projectPath: widget.project.path,
    scrollController: _scrollController,
    setPaginationState: ({required bool loadingMore, required bool loadedAll}) {
      if (mounted)
        setState(() {
          _loadingMoreMessages = loadingMore;
          _hasLoadedAllMessages = loadedAll;
        });
    },
    isMounted: () => mounted,
  );

  bool _hasStreamingMessage(List<ChatMessage> messages) {
    return messages.any((msg) => msg.isStreaming);
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
  void _copyTranscriptToClipboard() => tc.copyTranscriptToClipboard(
    context: context,
    ref: ref,
    sessionTitle: widget.session.title,
  );

  /// Export transcript (show options)
  void _exportTranscript() => exportTranscript(
    context: context,
    ref: ref,
    effectiveTitle: widget.effectiveTitle,
    onCopyToClipboard: _copyTranscriptToClipboard,
    onShare: _shareTranscript,
  );

  /// Share transcript via system share sheet
  void _shareTranscript() =>
      tc.shareTranscript(ref: ref, sessionTitle: widget.session.title);

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
  Widget _buildToolCard(ToolCall tool, String messageId) => tcb.buildToolCard(
    tool: tool,
    messageId: messageId,
    isClaudeCode: widget.isClaudeCode,
    isCodex: widget.isCodex,
    onRevert: _revertMessage,
  );

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
  List<Widget> _buildOrderedParts(ChatMessage message) => opb.buildOrderedParts(
    context: context,
    message: message,
    isClaudeCode: widget.isClaudeCode,
    isOpenCode: widget.isOpenCode,
    isCodex: widget.isCodex,
    buildToolCardFn: _buildToolCard,
    onFork: ({String? messageId}) => _forkSession(messageId: messageId),
    onResumeFromHere: _setClaudeResumeFromHere,
    onDeleteMessage: widget.isOpenCode
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
  );

  // PERF: Menu action handler that takes messages list directly (used with select())
  void _handleMenuActionWithMessages(
    String value,
    List<ChatMessage> messages,
  ) => omh.handleOcMenuAction(
    context: context,
    value: value,
    messages: messages,
    isClaudeCode: widget.isClaudeCode,
    onStopGeneration: _stopGeneration,
    onShowProjectTools: _showProjectToolsSheet,
    onFork: () => _forkSession(),
    onShare: _shareSession,
    onUnshare: _unshareSession,
    onCompact: _compactSession,
    onInit: _initializeProject,
    onRevert: _revertMessage,
    onCcRewind: _ccRewindToCheckpoint,
    onClearInstance: _clearInstance,
  );

  void _showProjectToolsSheet() => pth.showProjectToolsSheetAction(
    context: context,
    ref: ref,
    isClaudeCode: widget.isClaudeCode,
    isCodex: widget.isCodex,
    isPi: widget.isPi,
    projectName: widget.projectName,
    effectivePath: widget.effectivePath,
    project: widget.project,
    session: widget.session,
  );

  Future<void> _clearInstance() => cid.showClearInstanceDialog(
    context: context,
    ref: ref,
    projectPath: widget.project.path,
  );

  /// Stop AI generation for all backends
  /// Sends abort to bridge and clears local streaming states
  void _stopGeneration() => sg.stopGeneration(
    ref: ref,
    isClaudeCode: widget.isClaudeCode,
    isCodex: widget.isCodex,
    isPi: widget.isPi,
    sessionId: widget.session.id,
    projectPath: widget.project.path,
  );

  void _showModelSelector(BuildContext context) =>
      showModelsDialog(context, ref);

  /// Auto-send a pending CC message when the turn completes.
  /// Uses the same CC send flow as _sendMessage (config, model, sessionId, etc.)
  void _autoSendPendingCCMessage() {
    ascc.autoSendPendingCCMessage(
      ref: ref,
      isClaudeCode: widget.isClaudeCode,
      isMounted: () => mounted,
      ccSessionCwd: widget.ccSession?.cwd,
      ccSessionModel: widget.ccSession?.model,
      ccDraftCwd: widget.ccDraftCwd,
      ccDraftModel: widget.ccDraftModel,
      resetScrollAndScrollToBottom: () {
        _userHasScrolledUp = false;
        _scrollToBottom();
      },
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
    qph.maybeShowPermissionPromptFromList(
      context: context,
      ref: ref,
      permissions: permissions,
      activePermissionId: _activePermissionId,
      haptics: _haptics,
      isCodex: widget.isCodex,
      isClaudeCode: widget.isClaudeCode,
      onRespond: (request, response, {message, execpolicyAmendment}) =>
          _respondToPermission(
            request,
            response,
            message: message,
            execpolicyAmendment: execpolicyAmendment,
          ),
      setActivePermissionId: (id) => _activePermissionId = id,
    );
  }

  void _maybeShowQuestionPrompt(QuestionRequest? request) {
    qph.maybeShowQuestionPrompt(
      context: context,
      ref: ref,
      isOpenCode: widget.isOpenCode,
      isClaudeCode: widget.isClaudeCode,
      request: request,
      activeQuestionId: _activeQuestionId,
      answeredQuestionIds: _answeredQuestionIds,
      haptics: _haptics,
      setActiveQuestionId: (id) => _activeQuestionId = id,
      isMounted: () => mounted,
    );
  }

  void _maybeShowCodexQuestionPrompt(CodexUserInputRequest? request) {
    if (!widget.isCodex) return;
    qph.maybeShowCodexQuestionPrompt(
      context: context,
      ref: ref,
      request: request,
      activeCxQuestionId: _activeCxQuestionId,
      haptics: _haptics,
      setActiveCxQuestionId: (id) => _activeCxQuestionId = id,
      isMounted: () => mounted,
    );
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
