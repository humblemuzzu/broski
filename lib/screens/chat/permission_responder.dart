import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/message.dart';
import '../../providers/app_subscription_provider.dart';
import '../../providers/chat_provider.dart';
import '../../providers/service_providers.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Responds to a permission request (approve/deny/always).
/// Extracted from `_ChatScreenState._respondToPermission` in `chat_screen.dart`.
Future<void> respondToPermission({
  required BuildContext context,
  required WidgetRef ref,
  required PermissionRequest request,
  required String response,
  required bool isClaudeCode,
  required bool isCodex,
  required String projectPath,
  required Future<Map<String, dynamic>?> Function(PermissionRequest)
  showElicitationFormDialog,
  String? message,
  Object? execpolicyAmendment,
}) async {
  final entitlement = ref.read(appSubscriptionProvider).entitled;
  if (!entitlement) {
    showInfo(context, 'Subscription required to approve tools.');
    Navigator.pop(context);
    return;
  }
  final bridge = ref.read(bridgeServiceProvider);
  final chat = ref.read(chatSessionProvider.notifier);
  if (isClaudeCode) {
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
      bridge.ccRespondToPermission(
        sessionId: request.sessionId,
        toolUseId: request.id,
        response: response,
      );
    }
  } else if (isCodex) {
    bridge.cxRespondToPermission(
      requestId: request.id,
      response: response,
      execpolicyAmendment: execpolicyAmendment,
    );
  } else {
    bridge.respondToPermission(
      sessionId: request.sessionId,
      permissionId: request.id,
      response: response,
      message: message,
      projectPath: projectPath,
    );
  }
  chat.resolvePermission(request.id);
  if (context.mounted && Navigator.of(context).canPop()) {
    Navigator.pop(context);
  }
}
