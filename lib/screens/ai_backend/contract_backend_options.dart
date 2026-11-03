import 'package:broski/agent/agent_providers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/screens/agent/backend_label.dart';
import 'package:broski/screens/ai_backend/backend_option_card.dart';
import 'package:broski/screens/ai_backend/selected_backend_label.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// The backends of the bridge's contract, listed from what the bridge serves
/// (or last served), and the one selected even while the bridge cannot be
/// asked. One that goes by an old agent's name is listed too, beside it,
/// only while the bridge serves it (the bridge's `claudeCode.contract`).
final contractBackendChoicesProvider = Provider<List<BackendId>>((ref) {
  final selected = ref.watch(selectedBackendProvider);
  final listed = [
    for (final backend in ref.watch(backendsProvider).backends) backend.id,
  ];
  final held = selected is ContractSelection && !listed.contains(selected.id)
      ? [selected.id]
      : const <BackendId>[];
  return [...listed, ...held];
});

class ContractBackendOptions extends ConsumerWidget {
  const ContractBackendOptions({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(selectedBackendProvider);
    final statuses = ref.watch(backendsProvider).statuses;
    return Column(
      children: [
        for (final id in ref.watch(contractBackendChoicesProvider)) ...[
          BackendOptionCard(
            key: ValueKey('backend-option:${id.wire}'),
            title: ContractSelection(id).displayName,
            subtitle: _subtitle(id, statuses[id]),
            icon: _ContractBackendLogo(backend: id),
            isSelected: selected == ContractSelection(id),
            onTap: () => ref
                .read(selectedBackendProvider.notifier)
                .select(ContractSelection(id)),
          ),
          const SizedBox(height: Spacing.lg),
        ],
      ],
    );
  }

  String _subtitle(BackendId id, BackendStatus? status) {
    final issue = status == null || status.usable
        ? null
        : status.issues.firstOrNull;
    return issue?.message ?? backendBlurb(id);
  }
}

class _ContractBackendLogo extends StatelessWidget {
  const _ContractBackendLogo({required this.backend});

  final BackendId backend;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final asset = backendLogoAsset(backend);
    return Container(
      width: 50,
      height: 50,
      decoration: BoxDecoration(
        color: const Color(0xFF1a1a2e),
        borderRadius: Radii.brMd,
      ),
      padding: Insets.cardXs,
      child: asset == null
          ? Icon(AppIcons.agent, color: theme.text)
          : SvgPicture.asset(asset, fit: BoxFit.contain),
    );
  }
}
