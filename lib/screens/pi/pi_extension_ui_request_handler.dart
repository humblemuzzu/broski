import 'package:flutter/material.dart';

import '../../models/pi.dart';
import '../../services/pi_bridge_service.dart';

Future<void> handlePiExtensionUiRequest({
  required BuildContext context,
  required PiBridgeService bridge,
  required PiStreamMessage request,
  required String? projectPath,
  required TextEditingController composerController,
  void Function(String title)? onSetTitle,
}) async {
  final method = request.extensionUiMethod;
  final requestId = request.extensionUiRequestId;
  if (method == null || requestId == null) return;

  if (method == 'set_editor_text') {
    final text = request.raw['text'] as String? ?? '';
    composerController.text = text;
    composerController.selection = TextSelection.fromPosition(
      TextPosition(offset: composerController.text.length),
    );
    return;
  }

  if (method == 'setTitle') {
    final title = request.raw['title'] as String?;
    if (title != null && title.trim().isNotEmpty) {
      onSetTitle?.call(title.trim());
    }
    return;
  }

  if (method == 'notify') {
    final message = request.raw['message'] as String?;
    if (message != null && context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    }
    return;
  }

  if (method == 'setStatus' || method == 'setWidget') {
    // Handled as informational metadata for now.
    return;
  }

  if (method == 'select') {
    final title = request.raw['title'] as String? ?? 'Select option';
    final options = (request.raw['options'] as List<dynamic>? ?? const [])
        .map((item) => item.toString())
        .toList();

    final value = await showDialog<String>(
      context: context,
      builder: (context) {
        return SimpleDialog(
          title: Text(title),
          children: [
            for (final option in options)
              SimpleDialogOption(
                onPressed: () => Navigator.pop(context, option),
                child: Text(option),
              ),
          ],
        );
      },
    );

    await bridge.respondToExtensionUi(
      id: requestId,
      projectPath: projectPath,
      value: value,
      cancelled: value == null,
    );
    return;
  }

  if (method == 'confirm') {
    final title = request.raw['title'] as String? ?? 'Confirm';
    final message = request.raw['message'] as String? ?? '';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Confirm'),
            ),
          ],
        );
      },
    );

    if (confirmed == null) {
      await bridge.respondToExtensionUi(
        id: requestId,
        projectPath: projectPath,
        cancelled: true,
      );
      return;
    }

    await bridge.respondToExtensionUi(
      id: requestId,
      projectPath: projectPath,
      confirmed: confirmed,
    );
    return;
  }

  if (method == 'input' || method == 'editor') {
    final title = request.raw['title'] as String? ?? 'Input required';
    final placeholder = request.raw['placeholder'] as String?;
    final prefill = request.raw['prefill'] as String?;
    final controller = TextEditingController(text: prefill ?? '');

    final value = await showDialog<String>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: TextField(
            controller: controller,
            autofocus: true,
            maxLines: method == 'editor' ? 10 : 1,
            decoration: InputDecoration(hintText: placeholder),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, controller.text),
              child: const Text('Submit'),
            ),
          ],
        );
      },
    );

    controller.dispose();

    await bridge.respondToExtensionUi(
      id: requestId,
      projectPath: projectPath,
      value: value,
      cancelled: value == null,
    );
    return;
  }

  await bridge.respondToExtensionUi(
    id: requestId,
    projectPath: projectPath,
    cancelled: true,
  );
}
