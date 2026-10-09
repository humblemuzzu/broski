import 'package:broski/models/claude_code.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// ============================================================================
// Claude Code Chat Screen
// Extracted from sessions_screen.dart
// ============================================================================

class CCChatScreen extends ConsumerStatefulWidget {
  const CCChatScreen({super.key, required this.session});
  final ClaudeCodeSession session;
  @override
  ConsumerState<CCChatScreen> createState() => _CCChatScreenState();
}

class _CCChatScreenState extends ConsumerState<CCChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final FocusNode _focusNode = FocusNode();
  @override
  void initState() {
    super.initState();
    // Initialize chat provider with this session
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(ccChatProvider.notifier).setSession(widget.session.id);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _sendMessage() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    ref
        .read(ccChatProvider.notifier)
        .sendMessage(
          sessionId: widget.session.id,
          prompt: text,
          cwd: widget.session.cwd,
        );
    _controller.clear();
    _scrollToBottom();
  }

  void _abort() {
    ref.read(ccChatProvider.notifier).abort();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  String _getProjectName() {
    final parts = widget.session.cwd
        .split('/')
        .where((p) => p.isNotEmpty)
        .toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final chatState = ref.watch(ccChatProvider);
    // Build display messages from runtime display items
    final displayMessages = _buildDisplayMessages(chatState.displayItems);
    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.backgroundPanel,
        elevation: 0,
        leading: IconButton(
          icon: Icon(AppIcons.back, color: ocTheme.text),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.session.displayTitle,
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              _getProjectName(),
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
          ],
        ),
        actions: [
          // Claude Code badge
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: Insets.chip,
            decoration: BoxDecoration(
              color: ocTheme.accent.withValues(alpha: 0.15),
              borderRadius: Radii.brSm,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(AppIcons.terminal, size: 12, color: ocTheme.accent),
                const SizedBox(width: Spacing.xs),
                Text(
                  'CC',
                  style: TextStyle(
                    color: ocTheme.accent,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Messages list
          Expanded(
            child: displayMessages.isEmpty
                ? _CCChatEmptyState()
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                    itemCount: displayMessages.length,
                    itemBuilder: (context, index) {
                      final msg = displayMessages[index];
                      return _CCMessageBubble(
                        message: msg,
                        isStreaming:
                            chatState.isStreaming &&
                            index == displayMessages.length - 1,
                      );
                    },
                  ),
          ),
          // Input bar
          _CCInputBar(
            controller: _controller,
            focusNode: _focusNode,
            isStreaming: chatState.isStreaming,
            onSend: _sendMessage,
            onAbort: _abort,
          ),
        ],
      ),
    );
  }

  /// Convert runtime display items to display messages for rendering.
  /// Groups consecutive text items and interleaves tool items.
  List<_CCDisplayMessage> _buildDisplayMessages(List<CCDisplayItem> items) {
    final display = <_CCDisplayMessage>[];
    String assistantText = '';
    final tools = <_CCToolInfo>[];

    for (final item in items) {
      switch (item.type) {
        case 'text':
          assistantText = item.content;
        case 'tool':
          tools.add(
            _CCToolInfo(
              name: item.toolName ?? 'tool',
              input: item.toolInput,
              status: item.toolStatus ?? 'running',
            ),
          );
        case 'error':
          // Flush any pending assistant text before the error
          if (assistantText.isNotEmpty || tools.isNotEmpty) {
            display.add(
              _CCDisplayMessage(
                role: 'assistant',
                text: assistantText,
                tools: List.from(tools),
              ),
            );
            assistantText = '';
            tools.clear();
          }
          display.add(_CCDisplayMessage(role: 'error', text: item.content));
        default:
          break;
      }
    }

    // Flush remaining content
    if (assistantText.isNotEmpty || tools.isNotEmpty) {
      display.add(
        _CCDisplayMessage(
          role: 'assistant',
          text: assistantText,
          tools: List.from(tools),
        ),
      );
    }
    return display;
  }
}

/// Simple tool info for display in CC inline chat.
class _CCToolInfo {
  final String name;
  final dynamic input;
  final String status; // 'running', 'completed', 'failed'
  const _CCToolInfo({required this.name, this.input, this.status = 'running'});
}

/// Display message model for CC chat
class _CCDisplayMessage {
  final String role; // 'user', 'assistant', 'error'
  final String text;
  final List<_CCToolInfo> tools;
  const _CCDisplayMessage({
    required this.role,
    this.text = '',
    this.tools = const [],
  });
}

/// Message bubble for CC chat
class _CCMessageBubble extends StatelessWidget {
  const _CCMessageBubble({required this.message, this.isStreaming = false});
  final _CCDisplayMessage message;
  final bool isStreaming;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    if (message.role == 'error') {
      return Container(
        margin: Insets.bottomMd,
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: ocTheme.error.withValues(alpha: 0.1),
          borderRadius: Radii.brMd,
          border: Border.all(color: ocTheme.error.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            Icon(AppIcons.error, color: ocTheme.error, size: 20),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(
                message.text,
                style: TextStyle(color: ocTheme.error, fontSize: 14),
              ),
            ),
          ],
        ),
      );
    }
    final isUser = message.role == 'user';
    return Container(
      margin: Insets.bottomMd,
      child: Column(
        crossAxisAlignment: isUser
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        children: [
          // Text content
          if (message.text.isNotEmpty)
            Container(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.of(context).size.width * 0.85,
              ),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isUser ? ocTheme.primary : ocTheme.backgroundPanel,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(isUser ? 16 : 4),
                  bottomRight: Radius.circular(isUser ? 4 : 16),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    message.text,
                    style: TextStyle(
                      color: isUser
                          ? ocTheme.selectedListItemText
                          : ocTheme.text,
                      fontSize: 15,
                      height: 1.4,
                    ),
                  ),
                  if (isStreaming) ...[
                    const SizedBox(height: Spacing.xs),
                    SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: ocTheme.textMuted,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          // Tool calls
          if (message.tools.isNotEmpty) ...[
            const SizedBox(height: Spacing.sm),
            ...message.tools.map((tool) => _CCToolCallCard(tool: tool)),
          ],
        ],
      ),
    );
  }
}

/// Tool call card for CC chat — uses [_CCToolInfo] from runtime events.
class _CCToolCallCard extends StatelessWidget {
  const _CCToolCallCard({required this.tool});
  final _CCToolInfo tool;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final isRunning = tool.status == 'running';
    final isFailed = tool.status == 'failed';
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: Insets.cardXs,
      decoration: BoxDecoration(
        color: ocTheme.backgroundElement,
        borderRadius: Radii.brMd,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: isRunning
                  ? ocTheme.info.withValues(alpha: 0.15)
                  : isFailed
                  ? ocTheme.error.withValues(alpha: 0.15)
                  : ocTheme.success.withValues(alpha: 0.15),
              borderRadius: Radii.brSm,
            ),
            child: Center(
              child: isRunning
                  ? SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: ocTheme.info,
                      ),
                    )
                  : isFailed
                  ? Icon(AppIcons.error, size: 14, color: ocTheme.error)
                  : Icon(AppIcons.check, size: 14, color: ocTheme.success),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  tool.name,
                  style: TextStyle(
                    color: ocTheme.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (tool.input != null) ...[
                  const SizedBox(height: Spacing.xxs),
                  Text(
                    _formatInput(tool.input),
                    style: AppTypography.codeSmall(color: ocTheme.textMuted),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatInput(dynamic input) {
    if (input == null) return '';
    if (input is String) return input;
    if (input is Map) {
      if (input.containsKey('command')) return input['command'].toString();
      if (input.containsKey('path')) return input['path'].toString();
      if (input.containsKey('file_path')) return input['file_path'].toString();
      if (input.isNotEmpty) return input.entries.first.value.toString();
      return '';
    }
    return input.toString();
  }
}

/// Empty state for CC chat
class _CCChatEmptyState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            AppIcons.chatBubble,
            size: 48,
            color: ocTheme.textMuted.withValues(alpha: 0.5),
          ),
          const SizedBox(height: Spacing.lg),
          Text(
            'Start a conversation',
            style: TextStyle(
              color: ocTheme.textMuted,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: Spacing.xs),
          Text(
            'Send a message to begin',
            style: TextStyle(
              color: ocTheme.textMuted.withValues(alpha: 0.7),
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }
}

/// Input bar for CC chat
class _CCInputBar extends StatelessWidget {
  const _CCInputBar({
    required this.controller,
    required this.focusNode,
    required this.isStreaming,
    required this.onSend,
    required this.onAbort,
  });
  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isStreaming;
  final VoidCallback onSend;
  final VoidCallback onAbort;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final bottomPadding = MediaQuery.of(context).viewInsets.bottom;
    return Container(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + bottomPadding),
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        border: Border(top: BorderSide(color: ocTheme.borderSubtle)),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: ocTheme.backgroundElement,
                  borderRadius: Radii.brXxl,
                  border: Border.all(color: ocTheme.borderSubtle),
                ),
                child: TextField(
                  controller: controller,
                  focusNode: focusNode,
                  enabled: !isStreaming,
                  maxLines: 5,
                  minLines: 1,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => onSend(),
                  style: TextStyle(color: ocTheme.text, fontSize: 15),
                  decoration: InputDecoration(
                    hintText: isStreaming
                        ? 'Claude is thinking...'
                        : 'Message Claude Code',
                    hintStyle: TextStyle(color: ocTheme.textMuted),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 10,
                    ),
                    border: InputBorder.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: Spacing.sm),
            // Send or Abort button
            GestureDetector(
              onTap: isStreaming ? onAbort : onSend,
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: isStreaming ? ocTheme.error : ocTheme.primary,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isStreaming ? AppIcons.stop : AppIcons.arrowUp,
                  color: ocTheme.selectedListItemText,
                  size: 22,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
