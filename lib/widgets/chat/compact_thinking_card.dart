import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../models/card_style.dart';
import '../../models/message.dart';
import '../../providers/card_style_provider.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'detail_sheet.dart';

/// A compact single-line card for thinking/reasoning display.
/// Tapping opens DetailSheet with full thinking content.
///
/// Matches the aesthetic of CompactToolCard, CompactEditCard, etc.
class CompactThinkingCard extends ConsumerWidget {
  final ChatMessage message;

  const CompactThinkingCard({super.key, required this.message});

  String _formatDuration(int ms) {
    if (ms < 1000) return '${ms}ms';
    final seconds = ms / 1000;
    if (seconds < 60) return '${seconds.toStringAsFixed(1)}s';
    final minutes = seconds / 60;
    return '${minutes.toStringAsFixed(1)}m';
  }

  void _showDetailSheet(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final reasoningText = message.reasoningText;

    DetailSheet.show(
      context: context,
      title: 'Thinking',
      initialSize: 0.6,
      child: Padding(
        padding: Insets.screen,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Duration badge at top if available
            if (message.reasoningDurationMs != null) ...[
              Row(
                children: [
                  Icon(Icons.timer_outlined, size: 14, color: theme.textMuted),
                  SizedBox(width: 6),
                  Text(
                    'Completed in ${_formatDuration(message.reasoningDurationMs!)}',
                    style: TextStyle(color: theme.textMuted, fontSize: 12),
                  ),
                ],
              ),
              SizedBox(height: Spacing.lg),
            ],

            // Thinking content box
            Container(
              width: double.infinity,
              padding: Insets.card,
              decoration: BoxDecoration(
                color: theme.backgroundElement,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: theme.borderSubtle.withValues(alpha: 0.5),
                  width: 1,
                ),
              ),
              child: SelectableText(
                reasoningText.isNotEmpty
                    ? reasoningText
                    : 'No thinking content',
                style: GoogleFonts.jetBrainsMono(
                  color: theme.text,
                  fontSize: 12,
                  height: 1.5,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final cardStyle = ref.watch(cardStyleProvider);
    final isStreaming = message.isReasoningStreaming;
    final durationMs = message.reasoningDurationMs;
    final thinkingColor = theme.toolThinking;

    // Get preview text (first 60 chars of thinking)
    final reasoningText = message.reasoningText;
    String preview = '';
    if (reasoningText.isNotEmpty) {
      // Clean up whitespace and get first bit
      final cleaned = reasoningText.replaceAll(RegExp(r'\s+'), ' ').trim();
      preview = cleaned.length > 60
          ? '${cleaned.substring(0, 60)}...'
          : cleaned;
    }

    // Determine colors based on card style settings
    final Color headerBg;
    final Color borderColor;

    switch (cardStyle.headerStyle) {
      case CardHeaderStyle.solid:
        headerBg = theme.cardHeaderBg;
      case CardHeaderStyle.tinted:
        headerBg = thinkingColor.withValues(alpha: 0.1);
      case CardHeaderStyle.minimal:
        headerBg = theme.bgRaised;
    }

    switch (cardStyle.borderVisibility) {
      case CardBorderVisibility.subtle:
        borderColor = theme.cardBorderSubtle;
      case CardBorderVisibility.visible:
        borderColor = theme.cardHeaderBorder;
      case CardBorderVisibility.accent:
        borderColor = thinkingColor.withValues(alpha: 0.5);
    }

    return GestureDetector(
      onTap: reasoningText.isNotEmpty ? () => _showDetailSheet(context) : null,
      child: Container(
        margin: EdgeInsets.symmetric(vertical: Spacing.xxs),
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isStreaming
                ? thinkingColor.withValues(alpha: 0.4)
                : borderColor,
            width: isStreaming ? 1.5 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: Spacing.md, vertical: 10),
          decoration: BoxDecoration(
            color: headerBg,
            borderRadius: BorderRadius.circular(11),
          ),
          child: Row(
            children: [
              // Icon or spinner
              if (isStreaming)
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(thinkingColor),
                  ),
                )
              else
                Icon(Icons.psychology_rounded, size: 16, color: thinkingColor),
              SizedBox(width: 6),

              // "Thinking" label
              Text(
                isStreaming ? 'Thinking...' : 'Thinking',
                style: TextStyle(
                  color: theme.cardHeaderText,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),

              // Duration badge (when complete)
              if (durationMs != null && !isStreaming) ...[
                SizedBox(width: Spacing.sm),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: thinkingColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    _formatDuration(durationMs),
                    style: TextStyle(
                      color: thinkingColor,
                      fontSize: 10,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],

              SizedBox(width: Spacing.sm),

              // Preview text (muted, truncated)
              Expanded(
                child: Text(
                  preview,
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),

              // Chevron (only if we have content to show)
              if (reasoningText.isNotEmpty && !isStreaming) ...[
                SizedBox(width: Spacing.sm),
                Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: theme.textMuted.withValues(alpha: 0.5),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
