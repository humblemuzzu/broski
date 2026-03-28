import 'package:broski/models/session.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the OpenCode session fork tree sheet.
///
/// Fetches and displays all child forks of the given session,
/// allowing the user to navigate between them.
void showOcSessionChildrenSheet(
  BuildContext context, {
  required String sessionId,
  String? projectPath,
  void Function(SessionSummary)? onForkSelected,
}) {
  DetailSheet.show(
    context: context,
    title: 'Fork Tree',
    initialSize: 0.5,
    child: _OcSessionChildrenContent(
      sessionId: sessionId,
      projectPath: projectPath,
      onForkSelected: onForkSelected,
    ),
  );
}

class _OcSessionChildrenContent extends ConsumerStatefulWidget {
  final String sessionId;
  final String? projectPath;
  final void Function(SessionSummary)? onForkSelected;

  const _OcSessionChildrenContent({
    required this.sessionId,
    this.projectPath,
    this.onForkSelected,
  });

  @override
  ConsumerState<_OcSessionChildrenContent> createState() =>
      _OcSessionChildrenContentState();
}

class _OcSessionChildrenContentState
    extends ConsumerState<_OcSessionChildrenContent> {
  List<SessionSummary>? _children;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final data = await bridge.sessionChildren(
        widget.sessionId,
        projectPath: widget.projectPath,
      );
      if (!mounted) return;
      setState(() {
        _children = data;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = humanizeError(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);

    if (_loading) {
      return const Padding(
        padding: Insets.card,
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Padding(
        padding: Insets.card,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Error: $_error', style: TextStyle(color: oc.error)),
            const SizedBox(height: Spacing.md),
            TextButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }

    final children = _children ?? [];

    if (children.isEmpty) {
      return Padding(
        padding: Insets.card,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.account_tree_outlined, size: 48, color: oc.textMuted),
            const SizedBox(height: Spacing.md),
            Text(
              'No forks yet',
              style: TextStyle(
                color: oc.text,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: Spacing.xs),
            Text(
              'Fork a session to create alternative conversation branches.',
              textAlign: TextAlign.center,
              style: TextStyle(color: oc.textMuted, fontSize: 13),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: Insets.card,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Parent session header
          _buildParentHeader(oc),
          const SizedBox(height: Spacing.md),
          // Child forks
          ...children.map((child) => _buildForkCard(child, oc)),
        ],
      ),
    );
  }

  Widget _buildParentHeader(OpenCodeTheme oc) {
    return Container(
      width: double.infinity,
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: oc.backgroundElement,
        borderRadius: Radii.brSm,
        border: Border.all(
          color: oc.borderSubtle.withValues(alpha: 0.5),
          width: 1,
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.account_tree, size: 18, color: oc.primary),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SectionHeader(title: 'Parent Session', theme: oc),
                const SizedBox(height: Spacing.xxs),
                Text(
                  widget.sessionId,
                  style: TextStyle(color: oc.text, fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildForkCard(SessionSummary fork, OpenCodeTheme oc) {
    final stats = fork.summary;
    final hasStats = stats != null;

    return GestureDetector(
      onTap: widget.onForkSelected != null
          ? () {
              Navigator.of(context).pop();
              widget.onForkSelected!(fork);
            }
          : null,
      child: Container(
        margin: const EdgeInsets.only(bottom: Spacing.sm),
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: oc.backgroundElement,
          borderRadius: Radii.brSm,
          border: Border.all(
            color: oc.borderSubtle.withValues(alpha: 0.5),
            width: 1,
          ),
        ),
        child: Row(
          children: [
            // Fork icon
            const Text('🔀', style: TextStyle(fontSize: 20)),
            const SizedBox(width: Spacing.md),
            // Fork info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    fork.title,
                    style: TextStyle(
                      color: oc.text,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (fork.parentID != null && fork.parentID!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: Spacing.xxs),
                      child: Text(
                        'Forked from parent',
                        style: TextStyle(color: oc.textMuted, fontSize: 12),
                      ),
                    ),
                  if (hasStats)
                    Padding(
                      padding: const EdgeInsets.only(top: Spacing.xs),
                      child: _buildStatsRow(stats, oc),
                    ),
                ],
              ),
            ),
            // Navigate arrow
            if (widget.onForkSelected != null)
              Icon(Icons.chevron_right, size: 20, color: oc.textMuted),
          ],
        ),
      ),
    );
  }

  Widget _buildStatsRow(SessionSummaryStats stats, OpenCodeTheme oc) {
    final parts = <Widget>[];

    if (stats.files > 0) {
      parts.add(
        Text(
          '${stats.files} file${stats.files == 1 ? '' : 's'}',
          style: TextStyle(color: oc.textMuted, fontSize: 11),
        ),
      );
    }

    if (stats.additions > 0) {
      if (parts.isNotEmpty) {
        parts.add(
          Text(' · ', style: TextStyle(color: oc.textMuted, fontSize: 11)),
        );
      }
      parts.add(
        Text(
          '+${stats.additions}',
          style: TextStyle(color: oc.success, fontSize: 11),
        ),
      );
    }

    if (stats.deletions > 0) {
      if (parts.isNotEmpty) {
        parts.add(
          Text(' · ', style: TextStyle(color: oc.textMuted, fontSize: 11)),
        );
      }
      parts.add(
        Text(
          '-${stats.deletions}',
          style: TextStyle(color: oc.error, fontSize: 11),
        ),
      );
    }

    if (parts.isEmpty) return const SizedBox.shrink();

    return Row(mainAxisSize: MainAxisSize.min, children: parts);
  }
}
