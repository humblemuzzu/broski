import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/timeline_entry.dart';
import 'package:broski/screens/agent/chat/timeline_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The text of what the session said last: the newest text block, live or
/// finished. Null while it has said nothing.
String? lastAnswerOf(List<TimelineEntry> live, List<TimelineEntry> finished) {
  for (final entries in [live, finished]) {
    for (final entry in entries.reversed) {
      if (entry is BlockEntry &&
          entry.kind == BlockKind.text &&
          entry.text.trim().isNotEmpty) {
        return entry.text;
      }
    }
  }
  return null;
}

final lastAnswerProvider = Provider.autoDispose.family<String?, SessionRef>(
  (ref, session) => lastAnswerOf(
    ref.watch(liveTimelineProvider(session)),
    ref.watch(historyTimelineProvider(session)).entries,
  ),
);

/// The conversation read so far as Markdown, oldest first: what the person
/// wrote and what the session answered in text. Null when nothing was said.
String? conversationOf(List<TimelineEntry> finished, List<TimelineEntry> live) {
  final parts = [
    for (final entry in [...finished, ...live])
      if (entry case UserEntry(:final item) when item.text.trim().isNotEmpty)
        '**You:** ${item.text.trim()}'
      else if (entry case BlockEntry(
        kind: BlockKind.text,
        :final text,
      ) when text.trim().isNotEmpty)
        text.trim(),
  ];
  return parts.isEmpty ? null : parts.join('\n\n');
}

/// [conversationOf] as it stands now, read once: for a tap, not for a build.
String? conversationNow(WidgetRef ref, SessionRef session) => conversationOf(
  ref.read(historyTimelineProvider(session)).entries,
  ref.read(liveTimelineProvider(session)),
);

Future<void> copyToClipboard(BuildContext context, String text) async {
  await Clipboard.setData(ClipboardData(text: text));
  if (!context.mounted) return;
  ScaffoldMessenger.of(
    context,
  ).showSnackBar(const SnackBar(content: Text('Copied')));
}
