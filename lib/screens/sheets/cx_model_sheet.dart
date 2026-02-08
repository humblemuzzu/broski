import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/codex.dart';
import '../../providers/chat_provider.dart';
import '../../providers/service_providers.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Bottom sheet that dynamically fetches available Codex models via
/// the `model/list` JSON-RPC endpoint and lets the user pick one.
class CxModelSheet extends ConsumerStatefulWidget {
  const CxModelSheet({super.key});

  static void show(BuildContext context) {
    DetailSheet.show(
      context: context,
      title: 'Codex Model',
      initialSize: 0.5,
      child: const CxModelSheet(),
    );
  }

  @override
  ConsumerState<CxModelSheet> createState() => _CxModelSheetState();
}

class _CxModelSheetState extends ConsumerState<CxModelSheet> {
  List<CodexModel>? _models;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadModels();
  }

  Future<void> _loadModels() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final raw = await bridge.cxListModels();
      final models = raw.map(CodexModel.fromJson).toList();
      if (!mounted) return;
      setState(() {
        _models = models;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.watch(chatSessionProvider);
    final current = chatState.cxModel ?? '';

    if (_loading) {
      return const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline_rounded, color: theme.error, size: 32),
            const SizedBox(height: 8),
            Text(
              'Failed to load models',
              style: TextStyle(color: theme.text, fontSize: 14),
            ),
            const SizedBox(height: 4),
            Text(
              _error!,
              style: TextStyle(color: theme.textMuted, fontSize: 12),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: _loadModels,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    final models = _models ?? [];
    if (models.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Center(
          child: Text(
            'No models available',
            style: TextStyle(color: theme.textMuted, fontSize: 13),
          ),
        ),
      );
    }

    final isUsingDefault = current.isEmpty;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Select the model used for Codex turns.',
            style: TextStyle(color: theme.textMuted, fontSize: 13),
          ),
          const SizedBox(height: 14),
          ...models.map((model) {
            final selected = isUsingDefault
                ? model.isDefault
                : (current == model.id || current == model.model);
            return ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                selected
                    ? Icons.radio_button_checked_rounded
                    : Icons.radio_button_off_rounded,
                size: 18,
                color: selected ? theme.primary : theme.textMuted,
              ),
              title: Row(
                children: [
                  Flexible(
                    child: Text(
                      model.displayName,
                      style: TextStyle(color: theme.text, fontSize: 13),
                    ),
                  ),
                  if (model.isDefault) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: theme.primary.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        'default',
                        style: TextStyle(
                          color: theme.primary,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              subtitle: model.description.isNotEmpty
                  ? Text(
                      model.description,
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
                    )
                  : null,
              onTap: () {
                ref.read(chatSessionProvider.notifier).setCodexModel(model.id);
                if (!mounted) return;
                Navigator.pop(context);
              },
            );
          }),
        ],
      ),
    );
  }
}
