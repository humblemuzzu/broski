import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/service_providers.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Shows a confirmation dialog and deletes a message part.
Future<bool> deleteOpenCodePart(
  BuildContext context,
  WidgetRef ref, {
  required String sessionId,
  required String messageId,
  required String partId,
  String? projectPath,
  String? partDescription,
}) async {
  if (sessionId.isEmpty || messageId.isEmpty || partId.isEmpty) return false;

  final confirmed = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Delete Part'),
      content: Text(
        partDescription != null
            ? 'Delete "$partDescription"? This cannot be undone.'
            : 'Delete this part? This cannot be undone.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );

  if (confirmed != true || !context.mounted) return false;

  try {
    final bridge = ref.read(bridgeServiceProvider);
    final ok = await bridge.deletePart(
      sessionId: sessionId,
      messageId: messageId,
      partId: partId,
      projectPath: projectPath,
    );
    if (!context.mounted) return ok;

    final oc = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok ? 'Part deleted' : 'Failed to delete part'),
        backgroundColor: ok ? oc.backgroundPanel : oc.error,
      ),
    );
    return ok;
  } catch (error) {
    if (!context.mounted) return false;
    showError(context, 'Failed to delete part: ${humanizeError(error)}');
    return false;
  }
}

/// Shows a dialog to edit a part's text content.
Future<bool> editOpenCodePart(
  BuildContext context,
  WidgetRef ref, {
  required String sessionId,
  required String messageId,
  required String partId,
  String? currentText,
  String? projectPath,
}) async {
  if (sessionId.isEmpty || messageId.isEmpty || partId.isEmpty) return false;

  final controller = TextEditingController(text: currentText ?? '');
  final result = await showDialog<String?>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Edit Part'),
      content: SizedBox(
        width: double.maxFinite,
        child: TextField(
          controller: controller,
          maxLines: 8,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'Edit content...',
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, null),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(ctx, controller.text),
          child: const Text('Save'),
        ),
      ],
    ),
  );
  controller.dispose();

  if (result == null || !context.mounted) return false;

  try {
    final bridge = ref.read(bridgeServiceProvider);
    final updated = await bridge.updatePart(
      sessionId: sessionId,
      messageId: messageId,
      partId: partId,
      part: {'text': result},
      projectPath: projectPath,
    );
    if (!context.mounted) return updated != null;

    final oc = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          updated != null ? 'Part updated' : 'Failed to update part',
        ),
        backgroundColor: updated != null ? oc.backgroundPanel : oc.error,
      ),
    );
    return updated != null;
  } catch (error) {
    if (!context.mounted) return false;
    showError(context, 'Failed to update part: ${humanizeError(error)}');
    return false;
  }
}
