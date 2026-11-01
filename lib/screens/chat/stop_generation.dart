import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Stop AI generation.
///
/// The abort goes to the bridge, and the run ends on this phone at once instead of when the bridge
/// answers: with the bridge unreachable the abort reply and the events that would end the run never
/// come, and Stop must still leave the running state. The next resync shows what the Mac recorded.
void stopGeneration({required WidgetRef ref}) {
  final bridge = ref.read(bridgeServiceProvider);
  final notifier = ref.read(chatSessionProvider.notifier);
  final sid = ref.read(chatSessionProvider).ccSessionId;
  if (sid != null && sid.isNotEmpty) {
    bridge.ccAbort(sid);
  }
  notifier.cancelRunLocally();
}
