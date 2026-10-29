import 'package:broski/contract/generated/contract.dart';

/// The finished part of a session (contract §8, the merge rule): transcript
/// pages hold finished runs only, oldest item first here, and never overlap
/// the active run the snapshot carries. [settling] holds the items of runs
/// that finished live, shown until a re-read of the newest page replaces them.
final class SessionHistory {
  const SessionHistory({
    this.items = const [],
    this.olderCursor,
    this.loaded = false,
    this.complete = false,
    this.stability = IdStability.stable,
    this.settling = const [],
    this.settlingDropped = 0,
  });

  final List<TranscriptItem> items;
  final PageCursor? olderCursor;

  /// The newest page has been read at least once.
  final bool loaded;

  /// Every older page has been read.
  final bool complete;
  final IdStability stability;
  final List<TranscriptItem> settling;

  /// Items finished runs dropped live (`droppedItems`), which only the
  /// transcript can show.
  final int settlingDropped;

  /// The newest page, read again: at attach, after a run finished, after the
  /// history was rewritten. With stable ids the pages already read stay
  /// where the new page begins in them; otherwise, or when it begins in none
  /// of them, or when [rewritten], the new page starts the history afresh.
  SessionHistory withNewestPage(TranscriptPage page, {bool rewritten = false}) {
    final newest = page.items.reversed.toList();
    final keepOlder =
        !rewritten &&
        page.idStability == IdStability.stable &&
        stability == IdStability.stable &&
        newest.isNotEmpty;
    final start = keepOlder
        ? items.indexWhere((item) => item.id == newest.first.id)
        : -1;
    final spliced = start >= 0;
    return SessionHistory(
      items: spliced ? [...items.sublist(0, start), ...newest] : newest,
      olderCursor: spliced ? olderCursor : page.nextCursor,
      loaded: true,
      complete: spliced ? complete : page.nextCursor == null,
      stability: page.idStability,
    );
  }

  /// An older page, read with [olderCursor]. A row already held (rows move on
  /// a changing list) is not shown twice.
  SessionHistory withOlderPage(TranscriptPage page) {
    final held = {for (final item in items) item.id};
    final older = [
      for (final item in page.items.reversed)
        if (page.idStability == IdStability.positional ||
            !held.contains(item.id))
          item,
    ];
    return SessionHistory(
      items: [...older, ...items],
      olderCursor: page.nextCursor,
      loaded: loaded,
      complete: page.nextCursor == null,
      stability: page.idStability,
      settling: settling,
      settlingDropped: settlingDropped,
    );
  }

  /// A run finished live: its items stay shown until the newest page is read.
  SessionHistory withSettledRun(ActiveRun run) => SessionHistory(
    items: items,
    olderCursor: olderCursor,
    loaded: loaded,
    complete: complete,
    stability: stability,
    settling: [...settling, ...run.items],
    settlingDropped: settlingDropped + run.droppedItems,
  );
}
