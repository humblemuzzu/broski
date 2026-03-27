import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/project.dart';
import '../../providers/highlights_provider.dart';
import '../../providers/service_providers.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';
import 'edit_project_dialog.dart';

/// Shows a context menu for a project with highlight toggle and edit options.
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
          ListTile(
            leading: Icon(AppIcons.edit, color: oc.textMuted),
            title: Text('Edit Project', style: TextStyle(color: oc.text)),
            subtitle: Text(
              'Change name or icon',
              style: TextStyle(color: oc.textMuted, fontSize: 12),
            ),
            onTap: () => Navigator.pop(ctx, 'edit'),
          ),
          SizedBox(height: Spacing.sm),
        ],
      ),
    ),
  );

  if (result == null) return false;

  if (result == 'highlight') {
    ref.read(highlightsProvider.notifier).toggleProject(project.id);
    return false;
  }

  if (result == 'edit') {
    if (!context.mounted) return false;
    final bridge = ref.read(bridgeServiceProvider);
    final saved = await showEditProjectDialog(
      context: context,
      projectId: project.id,
      currentName: project.name,
      currentIcon: project.icon,
      onSave:
          ({
            required String projectId,
            String? name,
            Map<String, dynamic>? icon,
          }) => bridge.updateProject(
            projectId: projectId,
            name: name,
            icon: icon,
          ),
    );
    return saved == true;
  }

  return false;
}
