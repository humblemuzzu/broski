import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/latest_session.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens [session] as a fork: a copy of its whole history under a new id,
/// which opens, so the original is left exactly as it was. Offered where the
/// backend's capabilities say `fork`.
Future<void> openAsFork(
  BuildContext context,
  WidgetRef ref,
  SessionRef session,
) async {
  final outcome = await ref.read(contractClientProvider).forkSession(session);
  if (!context.mounted) return;
  if (outcome case Done(value: final forked)) {
    await openSession(context, forked);
  } else {
    showProblem(context, problemOf(outcome));
  }
}

/// Opens the session updated last in [cwd], or says there is none.
Future<void> continueLatest(
  BuildContext context,
  WidgetRef ref,
  BackendId backend,
  String cwd,
) async {
  final outcome = await latestSessionIn(
    ref.read(contractClientProvider),
    backend,
    cwd,
  );
  if (!context.mounted) return;
  switch (outcome) {
    case Done(value: final session?):
      await openSession(context, session);
    case Done(value: null):
      showProblem(context, 'No session in ${_name(cwd)} yet.');
    case Refused() || Unreached():
      showProblem(context, problemOf(outcome));
  }
}

String _name(String cwd) =>
    cwd.split('/').where((part) => part.isNotEmpty).lastOrNull ?? cwd;
