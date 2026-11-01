import 'package:broski/agent/ui/sessions/session_list_options.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// Search, order, directory and grouping for the rows of a session list. They
/// work on the rows read so far: the contract's list query takes a directory
/// and the archive flag, nothing else.
class SessionListTools extends StatelessWidget {
  const SessionListTools({
    super.key,
    required this.search,
    required this.options,
    required this.directories,
    required this.onChanged,
  });

  final TextEditingController search;
  final SessionListOptions options;
  final List<String> directories;
  final ValueChanged<SessionListOptions> onChanged;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.cardSm,
    child: Row(
      children: [
        Expanded(
          child: _SearchField(
            search: search,
            options: options,
            onChanged: onChanged,
          ),
        ),
        _SortMenu(options: options, onChanged: onChanged),
        if (directories.length > 1)
          _DirectoryMenu(
            options: options,
            directories: directories,
            onChanged: onChanged,
          ),
        IconButton(
          key: const ValueKey('session-group'),
          tooltip: options.byDirectory
              ? 'Show as one list'
              : 'Group by directory',
          icon: Icon(
            options.byDirectory
                ? Icons.view_agenda
                : Icons.view_agenda_outlined,
          ),
          onPressed: () =>
              onChanged(options.copyWith(byDirectory: !options.byDirectory)),
        ),
      ],
    ),
  );
}

class _SearchField extends StatelessWidget {
  const _SearchField({
    required this.search,
    required this.options,
    required this.onChanged,
  });

  final TextEditingController search;
  final SessionListOptions options;
  final ValueChanged<SessionListOptions> onChanged;

  @override
  Widget build(BuildContext context) => TextField(
    key: const ValueKey('session-search'),
    controller: search,
    textInputAction: TextInputAction.search,
    decoration: InputDecoration(
      hintText: 'Search these sessions',
      prefixIcon: const Icon(Icons.search, size: 20),
      isDense: true,
      suffixIcon: options.search.isEmpty
          ? null
          : IconButton(
              tooltip: 'Clear the search',
              icon: const Icon(Icons.close, size: 18),
              onPressed: () {
                search.clear();
                onChanged(options.copyWith(search: ''));
              },
            ),
    ),
    onChanged: (text) => onChanged(options.copyWith(search: text)),
  );
}

class _SortMenu extends StatelessWidget {
  const _SortMenu({required this.options, required this.onChanged});

  final SessionListOptions options;
  final ValueChanged<SessionListOptions> onChanged;

  @override
  Widget build(BuildContext context) => PopupMenuButton<SessionSort>(
    key: const ValueKey('session-sort'),
    tooltip: 'Order',
    icon: const Icon(Icons.sort),
    initialValue: options.sort,
    onSelected: (sort) => onChanged(options.copyWith(sort: sort)),
    itemBuilder: (context) => [
      for (final sort in SessionSort.values)
        PopupMenuItem(
          key: ValueKey('session-sort:${sort.name}'),
          value: sort,
          child: Text(sort.label),
        ),
    ],
  );
}

/// An empty value stands for every directory: a popup menu takes a null
/// value as a dismissal.
class _DirectoryMenu extends StatelessWidget {
  const _DirectoryMenu({
    required this.options,
    required this.directories,
    required this.onChanged,
  });

  final SessionListOptions options;
  final List<String> directories;
  final ValueChanged<SessionListOptions> onChanged;

  @override
  Widget build(BuildContext context) => PopupMenuButton<String>(
    key: const ValueKey('session-directory'),
    tooltip: 'Directory',
    initialValue: options.directory ?? '',
    icon: Icon(
      options.directory == null ? Icons.folder_open : Icons.folder_special,
    ),
    onSelected: (directory) =>
        onChanged(options.inDirectory(directory.isEmpty ? null : directory)),
    itemBuilder: (context) => [
      const PopupMenuItem(
        key: ValueKey('session-directory:all'),
        value: '',
        child: Text('All directories'),
      ),
      for (final directory in directories)
        PopupMenuItem(
          key: ValueKey('session-directory:$directory'),
          value: directory,
          child: Text(directory, overflow: TextOverflow.ellipsis),
        ),
    ],
  );
}
