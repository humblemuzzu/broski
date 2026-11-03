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

/// Adds and removes [backend]'s title filters: the titles a person never wants
/// to see in that backend's session list.
void showContractTitleFiltersSheet(BuildContext context, BackendId backend) {
  DetailSheet.show<void>(
    context: context,
    title: 'Title Filters',
    initialSize: 0.6,
    minSize: 0.3,
    maxSize: 0.85,
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
    final theme = OpenCodeTheme.of(context);
    final filters = ref.watch(contractTitleFiltersProvider(widget.backend));
    final notifier = ref.read(
      contractTitleFiltersProvider(widget.backend).notifier,
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Hide sessions whose titles match any filter. Use /regex/ for a '
            'regular expression; anything else matches anywhere in the title, '
            'whatever the case.',
            style: TextStyle(color: theme.textMuted, fontSize: 13),
          ),
          const SizedBox(height: Spacing.md),
          Row(
            children: [
              Expanded(
                child: _FilterField(controller: _text, onSubmitted: _add),
              ),
              const SizedBox(width: 10),
              _AddButton(onTap: _add),
            ],
          ),
          _FilterRows(
            filters: filters,
            onClear: notifier.clear,
            onRemove: notifier.remove,
          ),
        ],
      ),
    );
  }
}

class _FilterRows extends StatelessWidget {
  const _FilterRows({
    required this.filters,
    required this.onClear,
    required this.onRemove,
  });

  final List<String> filters;
  final VoidCallback onClear;
  final void Function(String filter) onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    if (filters.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Center(
          child: Text(
            'No filters yet',
            style: TextStyle(color: theme.textMuted),
          ),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: onClear,
            child: Text(
              'Clear all',
              style: TextStyle(color: theme.error, fontSize: 13),
            ),
          ),
        ),
        for (final (index, filter) in filters.indexed) ...[
          if (index > 0) Divider(height: 1, color: theme.borderSubtle),
          _FilterRow(filter: filter, onRemove: () => onRemove(filter)),
        ],
      ],
    );
  }
}

class _FilterField extends StatelessWidget {
  const _FilterField({required this.controller, required this.onSubmitted});

  final TextEditingController controller;
  final VoidCallback onSubmitted;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    OutlineInputBorder border(Color color) => OutlineInputBorder(
      borderRadius: Radii.brMd,
      borderSide: BorderSide(color: color),
    );
    return TextField(
      key: const ValueKey('title-filter-input'),
      controller: controller,
      style: TextStyle(color: theme.text),
      textInputAction: TextInputAction.done,
      decoration: InputDecoration(
        hintText: 'e.g. test, tmp, /wip.*/',
        hintStyle: TextStyle(color: theme.textMuted),
        filled: true,
        fillColor: theme.backgroundElement,
        border: border(theme.borderSubtle),
        enabledBorder: border(theme.borderSubtle),
        focusedBorder: border(theme.primary),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 10,
        ),
      ),
      onSubmitted: (_) => onSubmitted(),
    );
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return ElevatedButton(
      key: const ValueKey('title-filter-add'),
      onPressed: onTap,
      style: ElevatedButton.styleFrom(
        backgroundColor: theme.primary,
        foregroundColor: theme.selectedListItemText,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
      ),
      child: const Text('Add'),
    );
  }
}

class _FilterRow extends StatelessWidget {
  const _FilterRow({required this.filter, required this.onRemove});

  final String filter;
  final VoidCallback onRemove;

  bool get _pattern =>
      filter.length >= 3 && filter.startsWith('/') && filter.endsWith('/');

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      key: ValueKey('title-filter:$filter'),
      children: [
        Icon(
          _pattern ? AppIcons.code : AppIcons.textFields,
          size: 18,
          color: theme.textMuted,
        ),
        const SizedBox(width: Spacing.md),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              filter,
              style: TextStyle(color: theme.text, fontSize: 14),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
        Tooltip(
          message: 'Remove',
          child: InkWell(
            onTap: onRemove,
            borderRadius: Radii.brSm,
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Icon(AppIcons.delete, size: 18, color: theme.error),
            ),
          ),
        ),
      ],
    );
  }
}
