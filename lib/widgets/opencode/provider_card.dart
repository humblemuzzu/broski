import 'package:flutter/material.dart';

import '../../models/provider.dart';
import '../../providers/opencode_providers_provider.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

/// A card displaying a single provider with expandable model list.
class ProviderCard extends StatelessWidget {
  final OcProviderDisplay provider;
  final bool expanded;
  final VoidCallback onToggleExpand;
  final VoidCallback onSetApiKey;
  final VoidCallback onRemoveAuth;
  final void Function(int methodIndex) onOAuth;

  const ProviderCard({
    super.key,
    required this.provider,
    required this.expanded,
    required this.onToggleExpand,
    required this.onSetApiKey,
    required this.onRemoveAuth,
    required this.onOAuth,
  });

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final d = provider.details;

    return Card(
      color: oc.backgroundElement,
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: Radii.brMd,
        side: BorderSide(
          color: provider.isConnected
              ? oc.success.withValues(alpha: 0.4)
              : oc.border,
        ),
      ),
      child: Column(
        children: [
          ListTile(
            onTap: onToggleExpand,
            leading: Icon(
              provider.isConnected
                  ? Icons.check_circle
                  : Icons.circle_outlined,
              color: provider.isConnected ? oc.success : oc.textMuted,
              size: 20,
            ),
            title: Text(
              d.name,
              style: TextStyle(color: oc.text, fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              '${d.modelCount} model${d.modelCount == 1 ? '' : 's'}',
              style: AppTypography.label(color: oc.textMuted),
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (provider.hasApiKeyMethod)
                  _SmallButton(
                    label: 'API Key',
                    icon: Icons.key,
                    color: oc.primary,
                    onTap: onSetApiKey,
                  ),
                for (var i = 0; i < provider.authMethods.length; i++)
                  if (provider.authMethods[i].isOAuth)
                    Padding(
                      padding: const EdgeInsets.only(left: 4),
                      child: _SmallButton(
                        label: 'OAuth',
                        icon: Icons.launch,
                        color: oc.accent,
                        onTap: () => onOAuth(i),
                      ),
                    ),
                if (provider.isConnected)
                  Padding(
                    padding: const EdgeInsets.only(left: 4),
                    child: _SmallButton(
                      label: 'Remove',
                      icon: Icons.delete_outline,
                      color: oc.error,
                      onTap: onRemoveAuth,
                    ),
                  ),
                const SizedBox(width: 4),
                Icon(
                  expanded ? Icons.expand_less : Icons.expand_more,
                  color: oc.textMuted,
                  size: 20,
                ),
              ],
            ),
          ),
          if (expanded) _ModelList(models: d.models),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model List
// ─────────────────────────────────────────────────────────────────────────────

class _ModelList extends StatelessWidget {
  final Map<String, ModelInfo> models;
  const _ModelList({required this.models});

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    if (models.isEmpty) {
      return Padding(
        padding: Insets.card,
        child: Text('No models', style: TextStyle(color: oc.textMuted)),
      );
    }
    final sorted = models.values.toList()
      ..sort((a, b) => a.name.compareTo(b.name));

    return Container(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: oc.borderSubtle)),
      ),
      child: Column(
        children: [for (final m in sorted) _ModelTile(model: m)],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Tile
// ─────────────────────────────────────────────────────────────────────────────

class _ModelTile extends StatelessWidget {
  final ModelInfo model;
  const _ModelTile({required this.model});

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            margin: const EdgeInsets.only(right: 10),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _statusColor(oc),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  model.name,
                  style: TextStyle(
                    color: model.isDeprecated ? oc.textMuted : oc.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    decoration:
                        model.isDeprecated ? TextDecoration.lineThrough : null,
                  ),
                ),
                if (_subtitle.isNotEmpty)
                  Text(
                    _subtitle,
                    style: AppTypography.label(color: oc.textMuted),
                  ),
              ],
            ),
          ),
          if (model.reasoning)
            _capIcon(Icons.psychology, oc.accent, 'Reasoning'),
          if (model.toolCall)
            _capIcon(Icons.build_outlined, oc.info, 'Tools'),
          if (model.supportsImages)
            _capIcon(Icons.image_outlined, oc.secondary, 'Vision'),
          if (model.contextWindow != null)
            Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Text(
                model.displayContextWindow,
                style: AppTypography.label(color: oc.textMuted),
              ),
            ),
        ],
      ),
    );
  }

  Color _statusColor(OpenCodeTheme oc) {
    if (model.isDeprecated) return oc.warning;
    if (model.isBeta || model.isAlpha) return oc.info;
    return oc.success;
  }

  String get _subtitle {
    final parts = <String>[];
    if (model.status != null && model.status != 'active') {
      parts.add(model.status!);
    }
    if (model.inputPricing != null) {
      parts.add('\$${model.inputPricing!.toStringAsFixed(2)}/1M in');
    }
    return parts.join(' · ');
  }

  Widget _capIcon(IconData icon, Color color, String tooltip) {
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Tooltip(
        message: tooltip,
        child: Icon(icon, size: 14, color: color),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small Action Button
// ─────────────────────────────────────────────────────────────────────────────

class _SmallButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  const _SmallButton({
    required this.label,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brSm,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
