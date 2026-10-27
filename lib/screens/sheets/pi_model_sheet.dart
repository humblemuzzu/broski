import 'package:broski/models/pi.dart';
import 'package:broski/models/pi_model_catalogue.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:broski/widgets/pi/pi_catalogue_model_tile.dart';
import 'package:broski/widgets/pi/pi_selected_model_tile.dart';
import 'package:broski/widgets/sessions/sessions_search_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the Pi model picker: the user's own models first, then everything `pi` offers here.
void showPiModelSheet(BuildContext context) {
  DetailSheet.show(
    context: context,
    title: 'Pi Model',
    initialSize: 0.75,
    child: const PiModelSheet(),
  );
}

class PiModelSheet extends ConsumerStatefulWidget {
  const PiModelSheet({super.key});

  @override
  ConsumerState<PiModelSheet> createState() => _PiModelSheetState();
}

class _PiModelSheetState extends ConsumerState<PiModelSheet> {
  final _searchController = TextEditingController();
  String _query = '';
  bool _refreshing = false;

  @override
  void initState() {
    super.initState();
    // Shows the cached catalogue at once, then replaces it: Pi's model files change under a running bridge.
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _reload() {
    if (!mounted) return;
    ref.invalidate(piModelsProvider(ref.read(chatSessionProvider).piCwd));
  }

  Future<void> _refresh() async {
    if (_refreshing) return;
    setState(() => _refreshing = true);
    final bridge = ref.read(piBridgeServiceProvider);
    final cwd = ref.read(chatSessionProvider).piCwd;
    try {
      final catalogue = await bridge.refreshModelCatalogue(projectPath: cwd);
      ref.invalidate(piModelsProvider(cwd));
      if (!mounted) return;
      showInfo(context, 'Pi offers ${catalogue.models.length} models here');
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Refresh failed: $e');
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  Future<void> _select(PiModel model) async {
    final chatState = ref.read(chatSessionProvider);
    final piBridge = ref.read(piBridgeServiceProvider);
    Navigator.pop(context);
    try {
      await piBridge.setModel(
        provider: model.provider,
        modelId: model.id,
        projectPath: chatState.piCwd,
      );
      ref
          .read(chatSessionProvider.notifier)
          .setPiModel(model.modelRef, modelData: model);
    } catch (e) {
      if (!mounted) return;
      showInfo(context, 'Failed to set model: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.watch(chatSessionProvider);
    final catalogueAsync = ref.watch(piModelsProvider(chatState.piCwd));
    return catalogueAsync.when(
      skipLoadingOnReload: true,
      skipLoadingOnRefresh: true,
      loading: () => const Padding(
        padding: EdgeInsets.all(Spacing.xxl),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => Padding(
        padding: Insets.cardLg,
        child: Text(
          'Failed to load models: $error',
          style: TextStyle(color: theme.error),
        ),
      ),
      data: (catalogue) => _CatalogueBody(
        catalogue: catalogue,
        query: _query,
        searchController: _searchController,
        onQueryChanged: (value) => setState(() => _query = value),
        currentModel: chatState.piModel,
        currentThinkingLevel: chatState.piThinkingLevel,
        onSelect: _select,
        onRefresh: _refresh,
        refreshing: _refreshing,
        theme: theme,
      ),
    );
  }
}

class _CatalogueBody extends StatelessWidget {
  const _CatalogueBody({
    required this.catalogue,
    required this.query,
    required this.searchController,
    required this.onQueryChanged,
    required this.currentModel,
    required this.currentThinkingLevel,
    required this.onSelect,
    required this.onRefresh,
    required this.refreshing,
    required this.theme,
  });

  final PiModelCatalogue catalogue;
  final String query;
  final TextEditingController searchController;
  final ValueChanged<String> onQueryChanged;
  final String? currentModel;
  final PiThinkingLevel? currentThinkingLevel;
  final ValueChanged<PiModel> onSelect;
  final VoidCallback onRefresh;
  final bool refreshing;
  final OpenCodeTheme theme;

  bool _isCurrent(PiModel? model) =>
      model != null &&
      (currentModel == model.id || currentModel == model.modelRef);

  @override
  Widget build(BuildContext context) {
    final models = catalogue.models;
    final byRef = {for (final model in models) model.modelRef: model};
    final unselected = catalogue.unselectedByProvider;
    final filtered = _filter(unselected);

    return Padding(
      padding: const EdgeInsets.fromLTRB(Spacing.lg, 0, Spacing.lg, Spacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${catalogue.models.length} models available here',
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                ),
              ),
              TextButton.icon(
                onPressed: refreshing ? null : onRefresh,
                icon: refreshing
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(AppIcons.refresh, size: 16),
                label: const Text('Refresh'),
                style: TextButton.styleFrom(
                  foregroundColor: theme.accent,
                  textStyle: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          SessionsSearchBar(
            controller: searchController,
            onChanged: onQueryChanged,
            hintText: 'Search models...',
          ),
          if (catalogue.selected.isNotEmpty) ...[
            const SizedBox(height: Spacing.lg),
            SectionHeader(title: 'YOUR MODELS', theme: theme),
            const SizedBox(height: Spacing.xs),
            for (final entry in catalogue.selected)
              PiSelectedModelTile(
                selection: entry,
                model: byRef[entry.modelRef],
                selected: _isCurrent(byRef[entry.modelRef]),
                thinkingLevel: _levelFor(entry, byRef[entry.modelRef]),
                onTap: byRef[entry.modelRef] == null
                    ? null
                    : () => onSelect(byRef[entry.modelRef]!),
              ),
          ],
          const SizedBox(height: Spacing.lg),
          SectionHeader(title: 'ALL MODELS', theme: theme),
          const SizedBox(height: Spacing.xs),
          if (models.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: Spacing.lg),
              child: Text(
                'Pi has no model it can run here. Log in to a provider with '
                'the pi CLI, then refresh.',
                style: TextStyle(color: theme.textMuted, fontSize: 13),
              ),
            )
          else if (filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: Spacing.lg),
              child: Text(
                'No models match "$query"',
                style: TextStyle(color: theme.textMuted, fontSize: 13),
              ),
            )
          else
            for (final entry in filtered.entries) ...[
              Padding(
                padding: const EdgeInsets.only(
                  top: Spacing.md,
                  bottom: Spacing.xs,
                ),
                child: SectionHeader(
                  title: entry.key.toUpperCase(),
                  theme: theme,
                ),
              ),
              for (final model in entry.value)
                PiCatalogueModelTile(
                  model: model,
                  selected: _isCurrent(model),
                  onTap: () => onSelect(model),
                ),
            ],
        ],
      ),
    );
  }

  PiThinkingLevel? _levelFor(PiModelSelection entry, PiModel? model) {
    if (entry.thinkingLevel != null) return entry.thinkingLevel;
    return _isCurrent(model) ? currentThinkingLevel : null;
  }

  Map<String, List<PiModel>> _filter(Map<String, List<PiModel>> grouped) {
    final query = this.query.trim().toLowerCase();
    if (query.isEmpty) return grouped;
    final filtered = <String, List<PiModel>>{};
    for (final entry in grouped.entries) {
      final matches = entry.value.where((model) {
        return model.provider.toLowerCase().contains(query) ||
            model.id.toLowerCase().contains(query) ||
            model.name.toLowerCase().contains(query);
      }).toList();
      if (matches.isNotEmpty) filtered[entry.key] = matches;
    }
    return filtered;
  }
}
