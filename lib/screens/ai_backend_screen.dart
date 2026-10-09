import 'package:broski/models/agent_type.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/pi_durable/pi_durable_flag_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/pi_branding.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Screen for selecting the AI backend, plus the Experimental toggle that gates
/// backends which are not ready to be visible by default.
class AIBackendScreen extends ConsumerWidget {
  const AIBackendScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final currentAgent = ref.watch(agentTypeProvider);
    final piDurableEnabled = ref.watch(piDurableEnabledProvider);
    final backends = visibleAgentTypes(piDurableEnabled: piDurableEnabled);

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
            for (final type in backends) ...[
              _BackendOptionCard(
                title: type.displayName,
                subtitle: type.description,
                icon: _BackendLogo(agentType: type),
                isSelected: currentAgent == type,
                onTap: () => _selectAgent(ref, type),
              ),
              const SizedBox(height: Spacing.lg),
            ],
            const SizedBox(height: Spacing.sm),
            _ExperimentalToggle(
              enabled: piDurableEnabled,
              onChanged: (value) =>
                  ref.read(piDurableEnabledProvider.notifier).setEnabled(value),
            ),
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
                    currentAgent.displayName,
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
    ref.read(agentTypeProvider.notifier).setAgentType(type);
    final bridge = ref.read(bridgeServiceProvider);
    bridge.setAgent(type);
  }
}

class _BackendOptionCard extends StatelessWidget {
  const _BackendOptionCard({
    required this.title,
    required this.icon,
    required this.isSelected,
    required this.onTap,
    this.subtitle,
  });

  final String title;
  final String? subtitle;
  final Widget icon;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);

    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brLg,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        padding: Insets.screenAll,
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brLg,
          border: Border.all(
            color: isSelected
                ? theme.colorScheme.primary
                : ocTheme.borderSubtle,
            width: isSelected ? 1.8 : 1,
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: theme.colorScheme.primary.withValues(alpha: 0.14),
                    blurRadius: 16,
                    spreadRadius: 1,
                  ),
                ]
              : null,
        ),
        child: Row(
          children: [
            icon,
            const SizedBox(width: Spacing.lg),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface,
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle!,
                      style: TextStyle(
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.6,
                        ),
                        fontSize: 12,
                      ),
                    ),
                ],
              ),
            ),
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: isSelected
                      ? theme.colorScheme.primary
                      : theme.colorScheme.onSurface.withValues(alpha: 0.3),
                  width: 2,
                ),
                color: isSelected
                    ? theme.colorScheme.primary
                    : Colors.transparent,
              ),
              child: isSelected
                  ? Icon(
                      AppIcons.check,
                      size: 16,
                      color: theme.colorScheme.onPrimary,
                    )
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

class _BackendLogo extends StatelessWidget {
  const _BackendLogo({required this.agentType});

  final AgentType agentType;

  @override
  Widget build(BuildContext context) {
    switch (agentType) {
      case AgentType.codex:
        return Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: Radii.brMd,
          ),
          padding: Insets.cardXs,
          child: Image.asset('docs/assets/codex-icon.png', fit: BoxFit.contain),
        );
      case AgentType.opencode:
        return ClipRRect(
          borderRadius: Radii.brMd,
          child: Image.asset(
            'docs/assets/opencode-mark.png',
            width: 50,
            height: 50,
            fit: BoxFit.cover,
          ),
        );
      case AgentType.claudeCode:
        return ClipRRect(
          borderRadius: Radii.brMd,
          child: Image.asset(
            'docs/assets/claude-code.png',
            width: 50,
            height: 50,
            fit: BoxFit.cover,
          ),
        );
      case AgentType.pi:
        return Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: const Color(0xFF1a1a2e),
            borderRadius: Radii.brMd,
          ),
          padding: Insets.cardXs,
          child: SvgPicture.asset(
            'docs/assets/pi/pi-logo-dark.svg',
            fit: BoxFit.contain,
          ),
        );
      case AgentType.piDurable:
        return Stack(
          alignment: Alignment.center,
          children: [
            const PiBranding(width: 50, durable: true),
            Positioned(
              right: 0,
              top: 0,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primary,
                  borderRadius: Radii.brXs,
                ),
                child: Text(
                  'D',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onPrimary,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        );
    }
  }
}

/// Gates experimental backends. Off by default; turning it off also moves the
/// selection off a backend that is about to disappear.
class _ExperimentalToggle extends StatelessWidget {
  const _ExperimentalToggle({required this.enabled, required this.onChanged});

  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      padding: Insets.card,
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brMd,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(AppIcons.science, color: ocTheme.textMuted, size: 20),
          const SizedBox(width: Spacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Experimental',
                  style: TextStyle(
                    color: theme.colorScheme.onSurface,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  'Show backends that are still in development',
                  style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
                ),
              ],
            ),
          ),
          Switch(value: enabled, onChanged: onChanged),
        ],
      ),
    );
  }
}
