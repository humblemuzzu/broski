import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';

/// Input the backend took out of its queue on Stop (contract §10) waits in the
/// session state until the composer takes it.
void main() {
  late SessionRig rig;

  setUp(() async => rig = await SessionRig.start());
  tearDown(() => rig.dispose());

  test('hand-backs that arrive before the composer takes any add up, in the '
      'order they came', () async {
    final controller = await rig.attached();
    rig.bridge.event(
      sessionRef,
      1,
      const InputReturnedEvent(texts: ['one', 'two']),
    );
    rig.bridge.event(sessionRef, 2, const InputReturnedEvent(texts: ['three']));
    await pumpEventQueue();
    expect(controller.current.returnedInput, ['one', 'two', 'three']);

    controller.controls.clearReturnedInput();
    expect(controller.current.returnedInput, isEmpty);
    controller.dispose();
  });
}
