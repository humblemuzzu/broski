import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/session_history.dart';
import 'package:broski/agent/ui/chat/timeline_builder.dart';
import 'package:broski/agent/ui/chat/timeline_entry.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The finished part of a session's timeline with the ids it holds, built
/// once per history: a streamed delta costs nothing here, however long the
/// conversation.
final class HistoryTimeline {
  HistoryTimeline(this.history)
    : entries = buildHistoryTimeline(history),
      finished = {for (final item in history.items) item.id};

  final SessionHistory history;
  final List<TimelineEntry> entries;

  /// Items a person can act from: their ids are the transcript's.
  final Set<TranscriptItemId> finished;

  bool get olderToLoad => history.loaded && !history.complete;
}

final historyTimelineProvider = Provider.autoDispose
    .family<HistoryTimeline, SessionRef>(
      (ref, session) => HistoryTimeline(
        ref.watch(sessionProvider(session).select((state) => state.history)),
      ),
    );

/// The live part, built again only when the run, the open work, the queue or
/// this phone's prompts change.
final liveTimelineProvider = Provider.autoDispose
    .family<List<TimelineEntry>, SessionRef>(
      (ref, session) => buildLiveTimeline(
        ref.watch(sessionProvider(session).select(livePartsOf)),
      ),
    );
