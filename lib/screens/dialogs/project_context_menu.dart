import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/ui/panels/panels_sheet.dart';
import 'package:broski/agent/ui/sessions/session_openers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows a context menu for a project: a highlight toggle and, for a contract
/// backend the bridge can be asked now, its latest session there and the
/// backend's operations on the directory (its configuration, the settings in
/// effect). Returns true if the project list should be refreshed.
Future<bool> showProjectContextMenu({
  required BuildContext context,
  required WidgetRef ref,
  required ProjectSummary project,
}) async {
  final oc = OpenCodeTheme.of(context);
  final backend = _contractBackend(ref);
  final panels = backend == null ? const [] : projectPanels(backend);
  final result = await showModalBottomSheet<String>(
    context: context,
    backgroundColor: oc.backgroundPanel,
    shape: const RoundedRectangleBorder(borderRadius: Radii.sheetTop),
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              project.name,
              style: TextStyle(
                color: oc.text,
                fontWeight: FontWeight.w600,
                fontSize: 16,
              ),
            ),
          ),
          if (backend != null)
            _tile(
              ctx,
              oc,
              key: 'project-continue-latest',
              icon: AppIcons.history,
              title: 'Continue latest session',
              subtitle: 'Open the session updated last in this project',
            ),
          if (panels.isNotEmpty)
            _tile(
              ctx,
              oc,
              key: 'project-panels',
              icon: AppIcons.settings,
              title: 'Project configuration',
              subtitle: 'Settings, config files and plugins for this project',
            ),
          _tile(
            ctx,
            oc,
            key: 'highlight',
            icon: AppIcons.star,
            title: 'Toggle Highlight',
            subtitle: 'Pin to top of project list',
          ),
          const SizedBox(height: Spacing.sm),
        ],
      ),
    ),
  );
  if (!context.mounted) return false;
  switch (result) {
    case 'highlight':
      ref.read(highlightsProvider.notifier).toggleProject(project.id);
    case 'project-continue-latest' when backend != null:
      await continueLatest(context, ref, backend.id, project.path);
    case 'project-panels' when backend != null:
      showProjectPanels(
        context,
        backend,
        cwd: project.path,
        name: project.name,
      );
  }
  return false;
}

/// The contract backend selected, as the bridge lists it now; null for an
/// old-protocol agent or while the bridge cannot be asked.
BackendDescriptor? _contractBackend(WidgetRef ref) {
  final selected = ref.read(selectedBackendProvider);
  if (selected is! ContractSelection || !ref.read(liveProvider)) return null;
  return ref
      .read(backendsProvider)
      .backends
      .where((listed) => listed.id == selected.id)
      .firstOrNull;
}

Widget _tile(
  BuildContext sheet,
  OpenCodeTheme oc, {
  required String key,
  required IconData icon,
  required String title,
  required String subtitle,
}) => ListTile(
  key: ValueKey(key),
  leading: Icon(icon, color: oc.textMuted),
  title: Text(title, style: TextStyle(color: oc.text)),
  subtitle: Text(subtitle, style: TextStyle(color: oc.textMuted, fontSize: 12)),
  onTap: () => Navigator.pop(sheet, key),
);
