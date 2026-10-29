import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/session/session_cell.dart';
import 'package:broski/agent/session/stream_sync.dart';
import 'package:broski/contract/generated/contract.dart';

/// Reads a session's finished history (contract §8, §11.2): the newest page at
/// attach, after every finished run and after a rewrite; older pages on
/// demand. Only the newest read asked last may land, so an answer overtaken
/// by a newer one never puts back an older view.
final class HistoryLoader {
  HistoryLoader(this._cell);

  static const pageSize = 50;

  final SessionCell _cell;
  var _newestReads = 0;
  var _rewritePending = false;
  var _olderReading = false;

  Future<void> refreshNewest({bool rewritten = false}) async {
    _rewritePending |= rewritten;
    final read = ++_newestReads;
    final rewrite = _rewritePending;
    final outcome = await _cell.client.readTranscript(
      _cell.ref,
      const PageRequest(limit: pageSize),
    );
    if (_cell.closed || read != _newestReads) return;
    switch (outcome) {
      case Done(value: final page):
        if (rewrite) _rewritePending = false;
        _cell.update((state) {
          final history = state.history.withNewestPage(
            page,
            rewritten: rewrite,
          );
          return state.copyWith(
            history: history,
            prompts: withoutEchoed(state.prompts, history.items),
          );
        });
      case Refused() || Unreached():
        _cell.notify(
          NoticeLevel.warning,
          'The conversation could not be loaded: ${problemOf(outcome)}',
        );
    }
  }

  Future<void> loadOlder() async {
    final history = _cell.current.history;
    final cursor = history.olderCursor;
    if (_olderReading || cursor == null || history.complete) return;
    _olderReading = true;
    final newestBefore = _newestReads;
    final outcome = await _cell.client.readTranscript(
      _cell.ref,
      PageRequest(cursor: cursor, limit: pageSize),
    );
    _olderReading = false;
    if (_cell.closed) return;
    final current = _cell.current.history;
    if (newestBefore != _newestReads || current.olderCursor != cursor) return;
    switch (outcome) {
      case Done(value: final page):
        _cell.update(
          (state) => state.copyWith(history: state.history.withOlderPage(page)),
        );
      case Refused() || Unreached():
        _cell.notify(
          NoticeLevel.warning,
          'Older messages could not be loaded: ${problemOf(outcome)}',
        );
    }
  }
}
