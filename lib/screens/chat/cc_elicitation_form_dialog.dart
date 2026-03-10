import 'dart:convert';

import 'package:flutter/material.dart';

import '../../models/message.dart';
import '../../theme/opencode_theme.dart';
import '../../theme/design_tokens.dart';
import '../../theme/app_typography.dart';

Future<Map<String, dynamic>?> showCcElicitationFormInputDialog(
  BuildContext context,
  PermissionRequest request,
) async {
  final ocTheme = OpenCodeTheme.of(context);
  final requestedSchema =
      (request.metadata['input'] as Map<String, dynamic>?)?['requestedSchema'];
  final prettySchema = requestedSchema is Map
      ? const JsonEncoder.withIndent(
          '  ',
        ).convert(requestedSchema.cast<String, dynamic>())
      : null;
  final controller = TextEditingController(text: '{}');

  try {
    return await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          backgroundColor: ocTheme.bgSheet,
          title: Text('MCP form input', style: TextStyle(color: ocTheme.text)),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (request.command != null && request.command!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      request.command!,
                      style: AppTypography.bodySmall(color: ocTheme.textMuted),
                    ),
                  ),
                if (prettySchema != null)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(8),
                    margin: const EdgeInsets.only(bottom: 10),
                    decoration: BoxDecoration(
                      color: ocTheme.backgroundElement,
                      borderRadius: Radii.brSm,
                    ),
                    child: Text(
                      prettySchema,
                      style: AppTypography.bodySmall(color: ocTheme.textMuted),
                    ),
                  ),
                TextField(
                  controller: controller,
                  minLines: 6,
                  maxLines: 10,
                  decoration: InputDecoration(
                    labelText: 'JSON content',
                    hintText: '{"field":"value"}',
                    filled: true,
                    fillColor: ocTheme.backgroundElement,
                    border: OutlineInputBorder(
                      borderSide: BorderSide(color: ocTheme.borderSubtle),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: ocTheme.borderSubtle),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: ocTheme.primary),
                    ),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(null),
              style: TextButton.styleFrom(foregroundColor: ocTheme.textMuted),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                try {
                  final decoded = jsonDecode(controller.text.trim());
                  if (decoded is! Map) {
                    throw const FormatException('JSON must be an object');
                  }
                  Navigator.of(
                    dialogContext,
                  ).pop(decoded.cast<String, dynamic>());
                } catch (e) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Invalid JSON: $e'),
                      backgroundColor: ocTheme.error,
                    ),
                  );
                }
              },
              style: FilledButton.styleFrom(
                backgroundColor: ocTheme.primary,
                foregroundColor: ocTheme.selectedListItemText,
              ),
              child: const Text('Submit'),
            ),
          ],
        );
      },
    );
  } finally {
    controller.dispose();
  }
}
