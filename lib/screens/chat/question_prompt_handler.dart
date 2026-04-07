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
  required bool isCodex,
  required bool isClaudeCode,
  required void Function(
    PermissionRequest,
    String, {
    String? message,
    Object? execpolicyAmendment,
  })
  onRespond,
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
    final alwaysLabel = isCodex
        ? 'Session'
        : isClaudeElicitation
        ? 'Approve'
        : 'Always';
    VoidCallback? onExecpolicy;
    String? execpolicyLabel;
    if (isCodex) {
      final method = request.metadata['method'] as String?;
      final proposed = request.metadata['proposedExecpolicyAmendment'];
      if (method == 'item/commandExecution/requestApproval' &&
          proposed is List) {
        final prefix = proposed.whereType<String>().take(3).toList().join(' ');
        if (prefix.isNotEmpty) {
          execpolicyLabel = 'Always allow "$prefix…"';
          onExecpolicy = () =>
              onRespond(request, 'execpolicy', execpolicyAmendment: proposed);
        }
      }
    }
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
        onApproveWithExecpolicy: onExecpolicy,
        approveWithExecpolicyLabel: execpolicyLabel,
        onDenyWithMessage: (message) =>
            onRespond(request, 'reject', message: message),
        // NOTE: onDefer not wired yet — SDK PermissionResult only supports
        // allow/deny. Defer is valid in HookPermissionDecision but the bridge
        // doesn't distinguish hook vs SDK waiter permissions yet.
      ),
    ).whenComplete(() => setActivePermissionId(null));
  });
}

/// Shows a question prompt for OpenCode/Claude Code.
/// Extracted from `_ChatScreenState._maybeShowQuestionPrompt`.
void maybeShowQuestionPrompt({
  required BuildContext context,
  required WidgetRef ref,
  required bool isOpenCode,
  required bool isClaudeCode,
  required QuestionRequest? request,
  required String? activeQuestionId,
  required Set<String> answeredQuestionIds,
  required HapticsService haptics,
  required void Function(String?) setActiveQuestionId,
  required bool Function() isMounted,
}) {
  if (!isOpenCode && !isClaudeCode) return;
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

/// Shows a Codex-specific question prompt (user input request).
/// Extracted from `_ChatScreenState._maybeShowCodexQuestionPrompt`.
void maybeShowCodexQuestionPrompt({
  required BuildContext context,
  required WidgetRef ref,
  required CodexUserInputRequest? request,
  required String? activeCxQuestionId,
  required HapticsService haptics,
  required void Function(String?) setActiveCxQuestionId,
  required bool Function() isMounted,
}) {
  if (request == null || request.requestId.isEmpty) {
    setActiveCxQuestionId(null);
    return;
  }
  if (activeCxQuestionId == request.requestId) return;
  setActiveCxQuestionId(request.requestId);
  haptics.mediumImpact();
  // Convert CodexUserInputRequest to QuestionRequest for the existing UI
  final convertedRequest = QuestionRequest(
    id: request.requestId,
    sessionId: request.threadId,
    questions: request.questions
        .map(
          (q) => QuestionInfo(
            question: q.question,
            header: q.header,
            options: q.options
                .map(
                  (o) => QuestionOption(
                    label: o.label,
                    description: o.description,
                  ),
                )
                .toList(),
            multiple: false,
          ),
        )
        .toList(),
  );
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
          request: convertedRequest,
          onReply: (answers) {
            ref
                .read(chatSessionProvider.notifier)
                .replyToCodexUserInput(answers);
            if (isMounted()) Navigator.pop(context);
          },
          onReject: () {
            ref.read(chatSessionProvider.notifier).rejectCodexUserInput();
            if (isMounted()) Navigator.pop(context);
          },
        );
      },
    ).whenComplete(() => setActiveCxQuestionId(null));
  });
}
