import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/opencode_variant_provider.dart';
import '../../providers/selection_provider.dart';
import '../../providers/service_providers.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import '../../widgets/provider_icon.dart';

/// Model selector content for the chat screen. Extracted from chat_screen.dart.
class ModelSelectorContent extends ConsumerStatefulWidget {
  const ModelSelectorContent({super.key, required this.onModelSelected});
  final void Function(String model) onModelSelected;
  @override
  ConsumerState<ModelSelectorContent> createState() =>
      _ModelSelectorContentState();
}

class _ModelSelectorContentState extends ConsumerState<ModelSelectorContent> {
  Map<String, dynamic>? _providersData;
  String? _currentModel;
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final results = await Future.wait([
        bridge.listProviders(),
        bridge.getConfig(),
      ]);
      if (!mounted) return;
      setState(() {
        _providersData = results[0];
        _currentModel =
            selection.model?.displayString ?? (results[1])['model'] as String?;
        _loading = false;
      });
      // Update available variants for OpenCode thinking levels
      if (_providersData != null) {
        ref
            .read(openCodeVariantProvider.notifier)
            .updateAvailableVariants(_providersData!);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = humanizeError(e);
        _loading = false;
      });
    }
  }

  Future<void> _selectModel(String providerId, String modelId) async {
    final model = '$providerId/$modelId';
    final bridge = ref.read(bridgeServiceProvider);
    await bridge.setModel(model);
    setState(() {
      _currentModel = model;
    });
    widget.onModelSelected(model);
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final kOnBackground = theme.text;
    final kMuted = theme.textMuted;
    if (_loading) {
      return const Padding(
        padding: Insets.xxxl,
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) {
      return Padding(
        padding: Insets.screenAll,
        child: Text(
          'Failed to load models: $_error',
          style: TextStyle(color: kMuted),
        ),
      );
    }
    final rawProviders = _providersData?['providers'] as List<dynamic>? ?? [];
    // Sort providers: Anthropic first, then alphabetically
    final providers = List<dynamic>.from(rawProviders)
      ..sort((a, b) {
        final aId = (a as Map<String, dynamic>)['id'] as String? ?? '';
        final bId = (b as Map<String, dynamic>)['id'] as String? ?? '';
        // Priority order: anthropic first
        const priorityOrder = ['anthropic', 'openai', 'google'];
        final aPriority = priorityOrder.indexOf(aId.toLowerCase());
        final bPriority = priorityOrder.indexOf(bId.toLowerCase());
        // If both have priority, sort by priority order
        if (aPriority >= 0 && bPriority >= 0) {
          return aPriority.compareTo(bPriority);
        }
        // If only a has priority, a comes first
        if (aPriority >= 0) return -1;
        // If only b has priority, b comes first
        if (bPriority >= 0) return 1;
        // Otherwise sort alphabetically by name
        final aName = (a)['name'] as String? ?? aId;
        final bName = (b)['name'] as String? ?? bId;
        return aName.toLowerCase().compareTo(bName.toLowerCase());
      });
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(height: Spacing.sm),
        if (_currentModel != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text(
              'Current: $_currentModel',
              style: TextStyle(fontSize: 13, color: kMuted),
            ),
          ),
        if (providers.isEmpty)
          Padding(
            padding: Insets.card,
            child: Text(
              'No providers configured.',
              style: TextStyle(color: kMuted),
            ),
          )
        else
          for (final provider in providers) ...[
            Padding(
              padding: Insets.screenH,
              child: _buildProviderSection(provider as Map<String, dynamic>),
            ),
            SizedBox(height: Spacing.lg),
          ],
      ],
    );
  }

  List<Widget> _modelCapabilityIcons(
    Map<String, dynamic> model,
    OpenCodeTheme theme,
  ) {
    final icons = <Widget>[];
    const s = 13.0;
    final c = theme.textMuted.withValues(alpha: 0.7);
    if (model['reasoning'] == true) {
      icons.add(
        Tooltip(
          message: 'Reasoning',
          child: Icon(AppIcons.brain, size: s, color: c),
        ),
      );
    }
    if (model['attachment'] == true) {
      icons.add(
        Tooltip(
          message: 'Images',
          child: Icon(AppIcons.image, size: s, color: c),
        ),
      );
    }
    // Check modalities for PDF/audio
    final mods = model['modalities'];
    if (mods is Map) {
      final input = mods['input'];
      if (input is List) {
        if (input.contains('pdf')) {
          icons.add(
            Tooltip(
              message: 'PDF',
              child: Icon(AppIcons.description, size: s, color: c),
            ),
          );
        }
        if (input.contains('audio')) {
          icons.add(
            Tooltip(
              message: 'Audio',
              child: Icon(AppIcons.mic, size: s, color: c),
            ),
          );
        }
      }
    }
    final status = model['status'] as String?;
    if (status == 'deprecated') {
      icons.add(
        Tooltip(
          message: 'Deprecated',
          child: Icon(AppIcons.warning, size: s, color: theme.warning),
        ),
      );
    } else if (status == 'beta') {
      icons.add(
        Tooltip(
          message: 'Beta',
          child: Icon(AppIcons.science, size: s, color: theme.info),
        ),
      );
    }
    // Space between icons
    final spaced = <Widget>[];
    for (var i = 0; i < icons.length; i++) {
      spaced.add(icons[i]);
      if (i < icons.length - 1) spaced.add(const SizedBox(width: 3));
    }
    return spaced;
  }

  Widget _buildProviderSection(Map<String, dynamic> provider) {
    final theme = OpenCodeTheme.of(context);
    final kOnBackground = theme.text;
    final kMuted = theme.textMuted;
    final id = provider['id'] as String? ?? 'provider';
    final name = provider['name'] as String? ?? id;
    final models = provider['models'] as Map<String, dynamic>? ?? {};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Provider header with icon (SDK v1.1.18 provider-icon)
        Row(
          children: [
            ProviderIcon(providerId: id, size: 22),
            SizedBox(width: Spacing.sm),
            Text(
              name,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: kOnBackground,
              ),
            ),
          ],
        ),
        SizedBox(height: Spacing.sm),
        for (final entry in models.entries)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: _currentModel == '$id/${entry.key}'
                ? Icon(AppIcons.checkCircle, color: theme.success)
                : Icon(AppIcons.circleOutlined, color: theme.borderSubtle),
            title: Row(
              children: [
                Flexible(
                  child: Text(
                    entry.value['name'] as String? ?? entry.key,
                    style: TextStyle(color: kOnBackground),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 6),
                ..._modelCapabilityIcons(entry.value, theme),
              ],
            ),
            subtitle: Text(
              entry.key,
              style: TextStyle(fontSize: 12, color: kMuted),
            ),
            onTap: () => _selectModel(id, entry.key),
          ),
      ],
    );
  }
}
