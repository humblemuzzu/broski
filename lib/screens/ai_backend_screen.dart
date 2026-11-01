import 'package:broski/models/agent_type.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/ai_backend/backend_option_card.dart';
import 'package:broski/screens/ai_backend/contract_backend_options.dart';
import 'package:broski/screens/ai_backend/selected_backend_label.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Screen for selecting the AI backend.
class AIBackendScreen extends ConsumerWidget {
  const AIBackendScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final selected = ref.watch(selectedBackendProvider);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'AI Backend',
          style: TextStyle(
            color: theme.colorScheme.onSurface,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        leading: IconButton(
          icon: Icon(AppIcons.back, color: theme.colorScheme.onSurface),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: ListView(
          padding: Insets.screenAll,
          children: [
            Container(
              padding: Insets.card,
              decoration: BoxDecoration(
                color: ocTheme.backgroundPanel,
                borderRadius: Radii.brMd,
                border: Border.all(color: ocTheme.borderSubtle),
              ),
              child: Text(
                'Choose your default AI backend. You can switch anytime.',
                style: TextStyle(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.75),
                  fontSize: 13,
                  height: 1.35,
                ),
              ),
            ),
            const SizedBox(height: Spacing.xl),
            for (final type in AgentType.values) ...[
              BackendOptionCard(
                title: type.displayName,
                subtitle: type.description,
                icon: _BackendLogo(agentType: type),
                isSelected: selected == LegacySelection(type),
                onTap: () => _selectAgent(ref, type),
              ),
              const SizedBox(height: Spacing.lg),
            ],
            const ContractBackendOptions(),
            const SizedBox(height: Spacing.xl),
            Container(
              padding: Insets.card,
              decoration: BoxDecoration(
                color: theme.colorScheme.primary.withValues(alpha: 0.1),
                borderRadius: Radii.brMd,
                border: Border.all(
                  color: theme.colorScheme.primary.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    AppIcons.checkCircle,
                    color: theme.colorScheme.primary,
                    size: 20,
                  ),
                  const SizedBox(width: Spacing.md),
                  Text(
                    'Current: ',
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                      fontSize: 14,
                    ),
                  ),
                  Text(
                    selected.displayName,
                    style: TextStyle(
                      color: theme.colorScheme.primary,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 100),
          ],
        ),
      ),
    );
  }

  void _selectAgent(WidgetRef ref, AgentType type) {
    ref.read(selectedBackendProvider.notifier).select(LegacySelection(type));
    final bridge = ref.read(bridgeServiceProvider);
    bridge.setAgent(type);
  }
}

class _BackendLogo extends StatelessWidget {
  const _BackendLogo({required this.agentType});

  final AgentType agentType;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: Radii.brMd,
      child: Image.asset(
        'docs/assets/claude-code.png',
        width: 50,
        height: 50,
        fit: BoxFit.cover,
      ),
    );
  }
}
