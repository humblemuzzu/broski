import 'dart:convert';

import 'package:flutter/material.dart';

import '../../models/message.dart';

Future<Map<String, dynamic>?> showCcElicitationFormInputDialog(
  BuildContext context,
  PermissionRequest request,
) async {
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
        title: const Text('MCP form input'),
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
                    style: Theme.of(dialogContext).textTheme.bodySmall,
                  ),
                ),
              if (prettySchema != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(8),
                  margin: const EdgeInsets.only(bottom: 10),
                  decoration: BoxDecoration(
                    color: Theme.of(dialogContext).colorScheme.surfaceContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    prettySchema,
                    style: Theme.of(dialogContext).textTheme.bodySmall,
                  ),
                ),
              TextField(
                controller: controller,
                minLines: 6,
                maxLines: 10,
                decoration: const InputDecoration(
                  labelText: 'JSON content',
                  hintText: '{"field":"value"}',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(null),
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
                  SnackBar(content: Text('Invalid JSON: $e')),
                );
              }
            },
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
