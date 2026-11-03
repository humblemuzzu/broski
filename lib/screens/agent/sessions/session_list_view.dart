import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/session_actions.dart';
import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/providers/sessions/contract_title_filters_provider.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/agent/sessions/session_actions_sheet.dart';
import 'package:broski/screens/agent/sessions/session_list_notices.dart';
import 'package:broski/screens/agent/sessions/session_list_options.dart';
import 'package:broski/screens/agent/sessions/session_list_sections.dart';
import 'package:broski/screens/agent/sessions/session_list_tools.dart';
import 'package:broski/screens/agent/sessions/session_openers.dart';
import 'package:broski/screens/agent/sessions/session_row.dart';
import 'package:broski/screens/agent/shared/offline_banner.dart';
import 'package:broski/screens/sessions/contract_title_filters_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sessions/session_card_view.dart';
import 'package:broski/widgets/sessions/session_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The rows of one list of sessions, paged, drawn as the app's session cards:
/// the running ones in their panel, the highlighted ones under their star, the
/// rest under their directory. The saved copy, marked, while the bridge cannot
/// be reached. With [tools] the person can search the rows read, order them,
/// keep one directory, and group them by directory.
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

typedef _Seen = ({
  List<SessionSummary> kept,
  List<SessionSummary> shown,
  int hidden,
});

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
    final seen = _seen(list.rows);
    return RefreshIndicator(
      onRefresh: controller.refresh,
      color: Theme.of(context).colorScheme.primary,
      backgroundColor: Theme.of(context).colorScheme.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.only(bottom: widget.bottomPadding),
        children: [
          ..._above(context, list, seen, live),
          ..._rows(context, seen.shown, live),
          ..._below(list, controller, seen, live),
        ],
      ),
    );
  }

  _Seen _seen(List<SessionSummary> rows) {
    final hide = widget.hidden;
    final kept = hide == null
        ? rows
        : [
            for (final row in rows)
              if (!hide(row)) row,
          ];
    return (
      kept: kept,
      shown: visibleSessions(kept, _options),
      hidden: rows.length - kept.length,
    );
  }

  List<Widget> _above(
    BuildContext context,
    SessionListState list,
    _Seen seen,
    bool live,
  ) => [
    RunningSessionsSection(
      rows: [
        for (final row in seen.kept)
          if (row.status == SessionStatus.running ||
              row.status == SessionStatus.waitingForUser)
            row,
      ],
      onOpen: (row) => openSession(context, row.session),
    ),
    if (widget.tools && (list.rows.isNotEmpty || _options.filtering))
      SessionListTools(
        search: _search,
        options: _options,
        directories: directoriesOf(list.rows),
        titleFilters: ref
            .watch(contractTitleFiltersProvider(widget.backend.id))
            .length,
        onTitleFilters: () =>
            showContractTitleFiltersSheet(context, widget.backend.id),
        onChanged: (next) => setState(() => _options = next),
      ),
    if (_options.directory case final directory? when live)
      _ContinueLatest(
        onTap: () => continueLatest(context, ref, widget.backend.id, directory),
      ),
    if (!live && list.loaded)
      OfflineBanner(savedAt: list.savedAt)
    else if (list.problem case final problem?)
      SessionListProblem(text: problem),
    if (seen.hidden > 0)
      SessionListNote(
        key: const ValueKey('session-hidden-count'),
        text: '${seen.hidden} hidden by your title filters.',
      ),
    if (_options.filtering && !list.complete && list.loaded)
      SessionListNote(
        key: const ValueKey('session-search-scope'),
        text: 'Looking through the ${list.rows.length} sessions read so far.',
      ),
    ..._highlighted(context, seen.shown, live),
  ];

  List<Widget> _highlighted(
    BuildContext context,
    List<SessionSummary> shown,
    bool live,
  ) {
    final marks = ref.watch(highlightsProvider);
    final rows = [
      for (final row in shown)
        if (marks.isSessionHighlighted(row.session.sessionId)) row,
    ];
    if (rows.isEmpty) return const [];
    final brightness = Theme.of(context).brightness;
    final primary = OpenCodeTheme.of(context).primary;
    final mark = SessionCardHighlight(
      accent: marks.color.forBrightness(brightness, themePrimary: primary),
      background: marks.color.backgroundFor(brightness, themePrimary: primary),
    );
    return [
      HighlightedSessionsSection(
        accent: mark.accent,
        children: [
          for (final row in rows) _card(context, row, live, mark: mark),
        ],
      ),
    ];
  }

  List<Widget> _rows(
    BuildContext context,
    List<SessionSummary> shown,
    bool live,
  ) {
    final marks = ref.watch(highlightsProvider);
    final rows = [
      for (final row in shown)
        if (!marks.isSessionHighlighted(row.session.sessionId)) row,
    ];
    if (!_options.byDirectory) {
      return [for (final row in rows) _card(context, row, live)];
    }
    return [
      for (final section in byDirectory(rows)) ...[
        SessionDirectoryHeader(
          directory: section.directory,
          count: section.rows.length,
        ),
        for (final row in section.rows) _card(context, row, live),
      ],
    ];
  }

  List<Widget> _below(
    SessionListState list,
    SessionListController controller,
    _Seen seen,
    bool live,
  ) => [
    if (list.loaded && seen.shown.isEmpty) _empty(list, seen),
    if (!list.complete && list.loaded && live)
      Padding(
        padding: Insets.screenH,
        child: SessionListLoadMore(
          loading: list.loading,
          onTap: controller.loadMore,
        ),
      ),
    if (!list.loaded) const DelayedSkeletonList(),
  ];

  Widget _empty(SessionListState list, _Seen seen) {
    final narrowed = _options.filtering || seen.hidden > 0;
    if (list.rows.isEmpty || !narrowed) {
      return const SessionListEmptyState(
        title: 'No sessions',
        detail: 'Start one in a project and it will appear here',
      );
    }
    return const SessionListEmptyState(
      title: 'No session here matches.',
      detail: 'Try other words, another directory, or fewer title filters',
    );
  }

  Widget _card(
    BuildContext context,
    SessionSummary row,
    bool live, {
    SessionCardHighlight? mark,
  }) {
    final actions = live
        ? rowActions(row, widget.backend.capabilities)
        : const <RowAction>[];
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: SessionRow(
        row: row,
        highlight: mark,
        onOpen: () => openSession(context, row.session),
        onActions: actions.isEmpty
            ? null
            : () => showSessionActions(
                context,
                ref,
                row: row,
                backend: widget.backend,
                listKey: widget.listKey,
              ),
        onDelete: actions.contains(RowAction.delete)
            ? () =>
                  deleteSession(context, ref, row: row, listKey: widget.listKey)
            : null,
      ),
    );
  }
}

class _ContinueLatest extends StatelessWidget {
  const _ContinueLatest({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: InkWell(
        key: const ValueKey('continue-latest'),
        onTap: onTap,
        borderRadius: Radii.brMd,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
          decoration: BoxDecoration(
            color: theme.backgroundElement.withValues(alpha: 0.5),
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Row(
            children: [
              Icon(AppIcons.play, size: 16, color: theme.primary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Continue the latest session here',
                  style: TextStyle(
                    color: theme.primary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
