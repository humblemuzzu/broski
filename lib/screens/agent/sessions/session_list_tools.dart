import 'package:broski/screens/agent/sessions/session_list_options.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/sessions/session_card_text.dart';
import 'package:broski/widgets/sessions/session_helpers.dart';
import 'package:broski/widgets/sessions/sessions_search_bar.dart';
import 'package:flutter/material.dart';

/// The chips above a session list: the directory to keep, the titles to hide,
/// the order, whether rows are grouped by directory, and the words to find.
/// They work on the rows read so far: the contract's list query takes a
/// directory and the archive flag, nothing else.
class SessionListTools extends StatelessWidget {
  const SessionListTools({
    super.key,
    required this.search,
    required this.options,
    required this.directories,
    required this.onChanged,
    required this.titleFilters,
    required this.onTitleFilters,
  });

  final TextEditingController search;
  final SessionListOptions options;
  final List<String> directories;
  final ValueChanged<SessionListOptions> onChanged;

  /// How many titles the person's filters hide, and where they are edited.
  final int titleFilters;
  final VoidCallback onTitleFilters;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FilterStrip(
          options: options,
          titleFilters: titleFilters,
          onTitleFilters: onTitleFilters,
          onChanged: onChanged,
          onDirectories: () => _showDirectories(context),
          onSorts: () => _showSorts(context),
        ),
        const SizedBox(height: Spacing.md),
        _SessionSearch(search: search, options: options, onChanged: onChanged),
        const SizedBox(height: Spacing.md),
      ],
    );
  }

  void _showDirectories(BuildContext context) => _showOptions(
    context,
    title: 'Filter by directory',
    tiles: [
      FilterProjectTile(
        key: const ValueKey('session-directory:all'),
        name: 'All directories',
        path: null,
        isSelected: options.directory == null,
        onTap: () => _choose(context, options.inDirectory(null)),
      ),
      for (final directory in directories)
        FilterProjectTile(
          key: ValueKey('session-directory:$directory'),
          name: sessionProjectName(directory),
          path: directory,
          isSelected: options.directory == directory,
          onTap: () => _choose(context, options.inDirectory(directory)),
        ),
    ],
  );

  void _showSorts(BuildContext context) => _showOptions(
    context,
    title: 'Order',
    tiles: [
      for (final sort in SessionSort.values)
        FilterProjectTile(
          key: ValueKey('session-sort:${sort.name}'),
          name: sort.label,
          path: null,
          isSelected: options.sort == sort,
          onTap: () => _choose(context, options.copyWith(sort: sort)),
        ),
    ],
  );

  void _choose(BuildContext context, SessionListOptions next) {
    Navigator.of(context).pop();
    onChanged(next);
  }

  void _showOptions(
    BuildContext context, {
    required String title,
    required List<Widget> tiles,
  }) => DetailSheet.show<void>(
    context: context,
    title: title,
    initialSize: 0.5,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ...tiles,
        const SizedBox(height: Spacing.xxl),
      ],
    ),
  );
}

class _FilterStrip extends StatelessWidget {
  const _FilterStrip({
    required this.options,
    required this.titleFilters,
    required this.onTitleFilters,
    required this.onChanged,
    required this.onDirectories,
    required this.onSorts,
  });

  final SessionListOptions options;
  final int titleFilters;
  final VoidCallback onTitleFilters;
  final ValueChanged<SessionListOptions> onChanged;
  final VoidCallback onDirectories;
  final VoidCallback onSorts;

  @override
  Widget build(BuildContext context) {
    final directory = options.directory;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Row(
        children: [
          FilterChipButton(
            key: const ValueKey('session-directory'),
            label: directory == null
                ? 'All directories'
                : sessionProjectName(directory),
            onTap: onDirectories,
          ),
          const SizedBox(width: Spacing.sm),
          TitleFiltersChip(
            key: const ValueKey('title-filters'),
            count: titleFilters,
            onTap: onTitleFilters,
          ),
          const SizedBox(width: Spacing.sm),
          _SessionChip(
            key: const ValueKey('session-sort'),
            icon: AppIcons.sort,
            label: options.sort.shortLabel,
            onTap: onSorts,
          ),
          const SizedBox(width: Spacing.sm),
          _SessionChip(
            key: const ValueKey('session-group'),
            icon: AppIcons.layers,
            label: 'Group',
            active: options.byDirectory,
            onTap: () =>
                onChanged(options.copyWith(byDirectory: !options.byDirectory)),
          ),
        ],
      ),
    );
  }
}

class _SessionSearch extends StatelessWidget {
  const _SessionSearch({
    required this.search,
    required this.options,
    required this.onChanged,
  });

  final TextEditingController search;
  final SessionListOptions options;
  final ValueChanged<SessionListOptions> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: KeyedSubtree(
        key: const ValueKey('session-search'),
        child: SessionsSearchBar(
          controller: search,
          hintText: 'Search these sessions...',
          onChanged: (text) => onChanged(options.copyWith(search: text)),
        ),
      ),
    );
  }
}

class _SessionChip extends StatelessWidget {
  const _SessionChip({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final ink = active ? theme.info : theme.text;
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brFull,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: active
              ? theme.info.withValues(alpha: 0.15)
              : theme.backgroundPanel,
          borderRadius: Radii.brFull,
          border: Border.all(color: active ? theme.info : theme.borderSubtle),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: active ? theme.info : theme.textMuted),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: ink,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
