import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../models/message.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../utils/error_utils.dart';
import 'chat/detail_sheet.dart';
import 'retry_indicator.dart';
import 'variant_badge.dart';
import 'package:broski/theme/app_icons.dart';

class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.message,
    this.onForkFromHere,
    this.onResumeFromHere,
    this.onRollback,
  });
  final ChatMessage message;

  /// Feature 6: Callback for forking from this message
  final void Function(String messageId)? onForkFromHere;
  final void Function(String messageId)? onResumeFromHere;
  final VoidCallback? onRollback;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final isUser = message.role == MessageRole.user;
    final isSystem = message.role == MessageRole.system;
    final isError = message.error != null;
    // Informational system events (e.g. context_compacted) get neutral styling
    if (isError && isInfoCode(message.error)) {
      return _buildInfoMessage(context, theme);
    }
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

  Widget _buildInfoMessage(BuildContext context, OpenCodeTheme theme) {
    final label = humanErrorLabel(message.error);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: EdgeInsets.symmetric(vertical: Spacing.sm),
        padding: EdgeInsets.symmetric(horizontal: 18, vertical: Spacing.lg),
        constraints: const BoxConstraints(maxWidth: 340),
        decoration: BoxDecoration(
          color: theme.info.withValues(alpha: 0.08),
          borderRadius: Radii.brXl,
          border: Border.all(
            color: theme.info.withValues(alpha: 0.2),
            width: 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.info, color: theme.info, size: 18),
            SizedBox(width: Spacing.sm),
            Flexible(
              child: Text(
                message.text.isNotEmpty ? message.text : label,
                style: TextStyle(
                  color: theme.textMuted,
                  fontSize: 14,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorMessage(BuildContext context, OpenCodeTheme theme) {
    final label = humanErrorLabel(message.error);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: EdgeInsets.symmetric(vertical: Spacing.sm),
        padding: EdgeInsets.symmetric(horizontal: 18, vertical: Spacing.lg),
        constraints: const BoxConstraints(maxWidth: 340),
        decoration: BoxDecoration(
          color: theme.error.withValues(alpha: 0.1),
          borderRadius: Radii.brXl,
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
                Icon(AppIcons.error, color: theme.error, size: 18),
                SizedBox(width: Spacing.sm),
                Flexible(
                  child: Text(
                    label,
                    style: TextStyle(
                      color: theme.error,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ),
              ],
            ),
            if (message.text.isNotEmpty) ...[
              SizedBox(height: Spacing.sm),
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
        margin: EdgeInsets.only(left: 60, right: 0, top: 6, bottom: 6),
        padding: Insets.listItem,
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
          style: TextStyle(
            fontFamily: AppTypography.uiFontFamily,
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
    // Feature 6/CodeX: Long press actions
    return GestureDetector(
      onLongPress:
          (onForkFromHere != null ||
                  onResumeFromHere != null ||
                  onRollback != null) &&
              message.id.isNotEmpty
          ? () => _showForkMenu(context, theme)
          : null,
      child: Container(
        margin: Insets.chipV,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Subtle left accent bar
            Container(
              width: 2,
              height: 20,
              margin: EdgeInsets.only(top: Spacing.xs, right: Spacing.md),
              decoration: BoxDecoration(
                color: theme.borderSubtle,
                borderRadius: Radii.brXs,
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
                        padding: EdgeInsets.only(bottom: Spacing.sm),
                        child: _buildStreamingCursor(theme),
                      ),
                    ),
                  // Variant + retry + finish badges
                  if ((message.variant != null &&
                          message.variant!.isNotEmpty) ||
                      message.retryInfo != null ||
                      _shouldShowFinishHint)
                    Padding(
                      padding: EdgeInsets.only(bottom: 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (message.variant != null &&
                              message.variant!.isNotEmpty)
                            Padding(
                              padding: EdgeInsets.only(bottom: Spacing.xs),
                              child: VariantBadge(variant: message.variant),
                            ),
                          if (message.retryInfo != null)
                            Padding(
                              padding: EdgeInsets.only(bottom: Spacing.xs),
                              child: RetryIndicator(
                                retryInfo: message.retryInfo,
                              ),
                            ),
                          if (_shouldShowFinishHint)
                            _buildFinishHint(theme, message.finish!),
                        ],
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
                        style: TextStyle(
                          fontFamily: AppTypography.uiFontFamily,
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
                            style: TextStyle(
                              fontFamily: AppTypography.uiFontFamily,
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

  bool get _shouldShowFinishHint {
    final finish = message.finish?.trim().toLowerCase();
    if (finish == null || finish.isEmpty) return false;
    return finish != 'stop';
  }

  Widget _buildFinishHint(OpenCodeTheme theme, String finish) {
    final normalized = finish.trim().toLowerCase();
    final isLengthStop = normalized == 'length';
    final color = isLengthStop ? theme.warning : theme.info;
    final label = switch (normalized) {
      'length' => 'Response truncated by length',
      'tool_use' => 'Waiting on tool execution',
      _ => 'Finished: $finish',
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: Radii.brMd,
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isLengthStop ? AppIcons.warning : AppIcons.info,
            size: 14,
            color: color,
          ),
          SizedBox(width: Spacing.xs),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  MarkdownStyleSheet _buildMarkdownStyle(OpenCodeTheme theme) {
    return MarkdownStyleSheet(
      p: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        color: theme.markdownText,
        height: 1.6,
      ),
      h1: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 20,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h2: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h3: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      // Section spacing - creates visual separation like Claude's app
      h1Padding: EdgeInsets.only(top: Spacing.xxl, bottom: Spacing.md),
      h2Padding: EdgeInsets.only(top: Spacing.xl, bottom: 10),
      h3Padding: EdgeInsets.only(top: Spacing.lg, bottom: Spacing.sm),
      // Add subtle divider after headings using bottom border decoration
      horizontalRuleDecoration: BoxDecoration(
        border: Border(top: BorderSide(color: theme.dividerSection, width: 1)),
      ),
      strong: TextStyle(
        fontWeight: FontWeight.w600,
        color: theme.markdownStrong,
      ),
      em: TextStyle(fontStyle: FontStyle.italic, color: theme.markdownEmph),
      code: AppTypography.codeLarge(
        color: theme.markdownCode,
      ).copyWith(backgroundColor: theme.backgroundElement),
      codeblockPadding: Insets.card,
      codeblockDecoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      listBullet: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        color: theme.markdownListItem,
      ),
      listIndent: 24,
      blockquotePadding: EdgeInsets.only(left: Spacing.lg),
      blockquoteDecoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: theme.markdownBlockQuote, width: 3),
        ),
      ),
      a: TextStyle(
        color: theme.markdownLink,
        decoration: TextDecoration.underline,
      ),
      // Block spacing between sections
      blockSpacing: Spacing.lg,
    );
  }

  // Feature 6: Show fork menu on long press
  void _showForkMenu(BuildContext context, OpenCodeTheme theme) {
    DetailSheet.show(
      context: context,
      title: 'Message Actions',
      initialSize: 0.35,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (onForkFromHere != null)
            ListTile(
              leading: Icon(AppIcons.callSplit, color: theme.primary),
              title: Text(
                'Fork from here',
                style: TextStyle(
                  color: theme.text,
                  fontWeight: FontWeight.w500,
                ),
              ),
              subtitle: Text(
                'Create a new session branch from this point',
                style: AppTypography.label(color: theme.textMuted),
              ),
              onTap: () {
                Navigator.pop(context);
                onForkFromHere?.call(message.id);
              },
            ),
          if (onResumeFromHere != null) ...[
            if (onForkFromHere != null)
              Divider(height: 1, color: theme.borderSubtle),
            ListTile(
              leading: Icon(AppIcons.play, color: theme.accent),
              title: Text(
                'Resume from here',
                style: TextStyle(
                  color: theme.text,
                  fontWeight: FontWeight.w500,
                ),
              ),
              subtitle: Text(
                'Continue the session from this message on next send',
                style: AppTypography.label(color: theme.textMuted),
              ),
              onTap: () {
                Navigator.pop(context);
                onResumeFromHere?.call(message.id);
              },
            ),
          ],
          if (onRollback != null) ...[
            if (onForkFromHere != null || onResumeFromHere != null)
              Divider(height: 1, color: theme.borderSubtle),
            ListTile(
              leading: Icon(AppIcons.history, color: theme.warning),
              title: Text(
                'Rollback…',
                style: TextStyle(
                  color: theme.text,
                  fontWeight: FontWeight.w500,
                ),
              ),
              subtitle: Text(
                'Drop recent turns from this thread',
                style: AppTypography.label(color: theme.textMuted),
              ),
              onTap: () {
                Navigator.pop(context);
                onRollback?.call();
              },
            ),
          ],
        ],
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
