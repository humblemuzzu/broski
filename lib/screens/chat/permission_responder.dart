import 'package:broski/models/message.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Responds to a permission request (approve/deny/always).
Future<void> respondToPermission({
  required BuildContext context,
  required WidgetRef ref,
  required PermissionRequest request,
  required String response,
  required Future<Map<String, dynamic>?> Function(PermissionRequest)
  showElicitationFormDialog,
}) async {
  final bridge = ref.read(bridgeServiceProvider);
  final chat = ref.read(chatSessionProvider.notifier);
  final elicitationRequestId =
      request.metadata['ccElicitationRequestId'] as String?;
  if (elicitationRequestId != null && elicitationRequestId.isNotEmpty) {
    final mode = request.metadata['ccElicitationMode'] as String?;
    var action = switch (response) {
      'once' || 'always' => 'accept',
      'reject' => 'decline',
      _ => 'cancel',
    };

    Map<String, dynamic>? content;
    if (mode == 'form' && action == 'accept') {
      content = await showElicitationFormDialog(request);
      if (content == null) {
        action = 'cancel';
      }
    }

    bridge.ccRespondToElicitation(
      sessionId: request.sessionId,
      requestId: elicitationRequestId,
      action: action,
      content: content,
    );
  } else {
    // "Always Allow" forwards the SDK's suggestions so the rule persists.
    final suggestions = response == 'always'
        ? request.metadata['ccSuggestions'] as List<dynamic>?
        : null;
    bridge.ccRespondToPermission(
      sessionId: request.sessionId,
      toolUseId: request.id,
      response: response,
      updatedPermissions: suggestions,
    );
  }
  chat.resolvePermission(request.id);
  if (context.mounted && Navigator.of(context).canPop()) {
    Navigator.pop(context);
  }
}
