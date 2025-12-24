import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/agent.dart';
import '../models/command.dart';
import '../models/message.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../models/session_context.dart';
import '../models/vcs.dart';
import '../providers/chat_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/tool_settings_provider.dart';
import '../services/haptics_service.dart';
import '../widgets/diff_viewer.dart';
import '../widgets/message_bubble.dart';
import '../widgets/permission_prompt.dart';
import '../widgets/session_sidebar.dart';
import '../widgets/tool_call.dart';

// Utility function for color opacity (from expense_tracker)
Color fade(Color color, double opacity) {
  final clamped = opacity.clamp(0.0, 1.0);
  return color.withValues(alpha: clamped);
}

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.project, required this.session});

  final ProjectSummary project;
  final SessionSummary session;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen>
    with SingleTickerProviderStateMixin {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final HapticsService _haptics = HapticsService();
  String? _activePermissionId;
  bool _showScrollToBottom = false;

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

  @override
  void initState() {
    super.initState();
    _hydrateSession();
    _controller.addListener(_onTextChanged);
    _scrollController.addListener(_onScroll);
    _loadCommandsAndAgents();
    _loadVcsInfo();
  }

  Future<void> _hydrateSession() async {
    final bridge = ref.read(bridgeServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);
    final messages = await bridge.getSessionMessages(
      widget.session.id,
      projectPath: widget.project.path,
    );
    chat.hydrate(messages);
    _scrollToBottom(animate: false);
    // Load context after messages
    _loadSessionContext();
  }

  // Feature 2 & 3: Load available commands and agents
  Future<void> _loadCommandsAndAgents() async {
    final bridge = ref.read(bridgeServiceProvider);
    try {
      final commands = await bridge.listCommands(
        projectPath: widget.project.path,
      );
      final agents = await bridge.listAgents(projectPath: widget.project.path);
      if (mounted) {
        setState(() {
          _commands = commands;
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

  Future<void> _loadSessionContext() async {
    if (_loadingContext) return;
    setState(() => _loadingContext = true);
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
      if (mounted) {
        setState(() {
          _sessionContext = SessionContext.fromJson(contextData);
          _loadingContext = false;
        });
        // Update todos in provider
        ref.read(chatSessionProvider.notifier).setTodos(todosData);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _loadingContext = false);
      }
    }
  }

  void _closeSidebar() {
    setState(() => _sidebarOpen = false);
  }

  // Feature 10: Load VCS/Git info
  Future<void> _loadVcsInfo() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final vcsInfo = await bridge.getVcsInfo(projectPath: widget.project.path);
      if (mounted) {
        setState(() => _vcsInfo = vcsInfo);
        ref.read(chatSessionProvider.notifier).setVcsInfo(vcsInfo);
      }
    } catch (e) {
      // VCS info not available
    }
  }

  // Feature 6: Fork Session
  Future<void> _forkSession({String? messageId}) async {
    _haptics.mediumImpact();
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final forkedSession = await bridge.forkSession(
        widget.session.id,
        messageId: messageId,
        projectPath: widget.project.path,
      );
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Session forked: ${forkedSession.title}'),
          backgroundColor: const Color(0xFF1F2128),
          action: SnackBarAction(
            label: 'Open',
            textColor: const Color(0xFF3B82F6),
            onPressed: () {
              // Navigate to the forked session
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(
                  builder: (_) => ChatScreen(
                    project: widget.project,
                    session: forkedSession,
                  ),
                ),
              );
            },
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to fork session: $e'),
          backgroundColor: const Color(0xFFEF4444),
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

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Changes reverted'),
          backgroundColor: Color(0xFF1F2128),
        ),
      );
      // Refresh session context to update modified files
      _loadSessionContext();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to revert: $e'),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
    }
  }

  // Feature 7: Unrevert session
  Future<void> _unrevertSession() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.unrevertSession(
        widget.session.id,
        projectPath: widget.project.path,
      );
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Revert undone'),
          backgroundColor: Color(0xFF1F2128),
        ),
      );
      _loadSessionContext();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to undo revert: $e'),
          backgroundColor: const Color(0xFFEF4444),
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
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to get share URL'),
            backgroundColor: Color(0xFFEF4444),
          ),
        );
        return;
      }

      // Show share dialog
      _showShareDialog(shareUrl);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to share session: $e'),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
    }
  }

  void _showShareDialog(String url) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        decoration: const BoxDecoration(
          color: Color(0xFF1F2128),
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Session Shared',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w600,
                color: Color(0xFFE4E4E7),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Anyone with this link can view your session:',
              style: TextStyle(fontSize: 14, color: Color(0xFF9CA3AF)),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF16161E),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF2A2D36)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      url,
                      style: const TextStyle(
                        fontSize: 13,
                        color: Color(0xFF60A5FA),
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: url));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Link copied'),
                          backgroundColor: Color(0xFF1F2128),
                          duration: Duration(seconds: 2),
                        ),
                      );
                    },
                    icon: const Icon(
                      Icons.copy,
                      color: Color(0xFF9CA3AF),
                      size: 20,
                    ),
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
                      foregroundColor: const Color(0xFFE4E4E7),
                      side: const BorderSide(color: Color(0xFF2A2D36)),
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
                      backgroundColor: const Color(0xFF3B82F6),
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

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Session is no longer shared'),
          backgroundColor: Color(0xFF1F2128),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to unshare: $e'),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
    }
  }

  // Feature 9: Summarize/Compact Session
  Future<void> _compactSession() async {
    final selectedModel = ref.read(selectionProvider).model;
    if (selectedModel == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select a model first'),
          backgroundColor: Color(0xFFEF4444),
        ),
      );
      return;
    }

    // Confirm compact
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1F2128),
        title: const Text(
          'Compact Session?',
          style: TextStyle(color: Color(0xFFE4E4E7)),
        ),
        content: const Text(
          'This will summarize older messages to free up context window space. This cannot be undone.',
          style: TextStyle(color: Color(0xFF9CA3AF)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(
              'Compact',
              style: TextStyle(color: Color(0xFF3B82F6)),
            ),
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
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Session compacted successfully'),
            backgroundColor: Color(0xFF1F2128),
          ),
        );
        // Refresh context to show updated token count
        _loadSessionContext();
      } else {
        ref.read(chatSessionProvider.notifier).setCompacting(false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to compact session'),
            backgroundColor: Color(0xFFEF4444),
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ref.read(chatSessionProvider.notifier).setCompacting(false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to compact: $e'),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
    }
  }

  // Feature 20: Initialize Project (Create AGENTS.md)
  Future<void> _initializeProject() async {
    final selectedModel = ref.read(selectionProvider).model;
    if (selectedModel == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select a model first'),
          backgroundColor: Color(0xFFEF4444),
        ),
      );
      return;
    }

    // Confirm initialization
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1F2128),
        title: const Text(
          'Initialize Project?',
          style: TextStyle(color: Color(0xFFE4E4E7)),
        ),
        content: const Text(
          'This will analyze your project and create an AGENTS.md file with project-specific instructions for the AI.',
          style: TextStyle(color: Color(0xFF9CA3AF)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(
              'Initialize',
              style: TextStyle(color: Color(0xFF10B981)),
            ),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    _haptics.mediumImpact();

    // Show a loading message
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Initializing project...'),
        backgroundColor: Color(0xFF1F2128),
        duration: Duration(seconds: 2),
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
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Project initialized! AGENTS.md created.'),
            backgroundColor: Color(0xFF10B981),
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to initialize project'),
            backgroundColor: Color(0xFFEF4444),
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to initialize: $e'),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
    }
  }

  void _onTextChanged() {
    final text = _controller.text;

    // Detect slash command autocomplete - ONLY when input starts fresh with /
    // Once there's a space after the command name, autocomplete closes
    // e.g., "/" or "/init" or "/rev" triggers autocomplete
    // but "/init " (with space) or "hello" does NOT
    final isSlashCommand =
        text.startsWith('/') && text.isNotEmpty && !text.contains(' ');

    if (isSlashCommand) {
      final filter = text.substring(1).toLowerCase();
      if (!_showCommandAutocomplete || _commandFilter != filter) {
        setState(() {
          _showCommandAutocomplete = true;
          _commandFilter = filter;
        });
      }
    } else if (_showCommandAutocomplete) {
      setState(() {
        _showCommandAutocomplete = false;
        _commandFilter = '';
      });
    } else {
      setState(() {});
    }
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;

    final isAtBottom =
        _scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 100;

    if (_showScrollToBottom == isAtBottom) {
      setState(() {
        _showScrollToBottom = !isAtBottom;
      });
    }
  }

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
  void _selectCommand(SlashCommand command) {
    _controller.text = '/${command.name} ';
    _controller.selection = TextSelection.fromPosition(
      TextPosition(offset: _controller.text.length),
    );
    setState(() {
      _showCommandAutocomplete = false;
      _commandFilter = '';
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chatState = ref.watch(chatSessionProvider);
    final connection = ref.watch(connectionProvider);

    _maybeShowPermissionPrompt(chatState);

    return Scaffold(
      backgroundColor: const Color(0xFF16161E),
      // Use endDrawer for right-side sidebar that can be swiped from edge
      endDrawer: SessionSidebar(
        sessionTitle: widget.session.title,
        sessionContext: _sessionContext,
        todos: chatState.todos,
        onClose: _closeSidebar,
        vcsInfo: _vcsInfo,
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
          SafeArea(
            child: Column(
              children: [
                // Chat messages
                Expanded(
                  child: ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.fromLTRB(20, 20, 20, 90),
                    itemCount: chatState.messages.length,
                    itemBuilder: (context, index) {
                      final message = chatState.messages[index];
                      return _buildMessageGroup(message);
                    },
                  ),
                ),
              ],
            ),
          ),

          // Scroll to bottom button
          if (_showScrollToBottom)
            Positioned(
              bottom: 100,
              right: 20,
              child: _buildScrollToBottomButton(),
            ),

          // Stop button when streaming
          if (_hasStreamingMessage(chatState.messages))
            Positioned(bottom: 100, left: 20, child: _buildStopButton(context)),

          // Slash command autocomplete popup
          if (_showCommandAutocomplete && _commands.isNotEmpty)
            Positioned(
              left: 16,
              right: 16,
              bottom: 70,
              child: _CommandAutocomplete(
                commands: _filteredCommands,
                onSelect: _selectCommand,
              ),
            ),

          // Floating input bar at bottom (ChatGPT style)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _FloatingInputBar(
              controller: _controller,
              onSend: () => _sendMessage(connection, chatState),
              isBusy: _hasStreamingMessage(chatState.messages),
              canSend:
                  connection.isConnected &&
                  !_hasStreamingMessage(chatState.messages) &&
                  _controller.text.trim().isNotEmpty,
            ),
          ),

          // Floating header at top (glass pills)
          Positioned(
            left: 0,
            right: 0,
            top: 0,
            child: _FloatingHeader(
              projectName: widget.project.name,
              isConnected: connection.isConnected,
              currentModel: ref.watch(selectionProvider).model,
              onBack: () => Navigator.of(context).pop(),
              onModelTap: () => _showModelSelector(context),
              onMenu: (value) => _handleMenuAction(value, chatState),
              onOpenSidebar: () => Scaffold.of(context).openEndDrawer(),
              // Feature 3: Agent switching
              currentAgent: _selectedAgent,
              agents: _agents,
              onAgentChanged: (agent) => setState(() => _selectedAgent = agent),
              // Feature 10: VCS info
              vcsInfo: _vcsInfo,
              // Feature 8: Session sharing state
              isSessionShared: widget.session.isShared,
              // Feature 9: Compaction state
              isCompacting: chatState.isCompacting,
              // Feature 13: Session status
              sessionStatus: chatState.sessionStatus,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMessageGroup(ChatMessage message) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Feature 6: Pass fork callback to message bubble
        MessageBubble(
          message: message,
          onForkFromHere: message.role == MessageRole.assistant
              ? (messageId) => _forkSession(messageId: messageId)
              : null,
        ),

        // Tool calls with Feature 7: Undo callback
        for (final tool in message.toolCalls)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: ToolCallCard(
              tool: tool,
              messageId: message.id,
              onUndo: (messageId, partId) =>
                  _revertMessage(messageId, partId: partId),
            ),
          ),

        // Diffs with Feature 7: Revert callback
        for (final diff in message.diffs)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: DiffViewer(
              diff: diff,
              messageId: message.id,
              onRevert: (messageId) => _revertMessage(messageId),
            ),
          ),

        const SizedBox(height: 16),
      ],
    );
  }

  Widget _buildScrollToBottomButton() {
    const kCard = Color(0xFF1F2128);
    const kMuted = Color(0xFF71717A);

    return Material(
      color: kCard,
      borderRadius: BorderRadius.circular(26),
      elevation: 4,
      child: InkWell(
        onTap: () => _scrollToBottom(),
        borderRadius: BorderRadius.circular(26),
        child: Container(
          width: 52,
          height: 52,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: fade(kMuted, 0.25), width: 1),
          ),
          child: const Icon(
            Icons.keyboard_arrow_down,
            color: Color(0xFF9CA3AF),
            size: 24,
          ),
        ),
      ),
    );
  }

  Widget _buildStopButton(BuildContext context) {
    return Material(
      color: const Color(0xFFEF4444),
      borderRadius: BorderRadius.circular(26),
      elevation: 4,
      child: InkWell(
        onTap: () => _showStopConfirmation(context),
        borderRadius: BorderRadius.circular(26),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.stop, color: Colors.white, size: 20),
              SizedBox(width: 8),
              Text(
                'Stop',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _handleMenuAction(String value, ChatSessionState chatState) {
    switch (value) {
      case 'new_session':
        // TODO: Implement new session
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('New session - coming soon'),
            backgroundColor: Color(0xFF1F2128),
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
        // Find the last assistant message with tool calls
        ChatMessage? lastEditMessage;
        for (final msg in chatState.messages.reversed) {
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
            const SnackBar(
              content: Text('No file changes to undo'),
              backgroundColor: Color(0xFF1F2128),
            ),
          );
        }
        break;
      case 'clear':
        // TODO: Implement clear chat
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Clear chat - coming soon'),
            backgroundColor: Color(0xFF1F2128),
          ),
        );
        break;
    }
  }

  void _showStopConfirmation(BuildContext context) {
    _haptics.mediumImpact();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1F2128),
        title: const Text(
          'Stop Generation?',
          style: TextStyle(color: Color(0xFFE4E4E7)),
        ),
        content: const Text(
          'This will abort the current AI response.',
          style: TextStyle(color: Color(0xFF9CA3AF)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              ref.read(bridgeServiceProvider).abortSession(widget.session.id);
              Navigator.pop(context);
            },
            child: const Text(
              'Stop',
              style: TextStyle(color: Color(0xFFEF4444)),
            ),
          ),
        ],
      ),
    );
  }

  void _showModelSelector(BuildContext context) {
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
              backgroundColor: const Color(0xFF1F2128),
              behavior: SnackBarBehavior.floating,
            ),
          );
        },
      ),
    );
  }

  void _sendMessage(
    BridgeConnectionState connection,
    ChatSessionState chatState,
  ) {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    if (!connection.isConnected) return;
    if (_hasStreamingMessage(chatState.messages)) return;

    final bridge = ref.read(bridgeServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);
    final selectedModel = ref.read(selectionProvider).model;

    // Feature 2: Check if this is a slash command
    if (text.startsWith('/')) {
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
        agent: _selectedAgent,
        model: selectedModel != null
            ? '${selectedModel.providerID}/${selectedModel.modelID}'
            : null,
      );
    } else {
      // Regular chat message
      chat.appendUserMessage(text);

      // Get disabled tools from settings
      final toolSettings = ref.read(toolSettingsProvider);
      final disabledTools = toolSettings.disabledTools.toList();

      bridge.sendChat(
        sessionId: widget.session.id,
        content: text,
        projectPath: widget.project.path,
        providerID: selectedModel?.providerID,
        modelID: selectedModel?.modelID,
        agent: _selectedAgent,
        disabledTools: disabledTools.isNotEmpty ? disabledTools : null,
      );
    }

    _controller.clear();
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

  void _maybeShowPermissionPrompt(ChatSessionState state) {
    if (state.permissions.isEmpty) {
      _activePermissionId = null;
      return;
    }

    final request = state.permissions.first;
    if (_activePermissionId == request.id) return;

    _activePermissionId = request.id;
    _haptics.mediumImpact();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) {
          return PermissionPrompt(
            request: request,
            onApprove: () => _respondToPermission(request, 'once'),
            onDeny: () => _respondToPermission(request, 'reject'),
          );
        },
      ).whenComplete(() => _activePermissionId = null);
    });
  }

  void _respondToPermission(PermissionRequest request, String response) {
    final bridge = ref.read(bridgeServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);
    bridge.respondToPermission(
      sessionId: request.sessionId,
      permissionId: request.id,
      response: response,
      projectPath: widget.project.path,
    );
    chat.resolvePermission(request.id);
    Navigator.pop(context);
  }
}

// Floating header with glass pills (exact from expense_tracker)
class _FloatingHeader extends StatelessWidget {
  const _FloatingHeader({
    required this.projectName,
    required this.isConnected,
    required this.currentModel,
    required this.onBack,
    required this.onModelTap,
    required this.onMenu,
    required this.onOpenSidebar,
    this.currentAgent,
    this.agents = const [],
    this.onAgentChanged,
    this.vcsInfo,
    this.isSessionShared = false,
    this.isCompacting = false,
    this.sessionStatus =
        const SessionStatus.idle(), // Feature 13: Session status
  });

  final String projectName;
  final bool isConnected;
  final SelectedModel? currentModel;
  final VoidCallback onBack;
  final VoidCallback onModelTap;
  final void Function(String) onMenu;
  final VoidCallback onOpenSidebar;
  // Feature 3: Agent switching
  final String? currentAgent;
  final List<Agent> agents;
  final void Function(String?)? onAgentChanged;
  // Feature 10: VCS info
  final VcsInfo? vcsInfo;
  // Feature 8: Session sharing state
  final bool isSessionShared;
  // Feature 9: Compaction state
  final bool isCompacting;
  // Feature 13: Session status
  final SessionStatus sessionStatus;

  @override
  Widget build(BuildContext context) {
    const kCard = Color(0xFF1F2128);
    const kMuted = Color(0xFF71717A);
    const kOnBackground = Color(0xFFE4E4E7);

    return Container(
      padding: EdgeInsets.fromLTRB(
        12,
        MediaQuery.of(context).padding.top + 8,
        12,
        12,
      ),
      color: Colors.transparent, // Completely transparent
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Back button with glass effect
            ClipRRect(
              borderRadius: BorderRadius.circular(20),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                child: GestureDetector(
                  onTap: onBack,
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: kCard.withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: fade(kMuted, 0.2), width: 0.5),
                    ),
                    child: const Icon(
                      Icons.arrow_back_rounded,
                      color: kOnBackground,
                      size: 24,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),

            // Project name with glass effect - wrapped in Flexible to shrink if needed
            Flexible(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(20),
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: kCard.withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: fade(kMuted, 0.2), width: 0.5),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.folder_outlined,
                          size: 16,
                          color: kOnBackground,
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            projectName,
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                              color: kOnBackground,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

            // Feature 10: VCS branch indicator - reduced size
            if (vcsInfo != null && vcsInfo!.isAvailable)
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: kCard.withValues(alpha: 0.7),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: fade(kMuted, 0.2),
                          width: 0.5,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.call_split_rounded,
                            size: 12,
                            color: Color(0xFF10B981),
                          ),
                          const SizedBox(width: 4),
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 50),
                            child: Text(
                              vcsInfo!.branch ?? '',
                              style: const TextStyle(
                                fontSize: 11,
                                color: kOnBackground,
                                fontWeight: FontWeight.w500,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),

            const SizedBox(width: 8),

            // Feature 3: Agent selector
            if (agents.isNotEmpty && onAgentChanged != null)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(18),
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                    child: _AgentSelector(
                      agents: agents,
                      currentAgent: currentAgent,
                      onAgentChanged: onAgentChanged!,
                    ),
                  ),
                ),
              ),

            // Connection indicator + Model selector + Status
            ClipRRect(
              borderRadius: BorderRadius.circular(18),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                child: GestureDetector(
                  onTap: onModelTap,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: kCard.withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: fade(kMuted, 0.2), width: 0.5),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Feature 13: Animated status indicator
                        _StatusIndicator(
                          isConnected: isConnected,
                          sessionStatus: sessionStatus,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          _getModelName(currentModel),
                          style: const TextStyle(
                            fontSize: 11,
                            color: kOnBackground,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

            const SizedBox(width: 6),

            // Sidebar toggle button with glass effect
            ClipRRect(
              borderRadius: BorderRadius.circular(18),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                child: GestureDetector(
                  onTap: onOpenSidebar,
                  child: Container(
                    padding: const EdgeInsets.all(7),
                    decoration: BoxDecoration(
                      color: kCard.withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: fade(kMuted, 0.2), width: 0.5),
                    ),
                    child: const Icon(
                      Icons.menu_open_rounded,
                      color: kOnBackground,
                      size: 20,
                    ),
                  ),
                ),
              ),
            ),

            const SizedBox(width: 6),

            // Menu with glass effect
            ClipRRect(
              borderRadius: BorderRadius.circular(18),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                child: Container(
                  decoration: BoxDecoration(
                    color: kCard.withValues(alpha: 0.7),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: fade(kMuted, 0.2), width: 0.5),
                  ),
                  child: PopupMenuButton<String>(
                    icon: const Icon(
                      Icons.more_vert_rounded,
                      color: kOnBackground,
                      size: 20,
                    ),
                    color: kCard,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    onSelected: onMenu,
                    itemBuilder: (context) => [
                      const PopupMenuItem(
                        value: 'new_session',
                        child: Row(
                          children: [
                            Icon(
                              Icons.add_rounded,
                              size: 20,
                              color: kOnBackground,
                            ),
                            SizedBox(width: 12),
                            Text('New Session'),
                          ],
                        ),
                      ),
                      // Feature 6: Fork Session
                      const PopupMenuItem(
                        value: 'fork',
                        child: Row(
                          children: [
                            Icon(
                              Icons.call_split_rounded,
                              size: 20,
                              color: kOnBackground,
                            ),
                            SizedBox(width: 12),
                            Text('Fork Session'),
                          ],
                        ),
                      ),
                      // Feature 8: Share/Unshare Session
                      PopupMenuItem(
                        value: isSessionShared ? 'unshare' : 'share',
                        child: Row(
                          children: [
                            Icon(
                              isSessionShared ? Icons.link_off : Icons.share,
                              size: 20,
                              color: kOnBackground,
                            ),
                            const SizedBox(width: 12),
                            Text(isSessionShared ? 'Unshare' : 'Share Session'),
                          ],
                        ),
                      ),
                      // Feature 9: Compact Session
                      PopupMenuItem(
                        value: 'compact',
                        enabled: !isCompacting,
                        child: Row(
                          children: [
                            Icon(
                              Icons.compress_rounded,
                              size: 20,
                              color: isCompacting ? kMuted : kOnBackground,
                            ),
                            const SizedBox(width: 12),
                            Text(
                              isCompacting
                                  ? 'Compacting...'
                                  : 'Compact Session',
                              style: TextStyle(
                                color: isCompacting ? kMuted : null,
                              ),
                            ),
                          ],
                        ),
                      ),
                      // Feature 20: Initialize Project (Create AGENTS.md)
                      const PopupMenuItem(
                        value: 'init',
                        child: Row(
                          children: [
                            Icon(
                              Icons.auto_fix_high_rounded,
                              size: 20,
                              color: Color(0xFF10B981),
                            ),
                            SizedBox(width: 12),
                            Text(
                              'Initialize Project',
                              style: TextStyle(color: Color(0xFF10B981)),
                            ),
                          ],
                        ),
                      ),
                      const PopupMenuDivider(),
                      // Feature 7: Undo Last Changes
                      const PopupMenuItem(
                        value: 'undo',
                        child: Row(
                          children: [
                            Icon(
                              Icons.undo_rounded,
                              size: 20,
                              color: Color(0xFFF59E0B),
                            ),
                            SizedBox(width: 12),
                            Text(
                              'Undo Last Changes',
                              style: TextStyle(color: Color(0xFFF59E0B)),
                            ),
                          ],
                        ),
                      ),
                      const PopupMenuDivider(),
                      const PopupMenuItem(
                        value: 'clear',
                        child: Row(
                          children: [
                            Icon(
                              Icons.delete_outline_rounded,
                              size: 20,
                              color: Color(0xFFEF4444),
                            ),
                            SizedBox(width: 12),
                            Text(
                              'Clear Chat',
                              style: TextStyle(color: Color(0xFFEF4444)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

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
}

// ChatGPT-style floating input bar (exact from expense_tracker)
class _FloatingInputBar extends StatelessWidget {
  const _FloatingInputBar({
    required this.controller,
    required this.onSend,
    required this.isBusy,
    required this.canSend,
  });

  final TextEditingController controller;
  final VoidCallback onSend;
  final bool isBusy;
  final bool canSend;

  @override
  Widget build(BuildContext context) {
    const kCard = Color(0xFF1F2128);
    const kMuted = Color(0xFF71717A);
    const kOnBackground = Color(0xFFE4E4E7);
    const kBackground = Color(0xFF16161E);

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      color: Colors.transparent,
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.only(bottom: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            // Plus button - same height and style as prompt bar (ChatGPT style)
            GestureDetector(
              onTap: () {
                // TODO: Add attach/upload functionality
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Attach files - coming soon'),
                    backgroundColor: kCard,
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              },
              child: Container(
                height: 44, // Same as prompt bar minHeight
                width: 44,
                margin: const EdgeInsets.only(right: 8),
                decoration: BoxDecoration(
                  color: kCard, // Same background as prompt bar
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(color: fade(kMuted, 0.25)), // Same border
                  boxShadow: [
                    BoxShadow(
                      color: fade(kOnBackground, 0.06),
                      blurRadius: 12,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: const Center(
                  child: Icon(
                    Icons.add_rounded,
                    color: kOnBackground,
                    size: 24,
                  ),
                ),
              ),
            ),
            // Prompt bar container
            Expanded(
              child: Container(
                constraints: const BoxConstraints(minHeight: 44),
                decoration: BoxDecoration(
                  color: kCard,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: fade(kMuted, 0.25)),
                  boxShadow: [
                    BoxShadow(
                      color: fade(kOnBackground, 0.06),
                      blurRadius: 12,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    // Text input
                    Expanded(
                      child: TextField(
                        controller: controller,
                        minLines: 1,
                        maxLines: 5,
                        style: const TextStyle(
                          fontWeight: FontWeight.w500,
                          color: kOnBackground,
                          fontSize: 15,
                        ),
                        decoration: InputDecoration(
                          hintText: 'Ask AI to edit code...',
                          filled: false,
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          disabledBorder: InputBorder.none,
                          errorBorder: InputBorder.none,
                          focusedErrorBorder: InputBorder.none,
                          hintStyle: const TextStyle(
                            color: kMuted,
                            fontWeight: FontWeight.w500,
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
                    // Send button inside
                    GestureDetector(
                      onTap: canSend ? onSend : null,
                      child: Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: canSend ? kOnBackground : fade(kMuted, 0.15),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Center(
                          child: Icon(
                            isBusy
                                ? Icons.stop_rounded
                                : Icons.arrow_upward_rounded,
                            color: canSend ? kBackground : kMuted,
                            size: 18,
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
    const kBackground = Color(0xFF16161E);
    const kOnBackground = Color(0xFFE4E4E7);
    const kMuted = Color(0xFF71717A);

    return Container(
      decoration: const BoxDecoration(
        color: kBackground,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (context, scrollController) {
          if (_loading) {
            return const Center(
              child: CircularProgressIndicator(color: Color(0xFF3B82F6)),
            );
          }

          if (_error != null) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Text(
                  'Failed to load models: $_error',
                  style: const TextStyle(color: kMuted),
                ),
              ),
            );
          }

          final providers =
              _providersData?['providers'] as List<dynamic>? ?? [];

          return ListView(
            controller: scrollController,
            padding: const EdgeInsets.all(20),
            children: [
              const Text(
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
                    style: const TextStyle(fontSize: 13, color: kMuted),
                  ),
                ),
              if (providers.isEmpty)
                const Text(
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
    const kOnBackground = Color(0xFFE4E4E7);
    const kMuted = Color(0xFF71717A);

    final id = provider['id'] as String? ?? 'provider';
    final name = provider['name'] as String? ?? id;
    final models = provider['models'] as Map<String, dynamic>? ?? {};

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          name,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: kOnBackground,
          ),
        ),
        const SizedBox(height: 8),
        for (final entry in models.entries)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: _currentModel == '$id/${entry.key}'
                ? const Icon(Icons.check_circle, color: Color(0xFF10B981))
                : const Icon(Icons.circle_outlined, color: Color(0xFF52525B)),
            title: Text(
              entry.value['name'] as String? ?? entry.key,
              style: const TextStyle(color: kOnBackground),
            ),
            subtitle: Text(
              entry.key,
              style: const TextStyle(fontSize: 12, color: kMuted),
            ),
            onTap: () => _selectModel(id, entry.key),
          ),
      ],
    );
  }
}

// Feature 2: Slash command autocomplete popup
class _CommandAutocomplete extends StatelessWidget {
  const _CommandAutocomplete({required this.commands, required this.onSelect});

  final List<SlashCommand> commands;
  final void Function(SlashCommand) onSelect;

  @override
  Widget build(BuildContext context) {
    const kCard = Color(0xFF1F2128);
    const kBorder = Color(0xFF2A2D36);
    const kOnBackground = Color(0xFFE4E4E7);
    const kMuted = Color(0xFF71717A);
    const kAccent = Color(0xFF3B82F6);

    if (commands.isEmpty) {
      return const SizedBox.shrink();
    }

    return Container(
      constraints: const BoxConstraints(maxHeight: 200),
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
          shrinkWrap: true,
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: commands.length,
          itemBuilder: (context, index) {
            final command = commands[index];
            return InkWell(
              onTap: () => onSelect(command),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                child: Row(
                  children: [
                    // Command icon
                    Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: kAccent.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(
                        command.builtin ? Icons.terminal : Icons.extension,
                        size: 16,
                        color: kAccent,
                      ),
                    ),
                    const SizedBox(width: 12),
                    // Command name and description
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            command.displayName,
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: kOnBackground,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            command.shortDescription,
                            style: const TextStyle(fontSize: 12, color: kMuted),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                    // Built-in badge
                    if (command.builtin)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: kMuted.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Text(
                          'built-in',
                          style: TextStyle(
                            fontSize: 10,
                            color: kMuted,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

// Feature 3: Agent selector dropdown
class _AgentSelector extends StatelessWidget {
  const _AgentSelector({
    required this.agents,
    required this.currentAgent,
    required this.onAgentChanged,
  });

  final List<Agent> agents;
  final String? currentAgent;
  final void Function(String?) onAgentChanged;

  @override
  Widget build(BuildContext context) {
    const kCard = Color(0xFF1F2128);
    const kMuted = Color(0xFF71717A);
    const kOnBackground = Color(0xFFE4E4E7);

    // Get only primary agents for selection
    final primaryAgents = agents.where((a) => a.isPrimary).toList();
    if (primaryAgents.isEmpty) return const SizedBox.shrink();

    // Find current agent or default to first
    final current = primaryAgents.firstWhere(
      (a) => a.name == currentAgent,
      orElse: () => primaryAgents.first,
    );

    return PopupMenuButton<String>(
      onSelected: onAgentChanged,
      offset: const Offset(0, 45),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: kCard,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: kCard.withValues(alpha: 0.7),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: fade(kMuted, 0.2), width: 0.5),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: current.displayColor,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              current.displayName,
              style: const TextStyle(
                fontSize: 12,
                color: kOnBackground,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 4),
            const Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 16,
              color: kMuted,
            ),
          ],
        ),
      ),
      itemBuilder: (context) => primaryAgents.map((agent) {
        final isSelected =
            agent.name == currentAgent ||
            (currentAgent == null && agent == primaryAgents.first);
        return PopupMenuItem<String>(
          value: agent.name,
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
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      agent.displayName,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: isSelected
                            ? FontWeight.w600
                            : FontWeight.w500,
                        color: kOnBackground,
                      ),
                    ),
                    Text(
                      agent.shortDescription,
                      style: const TextStyle(fontSize: 11, color: kMuted),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (isSelected)
                const Icon(
                  Icons.check_rounded,
                  size: 18,
                  color: Color(0xFF10B981),
                ),
            ],
          ),
        );
      }).toList(),
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
    final status = widget.sessionStatus;

    // Connection color
    Color baseColor;
    if (!widget.isConnected) {
      baseColor = const Color(0xFFEF4444); // Red - disconnected
    } else if (status.isBusy) {
      baseColor = const Color(0xFF60A5FA); // Blue - busy/working
    } else if (status.isRetry) {
      baseColor = const Color(0xFFFBBF24); // Yellow - retry
    } else {
      baseColor = const Color(0xFF10B981); // Green - idle/connected
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
