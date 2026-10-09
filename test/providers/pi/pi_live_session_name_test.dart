import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/pi/pi_live_session_name_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

RuntimeBackendEvent sessionInfoChanged(
  String? name, {
  String? sessionId = 'pi-1',
  int seq = 1,
}) {
  return RuntimeEvent.fromJson(<String, dynamic>{
        'type': 'backend_event',
        'backend': 'pi',
        'timestampMs': 1000 + seq,
        if (sessionId != null) 'sessionId': sessionId,
        'seq': seq,
        'kind': 'session-info-changed',
        'payload': {'name': name},
      })
      as RuntimeBackendEvent;
}

void main() {
  late ProviderContainer container;

  setUp(() {
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  PiLiveSessionNameNotifier notifier() =>
      container.read(piLiveSessionNamesProvider.notifier);

  group('Pi live session name', () {
    test('reports the renamed session title', () {
      notifier().applySessionInfoChanged(sessionInfoChanged('Refactor auth'));

      expect(
        container.read(piLiveSessionTitleProvider('pi-1')),
        'Refactor auth',
      );
    });

    test('has no title for a session the bridge never renamed', () {
      expect(container.read(piLiveSessionTitleProvider('pi-1')), isNull);
      expect(container.read(piLiveSessionTitleProvider(null)), isNull);
    });

    test('a cleared name drops the live title', () {
      notifier().applySessionInfoChanged(sessionInfoChanged('Temporary'));

      notifier().applySessionInfoChanged(sessionInfoChanged(null, seq: 2));
      expect(container.read(piLiveSessionTitleProvider('pi-1')), isNull);

      notifier().applySessionInfoChanged(sessionInfoChanged('  ', seq: 3));
      expect(container.read(piLiveSessionTitleProvider('pi-1')), isNull);
    });
  });
}
