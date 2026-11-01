import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/sessions/contract_title_filters_provider.dart';
import 'package:broski/providers/sessions_provider.dart'
    show sessionTitleMatchesExcludeFilters;
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether [row] is left out of [backend]'s list by its saved title filters.
bool hiddenByTitleFilters(List<String> filters, SessionSummary row) =>
    sessionTitleMatchesExcludeFilters(row.title?.text ?? '', filters);

/// The header button that opens [backend]'s title filters, with their count.
class ContractTitleFiltersButton extends ConsumerWidget {
  const ContractTitleFiltersButton({super.key, required this.backend});

  final BackendId backend;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(contractTitleFiltersProvider(backend)).length;
    return IconButton(
      key: const ValueKey('title-filters'),
      tooltip: count == 0 ? 'Title filters' : 'Title filters ($count)',
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text('$count'),
        child: const Icon(Icons.filter_alt_outlined),
      ),
      onPressed: () => showContractTitleFiltersSheet(context, backend),
    );
  }
}

/// Adds and removes [backend]'s title filters.
void showContractTitleFiltersSheet(BuildContext context, BackendId backend) {
  DetailSheet.show<void>(
    context: context,
    title: 'Title Filters',
    child: _FiltersEditor(backend: backend),
  );
}

class _FiltersEditor extends ConsumerStatefulWidget {
  const _FiltersEditor({required this.backend});

  final BackendId backend;

  @override
  ConsumerState<_FiltersEditor> createState() => _FiltersEditorState();
}

class _FiltersEditorState extends ConsumerState<_FiltersEditor> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    await ref
        .read(contractTitleFiltersProvider(widget.backend).notifier)
        .add(_text.text);
    _text.clear();
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final filters = ref.watch(contractTitleFiltersProvider(widget.backend));
    final notifier = ref.read(
      contractTitleFiltersProvider(widget.backend).notifier,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Hide sessions whose titles match any filter. Use /regex/ for a '
          'regular expression; anything else matches anywhere in the title, '
          'whatever the case.',
          style: TextStyle(color: oc.textMuted, fontSize: 13),
        ),
        const SizedBox(height: Spacing.md),
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const ValueKey('title-filter-input'),
                controller: _text,
                decoration: const InputDecoration(hintText: 'e.g. /^test/'),
                onSubmitted: (_) => _add(),
              ),
            ),
            const SizedBox(width: Spacing.sm),
            TextButton(
              key: const ValueKey('title-filter-add'),
              onPressed: _add,
              child: const Text('Add'),
            ),
          ],
        ),
        const SizedBox(height: Spacing.md),
        if (filters.isEmpty)
          Text('No filters yet', style: TextStyle(color: oc.textMuted)),
        for (final filter in filters)
          ListTile(
            key: ValueKey('title-filter:$filter'),
            contentPadding: EdgeInsets.zero,
            leading: Icon(
              filter.length >= 3 &&
                      filter.startsWith('/') &&
                      filter.endsWith('/')
                  ? AppIcons.code
                  : AppIcons.textFields,
              color: oc.textMuted,
            ),
            title: Text(filter, style: TextStyle(color: oc.text)),
            trailing: IconButton(
              tooltip: 'Remove',
              icon: Icon(AppIcons.close, color: oc.textMuted),
              onPressed: () => notifier.remove(filter),
            ),
          ),
        if (filters.isNotEmpty)
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: notifier.clear,
              child: Text('Clear all', style: TextStyle(color: oc.error)),
            ),
          ),
      ],
    );
  }
}
