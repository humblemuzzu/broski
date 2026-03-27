import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/project.dart';
import '../../models/session.dart';
import '../../providers/service_providers.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Shows the rename session dialog. Extracted from chat_screen.dart.
void showRenameSessionDialog(
  BuildContext context, {
  required WidgetRef ref,
  required SessionSummary session,
  required ProjectSummary project,
}) {
  final theme = OpenCodeTheme.of(context);
  final controller = TextEditingController(text: session.title);
  showDialog(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: theme.backgroundPanel,
      title: Text('Rename Session', style: TextStyle(color: theme.text)),
      content: TextField(
        controller: controller,
        autofocus: true,
        style: TextStyle(color: theme.text),
        decoration: InputDecoration(
          hintText: 'Enter new title',
          hintStyle: TextStyle(color: theme.textMuted),
          border: OutlineInputBorder(borderRadius: Radii.brSm),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
        ),
        TextButton(
          onPressed: () async {
            final newTitle = controller.text.trim();
            if (newTitle.isEmpty) return;
            Navigator.pop(context);
            try {
              final bridge = ref.read(bridgeServiceProvider);
              await bridge.updateSession(
                session.id,
                title: newTitle,
                projectPath: project.path,
              );
              if (context.mounted) {
                showInfo(context, 'Session renamed to "$newTitle"');
              }
            } catch (e) {
              if (context.mounted) {
                showInfo(context, 'Failed to rename: ${humanizeError(e)}');
              }
            }
          },
          child: Text('Rename', style: TextStyle(color: theme.primary)),
        ),
      ],
    ),
  );
}
