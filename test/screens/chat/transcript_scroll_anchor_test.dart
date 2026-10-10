import 'package:broski/screens/chat/transcript_scroll_anchor.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _Host extends StatelessWidget {
  const _Host({
    required this.controller,
    required this.keys,
    required this.items,
  });

  final ScrollController controller;
  final TranscriptAnchorKeys keys;
  final List<(String, double)> items;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: ListView.builder(
          controller: controller,
          itemCount: items.length,
          itemBuilder: (context, index) {
            final (id, height) = items[index];
            return KeyedSubtree(
              key: keys.keyFor(id),
              child: SizedBox(height: height, child: Text(id)),
            );
          },
        ),
      ),
    );
  }
}

List<(String, double)> _messages(
  int count,
  double height, {
  String prefix = 'm',
}) {
  return [for (var i = 0; i < count; i++) ('$prefix$i', height)];
}

void main() {
  testWidgets('a prepended page leaves the anchored message in place', (
    tester,
  ) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);
    final keys = TranscriptAnchorKeys();

    final window = _messages(40, 100);
    await tester.pumpWidget(
      _Host(controller: controller, keys: keys, items: window),
    );
    controller.jumpTo(1000);
    await tester.pump();

    final anchor = captureTranscriptAnchor(
      messageIds: window.map((entry) => entry.$1).toList(),
      keys: keys,
    )!;
    expect(anchor.messageId, 'm10');

    // A live message lands at the bottom while the page is in flight.
    await tester.pumpWidget(
      _Host(
        controller: controller,
        keys: keys,
        items: [...window, ('tail', 300.0)],
      ),
    );
    final restore = restoreTranscriptScroll(
      controller: controller,
      keys: keys,
      anchor: anchor,
      offsetBefore: controller.offset,
      extentBefore: controller.position.maxScrollExtent,
    );

    // The page arrives, still at its placeholder height...
    await tester.pumpWidget(
      _Host(
        controller: controller,
        keys: keys,
        items: [
          ..._messages(30, 100, prefix: 'o'),
          ...window,
          ('tail', 300.0),
          ('newer', 100.0),
        ],
      ),
    );
    await tester.pump();

    // ...then grows as its images and tool cards measure, while another live
    // message appends at the bottom.
    await tester.pumpWidget(
      _Host(
        controller: controller,
        keys: keys,
        items: [
          ..._messages(30, 140, prefix: 'o'),
          ...window,
          ('tail', 300.0),
          ('newer', 100.0),
        ],
      ),
    );
    await tester.pumpAndSettle();
    await restore;

    final box =
        keys.keyFor(anchor.messageId).currentContext!.findRenderObject()
            as RenderBox;
    expect(box.localToGlobal(Offset.zero).dy, closeTo(anchor.topOffset, 1));
  });

  testWidgets('nothing to anchor to when the window is off screen', (
    tester,
  ) async {
    final keys = TranscriptAnchorKeys();
    expect(captureTranscriptAnchor(messageIds: ['m0'], keys: keys), isNull);
  });
}
