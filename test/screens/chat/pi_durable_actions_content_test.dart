import 'package:broski/widgets/chat/pi_durable_actions_content.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('pi-durable actions content wiring', () {
    test('offers every durable action, and Stop only while streaming', () {
      final idle = piDurableActions(
        isStreaming: false,
      ).map((action) => action.id).toList();
      final streaming = piDurableActions(
        isStreaming: true,
      ).map((action) => action.id).toList();

      expect(idle, [
        pdModelActionId,
        pdCompactActionId,
        pdCopySessionIdActionId,
        pdDeleteActionId,
      ]);
      expect(streaming, [pdStopActionId, ...idle]);
    });

    test('every tile has a label and subtitle', () {
      for (final action in piDurableActions(isStreaming: true)) {
        expect(action.label, isNotEmpty);
        expect(action.subtitle, isNotEmpty);
      }
    });

    test('dispatches each id to its handler', () {
      final calls = <String>[];
      PiDurableActionHandlers handlers() => PiDurableActionHandlers(
        onStop: () => calls.add('stop'),
        onShowModel: () => calls.add('model'),
        onCompact: () => calls.add('compact'),
        onCopySessionId: () => calls.add('copy'),
        onDelete: () => calls.add('delete'),
      );

      expect(dispatchPiDurableAction(pdStopActionId, handlers()), isTrue);
      expect(dispatchPiDurableAction(pdModelActionId, handlers()), isTrue);
      expect(dispatchPiDurableAction(pdCompactActionId, handlers()), isTrue);
      expect(
        dispatchPiDurableAction(pdCopySessionIdActionId, handlers()),
        isTrue,
      );
      expect(dispatchPiDurableAction(pdDeleteActionId, handlers()), isTrue);
      expect(calls, ['stop', 'model', 'compact', 'copy', 'delete']);
    });

    test('an unknown id runs nothing', () {
      var ran = false;
      final handlers = PiDurableActionHandlers(
        onStop: () => ran = true,
        onShowModel: () => ran = true,
        onCompact: () => ran = true,
        onCopySessionId: () => ran = true,
        onDelete: () => ran = true,
      );

      expect(dispatchPiDurableAction('nope', handlers), isFalse);
      expect(ran, isFalse);
    });
  });
}
