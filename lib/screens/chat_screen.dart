import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/message.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../providers/chat_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../services/haptics_service.dart';
import '../widgets/connection_indicator.dart';
import '../widgets/diff_viewer.dart';
import '../widgets/message_bubble.dart';
import '../widgets/permission_prompt.dart';
import '../widgets/tool_call.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.project, required this.session});

  final ProjectSummary project;
  final SessionSummary session;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final HapticsService _haptics = HapticsService();
  String? _activePermissionId;

  @override
  void initState() {
    super.initState();
    _hydrateSession();
  }

  Future<void> _hydrateSession() async {
    final bridge = ref.read(bridgeServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);
    final messages = await bridge.getSessionMessages(
      widget.session.id,
      projectPath: widget.project.path,
    );
    chat.hydrate(messages);
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
      appBar: AppBar(
        title: Text(widget.project.name),
        actions: [
          IconButton(
            icon: const Icon(Icons.tune),
            onPressed: () => _showModelSelector(context),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: ConnectionIndicator(
              status: connection.status,
              opencodeRunning: connection.opencodeRunning,
              compact: true,
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(20),
              itemCount: chatState.messages.length,
              itemBuilder: (context, index) {
                final message = chatState.messages[index];
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    MessageBubble(message: message),
                    for (final tool in message.toolCalls)
                      ToolCallCard(tool: tool),
                    for (final diff in message.diffs) DiffViewer(diff: diff),
                  ],
                );
              },
            ),
          ),
          _buildComposer(context, connection),
        ],
      ),
    );
  }

  void _showModelSelector(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ModelSelectorSheet(
        onModelSelected: (model) {
          // Store model selection in app state
          ref.read(selectionProvider.notifier).selectModelFromString(model);
          Navigator.pop(context);
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text('Switched to $model')));
        },
      ),
    );
  }

  Widget _buildComposer(
    BuildContext context,
    BridgeConnectionState connection,
  ) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _controller,
                decoration: const InputDecoration(
                  hintText: 'Type a message...',
                ),
              ),
            ),
            const SizedBox(width: 12),
            IconButton.filled(
              onPressed: connection.isConnected ? _sendMessage : null,
              icon: const Icon(Icons.send),
            ),
          ],
        ),
      ),
    );
  }

  void _sendMessage() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;

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

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
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
        // Use the app's selected model if set, otherwise use OpenCode's config
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
    // Update OpenCode's global config (for new sessions)
    final bridge = ref.read(bridgeServiceProvider);
    await bridge.setModel(model);
    // Update local state for immediate use
    setState(() {
      _currentModel = model;
    });
    widget.onModelSelected(model);
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.3,
      maxChildSize: 0.9,
      expand: false,
      builder: (context, scrollController) {
        if (_loading) {
          return const Center(child: CircularProgressIndicator());
        }

        if (_error != null) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Text('Failed to load models: $_error'),
            ),
          );
        }

        final providers = _providersData?['providers'] as List<dynamic>? ?? [];

        return ListView(
          controller: scrollController,
          padding: const EdgeInsets.all(20),
          children: [
            Text('Select Model', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            if (_currentModel != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(
                  'Current: $_currentModel',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            if (providers.isEmpty)
              const Text('No providers configured.')
            else
              for (final provider in providers) ...[
                _buildProviderSection(provider as Map<String, dynamic>),
                const SizedBox(height: 16),
              ],
          ],
        );
      },
    );
  }

  Widget _buildProviderSection(Map<String, dynamic> provider) {
    final id = provider['id'] as String? ?? 'provider';
    final name = provider['name'] as String? ?? id;
    final models = provider['models'] as Map<String, dynamic>? ?? {};

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(name, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final entry in models.entries)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: _currentModel == '$id/${entry.key}'
                ? const Icon(Icons.check_circle, color: Colors.green)
                : const Icon(Icons.circle_outlined),
            title: Text(entry.value['name'] as String? ?? entry.key),
            subtitle: Text(
              entry.key,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            onTap: () => _selectModel(id, entry.key),
          ),
      ],
    );
  }
}
