import 'dart:async';

import 'package:broski/agent/cache/cached_kinds.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/session/session_cell.dart';
import 'package:broski/agent/session/session_history.dart';
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

  /// Shows the saved copy of the finished history until the bridge answers:
  /// nothing replaces a history the bridge already gave.
  Future<void> restoreSaved() async {
    final saved = await _cell.cache?.history(_cell.ref);
    if (saved == null || _cell.closed || _cell.current.history.loaded) return;
    _cell.update(
      (state) => state.copyWith(
        history: SessionHistory.saved(
          saved.value.items,
          saved.value.stability,
          saved.savedAt,
        ),
      ),
    );
  }

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
        _save();
      case Refused() || Unreached():
        _cell.notify(
          NoticeLevel.warning,
          'The conversation could not be loaded: ${problemOf(outcome)}',
        );
    }
  }

  void _save() {
    final history = _cell.current.history;
    unawaited(
      _cell.cache?.saveHistory(_cell.ref, history.items, history.stability),
    );
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
