import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/message.dart';
import '../theme/opencode_theme.dart';

class MessageBubble extends StatelessWidget {
  const MessageBubble({super.key, required this.message, this.onForkFromHere});

  final ChatMessage message;

  /// Feature 6: Callback for forking from this message
  final void Function(String messageId)? onForkFromHere;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final isUser = message.role == MessageRole.user;
    final isSystem = message.role == MessageRole.system;
    final isError = message.error != null;

    // Error messages get red styling
    if (isError) {
      return _buildErrorMessage(context, theme);
    }

    // System messages - skip if just diff data
    if (isSystem && message.text.isEmpty) {
      return const SizedBox.shrink();
    }

    // User messages - right aligned, primary accent
    if (isUser) {
      return _buildUserMessage(context, theme);
    }

    // AI messages - left aligned, subtle styling with markdown support
    return _buildAssistantMessage(context, theme);
  }

  Widget _buildErrorMessage(BuildContext context, OpenCodeTheme theme) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 8),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        constraints: const BoxConstraints(maxWidth: 340),
        decoration: BoxDecoration(
          color: theme.error.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: theme.error.withValues(alpha: 0.3),
            width: 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.error_outline, color: theme.error, size: 18),
                const SizedBox(width: 8),
                Text(
                  message.error ?? 'Error',
                  style: TextStyle(
                    color: theme.error,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
            if (message.text.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                message.text,
                style: TextStyle(color: theme.text, fontSize: 15, height: 1.5),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildUserMessage(BuildContext context, OpenCodeTheme theme) {
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.only(left: 60, right: 0, top: 6, bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: theme.primary.withValues(alpha: 0.15),
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(18),
            topRight: Radius.circular(18),
            bottomLeft: Radius.circular(18),
            bottomRight: Radius.circular(4),
          ),
          border: Border.all(
            color: theme.primary.withValues(alpha: 0.3),
            width: 1,
          ),
        ),
        child: Text(
          message.text,
          style: GoogleFonts.inter(
            color: theme.text,
            fontSize: 15,
            height: 1.5,
            fontWeight: FontWeight.w400,
          ),
        ),
      ),
    );
  }

  Widget _buildAssistantMessage(BuildContext context, OpenCodeTheme theme) {
    // Feature 6: Long press to fork from this message
    return GestureDetector(
      onLongPress: onForkFromHere != null && message.id.isNotEmpty
          ? () => _showForkMenu(context, theme)
          : null,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Subtle left accent bar
            Container(
              width: 2,
              height: 20,
              margin: const EdgeInsets.only(top: 4, right: 12),
              decoration: BoxDecoration(
                color: theme.borderSubtle,
                borderRadius: BorderRadius.circular(1),
              ),
            ),
            // Message content - full width, no box
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Streaming indicator (top right when streaming)
                  if (message.isStreaming)
                    Align(
                      alignment: Alignment.centerRight,
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _buildStreamingCursor(theme),
                      ),
                    ),

                  // Message text with markdown - full width, no box
                  // Show placeholder only while streaming; avoid persisting empty
                  // bubbles (e.g., tool-only messages) after completion.
                  if (message.text.isEmpty &&
                      !message.hasReasoning &&
                      message.isStreaming)
                    Opacity(
                      opacity: 0.5,
                      child: Text(
                        '...',
                        style: GoogleFonts.inter(
                          fontSize: 15,
                          color: theme.textMuted,
                          height: 1.6,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                    )
                  else if (message.text.isNotEmpty)
                    // Huge perf win: avoid markdown layout while streaming.
                    // Render markdown only once the message is stable.
                    //
                    // Also avoid SelectableText while streaming: selection layout is expensive.
                    message.isStreaming
                        ? Text(
                            message.text,
                            style: GoogleFonts.inter(
                              fontSize: 15,
                              color: theme.text,
                              height: 1.6,
                            ),
                          )
                        : MarkdownBody(
                            data: message.text,
                            selectable: true,
                            styleSheet: _buildMarkdownStyle(theme),
                          ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  MarkdownStyleSheet _buildMarkdownStyle(OpenCodeTheme theme) {
    return MarkdownStyleSheet(
      p: GoogleFonts.inter(
        fontSize: 15,
        color: theme.markdownText,
        height: 1.6,
      ),
      h1: GoogleFonts.inter(
        fontSize: 20,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h2: GoogleFonts.inter(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h3: GoogleFonts.inter(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      strong: TextStyle(
        fontWeight: FontWeight.w600,
        color: theme.markdownStrong,
      ),
      em: TextStyle(fontStyle: FontStyle.italic, color: theme.markdownEmph),
      code: GoogleFonts.jetBrainsMono(
        fontSize: 14,
        backgroundColor: theme.backgroundElement,
        color: theme.markdownCode,
      ),
      codeblockPadding: const EdgeInsets.all(12),
      codeblockDecoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      listBullet: GoogleFonts.inter(
        fontSize: 15,
        color: theme.markdownListItem,
      ),
      listIndent: 24,
      blockquotePadding: const EdgeInsets.only(left: 16),
      blockquoteDecoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: theme.markdownBlockQuote, width: 3),
        ),
      ),
      a: TextStyle(
        color: theme.markdownLink,
        decoration: TextDecoration.underline,
      ),
    );
  }

  // Feature 6: Show fork menu on long press
  void _showForkMenu(BuildContext context, OpenCodeTheme theme) {
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
          children: [
            ListTile(
              leading: Icon(Icons.call_split_rounded, color: theme.primary),
              title: Text(
                'Fork from here',
                style: TextStyle(
                  color: theme.text,
                  fontWeight: FontWeight.w500,
                ),
              ),
              subtitle: Text(
                'Create a new session branch from this point',
                style: TextStyle(color: theme.textMuted, fontSize: 12),
              ),
              onTap: () {
                Navigator.pop(context);
                onForkFromHere?.call(message.id);
              },
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStreamingCursor(OpenCodeTheme theme) =>
      _StreamingCursor(color: theme.info);
}

class _StreamingCursor extends StatefulWidget {
  const _StreamingCursor({required this.color});

  final Color color;

  @override
  State<_StreamingCursor> createState() => _StreamingCursorState();
}

class _StreamingCursorState extends State<_StreamingCursor>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) =>
          Opacity(opacity: _controller.value > 0.5 ? 1.0 : 0.2, child: child),
      child: Container(
        width: 7,
        height: 7,
        decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle),
      ),
    );
  }
}
