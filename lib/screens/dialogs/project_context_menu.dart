import 'package:broski/models/project.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows a context menu for a project with a highlight toggle.
/// Returns true if the project list should be refreshed.
Future<bool> showProjectContextMenu({
  required BuildContext context,
  required WidgetRef ref,
  required ProjectSummary project,
}) async {
  final oc = OpenCodeTheme.of(context);
  final result = await showModalBottomSheet<String>(
    context: context,
    backgroundColor: oc.backgroundPanel,
    shape: const RoundedRectangleBorder(borderRadius: Radii.sheetTop),
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              project.name,
              style: TextStyle(
                color: oc.text,
                fontWeight: FontWeight.w600,
                fontSize: 16,
              ),
            ),
          ),
          ListTile(
            leading: Icon(AppIcons.star, color: oc.textMuted),
            title: Text('Toggle Highlight', style: TextStyle(color: oc.text)),
            subtitle: Text(
              'Pin to top of project list',
              style: TextStyle(color: oc.textMuted, fontSize: 12),
            ),
            onTap: () => Navigator.pop(ctx, 'highlight'),
          ),
          const SizedBox(height: Spacing.sm),
        ],
      ),
    ),
  );

  if (result == null) return false;

  if (result == 'highlight') {
    ref.read(highlightsProvider.notifier).toggleProject(project.id);
    return false;
  }

  return false;
}
