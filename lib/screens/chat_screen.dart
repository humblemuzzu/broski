import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';
import 'package:share_plus/share_plus.dart';

import '../models/agent.dart';
import '../models/agent_type.dart';
import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/pi.dart';
import 'sheets/cx_apps_sheet.dart';
import 'sheets/cx_agents_sheet.dart';
import 'sheets/cx_auth_sheet.dart';
import 'sheets/cx_config_sheet.dart';
import 'sheets/cx_feedback_sheet.dart';
import 'sheets/cx_mcp_sheet.dart';
import 'sheets/cx_rollback_sheet.dart';
import 'sheets/cx_settings_sheet.dart';
import 'sheets/cx_model_sheet.dart';
import 'sheets/cx_remote_skills_sheet.dart';
import 'sheets/cc_skills_sheet.dart';
import 'sheets/cc_hooks_sheet.dart';
import 'sheets/cc_mcp_sheet.dart';
import 'sheets/cc_tools_sheet.dart';
import 'sheets/cc_commands_sheet.dart';
import 'sheets/cc_model_sheet.dart';
import 'sheets/pi_model_sheet.dart';
import 'sheets/pi_skills_sheet.dart';
import 'sheets/cc_memory_scope_picker.dart';
import 'dialogs/share_dialog.dart';
import 'dialogs/help_dialog.dart';
import 'dialogs/timeline_dialog.dart';
import 'dialogs/fork_dialog.dart';
import 'dialogs/rename_dialog.dart';
import '../widgets/chat/floating_header.dart';
import '../widgets/chat/floating_input_bar.dart';
import '../widgets/chat/model_selector_content.dart';
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
import '../providers/claude_code_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/app_subscription_provider.dart';

import '../providers/codex_settings_provider.dart';
import '../providers/pi_provider.dart';
import 'pi/pi_extension_ui_request_handler.dart';
import 'sheets/pi_session_sidebar_sheet.dart';
import '../providers/file_search_provider.dart';
import '../providers/input_style_provider.dart';
import '../providers/opencode_variant_provider.dart';
import '../providers/claude_code_variant_provider.dart';
import '../providers/glow_style_provider.dart';
import '../providers/prompt_accent_provider.dart';
import '../providers/selection_provider.dart';
import '../models/prompt_accent_color.dart';
import '../providers/service_providers.dart';
import '../services/haptics_service.dart';
import '../services/image_picker_service.dart';
import '../services/websocket_service.dart';
import '../theme/opencode_theme.dart';
import '../widgets/diff_viewer.dart';
import '../widgets/export_session_sheet.dart';
import '../widgets/file_tagging.dart';
import '../widgets/retry_indicator.dart';
import '../widgets/message_bubble.dart';
import '../widgets/chat/compact_thinking_card.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/permission_prompt.dart';
import '../widgets/question_prompt_sheet.dart';
import '../widgets/session_sidebar.dart';
import '../widgets/chat/compact_tool_card.dart';
import '../widgets/chat/compact_edit_card.dart';
import '../widgets/chat/compact_write_card.dart';
import '../widgets/chat/compact_todos_card.dart';
import '../widgets/chat/compact_task_notification_card.dart';
import '../widgets/chat/compact_tool_summary_chip.dart';
import '../widgets/chat/compact_hook_card.dart';
import '../widgets/chat/compact_agent_card.dart';
import '../widgets/chat/cc_system_message_cards.dart';

import '../models/todo.dart';
import '../widgets/multi_agent_tree.dart';
import '../widgets/power_sheet.dart';
import '../widgets/project_tools_sheet.dart';
import 'sessions_screen.dart';
import '../utils/opencode_id.dart';
import '../widgets/app_background.dart';
import '../widgets/opencode_branding.dart';
import '../providers/appearance_provider.dart';
import 'diff_view_screen.dart';
import '../utils/error_utils.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
import '../widgets/chat/retry_status_banner.dart';  
import '../widgets/chat/revert_state_banner.dart';  
import '../widgets/chat/cc_undo_turn_bar.dart';  
import '../widgets/chat/subagent_activity.dart';  
import '../widgets/chat/cli_input_bar.dart';

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
    // Pi mode - set up Pi session in provider
    if (widget.isPi) {
      final cwd = widget.piSession?.cwd ?? widget.piDraftCwd ?? '';
      final widgetSessionId = widget.piSession?.id ?? '';
      final isDraft = widget.piSession == null;
      final piBridge = ref.read(piBridgeServiceProvider);

      // On reconnect, the session is already alive in the bridge — don't
      // create a new one or switch sessions. Just re-sync state and hydrate.
      if (_resyncingAfterReconnect) {
        if (!connection.isOfflineMode) {
          try {
            final piState = await piBridge.getState(projectPath: cwd);
            chat.setPiModel(
              piState.model != null
                  ? '${piState.model!.provider}/${piState.model!.id}'
                  : null,
              modelData: piState.model,
            );
            chat.setPiThinkingLevel(piState.thinkingLevel);
          } catch (_) {
            // Best effort
          }
          // Re-hydrate transcript to pick up any messages from the gap.
          // getMessages works by CWD so this works even if session ID is empty.
          try {
            final items = await piBridge.getMessages(projectPath: cwd);
            chat.hydratePiTranscript(items);
          } catch (_) {
            // Best effort
          }
        }
        _scrollToBottom(animate: false);
        setState(() => _hasLoadedAllMessages = true);
        _loadSessionContext();
        return;
      }

      // Initial load path — only runs on first open, not on reconnect.
      // Draft mode: create a new session so we don't resume an existing one.
      // Existing session: switch to the specific session by path.
      if (isDraft && !connection.isOfflineMode) {
        try {
          await piBridge.newSession(projectPath: cwd);
        } catch (_) {
          // Best effort — first message will still create one
        }
      } else if (widget.piSession?.path != null &&
          (widget.piSession?.path.isNotEmpty ?? false)) {
        try {
          await piBridge.switchSession(
            sessionPath: widget.piSession!.path,
            projectPath: cwd,
          );
        } catch (_) {
          // Best effort
        }
      }
      chat.setPiSession(
        sessionId: widgetSessionId,
        cwd: cwd,
        model: widget.piSession?.name,
      );
      // Existing session: hydrate transcript
      if (widgetSessionId.isNotEmpty && !connection.isOfflineMode) {
        try {
          final items = await piBridge.getMessages(projectPath: cwd);
          chat.hydratePiTranscript(items);
        } catch (_) {
          // Best effort
        }
      }
      // Fetch state to sync model/thinking level and pick up session ID
      if (!connection.isOfflineMode) {
        try {
          final piState = await piBridge.getState(projectPath: cwd);
          if (piState.sessionId.isNotEmpty && widgetSessionId.isEmpty) {
            // New session was created by newSession() — adopt its ID
            chat.setPiSession(
              sessionId: piState.sessionId,
              cwd: cwd,
              model: piState.model != null
                  ? '${piState.model!.provider}/${piState.model!.id}'
                  : null,
              thinkingLevel: piState.thinkingLevel,
            );
            // Draft: don't hydrate — it's a fresh session with no messages
          }
          // Set model data after setPiSession to ensure it's not overwritten
          chat.setPiModel(
            piState.model != null
                ? '${piState.model!.provider}/${piState.model!.id}'
                : null,
            modelData: piState.model,
          );
          chat.setPiThinkingLevel(piState.thinkingLevel);
        } catch (_) {
          // Best effort
        }
      }
      _scrollToBottom(animate: false);
      setState(() => _hasLoadedAllMessages = true);
      _loadSessionContext();
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
            description:
                'Open sidebar with context usage, tokens & session info',
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
    // Pi mode - load commands from bridge
    if (widget.isPi) {
      if (connection.isOfflineMode || !mounted) return;
      try {
        final piBridge = ref.read(piBridgeServiceProvider);
        final cwd = widget.piSession?.cwd ?? widget.piDraftCwd;
        final piCommands = await piBridge.listCommands(projectPath: cwd);
        if (!mounted) return;
        setState(() {
          _agents = const [];
          _commands = piCommands
              .map(
                (c) => SlashCommand(
                  name: c.name,
                  description: c.description ?? c.source,
                  builtin: false,
                ),
              )
              .toList();
        });
      } catch (_) {
        // Best effort
      }
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
        // Per-turn context tokens from iterations[-1] (actual window occupancy)
        lastIterContextTokens: tokenUsage?.lastIterContextTokens,
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
    // Codex SDK provides TokenUsageBreakdown with:
    //   totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens
    // and ThreadTokenUsage with:
    //   total (cumulative), last (last turn), modelContextWindow
    // NOTE: Codex SDK does NOT provide cost information.
    if (widget.isCodex) {
      final chatState = ref.read(chatSessionProvider);
      final tokenUsage = chatState.cxTokenUsage;
      final total = tokenUsage?.total;
      final last = tokenUsage?.last;
      final contextWindow = tokenUsage?.modelContextWindow ?? 200000;
      // Cumulative totals across the thread (for display)
      final inputTokens = total?.inputTokens ?? 0;
      final outputTokens = total?.outputTokens ?? 0;
      final cachedInputTokens = total?.cachedInputTokens ?? 0;
      final reasoningTokens = total?.reasoningOutputTokens ?? 0;
      final cacheWriteTokens = total?.cacheWriteTokens ?? 0;
      // Context tokens = LAST turn's input tokens (what's currently in the window)
      // Codex SDK: inputTokens includes cachedInputTokens (OpenAI convention)
      // Using last turn since it reflects the current context state
      final contextTokens = last?.inputTokens ?? inputTokens;
      final context = SessionContext.fromCodex(
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        cachedInputTokens: cachedInputTokens,
        reasoningTokens: reasoningTokens,
        cacheWriteTokens: cacheWriteTokens,
        contextWindow: contextWindow,
        contextTokens: contextTokens,
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
    // Pi mode - build context from session stats
    if (widget.isPi) {
      try {
        final piBridge = ref.read(piBridgeServiceProvider);
        final chatState = ref.read(chatSessionProvider);
        final cwd = chatState.piCwd;
        final stats = await piBridge.getSessionStats(projectPath: cwd);
        final ctxUsage = stats.contextUsage;
        final context = SessionContext.fromPi(
          inputTokens: stats.tokens.input,
          outputTokens: stats.tokens.output,
          cacheReadTokens: stats.tokens.cacheRead,
          cacheWriteTokens: stats.tokens.cacheWrite,
          totalCost: stats.cost,
          contextWindow:
              ctxUsage?.contextWindow ??
              chatState.piModelData?.contextWindow ??
              200000,
          actualContextTokens: ctxUsage?.tokens ?? 0,
        );
        if (mounted) {
          setState(() {
            _sessionContext = context;
            _loadingContext = false;
          });
        }
      } catch (_) {
        if (mounted) {
          setState(() {
            _sessionContext = SessionContext.empty();
            _loadingContext = false;
          });
        }
      }
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
          content: Text('Failed to fork session: ${humanizeError(e)}'),
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
          content: Text('Failed to compact: ${humanizeError(e)}'),
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
          content: Text('Failed to initialize: ${humanizeError(e)}'),
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
            leading: Icon(AppIcons.camera, color: theme.primary),
            title: Text('Take Photo', style: TextStyle(color: theme.text)),
            onTap: () {
              Navigator.pop(context);
              _pickImageFromCamera();
            },
          ),
          ListTile(
            leading: Icon(AppIcons.photoLibrary, color: theme.primary),
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
            leading: Icon(AppIcons.attach, color: theme.info),
            title: Text('Attach File (@)', style: TextStyle(color: theme.text)),
            subtitle: Text(
              'Type @ in the input to search files',
              style: AppTypography.label(color: theme.textMuted),
            ),
            onTap: () => Navigator.pop(context),
          ),
        ],
      ),
    );
  }

  void _showClaudeCodeToolsSheet() => showCcToolsSheet(context, onShowMemoryScopePicker: _showMemoryScopePicker);

  void _showClaudeCodeCommandsSheet() => showCcCommandsSheet(context, controller: _controller, inputFocusNode: _inputFocusNode);

  void _showClaudeCodeSkillsSheet() => showCcSkillsSheet(context);

  void _showClaudeCodeHooksSheet() => showCcHooksSheet(context);

  void _showClaudeCodeMcpSheet() => showCcMcpSheet(context, fallbackCwd: widget.ccSession?.cwd ?? widget.ccDraftCwd);

  void _handleClaudeCodeMenuAction(String value) {
    switch (value) {
      case 'stop':
        _stopGeneration();
        break;
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
      case 'stop':
        _stopGeneration();
        break;
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
      case 'cx_apps':
        _showCodexAppsSheet();
        break;
      case 'cx_remote_skills':
        _showCodexRemoteSkillsSheet();
        break;
    }
  }

  void _handlePiMenuAction(String value) {
    switch (value) {
      case 'stop':
        _stopGeneration();
        break;
      case 'pi_model':
        _showPiModelSheet();
        break;
      case 'pi_thinking':
        _cyclePiThinkingLevel();
        break;
      case 'pi_skills':
        _showPiSkillsSheet();
        break;
      case 'pi_sidebar':
        _showPiSidebarSheet();
        break;
      case 'pi_compact':
        _piCompact();
        break;
      case 'pi_new_session':
        _piNewSession();
        break;
    }
  }

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

  void _showPiSkillsSheet() => showPiSkillsSheet(context);

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


  void _showCodexAuthSheet() => showCodexAuthSheet(context, ref);


  void _showCodexFeedbackSheet() => showCodexFeedbackSheet(context, ref);


  void _showCodexSettingsSheet() => showCodexSettingsSheet(context);


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

  void _showCodexMcpSheet() => showCodexMcpSheet(context, ref);


  void _showCodexRollbackSheet() => showCodexRollbackSheet(context, ref);


  void _showCodexConfigSheet() => showCodexConfigSheet(context, ref);


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

  void _showClaudeCodeModelSheet() => showCcModelSheet(context, ccSessionCwd: widget.ccSession?.cwd, ccSessionModel: widget.ccSession?.model, ccDraftCwd: widget.ccDraftCwd, ccDraftModel: widget.ccDraftModel);

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
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Failed to undo: ${humanizeError(e)}'),
                  ),
                );
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
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Failed to redo: ${humanizeError(e)}')),
              );
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
                  SnackBar(
                    content: Text('Failed to compact: ${humanizeError(e)}'),
                  ),
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
            leading: Icon(AppIcons.copy, color: theme.primary),
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
            leading: Icon(AppIcons.share, color: theme.primary),
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
            leading: Icon(AppIcons.tune, color: theme.primary),
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
          SizedBox(height: Spacing.sm),
          if (_agents.isEmpty)
            Padding(
              padding: Insets.card,
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
                    AppIcons.agent,
                    color: isSelected
                        ? theme.selectedListItemText
                        : theme.textMuted,
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
                        style: AppTypography.label(color: theme.textMuted),
                      )
                    : null,
                trailing: isSelected
                    ? Icon(AppIcons.checkCircle, color: theme.primary)
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
          SizedBox(height: Spacing.sm),
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
  // This allows using select() in the build method for better performance
  Widget _buildInputBarWithParams({
    required BridgeConnectionState connection,
    required List<ChatMessage> messages,
    required bool ccIsStreaming,
    CCSessionInit? ccInit,
    String? ccModel,
  }) {
    final inputStyle = ref.watch(inputStyleProvider);
    // Busy logic per agent:
    // - CC: busy only if streaming AND already has a queued message (allow 1 queue)
    // - Codex: never busy — if streaming, _sendMessage steers the agent mid-turn
    // - OpenCode: never busy — SDK's promptAsync() queues server-side
    final pendingCCMessage = widget.isClaudeCode
        ? ref.watch(chatSessionProvider.select((s) => s.pendingCCMessage))
        : null;
    final isBusy = widget.isClaudeCode
        ? (ccIsStreaming && pendingCCMessage != null)
        : false;
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
        : widget.isPi
        ? AgentType.pi
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
      inputBar = CliStyleInputBar(
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
            : widget.isPi
            ? () => _showPiModelSheet()
            : () => _showModelsDialog(),
        attachedFiles: _attachedFiles,
        onRemoveAttachment: _removeAttachedFile,
        showFileAutocomplete: _showFileAutocomplete,
        onFileSelect: _handleFileSelection,
        onAttachTap: () => _showAttachmentOptions(context),
        onTakePhoto: _pickImageFromCamera,
        attachIcon: AppIcons.add,
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
            ? (mode) async {
                final messenger = ScaffoldMessenger.of(context);
                final notifier = ref.read(ccConfigProvider.notifier);
                final existing = ref.read(ccConfigProvider).valueOrNull;
                await notifier.updateConfig(
                  existing?.copyWith(permissionMode: mode) ??
                      ClaudeCodeConfig(
                        permissionMode: mode,
                        allowedTools: const [],
                        disallowedTools: const [],
                      ),
                );

                final liveState = ref.read(chatSessionProvider);
                final sessionId = liveState.ccSessionId;
                final canApplyLive =
                    liveState.ccIsStreaming &&
                    sessionId != null &&
                    sessionId.isNotEmpty;
                if (!canApplyLive) return;

                final ok = await ref
                    .read(bridgeServiceProvider)
                    .ccSetPermissionMode(
                      sessionId: sessionId,
                      mode: mode.wireValue,
                    );
                if (!mounted) return;
                messenger.showSnackBar(
                  SnackBar(
                    content: Text(
                      ok
                          ? 'Permission mode applied to current Claude turn.'
                          : 'Saved as default. Live turn update failed.',
                    ),
                    behavior: SnackBarBehavior.floating,
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
            : widget.isPi
            ? ref
                  .watch(chatSessionProvider.select((s) => s.piThinkingLevel))
                  ?.wireValue
            : null,
        availableVariants: widget.isOpenCode
            ? ref
                  .watch(openCodeVariantProvider)
                  .getAvailableVariants(ref.watch(selectionProvider).model)
            : widget.isClaudeCode
            ? claudeCodeVariants
            : widget.isCodex
            ? CodexReasoningEffort.values.map((e) => e.wireValue).toList()
            : widget.isPi
            ? PiThinkingLevel.values.map((e) => e.wireValue).toList()
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
            : widget.isPi
            ? (v) => _setPiThinkingLevel(v)
            : null,
      );
    } else {
      // FloatingInputBar uses the backend/project declared above
      inputBar = FloatingInputBar(
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
        attachIcon: AppIcons.add,
        // Model selector
        currentModel: widget.isClaudeCode
            ? ref.watch(chatSessionProvider.select((s) => s.ccModel))
            : widget.isCodex
            ? ref.watch(chatSessionProvider.select((s) => s.cxModel))
            : widget.isPi
            ? ref.watch(chatSessionProvider.select((s) => s.piModel))
            : ref.watch(selectionProvider).model?.displayString,
        onModelTap: widget.isClaudeCode
            ? () => _showClaudeCodeModelSheet()
            : widget.isCodex
            ? () => _showCodexModelSheet()
            : widget.isPi
            ? () => _showPiModelSheet()
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
            ? (mode) async {
                final messenger = ScaffoldMessenger.of(context);
                final notifier = ref.read(ccConfigProvider.notifier);
                final existing = ref.read(ccConfigProvider).valueOrNull;
                await notifier.updateConfig(
                  existing?.copyWith(permissionMode: mode) ??
                      ClaudeCodeConfig(
                        permissionMode: mode,
                        allowedTools: const [],
                        disallowedTools: const [],
                      ),
                );

                final liveState = ref.read(chatSessionProvider);
                final sessionId = liveState.ccSessionId;
                final canApplyLive =
                    liveState.ccIsStreaming &&
                    sessionId != null &&
                    sessionId.isNotEmpty;
                if (!canApplyLive) return;

                final ok = await ref
                    .read(bridgeServiceProvider)
                    .ccSetPermissionMode(
                      sessionId: sessionId,
                      mode: mode.wireValue,
                    );
                if (!mounted) return;
                messenger.showSnackBar(
                  SnackBar(
                    content: Text(
                      ok
                          ? 'Permission mode applied to current Claude turn.'
                          : 'Saved as default. Live turn update failed.',
                    ),
                    behavior: SnackBarBehavior.floating,
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
            : widget.isPi
            ? ref
                  .watch(chatSessionProvider.select((s) => s.piThinkingLevel))
                  ?.wireValue
            : null,
        availableVariants: widget.isOpenCode
            ? ref
                  .watch(openCodeVariantProvider)
                  .getAvailableVariants(ref.watch(selectionProvider).model)
            : widget.isClaudeCode
            ? claudeCodeVariants
            : widget.isCodex
            ? CodexReasoningEffort.values.map((e) => e.wireValue).toList()
            : widget.isPi
            ? PiThinkingLevel.values.map((e) => e.wireValue).toList()
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
            : widget.isPi
            ? (v) => _setPiThinkingLevel(v)
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
      padding: Insets.screenV,
      child: Row(
        children: [
          Expanded(
            child: Divider(
              color: theme.textMuted.withValues(alpha: 0.3),
              thickness: 1,
            ),
          ),
          Padding(
            padding: Insets.cardH,
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
    return RetryIndicator(
      retryInfo: RetryInfo(attempt: attempt, errorMessage: errorMessage),
    );
  }

  /// SDK v1.2.1: Context overflow error with action buttons
  Widget _buildContextOverflowError(ChatMessage message) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.screenV,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.warning.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.warning.withValues(alpha: 0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '⚠️ ${message.text}',
              style: TextStyle(
                color: theme.warning,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                TextButton.icon(
                  onPressed: () {
                    // Trigger /compact via the existing slash command flow
                    final bridge = ref.read(bridgeServiceProvider);
                    final chatState = ref.read(chatSessionProvider);
                    final sessionId = chatState.session?.id;
                    if (sessionId != null) {
                      bridge.executeCommand(
                        sessionId: sessionId,
                        command: 'compact',
                        arguments: '',
                        projectPath: chatState.projectPath,
                      );
                    }
                  },
                  icon: Icon(Icons.compress, size: 16, color: theme.accent),
                  label: Text(
                    'Compact',
                    style: TextStyle(color: theme.accent, fontSize: 12),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
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

  /// SDK v1.2.1: Enhanced compaction divider with auto/manual/overflow.
  Widget _buildCompactionDividerEnhanced({
    required bool auto,
    bool overflow = false,
  }) {
    final theme = OpenCodeTheme.of(context);
    final label = overflow
        ? 'Context compacted (overflow)'
        : (auto ? 'Context compacted (auto)' : 'Context compacted');
    return Padding(
      padding: Insets.screenV,
      child: Row(
        children: [
          Expanded(
            child: Divider(
              color: theme.textMuted.withValues(alpha: 0.3),
              thickness: 1,
            ),
          ),
          Padding(
            padding: Insets.cardH,
            child: Text(
              label,
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

  /// Check if a tool is an edit/patch tool (handles all backend naming conventions)
  /// - OpenCode: 'edit', 'patch'
  /// - Claude Code: 'str_replace_editor', 'edit'
  /// - Codex: 'applypatch', 'ApplyPatch'
  bool _isEditTool(String toolName) {
    return toolName == 'edit' ||
        toolName == 'multiedit' ||
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
    if (message.error == 'context_compacted_overflow') {
      return _buildCompactionDividerEnhanced(auto: true, overflow: true);
    }
    // SDK v1.2.1: Context overflow — show with action buttons
    if (message.error == 'ContextOverflowError') {
      return _buildContextOverflowError(message);
    }
    // ── SDK 0.2.42: Variant-tagged system messages → compact cards ──
    if (message.role == MessageRole.system && message.variant != null) {
      final card = _buildVariantCard(message);
      if (card != null) {
        return Padding(
          padding: EdgeInsets.only(bottom: Spacing.sm),
          child: card,
        );
      }
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
              padding: Insets.bottomSm,
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
                onDeleteMessage:
                    widget.isOpenCode && message.role == MessageRole.assistant
                    ? (messageId) => deleteOpenCodeMessageFromChat(
                        context: context,
                        ref: ref,
                        sessionId: message.sessionId,
                        messageId: messageId,
                        projectPath:
                            ref.read(chatSessionProvider).projectPath ??
                            widget.project.path,
                      )
                    : null,
                onRollback: widget.isCodex ? _showCodexRollbackSheet : null,
              ),
            // Tool calls - using new compact card components
            for (final tool in message.toolCalls)
              Padding(
                padding: Insets.topSm,
                child: _buildToolCard(tool, message.id),
              ),
          ],
          // Diffs - only show standalone diffs that aren't from edit tools
          // (edit tool diffs are now shown inline in CompactEditCard)
          for (final diff in message.diffs)
            if (!_isDiffFromEditTool(diff, message.toolCalls))
              Padding(
                padding: Insets.topSm,
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
              padding: Insets.topSm,
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
                return CCUndoTurnBar(
                  changedFiles: _extractChangedFilePaths(message),
                  onUndo: _ccRewindToCheckpoint,
                );
              },
            ),
          SizedBox(height: Spacing.lg),
        ],
      ),
    );
  }

  /// Build a compact card widget for variant-tagged system messages.
  /// Returns null if the variant is not recognized (falls through to default rendering).
  Widget? _buildVariantCard(ChatMessage message) {
    final variant = message.variant!;

    // Task notification: variant = 'task-notification:completed' etc.
    if (variant.startsWith('task-notification:')) {
      final status = variant.replaceFirst('task-notification:', '');
      // Extract taskId from message id (pattern: cc-task-{taskId}-{timestamp})
      final idParts = message.id.split('-');
      final taskId = idParts.length >= 3 ? idParts[2] : '';
      return CompactTaskNotificationCard(
        taskId: taskId,
        status: status,
        summary: message.text.replaceFirst(RegExp(r'^[✅❌⏳]\s*Task:\s*'), ''),
        onStop:
            status != 'completed' && status != 'failed' && status != 'stopped'
            ? () {
                final ccState = ref.read(ccChatProvider);
                final sessionId = ccState.sessionId;
                if (sessionId != null &&
                    sessionId.isNotEmpty &&
                    taskId.isNotEmpty) {
                  ref
                      .read(bridgeServiceProvider)
                      .ccStopTask(sessionId: sessionId, taskId: taskId);
                }
              }
            : null,
      );
    }

    // Tool use summary: variant = 'tool-use-summary'
    if (variant == 'tool-use-summary') {
      return CompactToolSummaryChip(summary: message.text);
    }

    // Files persisted: variant = 'files-persisted'
    if (variant == 'files-persisted') {
      return _buildFilesPersistedCard(message);
    }

    // Hook events: variant = 'hook:running' or 'hook:success' etc.
    if (variant.startsWith('hook:')) {
      final status = variant.replaceFirst('hook:', '');
      // Parse hook info from text: "⚡ Hook: {name} ({event})" or "⚡ Hook: {name} ({event}) — {outcome}"
      final hookText = message.text.replaceFirst(RegExp(r'^⚡\s*Hook:\s*'), '');
      final match = RegExp(r'^(.+?)\s*\(([^)]+)\)').firstMatch(hookText);
      final hookName = match?.group(1) ?? hookText;
      final hookEvent = match?.group(2) ?? '';
      // Check for output after " — "
      final dashIdx = hookText.indexOf(' — ');
      final output = dashIdx > 0 ? hookText.substring(dashIdx + 3) : null;
      return CompactHookCard(
        hookName: hookName,
        hookEvent: hookEvent,
        status: status,
        output: output,
      );
    }

    // Status compacting: variant = 'status-compacting'
    if (variant == 'status-compacting') {
      final theme = OpenCodeTheme.of(context);
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: theme.accent.withValues(alpha: 0.2),
            width: 0.5,
          ),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 1.5,
                color: theme.accent,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Compacting conversation…',
                style: TextStyle(fontSize: 12, color: theme.textMuted),
              ),
            ),
          ],
        ),
      );
    }

    // Assistant error: variant = 'assistant-error:{errorType}'
    if (variant.startsWith('assistant-error:')) {
      final theme = OpenCodeTheme.of(context);
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: theme.error.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: theme.error.withValues(alpha: 0.3),
            width: 0.5,
          ),
        ),
        child: Row(
          children: [
            Icon(Icons.warning_amber_rounded, size: 16, color: theme.error),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message.text,
                style: TextStyle(fontSize: 12, color: theme.text, height: 1.3),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      );
    }

    // Auth status: variant = 'auth-status'
    if (variant == 'auth-status') {
      final theme = OpenCodeTheme.of(context);
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: theme.accent.withValues(alpha: 0.2),
            width: 0.5,
          ),
        ),
        child: Row(
          children: [
            Icon(Icons.vpn_key_rounded, size: 14, color: theme.accent),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message.text,
                style: TextStyle(fontSize: 12, color: theme.textMuted),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      );
    }

    final ccSystemCard = buildCcSystemMessageCard(
      context: context,
      message: message,
      variant: variant,
    );
    if (ccSystemCard != null) {
      return ccSystemCard;
    }

    return null; // Unknown variant, fall through to default rendering
  }

  /// Build a compact card for files-persisted events
  Widget _buildFilesPersistedCard(ChatMessage message) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: theme.success.withValues(alpha: 0.25),
          width: 0.5,
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.save_outlined, size: 16, color: theme.success),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message.text.replaceFirst('💾 ', ''),
              style: TextStyle(fontSize: 12, color: theme.text, height: 1.3),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
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

  void _showModelSelector(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Select Model',
      initialSize: 0.5,
      child: ModelSelectorContent(
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
    // Check for streaming state (different per agent)
    if (widget.isClaudeCode) {
      if (chatState.ccIsStreaming) {
        // CC SDK single-message mode doesn't support mid-turn queuing.
        // Queue the message locally and auto-send when the turn completes.
        final chat = ref.read(chatSessionProvider.notifier);
        chat.setPendingCCMessage(
          text,
          attachments: hasAttachments ? _attachedFiles.toList() : null,
        );
        _controller.clear();
        setState(() => _attachedFiles.clear());
        return;
      }
    } else if (widget.isCodex) {
      // Codex mid-turn: steer the agent instead of blocking.
      // Uses the SDK turn/steer RPC to nudge the agent with the new message.
      if (chatState.cxIsStreaming) {
        final threadId = chatState.cxThreadId;
        if (threadId != null && threadId.isNotEmpty) {
          ref
              .read(bridgeServiceProvider)
              .cxSteer(threadId: threadId, prompt: text);
          // Show the steer message in chat so the user sees what they sent
          ref.read(chatSessionProvider.notifier).appendUserMessage(text);
          _controller.clear();
          setState(() => _attachedFiles.clear());
        }
        return;
      }
    } else if (widget.isPi) {
      // Pi mid-turn: steer the agent
      if (chatState.piIsStreaming) {
        final piBridge = ref.read(piBridgeServiceProvider);
        piBridge.steer(message: text, projectPath: chatState.piCwd);
        ref.read(chatSessionProvider.notifier).appendUserMessage(text);
        _controller.clear();
        setState(() => _attachedFiles.clear());
        return;
      }
    }
    // OpenCode: no block — SDK's promptAsync() returns 204 immediately
    // and the server queues messages internally.
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
        thinking: ccConfig?.thinking,
        effort: ccConfig?.effort,
        activeSubagent: activeSubagent,
        resumeSessionAt: _ccResumeSessionAtMessageId,
        outputFormat: ccConfig?.outputFormat,
        sandbox: ccConfig?.sandbox,
        enableAgentTeams: ccConfig?.enableAgentTeams,
        enableClaudeAiMcpServers: ccConfig?.enableClaudeAiMcpServers,
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
      if (text.startsWith('/personality')) {
        final arg = text.replaceFirst('/personality', '').trim().toLowerCase();
        final p = switch (arg) {
          'none' => CodexPersonality.none,
          'friendly' => CodexPersonality.friendly,
          'pragmatic' || '' => CodexPersonality.pragmatic,
          _ => CodexPersonality.pragmatic,
        };
        chat.appendUserMessage(text);
        ref.read(codexSettingsProvider.notifier).setPersonality(p);
        chat.appendLocalAssistantMessage(
          'Personality set to: ${p.displayName}',
        );
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }
      if (text.startsWith('/collab')) {
        final arg = text.replaceFirst('/collab', '').trim().toLowerCase();
        final mode = switch (arg) {
          'plan' => CodexCollaborationMode.plan,
          'default' || '' => CodexCollaborationMode.defaultMode,
          _ => CodexCollaborationMode.defaultMode,
        };
        chat.appendUserMessage(text);
        ref.read(codexSettingsProvider.notifier).setCollaborationMode(mode);
        chat.appendLocalAssistantMessage(
          'Collaboration mode set to: ${mode.displayName}',
        );
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }
      if (text.startsWith('/rename')) {
        final name = text.replaceFirst('/rename', '').trim();
        final threadId = chatState.cxThreadId;
        chat.appendUserMessage(text);
        if (threadId == null || threadId.isEmpty) {
          chat.appendLocalAssistantMessage('No Codex thread yet to rename.');
        } else if (name.isEmpty) {
          chat.appendLocalAssistantMessage('Usage: /rename <name>');
        } else {
          () async {
            try {
              await ref
                  .read(bridgeServiceProvider)
                  .cxRenameThread(threadId: threadId, name: name);
              if (mounted) {
                chat.appendLocalAssistantMessage('Thread renamed to: $name');
              }
            } catch (e) {
              if (mounted) {
                chat.appendLocalAssistantMessage(
                  'Rename failed: ${humanizeError(e)}',
                );
              }
            }
          }();
        }
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }
      if (text == '/fork') {
        final threadId = chatState.cxThreadId;
        chat.appendUserMessage(text);
        if (threadId == null || threadId.isEmpty) {
          chat.appendLocalAssistantMessage('No Codex thread yet to fork.');
        } else {
          () async {
            try {
              final forked = await ref
                  .read(bridgeServiceProvider)
                  .cxThreadFork(threadId: threadId);
              if (mounted) {
                chat.appendLocalAssistantMessage(
                  'Thread forked! New thread: ${forked.displayTitle}',
                );
              }
            } catch (e) {
              if (mounted) {
                chat.appendLocalAssistantMessage(
                  'Fork failed: ${humanizeError(e)}',
                );
              }
            }
          }();
        }
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }
      if (text == '/apps') {
        chat.appendUserMessage(text);
        _showCodexAppsSheet();
        _controller.clear();
        _userHasScrolledUp = false;
        _scrollToBottom();
        return;
      }
      if (text == '/remote-skills') {
        chat.appendUserMessage(text);
        _showCodexRemoteSkillsSheet();
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
        _controller.clear();
        // Load fresh context data and open the sidebar
        _loadSessionContext();
        Scaffold.of(context).openEndDrawer();
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
          personality: codexSettings.personality.wireValue,
          serviceTier: codexSettings.serviceTier.wireValue,
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
              chat.appendLocalAssistantMessage(
                'Undo failed: ${humanizeError(e)}',
              );
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
            chat.appendLocalAssistantMessage(humanizeError(e));
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
            chat.appendLocalAssistantMessage(
              'Failed to list MCP servers: ${humanizeError(e)}',
            );
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
        personality: codexSettings.personality.wireValue,
        serviceTier: codexSettings.serviceTier.wireValue,
      );
      _controller.clear();
      setState(() => _attachedFiles.clear());
      _userHasScrolledUp = false;
      _scrollToBottom();
      return;
    }
    // Pi mode
    if (widget.isPi) {
      final piBridge = ref.read(piBridgeServiceProvider);
      final cwd = chatState.piCwd ?? widget.piSession?.cwd ?? widget.piDraftCwd;
      // Build display message with file attachments
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
      chat.setPiStreaming(true);
      piBridge.chat(
        prompt: text,
        projectPath: cwd,
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
      final elicitationRequestId =
          request.metadata['ccElicitationRequestId'] as String?;
      if (elicitationRequestId != null && elicitationRequestId.isNotEmpty) {
        final mode = request.metadata['ccElicitationMode'] as String?;
        var action = switch (response) {
          'once' || 'always' => 'accept',
          'reject' => 'decline',
          _ => 'cancel',
        };

        Map<String, dynamic>? content;
        if (mode == 'form' && action == 'accept') {
          content = await _showElicitationFormInputDialog(request);
          if (content == null) {
            action = 'cancel';
          }
        }

        bridge.ccRespondToElicitation(
          sessionId: request.sessionId,
          requestId: elicitationRequestId,
          action: action,
          content: content,
        );
      } else {
        bridge.ccRespondToPermission(
          sessionId: request.sessionId,
          toolUseId: request.id,
          response: response,
        );
      }
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
    if (mounted && Navigator.of(context).canPop()) {
      Navigator.pop(context);
    }
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
