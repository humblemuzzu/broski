
import 'package:flutter/material.dart';
import '../models/message.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';
/// A collapsible card that displays model reasoning/thinking content.
/// Collapsed by default, tap to expand and see the full thinking process.
class ThinkingCard extends StatefulWidget {
  const ThinkingCard({super.key, required this.message});
  final ChatMessage message;
  @override
  State<ThinkingCard> createState() => _ThinkingCardState();
}
class _ThinkingCardState extends State<ThinkingCard>
    with SingleTickerProviderStateMixin {
  bool _isExpanded = false;
  late AnimationController _controller;
  late Animation<double> _heightFactor;
  late Animation<double> _iconTurns;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 200),
      vsync: this,
    );
    _heightFactor = _controller.drive(CurveTween(curve: Curves.easeInOut));
    _iconTurns = _controller.drive(
      Tween<double>(
        begin: 0.0,
        end: 0.5,
      ).chain(CurveTween(curve: Curves.easeInOut)),
    );
  }
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
  void _toggle() {
    setState(() {
      _isExpanded = !_isExpanded;
      if (_isExpanded) {
        _controller.forward();
      } else {
        _controller.reverse();
      }
    });
  }
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final message = widget.message;
    final isStreaming = message.isReasoningStreaming;
    final durationMs = message.reasoningDurationMs;
    // Use dedicated toolThinking color for cognitive/reasoning displays
    final thinkingColor = theme.toolThinking;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: thinkingColor.withValues(alpha: 0.08),
        borderRadius: Radii.brSm,
        border: Border.all(
          color: isStreaming
              ? thinkingColor.withValues(alpha: 0.4)
              : thinkingColor.withValues(alpha: 0.2),
          width: isStreaming ? 1.5 : 1.0,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header - always visible
          InkWell(
            onTap: _toggle,
            borderRadius: Radii.brSm,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  // Thinking icon with animation for streaming
                  _buildThinkingIcon(theme, thinkingColor, isStreaming),
                  const SizedBox(width: 10),
                  // Content
                  Expanded(
                    child: Row(
                      children: [
                        Text(
                          isStreaming ? 'Thinking...' : 'Thinking',
                          style: TextStyle(
                            color: thinkingColor,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (durationMs != null && !isStreaming) ...[
                          SizedBox(width: Spacing.sm),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: thinkingColor.withValues(alpha: 0.12),
                              borderRadius: Radii.brXs,
                            ),
                            child: Text(
                              _formatDuration(durationMs),
                              style: TextStyle(
                                color: thinkingColor.withValues(alpha: 0.8),
                                fontSize: 10,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  // Expand icon
                  RotationTransition(
                    turns: _iconTurns,
                    child: Icon(
                      AppIcons.expandMore,
                      size: 20,
                      color: theme.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Expanded content - reasoning text
          ClipRect(
            child: AnimatedBuilder(
              animation: _controller,
              builder: (context, child) {
                return Align(
                  heightFactor: _heightFactor.value,
                  alignment: Alignment.topCenter,
                  child: child,
                );
              },
              child: _buildExpandedContent(theme, thinkingColor),
            ),
          ),
        ],
      ),
    );
  }
  Widget _buildThinkingIcon(
    OpenCodeTheme theme,
    Color thinkingColor,
    bool isStreaming,
  ) {
    return Container(
      width: 28,
      height: 28,
      decoration: BoxDecoration(
        color: thinkingColor.withValues(alpha: 0.12),
        borderRadius: Radii.brSm,
      ),
      child: Center(
        child: isStreaming
            ? RepaintBoundary(
                child: SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(thinkingColor),
                  ),
                ),
              )
            : Icon(AppIcons.psychology, size: 14, color: thinkingColor),
      ),
    );
  }
  Widget _buildExpandedContent(OpenCodeTheme theme, Color thinkingColor) {
    final message = widget.message;
    final reasoningText = message.reasoningText;
    if (reasoningText.isEmpty) {
      return const SizedBox.shrink();
    }
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Divider(color: theme.borderSubtle, height: 16),
          Container(
            width: double.infinity,
            constraints: const BoxConstraints(maxHeight: 300),
            padding: Insets.cardXs,
            decoration: BoxDecoration(
              color: theme.backgroundElement,
              borderRadius: Radii.brSm,
            ),
            child: SingleChildScrollView(
              child: SelectableText(
                reasoningText,
                style: AppTypography.codeSmall(color: theme.textMuted).copyWith(
                  height: 1.5,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
  String _formatDuration(int ms) {
    if (ms < 1000) return '${ms}ms';
    final seconds = ms / 1000;
    if (seconds < 60) return '${seconds.toStringAsFixed(1)}s';
    final minutes = seconds / 60;
    return '${minutes.toStringAsFixed(1)}m';
  }
}
/// A compact inline version of the thinking indicator for tight spaces.
class ThinkingChip extends StatelessWidget {
  const ThinkingChip({
    super.key,
    required this.isStreaming,
    this.durationMs,
    this.onTap,
  });
  final bool isStreaming;
  final int? durationMs;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    // Use dedicated toolThinking color
    final thinkingColor = theme.toolThinking;
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brSm,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: thinkingColor.withValues(alpha: 0.08),
          borderRadius: Radii.brSm,
          border: Border.all(color: thinkingColor.withValues(alpha: 0.15)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isStreaming)
              RepaintBoundary(
                child: SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(
                    strokeWidth: 1.5,
                    valueColor: AlwaysStoppedAnimation<Color>(thinkingColor),
                  ),
                ),
              )
            else
              Icon(AppIcons.psychology, size: 14, color: thinkingColor),
            const SizedBox(width: 6),
            Text(
              isStreaming ? 'Thinking...' : 'Thinking',
              style: TextStyle(
                color: thinkingColor,
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
            if (durationMs != null && !isStreaming) ...[
              const SizedBox(width: 6),
              Text(
                _formatDuration(durationMs!),
                style: TextStyle(
                  color: thinkingColor.withValues(alpha: 0.7),
                  fontSize: 10,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
  String _formatDuration(int ms) {
    if (ms < 1000) return '${ms}ms';
    final seconds = ms / 1000;
    if (seconds < 60) return '${seconds.toStringAsFixed(1)}s';
    final minutes = seconds / 60;
    return '${minutes.toStringAsFixed(1)}m';
  }
}
