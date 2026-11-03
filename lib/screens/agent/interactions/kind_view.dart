import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/choice_view.dart';
import 'package:broski/screens/agent/interactions/confirm_view.dart';
import 'package:broski/screens/agent/interactions/external_url_view.dart';
import 'package:broski/screens/agent/interactions/form_view.dart';
import 'package:broski/screens/agent/interactions/permission_view.dart';
import 'package:broski/screens/agent/interactions/plan_view.dart';
import 'package:broski/screens/agent/interactions/questions_view.dart';
import 'package:broski/screens/agent/interactions/reply_draft.dart';
import 'package:broski/screens/agent/interactions/text_answer_view.dart';
import 'package:flutter/material.dart';

/// Whether the sheet's Send button answers [request]; a confirm and an
/// external step answer from their own buttons.
bool submitsWithButton(InteractionRequest request) => switch (request) {
  ConfirmRequest() || ExternalUrlRequest() => false,
  ToolPermissionRequest() ||
  QuestionsRequest() ||
  FormRequest() ||
  PlanApprovalRequest() ||
  ChoiceRequest() ||
  TextRequest() => true,
};

/// The inputs one kind of interaction needs. Each view reports every change
/// as a [ReplyDraft]; a view whose own buttons answer calls [onSubmit].
class KindView extends StatelessWidget {
  const KindView({
    super.key,
    required this.interaction,
    required this.onDraft,
    required this.onSubmit,
  });

  final Interaction interaction;
  final ValueChanged<ReplyDraft> onDraft;
  final ValueChanged<InteractionReply> onSubmit;

  @override
  Widget build(BuildContext context) => switch (interaction.request) {
    final ToolPermissionRequest request => PermissionView(
      request: request,
      onDraft: onDraft,
      onSubmit: onSubmit,
    ),
    final QuestionsRequest request => QuestionsView(
      request: request,
      onDraft: onDraft,
    ),
    final FormRequest request => FormView(request: request, onDraft: onDraft),
    final PlanApprovalRequest request => PlanView(
      request: request,
      onDraft: onDraft,
    ),
    final ExternalUrlRequest request => ExternalUrlView(
      request: request,
      onSubmit: onSubmit,
    ),
    final ChoiceRequest request => ChoiceView(
      request: request,
      onDraft: onDraft,
    ),
    ConfirmRequest() => ConfirmView(onSubmit: onSubmit),
    final TextRequest request => TextAnswerView(
      request: request,
      onDraft: onDraft,
    ),
  };
}
