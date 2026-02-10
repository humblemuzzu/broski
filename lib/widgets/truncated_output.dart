import 'package:flutter/material.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';

/// Widget for displaying truncated tool output with head-tail preservation.
///
/// Handles two truncation patterns:
/// 1. OpenCode file-based: "Full output saved to: /path/to/file"
/// 2. Head-tail buffer: "... X lines (Y KB) omitted ..."
class TruncatedOutput extends StatelessWidget {
  const TruncatedOutput({
    super.key,
    required this.output,
    required this.onOpenFile,
  });

  final String output;
  final void Function(String path) onOpenFile;

  // OpenCode's file-based truncation pattern
  static final _fullOutputPathRe = RegExp(
    r'Full output saved to:\s*(.+)$',
    multiLine: true,
  );

  // Head-tail buffer truncation pattern (from bridge utils)
  static final _headTailOmittedRe = RegExp(
    r'\n?\.\.\. (\d+) lines \(([^)]+)\) omitted \.\.\.\n?',
  );

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    // Check for file-based truncation first
    final fileMatch = _fullOutputPathRe.firstMatch(output);
    if (fileMatch != null) {
      return _buildFileBasedTruncation(theme, fileMatch);
    }

    // Check for head-tail buffer truncation
    final headTailMatch = _headTailOmittedRe.firstMatch(output);
    if (headTailMatch != null) {
      return _buildHeadTailTruncation(theme, headTailMatch);
    }

    // No truncation detected, show as-is
    return _CodeBox(text: output);
  }

  Widget _buildFileBasedTruncation(OpenCodeTheme theme, RegExpMatch match) {
    final path = (match.group(1) ?? '').trim();
    final head = output.substring(0, match.start).trimRight();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (head.isNotEmpty) _CodeBox(text: head),
        if (head.isNotEmpty) SizedBox(height: Spacing.sm),
        _TruncationCard(
          theme: theme,
          icon: Icons.unfold_more_rounded,
          message: path.isEmpty ? 'Full output saved to file' : path,
          buttonLabel: 'Open',
          onPressed: path.isEmpty ? null : () => onOpenFile(path),
        ),
      ],
    );
  }

  Widget _buildHeadTailTruncation(OpenCodeTheme theme, RegExpMatch match) {
    final omittedLines = match.group(1) ?? '0';
    final omittedSize = match.group(2) ?? '';

    // Split into head and tail parts
    final headPart = output.substring(0, match.start).trimRight();
    final tailPart = output.substring(match.end).trimLeft();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Head section
        if (headPart.isNotEmpty) _CodeBox(text: headPart),
        if (headPart.isNotEmpty) SizedBox(height: Spacing.sm),

        // Omitted indicator
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: theme.warning.withValues(alpha: 0.08),
            borderRadius: Radii.brSm,
            border: Border.all(color: theme.warning.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.more_horiz_rounded, color: theme.warning, size: 16),
              SizedBox(width: Spacing.sm),
              Text(
                '$omittedLines lines ($omittedSize) omitted',
                style: TextStyle(
                  color: theme.warning,
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                ),
              ),
              SizedBox(width: Spacing.sm),
              Icon(Icons.more_horiz_rounded, color: theme.warning, size: 16),
            ],
          ),
        ),

        // Tail section
        if (tailPart.isNotEmpty) SizedBox(height: Spacing.sm),
        if (tailPart.isNotEmpty) _CodeBox(text: tailPart),
      ],
    );
  }
}

/// Card showing truncation info with optional action button
class _TruncationCard extends StatelessWidget {
  const _TruncationCard({
    required this.theme,
    required this.icon,
    required this.message,
    required this.buttonLabel,
    this.onPressed,
  });

  final OpenCodeTheme theme;
  final IconData icon;
  final String message;
  final String buttonLabel;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(icon, color: theme.info, size: 16),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: AppTypography.codeSmall(color: theme.text).copyWith(
                height: 1.4,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 10),
          OutlinedButton.icon(
            onPressed: onPressed,
            icon: const Icon(Icons.open_in_new_rounded, size: 16),
            label: Text(buttonLabel),
            style: OutlinedButton.styleFrom(
              foregroundColor: theme.info,
              side: BorderSide(color: theme.info.withValues(alpha: 0.4)),
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
      ),
    );
  }
}

class _CodeBox extends StatelessWidget {
  const _CodeBox({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      width: double.infinity,
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Text(
        text,
        style: AppTypography.codeSmall(color: theme.text).copyWith(
          height: 1.5,
        ),
      ),
    );
  }
}
