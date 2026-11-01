import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/session_actions.dart';
import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/sessions/session_actions_sheet.dart';
import 'package:broski/agent/ui/sessions/session_list_options.dart';
import 'package:broski/agent/ui/sessions/session_list_tools.dart';
import 'package:broski/agent/ui/sessions/session_openers.dart';
import 'package:broski/agent/ui/sessions/session_row.dart';
import 'package:broski/agent/ui/shared/offline_banner.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The rows of one list of sessions, paged, with the row actions the backend
/// has; the saved copy, marked, while the bridge cannot be reached. With
/// [tools] the person can search the rows read, order them, keep one
/// directory, and group them by directory.
class SessionListView extends ConsumerStatefulWidget {
  const SessionListView({
    super.key,
    required this.backend,
    required this.listKey,
    this.bottomPadding = 0,
    this.tools = true,
    this.hidden,
  });

  final BackendDescriptor backend;
  final SessionListKey listKey;

  /// Room below the last row, for what floats over the list.
  final double bottomPadding;
  final bool tools;

  /// Rows the person chose not to see, such as titles the screen around the
  /// list filters out; a line says how many of the rows read it left out.
  final bool Function(SessionSummary row)? hidden;

  @override
  ConsumerState<SessionListView> createState() => _SessionListViewState();
}

class _SessionListViewState extends ConsumerState<SessionListView> {
  final _search = TextEditingController();
  var _options = const SessionListOptions();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final list = ref.watch(sessionListProvider(widget.listKey));
    final controller = ref.read(sessionListProvider(widget.listKey).notifier);
    final live = ref.watch(liveProvider);
    final hide = widget.hidden;
    final kept = hide == null
        ? list.rows
        : [
            for (final row in list.rows)
              if (!hide(row)) row,
          ];
    final hiddenCount = list.rows.length - kept.length;
    final shown = visibleSessions(kept, _options);
    return RefreshIndicator(
      onRefresh: controller.refresh,
      child: ListView(
        padding: EdgeInsets.only(bottom: widget.bottomPadding),
        children: [
          if (widget.tools && (list.rows.isNotEmpty || _options.filtering))
            SessionListTools(
              search: _search,
              options: _options,
              directories: directoriesOf(list.rows),
              onChanged: (next) => setState(() => _options = next),
            ),
          if (_options.directory case final directory? when live)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: const ValueKey('continue-latest'),
                icon: const Icon(Icons.play_arrow, size: 18),
                label: const Text('Continue the latest session here'),
                onPressed: () =>
                    continueLatest(context, ref, widget.backend.id, directory),
              ),
            ),
          if (!live && list.loaded)
            OfflineBanner(savedAt: list.savedAt)
          else if (list.problem case final problem?)
            Padding(padding: Insets.screen, child: Text(problem)),
          if (hiddenCount > 0) _HiddenCount(count: hiddenCount),
          ..._rows(context, shown, live),
          if (list.loaded && shown.isEmpty)
            _empty(list.rows.isEmpty, filtered: hiddenCount > 0),
          if (_options.filtering && !list.complete && list.loaded)
            _SearchScope(read: list.rows.length),
          if (!list.complete && list.loaded && live)
            TextButton(
              onPressed: list.loading ? null : controller.loadMore,
              child: Text(list.loading ? 'Loading\u2026' : 'Load more'),
            ),
          if (!list.loaded)
            const Padding(
              padding: Insets.screen,
              child: Center(
                child: CircularProgressIndicator(
                  semanticsLabel: 'Loading the sessions',
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _empty(bool nothingRead, {required bool filtered}) => Padding(
    padding: Insets.screen,
    child: Text(
      nothingRead || !(_options.filtering || filtered)
          ? 'No sessions'
          : 'No session here matches.',
    ),
  );

  List<Widget> _rows(
    BuildContext context,
    List<SessionSummary> shown,
    bool live,
  ) {
    if (!_options.byDirectory) {
      return [for (final row in shown) _row(context, row, live)];
    }
    return [
      for (final section in byDirectory(shown)) ...[
        _DirectoryHeader(
          directory: section.directory,
          count: section.rows.length,
        ),
        for (final row in section.rows) _row(context, row, live),
      ],
    ];
  }

  Widget _row(BuildContext context, SessionSummary row, bool live) {
    final actionable =
        live && rowActions(row, widget.backend.capabilities).isNotEmpty;
    return SessionRow(
      row: row,
      onOpen: () => openSession(context, row.session),
      onActions: actionable
          ? () => showSessionActions(
              context,
              ref,
              row: row,
              backend: widget.backend,
              listKey: widget.listKey,
            )
          : null,
    );
  }
}

class _HiddenCount extends StatelessWidget {
  const _HiddenCount({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => Padding(
    key: const ValueKey('session-hidden-count'),
    padding: Insets.chip,
    child: Text(
      '$count hidden by your title filters.',
      style: AppTypography.caption(color: OpenCodeTheme.of(context).textMuted),
    ),
  );
}

class _SearchScope extends StatelessWidget {
  const _SearchScope({required this.read});

  final int read;

  @override
  Widget build(BuildContext context) => Padding(
    key: const ValueKey('session-search-scope'),
    padding: Insets.chip,
    child: Text(
      'Looking through the $read sessions read so far.',
      style: AppTypography.caption(color: OpenCodeTheme.of(context).textMuted),
    ),
  );
}

class _DirectoryHeader extends StatelessWidget {
  const _DirectoryHeader({required this.directory, required this.count});

  final String? directory;
  final int count;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final segments = (directory ?? '').split('/').where((s) => s.isNotEmpty);
    final name = directory == null
        ? 'No directory'
        : segments.lastOrNull ?? directory!;
    return Padding(
      key: ValueKey('session-directory-header:${directory ?? ''}'),
      padding: const EdgeInsets.fromLTRB(
        Spacing.lg,
        Spacing.md,
        Spacing.lg,
        Spacing.xs,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$name \u00b7 $count', style: AppTypography.labelLarge()),
          if (directory != null)
            Text(
              directory!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.caption(color: theme.textMuted),
            ),
        ],
      ),
    );
  }
}
