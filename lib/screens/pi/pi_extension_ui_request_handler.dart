import 'package:flutter/material.dart';

import '../../models/pi.dart';
import '../../services/pi_bridge_service.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

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

  if (method == 'paste_to_editor') {
    final text = request.raw['text'] as String? ?? '';
    if (text.isNotEmpty) {
      final current = composerController.text;
      final selection = composerController.selection;
      final before = current.substring(0, selection.baseOffset.clamp(0, current.length));
      final after = current.substring(selection.extentOffset.clamp(0, current.length));
      composerController.text = '$before$text$after';
      composerController.selection = TextSelection.fromPosition(
        TextPosition(offset: before.length + text.length),
      );
    }
    return;
  }

  if (method == 'set_tools_expanded') {
    // Acknowledged — tools expansion state is handled by the Flutter UI layer.
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
      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message, style: TextStyle(color: theme.text)),
          backgroundColor: theme.backgroundPanel,
        ),
      );
    }
    return;
  }

  if (method == 'setStatus' || method == 'setWidget') {
    return;
  }

  if (method == 'select') {
    final title = request.raw['title'] as String? ?? 'Select option';
    final options = (request.raw['options'] as List<dynamic>? ?? const [])
        .map((item) => item.toString())
        .toList();

    if (!context.mounted) return;
    String? value;
    await DetailSheet.show(
      context: context,
      title: title,
      initialSize: 0.4,
      child: Builder(
        builder: (sheetContext) {
          final theme = OpenCodeTheme.of(sheetContext);
          return ListView.separated(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            itemCount: options.length,
            separatorBuilder: (_, __) => const SizedBox(height: 4),
            itemBuilder: (ctx, index) {
              final option = options[index];
              return ListTile(
                dense: true,
                shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
                tileColor: theme.backgroundElement,
                leading: Icon(
                  AppIcons.chevronRight,
                  size: 16,
                  color: theme.primary,
                ),
                title: Text(
                  option,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                onTap: () {
                  value = option;
                  Navigator.pop(ctx);
                },
              );
            },
          );
        },
      ),
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

    if (!context.mounted) return;
    final theme = OpenCodeTheme.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: theme.background,
          shape: RoundedRectangleBorder(borderRadius: Radii.brLg),
          title: Text(title, style: TextStyle(color: theme.text)),
          content: Text(message, style: TextStyle(color: theme.textMuted)),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: theme.primary),
              onPressed: () => Navigator.pop(ctx, true),
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
    final isEditor = method == 'editor';

    if (!context.mounted) return;
    final theme = OpenCodeTheme.of(context);
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: theme.background,
          shape: RoundedRectangleBorder(borderRadius: Radii.brLg),
          title: Row(
            children: [
              Icon(
                isEditor ? AppIcons.edit : AppIcons.textFields,
                size: 18,
                color: theme.primary,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(title, style: TextStyle(color: theme.text)),
              ),
            ],
          ),
          content: SizedBox(
            width: double.maxFinite,
            child: TextField(
              controller: controller,
              autofocus: true,
              maxLines: isEditor ? 10 : 1,
              style: TextStyle(
                color: theme.text,
                fontSize: isEditor ? 13 : 14,
                fontFamily: isEditor ? 'monospace' : null,
              ),
              decoration: InputDecoration(
                hintText: placeholder,
                hintStyle: TextStyle(color: theme.textMuted),
                filled: true,
                fillColor: theme.backgroundPanel,
                border: OutlineInputBorder(
                  borderRadius: Radii.brSm,
                  borderSide: BorderSide(color: theme.borderSubtle),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: Radii.brSm,
                  borderSide: BorderSide(color: theme.borderSubtle),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: Radii.brSm,
                  borderSide: BorderSide(color: theme.primary),
                ),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: theme.primary),
              onPressed: () => Navigator.pop(ctx, controller.text),
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

  // Unknown method — cancel
  await bridge.respondToExtensionUi(
    id: requestId,
    projectPath: projectPath,
    cancelled: true,
  );
}
