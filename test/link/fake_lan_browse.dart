import 'dart:async';

import 'package:broski/services/link/discovery/discovered_link.dart';
import 'package:broski/services/link/discovery/lan_search.dart';
import 'package:broski/services/link/discovery/link_service_browser.dart';

/// A browse a test opens, feeds and closes, and the count of open ones.
final class FakeLanBrowser implements LinkServiceBrowser {
  final List<StreamController<LinkBrowseEvent>> _opened =
      <StreamController<LinkBrowseEvent>>[];
  var opened = 0;
  var listening = 0;

  @override
  Stream<LinkBrowseEvent> watch() {
    opened++;
    listening++;
    final events = StreamController<LinkBrowseEvent>.broadcast();
    events.onCancel = () => listening--;
    _opened.add(events);
    return events.stream;
  }

  /// The browse the app is running now, if any.
  StreamController<LinkBrowseEvent>? get current =>
      _opened.isEmpty ? null : _opened.last;

  void advertised(DiscoveredLink link) => current?.add(LinkAdvertised(link));

  void unadvertised(DiscoveredLink link) =>
      current?.add(LinkUnadvertised(link));

  void failed(Object error) => current?.addError(error);
}

/// A clock that only moves when a test moves it, and the timers waiting on it.
final class FakeLanTiming implements LanSearchTiming {
  Duration elapsed = Duration.zero;
  final List<({Duration delay, void Function() run})> _pending =
      <({Duration delay, void Function() run})>[];

  @override
  Duration now() => elapsed;

  @override
  void Function() after(Duration delay, void Function() callback) {
    final entry = (delay: delay, run: callback);
    _pending.add(entry);
    return () => _pending.remove(entry);
  }

  /// The delay of the timer waiting, if there is one.
  Duration? get waiting => _pending.isEmpty ? null : _pending.first.delay;

  void fire() {
    final entry = _pending.removeAt(0);
    elapsed += entry.delay;
    entry.run();
  }
}
