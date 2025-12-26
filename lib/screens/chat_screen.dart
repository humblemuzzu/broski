import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/agent.dart';
import '../models/command.dart';
import '../models/file_attachment.dart';
import '../models/message.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../models/session_context.dart';
import '../models/vcs.dart';
import '../providers/chat_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/file_search_provider.dart';
import '../providers/input_style_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/tool_settings_provider.dart';
import '../services/haptics_service.dart';
import '../services/image_picker_service.dart';
import '../services/websocket_service.dart';
import '../theme/opencode_theme.dart';
import '../widgets/diff_viewer.dart';
import '../widgets/file_tagging.dart';
import '../widgets/message_bubble.dart';
import '../widgets/permission_prompt.dart';
import '../widgets/session_sidebar.dart';
import '../widgets/tool_call.dart';
import 'diff_view_screen.dart';

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

  // Feature 21: File @ tagging
  final List<FileAttachment> _attachedFiles = [];
  bool _showFileAutocomplete = false;

  // Focus node for input bar - needed to restore focus after autocomplete appears
  final FocusNode _inputFocusNode = FocusNode();

  // Message pagination state
  bool _loadingMoreMessages = false;
  bool _hasLoadedAllMessages = false;

  bool _resyncingAfterReconnect = false;

  @override
  void initState() {
    super.initState();
    final bridge = ref.read(bridgeServiceProvider);
    bridge.setView(
      projectPath: widget.project.path,
      sessionId: widget.session.id,
    );

    ref.listen(connectionProvider, (previous, next) {
      final wasConnected = previous?.status == ConnectionStatus.connected;
      final isConnected = next.status == ConnectionStatus.connected;
      if (!wasConnected && isConnected) {
        // Re-assert view routing and re-sync session state after network flips.
        if (_resyncingAfterReconnect) return;
        _resyncingAfterReconnect = true;
        bridge.setView(
          projectPath: widget.project.path,
          sessionId: widget.session.id,
        );
        _hydrateSession().whenComplete(() {
          _resyncingAfterReconnect = false;
        });
      }
    });

    _hydrateSession();
    _controller.addListener(_onTextChanged);
    _scrollController.addListener(_onScroll);
    _loadCommandsAndAgents();
    _loadVcsInfo();
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

      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Session forked: ${forkedSession.title}'),
          backgroundColor: theme.backgroundPanel,
          action: SnackBarAction(
            label: 'Open',
            textColor: theme.primary,
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
      final theme = OpenCodeTheme.of(context);
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

  // Feature 7: Unrevert session
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
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.background,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: theme.borderSubtle),
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

  void _onTextChanged() {
    final text = _controller.text;
    final fileSearch = ref.read(fileSearchProvider.notifier);

    // Detect slash command autocomplete - ONLY when input starts fresh with /
    // Once there's a space after the command name, autocomplete closes
    // e.g., "/" or "/init" or "/rev" triggers autocomplete
    // but "/init " (with space) or "hello" does NOT
    final isSlashCommand =
        text.startsWith('/') && text.isNotEmpty && !text.contains(' ');

    // Detect @ file mention - check for @something at cursor position
    final atMatch = RegExp(r'@(\S*)$').firstMatch(text);

    if (isSlashCommand) {
      final filter = text.substring(1).toLowerCase();
      if (!_showCommandAutocomplete || _commandFilter != filter) {
        setState(() {
          _showCommandAutocomplete = true;
          _showFileAutocomplete = false;
          _commandFilter = filter;
        });
        fileSearch.clear();
      }
    } else if (atMatch != null) {
      final query = atMatch.group(1) ?? '';
      fileSearch.setProjectPath(widget.project.path);
      fileSearch.search(query);
      final wasShowingAutocomplete = _showFileAutocomplete;
      setState(() {
        _showCommandAutocomplete = false;
        _showFileAutocomplete = true;
        _commandFilter = '';
      });
      // Restore focus after autocomplete appears (fixes keyboard dismissal on mobile)
      if (!wasShowingAutocomplete) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _inputFocusNode.requestFocus();
        });
      }
    } else {
      if (_showCommandAutocomplete || _showFileAutocomplete) {
        setState(() {
          _showCommandAutocomplete = false;
          _showFileAutocomplete = false;
          _commandFilter = '';
        });
        fileSearch.clear();
      } else {
        setState(() {});
      }
    }
  }

  void _handleFileSelection(FileAttachment attachment) {
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
    final isAtBottom = position.pixels >= position.maxScrollExtent - 100;

    if (_showScrollToBottom == isAtBottom) {
      setState(() {
        _showScrollToBottom = !isAtBottom;
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
    ref.read(bridgeServiceProvider).setView(projectPath: 'global');
    _controller.dispose();
    _scrollController.dispose();
    _inputFocusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.watch(chatSessionProvider);
    final connection = ref.watch(connectionProvider);

    _maybeShowPermissionPrompt(chatState);

    return Scaffold(
      backgroundColor: theme.background,
      // Use endDrawer for right-side sidebar that can be swiped from edge
      endDrawer: SessionSidebar(
        sessionTitle: widget.session.title,
        sessionContext: _sessionContext,
        todos: chatState.todos,
        onClose: _closeSidebar,
        vcsInfo: _vcsInfo,
        sessionDiffs: chatState.sessionDiffs,
        onOpenDiff: (diff) => _openDiffView(diff),
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
                    // Add 1 for loading indicator at top when loading more
                    itemCount:
                        chatState.messages.length +
                        (_loadingMoreMessages ? 1 : 0) +
                        (!_hasLoadedAllMessages && chatState.messages.isNotEmpty
                            ? 1
                            : 0),
                    itemBuilder: (context, index) {
                      // Show "load more" indicator at top
                      if (!_hasLoadedAllMessages &&
                          chatState.messages.isNotEmpty &&
                          index == 0) {
                        if (_loadingMoreMessages) {
                          return const Padding(
                            padding: EdgeInsets.symmetric(vertical: 16),
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
                          padding: const EdgeInsets.symmetric(vertical: 12),
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
                              chatState.messages.isNotEmpty)
                          ? index - 1
                          : index;

                      if (messageIndex < 0 ||
                          messageIndex >= chatState.messages.length) {
                        return const SizedBox.shrink();
                      }

                      final message = chatState.messages[messageIndex];
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

          // Stop button when streaming - centered at bottom
          if (_hasStreamingMessage(chatState.messages))
            Positioned(
              bottom: 24,
              left: 0,
              right: 0,
              child: Center(child: _buildStopButton(context)),
            ),

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

          // Floating input bar at bottom (style based on settings)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _buildInputBar(connection, chatState),
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
              rttMs: connection.rttMs,
              onBack: () => Navigator.of(context).pop(),
              onModelTap: () => _showModelSelector(context),
              onMenu: (value) => _handleMenuAction(value, chatState),
              onOpenSidebar: () => Scaffold.of(context).openEndDrawer(),
              currentAgent: _selectedAgent,
              agents: _agents,
              onAgentChanged: (agent) => setState(() => _selectedAgent = agent),
              vcsInfo: _vcsInfo,
              isSessionShared: widget.session.isShared,
              isCompacting: chatState.isCompacting,
              sessionStatus: chatState.sessionStatus,
              isStreaming: _hasStreamingMessage(chatState.messages),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInputBar(
    BridgeConnectionState connection,
    ChatSessionState chatState,
  ) {
    final inputStyle = ref.watch(inputStyleProvider);
    final isBusy = _hasStreamingMessage(chatState.messages);
    final hasContent =
        _controller.text.trim().isNotEmpty || _attachedFiles.isNotEmpty;
    final canSend =
        connection.isConnected &&
        !connection.isOfflineMode &&
        !isBusy &&
        hasContent;

    Widget inputBar;
    if (inputStyle == InputBarStyle.cli) {
      inputBar = _CliStyleInputBar(
        controller: _controller,
        focusNode: _inputFocusNode,
        onSend: () => _sendMessage(connection, chatState),
        isBusy: isBusy,
        canSend: canSend,
        isOfflineMode: connection.isOfflineMode,
        currentAgent: _selectedAgent,
        agents: _agents,
        onAgentChanged: (agent) => setState(() => _selectedAgent = agent),
        currentModel: ref.watch(selectionProvider).model,
        onModelTap: () => _showModelSelector(context),
        attachedFiles: _attachedFiles,
        onRemoveAttachment: _removeAttachedFile,
        showFileAutocomplete: _showFileAutocomplete,
        onFileSelect: _handleFileSelection,
        onAttachTap: () => _showAttachmentOptions(context),
      );
    } else {
      inputBar = _FloatingInputBar(
        controller: _controller,
        focusNode: _inputFocusNode,
        onSend: () => _sendMessage(connection, chatState),
        isBusy: isBusy,
        canSend: canSend,
        isOfflineMode: connection.isOfflineMode,
        attachedFiles: _attachedFiles,
        onRemoveAttachment: _removeAttachedFile,
        showFileAutocomplete: _showFileAutocomplete,
        onFileSelect: _handleFileSelection,
        onAttachTap: () => _showAttachmentOptions(context),
      );
    }

    return inputBar;
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
              onUndo: (messageId, partId) =>
                  _revertMessage(messageId, partId: partId),
              onViewFull: () => _openDiffView(diff, messageId: message.id),
            ),
          ),

        const SizedBox(height: 16),
      ],
    );
  }

  Widget _buildScrollToBottomButton() {
    final theme = OpenCodeTheme.of(context);

    return Material(
      color: theme.backgroundPanel,
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
            border: Border.all(color: fade(theme.textMuted, 0.25), width: 1),
          ),
          child: Icon(
            Icons.keyboard_arrow_down,
            color: theme.textMuted,
            size: 24,
          ),
        ),
      ),
    );
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

  void _handleMenuAction(String value, ChatSessionState chatState) {
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
            SnackBar(
              content: const Text('No file changes to undo'),
              backgroundColor: theme.backgroundPanel,
            ),
          );
        }
        break;
      case 'clear':
        // TODO: Implement clear chat
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Clear chat - coming soon'),
            backgroundColor: theme.backgroundPanel,
          ),
        );
        break;
    }
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
              ref.read(bridgeServiceProvider).abortSession(widget.session.id);
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

  void _sendMessage(
    BridgeConnectionState connection,
    ChatSessionState chatState,
  ) {
    final text = _controller.text.trim();
    final hasAttachments = _attachedFiles.isNotEmpty;
    if (text.isEmpty && !hasAttachments) return;
    if (!connection.isConnected) return;
    if (_hasStreamingMessage(chatState.messages)) return;

    final bridge = ref.read(bridgeServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);
    final selectedModel = ref.read(selectionProvider).model;

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
        agent: _selectedAgent,
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
      chat.appendUserMessage(displayText);

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
        fileAttachments: hasAttachments ? _attachedFiles : null,
      );
    }

    _controller.clear();
    setState(() => _attachedFiles.clear());
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

// Floating header - simplified and compact
class _FloatingHeader extends StatelessWidget {
  const _FloatingHeader({
    required this.projectName,
    required this.isConnected,
    required this.currentModel,
    this.rttMs,
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
    this.sessionStatus = const SessionStatus.idle(),
    this.isStreaming = false,
  });

  final String projectName;
  final bool isConnected;
  final SelectedModel? currentModel;
  final int? rttMs;
  final VoidCallback onBack;
  final VoidCallback onModelTap;
  final void Function(String) onMenu;
  final VoidCallback onOpenSidebar;
  final String? currentAgent;
  final List<Agent> agents;
  final void Function(String?)? onAgentChanged;
  final VcsInfo? vcsInfo;
  final bool isSessionShared;
  final bool isCompacting;
  final SessionStatus sessionStatus;
  final bool isStreaming;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final kCard = theme.backgroundPanel;
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
        MediaQuery.of(context).padding.top + 8,
        12,
        isStreaming ? 6 : 10,
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
                    // Agent indicator
                    if (current != null) ...[
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
            _GlassPill(
              compact: true,
              child: PopupMenuButton<String>(
                icon: Icon(
                  Icons.more_horiz_rounded,
                  color: kOnBackground,
                  size: 18,
                ),
                padding: EdgeInsets.zero,
                color: kCard,
                constraints: const BoxConstraints(minWidth: 180, maxWidth: 220),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                onSelected: onMenu,
                itemBuilder: (context) => [
                  // Info section (non-clickable) - compact
                  if (vcsInfo != null && vcsInfo!.isAvailable)
                    PopupMenuItem(
                      enabled: false,
                      height: 28,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Row(
                        children: [
                          Icon(
                            Icons.call_split_rounded,
                            size: 13,
                            color: theme.success,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            vcsInfo!.branch ?? 'unknown',
                            style: TextStyle(fontSize: 12, color: kMuted),
                          ),
                        ],
                      ),
                    ),
                  if (isConnected && rttMs != null)
                    PopupMenuItem(
                      enabled: false,
                      height: 28,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Row(
                        children: [
                          Icon(
                            Icons.speed_rounded,
                            size: 13,
                            color: theme.info,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '${rttMs}ms',
                            style: TextStyle(fontSize: 12, color: kMuted),
                          ),
                        ],
                      ),
                    ),
                  // Model selector - tappable
                  PopupMenuItem(
                    height: 32,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    onTap: onModelTap,
                    child: Row(
                      children: [
                        Icon(
                          Icons.auto_awesome_rounded,
                          size: 13,
                          color: theme.primary,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _getModelName(currentModel),
                          style: TextStyle(
                            fontSize: 12,
                            color: theme.primary,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const Spacer(),
                        Icon(
                          Icons.chevron_right_rounded,
                          size: 14,
                          color: kMuted,
                        ),
                      ],
                    ),
                  ),
                  const PopupMenuDivider(height: 8),
                  // Sidebar
                  PopupMenuItem(
                    value: 'sidebar',
                    height: 36,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Row(
                      children: [
                        Icon(
                          Icons.menu_open_rounded,
                          size: 15,
                          color: kOnBackground,
                        ),
                        const SizedBox(width: 10),
                        Text(
                          'Session Info',
                          style: TextStyle(fontSize: 13, color: kOnBackground),
                        ),
                      ],
                    ),
                  ),
                  PopupMenuItem(
                    value: 'new_session',
                    height: 36,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Row(
                      children: [
                        Icon(Icons.add_rounded, size: 15, color: kOnBackground),
                        const SizedBox(width: 10),
                        Text(
                          'New Session',
                          style: TextStyle(fontSize: 13, color: kOnBackground),
                        ),
                      ],
                    ),
                  ),
                  PopupMenuItem(
                    value: 'fork',
                    height: 36,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Row(
                      children: [
                        Icon(
                          Icons.call_split_rounded,
                          size: 15,
                          color: kOnBackground,
                        ),
                        const SizedBox(width: 10),
                        Text(
                          'Fork',
                          style: TextStyle(fontSize: 13, color: kOnBackground),
                        ),
                      ],
                    ),
                  ),
                  PopupMenuItem(
                    value: isSessionShared ? 'unshare' : 'share',
                    height: 36,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Row(
                      children: [
                        Icon(
                          isSessionShared ? Icons.link_off : Icons.share,
                          size: 15,
                          color: kOnBackground,
                        ),
                        const SizedBox(width: 10),
                        Text(
                          isSessionShared ? 'Unshare' : 'Share',
                          style: TextStyle(fontSize: 13, color: kOnBackground),
                        ),
                      ],
                    ),
                  ),
                  PopupMenuItem(
                    value: 'compact',
                    height: 36,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    enabled: !isCompacting,
                    child: Row(
                      children: [
                        Icon(
                          Icons.compress_rounded,
                          size: 15,
                          color: isCompacting ? kMuted : kOnBackground,
                        ),
                        const SizedBox(width: 10),
                        Text(
                          isCompacting ? 'Compacting...' : 'Compact',
                          style: TextStyle(
                            fontSize: 13,
                            color: isCompacting ? kMuted : kOnBackground,
                          ),
                        ),
                      ],
                    ),
                  ),
                  PopupMenuItem(
                    value: 'init',
                    height: 36,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Row(
                      children: [
                        Icon(
                          Icons.auto_fix_high_rounded,
                          size: 18,
                          color: theme.success,
                        ),
                        const SizedBox(width: 12),
                        Text(
                          'Initialize Project',
                          style: TextStyle(color: theme.success),
                        ),
                      ],
                    ),
                  ),
                  const PopupMenuDivider(),
                  PopupMenuItem(
                    value: 'undo',
                    child: Row(
                      children: [
                        Icon(
                          Icons.undo_rounded,
                          size: 18,
                          color: theme.warning,
                        ),
                        const SizedBox(width: 12),
                        Text(
                          'Undo Last Changes',
                          style: TextStyle(color: theme.warning),
                        ),
                      ],
                    ),
                  ),
                  const PopupMenuDivider(),
                  PopupMenuItem(
                    value: 'clear',
                    child: Row(
                      children: [
                        Icon(
                          Icons.delete_outline_rounded,
                          size: 18,
                          color: theme.error,
                        ),
                        const SizedBox(width: 12),
                        Text(
                          'Clear Chat',
                          style: TextStyle(color: theme.error),
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

// Glass pill widget for header elements
class _GlassPill extends StatelessWidget {
  const _GlassPill({required this.child, this.onTap, this.compact = false});

  final Widget child;
  final VoidCallback? onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final kCard = theme.backgroundPanel;
    final kMuted = theme.textMuted;

    return ClipRRect(
      borderRadius: BorderRadius.circular(compact ? 16 : 20),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            padding: compact
                ? const EdgeInsets.all(6)
                : const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: kCard.withValues(alpha: 0.75),
              borderRadius: BorderRadius.circular(compact ? 16 : 20),
              border: Border.all(color: fade(kMuted, 0.15), width: 0.5),
            ),
            child: child,
          ),
        ),
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
            minimum: const EdgeInsets.only(bottom: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // File autocomplete dropdown (appears above input)
                if (showFileAutocomplete && onFileSelect != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: FileAutocomplete(
                      visible: showFileAutocomplete,
                      onSelect: onFileSelect!,
                    ),
                  ),

                // Attached files chips row
                if (attachedFiles.isNotEmpty && onRemoveAttachment != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                    child: AttachedFilesChips(
                      attachments: attachedFiles,
                      onRemove: onRemoveAttachment!,
                    ),
                  ),

                // Main input row
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      // Plus button - shows attachment options
                      GestureDetector(
                        onTap: onAttachTap,
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
                              Icons.add_rounded,
                              color: kOnBackground,
                              size: 22,
                            ),
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

  @override
  void initState() {
    super.initState();
    _placeholderIndex = DateTime.now().millisecond % _placeholders.length;
    // Rotate placeholder every 6 seconds
    Future.doWhile(() async {
      await Future.delayed(const Duration(seconds: 6));
      if (!mounted) return false;
      setState(() {
        _placeholderIndex = (_placeholderIndex + 1) % _placeholders.length;
      });
      return true;
    });
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

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final agent = _getCurrentAgent();
    final agentColor = agent?.displayColor ?? theme.primary;

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
            minimum: const EdgeInsets.only(bottom: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // File autocomplete dropdown (appears above input)
                if (widget.showFileAutocomplete && widget.onFileSelect != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(8, 0, 0, 8),
                    child: FileAutocomplete(
                      visible: widget.showFileAutocomplete,
                      onSelect: widget.onFileSelect!,
                    ),
                  ),

                // Main CLI input container
                Container(
                  margin: const EdgeInsets.only(left: 8, right: 0),
                  // Light greyish background like OpenCode CLI - rgb(40,40,40)
                  decoration: const BoxDecoration(color: Color(0xFF282828)),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Glowing accent line on the left
                      Container(
                        width: 3,
                        constraints: const BoxConstraints(minHeight: 80),
                        decoration: BoxDecoration(
                          color: agentColor,
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
                            if (widget.attachedFiles.isNotEmpty &&
                                widget.onRemoveAttachment != null)
                              Padding(
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
                              padding: const EdgeInsets.fromLTRB(16, 0, 12, 10),
                              child: Row(
                                children: [
                                  // Agent name (colored, tappable)
                                  GestureDetector(
                                    onTap:
                                        widget.onAgentChanged != null &&
                                            widget.agents.isNotEmpty
                                        ? () => _showAgentPicker(context)
                                        : null,
                                    child: Text(
                                      agent?.displayName ?? 'Sisyphus',
                                      style: TextStyle(
                                        color: agentColor,
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),

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

                                  // Model name (tappable)
                                  GestureDetector(
                                    onTap: widget.onModelTap,
                                    child: Text(
                                      _getModelDisplayName(widget.currentModel),
                                      style: TextStyle(
                                        color: theme.text,
                                        fontSize: 13,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ),

                                  // Provider name (muted)
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
                                          Icons.add_rounded,
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
      builder: (context) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Select Agent',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: theme.text,
              ),
            ),
            const SizedBox(height: 12),
            for (final agent in primaryAgents)
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                leading: Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: agent.displayColor,
                    shape: BoxShape.circle,
                  ),
                ),
                title: Text(
                  agent.displayName,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 14,
                    fontWeight: agent.name == widget.currentAgent
                        ? FontWeight.w600
                        : FontWeight.w400,
                  ),
                ),
                subtitle: Text(
                  agent.shortDescription,
                  style: TextStyle(color: theme.textMuted, fontSize: 11),
                ),
                trailing: agent.name == widget.currentAgent
                    ? Icon(Icons.check_rounded, color: theme.success, size: 18)
                    : null,
                onTap: () {
                  widget.onAgentChanged?.call(agent.name);
                  Navigator.pop(context);
                },
              ),
            const SizedBox(height: 8),
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

          final providers =
              _providersData?['providers'] as List<dynamic>? ?? [];

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
        Text(
          name,
          style: TextStyle(
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

// Feature 2: Slash command autocomplete popup
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
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: kOnBackground,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            command.shortDescription,
                            style: TextStyle(fontSize: 12, color: kMuted),
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
                        child: Text(
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
