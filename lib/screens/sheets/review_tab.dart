import 'package:broski/models/vcs.dart';
import 'package:broski/providers/git_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/git/git_diff_inline.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Review tab showing VCS diffs — working tree changes or changes vs the
/// default branch, read through the unified git handler. Designed to be embedded inside a git panel sheet.
class ReviewTab extends ConsumerStatefulWidget {
  const ReviewTab({super.key, required this.projectPath});

  final String projectPath;

  @override
  ConsumerState<ReviewTab> createState() => _ReviewTabState();
}

class _ReviewTabState extends ConsumerState<ReviewTab> {
  String _mode = 'git';

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final request = VcsDiffRequest(
      projectPath: widget.projectPath,
      mode: _mode,
    );
    final diffAsync = ref.watch(vcsDiffProvider(request));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildModeToggle(theme),
        const SizedBox(height: Spacing.md),
        diffAsync.when(
          data: (files) => _buildDiffContent(theme, files),
          loading: () => const Padding(
            padding: Insets.card,
            child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
          ),
          error: (error, _) => _buildErrorCard(theme, error),
        ),
      ],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Mode toggle
  // ═══════════════════════════════════════════════════════════════════════════
  Widget _buildModeToggle(OpenCodeTheme theme) {
    const labels = ['Working Tree', 'vs main'];
    final modes = ['git', 'branch'];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: theme.backgroundElement,
          borderRadius: Radii.brMd,
        ),
        child: Row(
          children: List.generate(2, (i) {
            final selected = _mode == modes[i];
            return Expanded(
              child: GestureDetector(
                onTap: () => setState(() => _mode = modes[i]),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: Insets.chipV,
                  decoration: BoxDecoration(
                    color: selected ? theme.primary : Colors.transparent,
                    borderRadius: Radii.brMd,
                  ),
                  child: Text(
                    labels[i],
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: selected
                          ? theme.selectedListItemText
                          : theme.textMuted,
                    ),
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Diff content
  // ═══════════════════════════════════════════════════════════════════════════
  Widget _buildDiffContent(OpenCodeTheme theme, List<VcsDiffFile> files) {
    if (files.isEmpty) {
      return Padding(
        padding: Insets.card,
        child: Center(
          child: Text(
            'No changes',
            style: AppTypography.bodySmall(color: theme.success),
          ),
        ),
      );
    }

    final totalAdditions = files.fold<int>(0, (s, f) => s + f.additions);
    final totalDeletions = files.fold<int>(0, (s, f) => s + f.deletions);

    // Group files by status
    final modified = files.where((f) => f.isModified).toList();
    final added = files.where((f) => f.isAdded).toList();
    final deleted = files.where((f) => f.isDeleted).toList();
    // Catch-all for unknown statuses
    final other = files
        .where((f) => !f.isModified && !f.isAdded && !f.isDeleted)
        .toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Summary card
        _buildSummaryCard(theme, files.length, totalAdditions, totalDeletions),
        const SizedBox(height: Spacing.md),
        // File list grouped by status
        Container(
          decoration: BoxDecoration(
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (modified.isNotEmpty)
                _buildFileGroup(
                  theme,
                  'Modified (${modified.length})',
                  modified,
                ),
              if (added.isNotEmpty)
                _buildFileGroup(theme, 'Added (${added.length})', added),
              if (deleted.isNotEmpty)
                _buildFileGroup(theme, 'Deleted (${deleted.length})', deleted),
              if (other.isNotEmpty)
                _buildFileGroup(theme, 'Other (${other.length})', other),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSummaryCard(
    OpenCodeTheme theme,
    int fileCount,
    int additions,
    int deletions,
  ) {
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
          Icon(AppIcons.fileText, size: 16, color: theme.textMuted),
          const SizedBox(width: 6),
          Text(
            '$fileCount file${fileCount == 1 ? '' : 's'} changed',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: theme.text,
              fontSize: 13,
            ),
          ),
          const Spacer(),
          Text(
            '+$additions',
            style: TextStyle(
              color: theme.success,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            '-$deletions',
            style: TextStyle(
              color: theme.error,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // File groups and rows
  // ═══════════════════════════════════════════════════════════════════════════
  Widget _buildFileGroup(
    OpenCodeTheme theme,
    String title,
    List<VcsDiffFile> files,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 4, 4),
          child: Text(
            title,
            style: TextStyle(
              fontWeight: FontWeight.w600,
              fontSize: 12,
              color: theme.textMuted,
            ),
          ),
        ),
        ...files.map((f) => _buildFileRow(theme, f)),
      ],
    );
  }

  Widget _buildFileRow(OpenCodeTheme theme, VcsDiffFile file) {
    final statusColor = switch (file.status) {
      'added' => theme.success,
      'deleted' => theme.error,
      'modified' => theme.warning,
      _ => theme.textMuted,
    };

    return InkWell(
      onTap: () => _openFileDiff(file),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Row(
          children: [
            // Status badge
            Container(
              width: 22,
              height: 22,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.15),
                borderRadius: Radii.brXs,
              ),
              child: Text(
                file.statusLabel,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: statusColor,
                ),
              ),
            ),
            const SizedBox(width: Spacing.sm),
            // File path
            Expanded(
              child: Text(
                file.file,
                style: AppTypography.bodySmall(color: theme.text),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: Spacing.sm),
            // +/- counts
            if (file.additions > 0)
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Text(
                  '+${file.additions}',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: theme.success,
                  ),
                ),
              ),
            if (file.deletions > 0)
              Text(
                '-${file.deletions}',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: theme.error,
                ),
              ),
            const SizedBox(width: 4),
            Icon(AppIcons.chevronRight, size: 14, color: theme.textMuted),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Error card
  // ═══════════════════════════════════════════════════════════════════════════
  Widget _buildErrorCard(OpenCodeTheme theme, Object error) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 12),
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.error.withValues(alpha: 0.1),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.error.withValues(alpha: 0.3)),
      ),
      child: Text(
        error.toString(),
        style: AppTypography.bodySmall(color: theme.error),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Diff viewer
  // ═══════════════════════════════════════════════════════════════════════════
  Future<void> _openFileDiff(VcsDiffFile file) async {
    final diff = _computeUnifiedDiff(file);
    if (!mounted) return;
    await GitDiffInline.show(
      context: context,
      title: '${file.statusLabel} ${file.file}',
      diff: diff,
    );
  }

  /// Generates a simple unified diff string from the before/after content
  /// stored in [VcsDiffFile]. This gives GitDiffInline something to render.
  String _computeUnifiedDiff(VcsDiffFile file) {
    final beforeLines = file.before.split('\n');
    final afterLines = file.after.split('\n');
    final buf = StringBuffer();
    buf.writeln('--- a/${file.file}');
    buf.writeln('+++ b/${file.file}');

    // Added: all lines are additions
    if (file.isAdded) {
      buf.writeln('@@ -0,0 +1,${afterLines.length} @@');
      for (final line in afterLines) {
        buf.writeln('+$line');
      }
      return buf.toString();
    }

    // Deleted: all lines are removals
    if (file.isDeleted) {
      buf.writeln('@@ -1,${beforeLines.length} +0,0 @@');
      for (final line in beforeLines) {
        buf.writeln('-$line');
      }
      return buf.toString();
    }

    // Modified: show before as removals, after as additions
    buf.writeln('@@ -1,${beforeLines.length} +1,${afterLines.length} @@');
    for (final line in beforeLines) {
      buf.writeln('-$line');
    }
    for (final line in afterLines) {
      buf.writeln('+$line');
    }
    return buf.toString();
  }
}
