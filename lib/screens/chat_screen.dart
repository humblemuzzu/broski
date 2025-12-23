import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/message.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../models/session_context.dart';
import '../providers/chat_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../services/haptics_service.dart';
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

  @override
  void initState() {
    super.initState();
    _hydrateSession();
    _controller.addListener(_onTextChanged);
    _scrollController.addListener(_onScroll);
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

  Future<void> _loadSessionContext() async {
    if (_loadingContext) return;
    setState(() => _loadingContext = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final data = await bridge.getSessionContext(
        widget.session.id,
        projectPath: widget.project.path,
      );
      if (mounted) {
        setState(() {
          _sessionContext = SessionContext.fromJson(data);
          _loadingContext = false;
        });
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

  void _onTextChanged() {
    setState(() {});
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
        onClose: _closeSidebar,
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
        MessageBubble(message: message),

        // Tool calls
        for (final tool in message.toolCalls)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: ToolCallCard(tool: tool),
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

    chat.appendUserMessage(text);
    bridge.sendChat(
      sessionId: widget.session.id,
      content: text,
      projectPath: widget.project.path,
      providerID: selectedModel?.providerID,
      modelID: selectedModel?.modelID,
    );

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
  });

  final String projectName;
  final bool isConnected;
  final SelectedModel? currentModel;
  final VoidCallback onBack;
  final VoidCallback onModelTap;
  final void Function(String) onMenu;
  final VoidCallback onOpenSidebar;

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
      child: Row(
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
          const SizedBox(width: 12),

          // Project name with glass effect
          ClipRRect(
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
                      size: 18,
                      color: kOnBackground,
                    ),
                    const SizedBox(width: 8),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 120),
                      child: Text(
                        projectName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
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

          const Spacer(),

          // Connection indicator + Model selector
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: GestureDetector(
                onTap: onModelTap,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 11,
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
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: isConnected
                              ? const Color(0xFF10B981)
                              : const Color(0xFFEF4444),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 7),
                      Text(
                        _getModelName(currentModel),
                        style: const TextStyle(
                          fontSize: 12,
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

          const SizedBox(width: 8),

          // Sidebar toggle button with glass effect
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: GestureDetector(
                onTap: onOpenSidebar,
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: kCard.withValues(alpha: 0.7),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: fade(kMuted, 0.2), width: 0.5),
                  ),
                  child: const Icon(
                    Icons.menu_open_rounded,
                    color: kOnBackground,
                    size: 22,
                  ),
                ),
              ),
            ),
          ),

          const SizedBox(width: 8),

          // Menu with glass effect
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: Container(
                decoration: BoxDecoration(
                  color: kCard.withValues(alpha: 0.7),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: fade(kMuted, 0.2), width: 0.5),
                ),
                child: PopupMenuButton<String>(
                  icon: const Icon(
                    Icons.more_vert_rounded,
                    color: kOnBackground,
                    size: 22,
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
