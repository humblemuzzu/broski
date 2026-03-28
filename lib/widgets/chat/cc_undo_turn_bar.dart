import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';

/// Claude Code: Turn-level undo bar shown after assistant messages that
/// modified files. The SDK only supports `rewindFiles(userMessageId)` which
/// reverts ALL file changes back to a checkpoint — there is no per-file undo.
/// This bar makes that behaviour transparent instead of misleading per-card
/// undo buttons.
///
/// Design matches the compact card system: bgRaised, circular(12), cardBorderSubtle,
/// JetBrains Mono for paths, DetailSheet for the expanded file list.
class CCUndoTurnBar extends StatelessWidget {
  const CCUndoTurnBar({
    super.key,
    required this.changedFiles,
    required this.onUndo,
  });

  /// Paths of files changed in this turn (extracted from tool call inputs).
  final List<String> changedFiles;

  /// Called when the user taps undo. Should call rewindToCheckpoint().
  final VoidCallback onUndo;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final fileCount = changedFiles.length;
    final label = fileCount == 1
        ? '1 file changed'
        : '$fileCount files changed';
    return GestureDetector(
      onTap: () => _showChangedFilesSheet(context),
      child: Container(
        margin: Insets.chipV,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: Radii.brMd,
          border: Border.all(color: theme.cardBorderSubtle),
        ),
        child: Row(
          children: [
            Icon(AppIcons.history, color: theme.warning, size: 16),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: theme.cardHeaderText,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(
                changedFiles.map((p) => p.split('/').last).join(', '),
                style: AppTypography.label(color: theme.textMuted),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: Spacing.sm),
            SizedBox(
              height: 28,
              child: OutlinedButton.icon(
                onPressed: onUndo,
                icon: Icon(AppIcons.undo, size: 14, color: theme.warning),
                label: Text(
                  'Undo',
                  style: TextStyle(
                    color: theme.warning,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  side: BorderSide(color: theme.warning.withValues(alpha: 0.5)),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  shape: RoundedRectangleBorder(borderRadius: Radii.brSm),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showChangedFilesSheet(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Undo File Changes',
      initialSize: 0.35,
      minSize: 0.2,
      maxSize: 0.6,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // File list section
          DetailSection(
            label: '${changedFiles.length} files changed this turn',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final path in changedFiles)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      children: [
                        Icon(
                          AppIcons.description,
                          color: theme.textMuted,
                          size: 15,
                        ),
                        const SizedBox(width: Spacing.sm),
                        Expanded(
                          child: Text(
                            path,
                            style: AppTypography.codeSmall(color: theme.text),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          // Undo button (matches edit/write card undo style: OutlinedButton, warning color)
          Padding(
            padding: Insets.card,
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () {
                  Navigator.of(context).pop();
                  onUndo();
                },
                icon: const Icon(AppIcons.undo, size: 18),
                label: const Text('Undo all changes from this turn'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: theme.warning,
                  side: BorderSide(color: theme.warning.withValues(alpha: 0.5)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
