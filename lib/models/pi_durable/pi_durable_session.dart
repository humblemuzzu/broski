import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime_session_summary.dart';
import 'package:broski/models/session.dart';

/// A durable session arrives as a runtime summary; the generic chat screen keys
/// off a [SessionSummary], so this is the adapter between them.
SessionSummary sessionSummaryOf(RuntimeSessionSummary summary) {
  return SessionSummary(
    id: summary.id,
    title: summary.title,
    projectID: '',
    directory: summary.cwd,
    time: SessionTime(
      created: summary.createdAtMs ~/ 1000,
      updated: summary.updatedAtMs ~/ 1000,
    ),
  );
}

/// Banner text for a `resumed` backend_event payload: what the Mac picked back
/// up when the durable session was opened.
String? piDurableResumeNoticeText(AgentType backend, Object? payload) {
  if (backend != AgentType.piDurable || payload is! Map) return null;
  final tasks = (payload['tasks'] as num?)?.toInt() ?? 0;
  final submissions = (payload['submissions'] as num?)?.toInt() ?? 0;
  if (tasks == 0 && submissions == 0) return null;
  final parts = <String>[
    if (tasks > 0) '$tasks tool ${tasks == 1 ? 'call' : 'calls'}',
    if (submissions > 0)
      '$submissions queued ${submissions == 1 ? 'prompt' : 'prompts'}',
  ];
  return 'Resumed interrupted work: ${parts.join(' and ')}';
}
