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
        margin: const EdgeInsets.only(left: 50, right: 0, top: 8, bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        decoration: BoxDecoration(
          color: theme.primary,
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(20),
            topRight: Radius.circular(20),
            bottomLeft: Radius.circular(20),
            bottomRight: Radius.circular(4),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.1),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Text(
          message.text,
          style: GoogleFonts.inter(
            color: theme.selectedListItemText,
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
      child: Align(
        alignment: Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.only(right: 50, left: 0, top: 8, bottom: 8),
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: theme.borderSubtle, width: 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // AI badge - subtle, minimal
              Row(
                children: [
                  Container(
                    width: 24,
                    height: 24,
                    decoration: BoxDecoration(
                      color: theme.backgroundElement,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(
                      Icons.auto_awesome,
                      size: 14,
                      color: theme.textMuted,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Spacer(),
                  if (message.isStreaming) _buildStreamingCursor(theme),
                ],
              ),
              const SizedBox(height: 12),

              // Message text with markdown
              if (message.text.isEmpty)
                Text(
                  'Thinking...',
                  style: GoogleFonts.inter(
                    fontSize: 15,
                    color: theme.textMuted,
                    height: 1.6,
                    fontStyle: FontStyle.italic,
                  ),
                )
              else
                // Huge perf win: avoid markdown layout while streaming.
                // Render markdown only once the message is stable.
                message.isStreaming
                    ? SelectableText(
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

  Widget _buildStreamingCursor(OpenCodeTheme theme) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.0, end: 1.0),
      duration: const Duration(milliseconds: 800),
      builder: (context, value, child) {
        return Opacity(
          opacity: value > 0.5 ? 1.0 : 0.2,
          child: Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(
              color: theme.info,
              shape: BoxShape.circle,
            ),
          ),
        );
      },
    );
  }
}
