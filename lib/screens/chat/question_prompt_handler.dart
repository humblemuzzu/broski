import 'package:broski/models/message.dart';
import 'package:broski/models/question.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/services/haptics_service.dart';
import 'package:broski/widgets/permission_prompt.dart';
import 'package:broski/widgets/question_prompt_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows a permission prompt from the permission request list.
/// Returns the new active permission ID.
/// Extracted from `_ChatScreenState._maybeShowPermissionPromptFromList`.
void maybeShowPermissionPromptFromList({
  required BuildContext context,
  required WidgetRef ref,
  required List<PermissionRequest> permissions,
  required String? activePermissionId,
  required HapticsService haptics,
  required void Function(PermissionRequest, String) onRespond,
  required void Function(String?) setActivePermissionId,
}) {
  if (permissions.isEmpty) {
    setActivePermissionId(null);
    return;
  }
  final request = permissions.first;
  if (activePermissionId == request.id) return;
  setActivePermissionId(request.id);
  haptics.mediumImpact();
  WidgetsBinding.instance.addPostFrameCallback((_) {
    final isClaudeElicitation =
        request.metadata['ccElicitationRequestId'] != null;
    final alwaysLabel = isClaudeElicitation ? 'Approve' : 'Always';
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => PermissionPrompt(
        request: request,
        onApprove: () => onRespond(request, 'once'),
        onDeny: () => onRespond(request, 'reject'),
        onAlwaysAllow: isClaudeElicitation
            ? () => onRespond(request, 'once')
            : () => onRespond(request, 'always'),
        approveAlwaysLabel: alwaysLabel,
        // NOTE: onDefer not wired yet — SDK PermissionResult only supports
        // allow/deny. Defer is valid in HookPermissionDecision but the bridge
        // doesn't distinguish hook vs SDK waiter permissions yet.
      ),
    ).whenComplete(() => setActivePermissionId(null));
  });
}

/// Shows Claude Code's AskUserQuestion prompt.
void maybeShowQuestionPrompt({
  required BuildContext context,
  required WidgetRef ref,
  required QuestionRequest? request,
  required String? activeQuestionId,
  required Set<String> answeredQuestionIds,
  required HapticsService haptics,
  required void Function(String?) setActiveQuestionId,
  required bool Function() isMounted,
}) {
  if (request == null || request.id.isEmpty) {
    setActiveQuestionId(null);
    return;
  }
  if (activeQuestionId == request.id) return;
  if (answeredQuestionIds.contains(request.id)) return;
  setActiveQuestionId(request.id);
  haptics.mediumImpact();
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!isMounted()) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      isDismissible: false,
      enableDrag: false,
      builder: (_) {
        return QuestionPromptSheet(
          request: request,
          onReply: (answers) {
            answeredQuestionIds.add(request.id);
            ref
                .read(chatSessionProvider.notifier)
                .replyToPendingQuestion(answers);
            if (isMounted()) Navigator.pop(context);
          },
          onReject: () {
            answeredQuestionIds.add(request.id);
            ref.read(chatSessionProvider.notifier).rejectPendingQuestion();
            if (isMounted()) Navigator.pop(context);
          },
        );
      },
    ).whenComplete(() => setActiveQuestionId(null));
  });
}
