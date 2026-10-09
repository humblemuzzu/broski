import 'package:broski/models/pi.dart';
import 'package:broski/models/pi_durable/pi_durable_session.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/runtime/runtime_model_summary.dart';
import 'package:broski/models/session.dart';
import 'package:broski/providers/pi_durable/pi_durable_providers.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Creates a durable session: project cwd, model and thinking level, then
/// `pd_create_session`. [onCreated] receives the project to select and the
/// session to open. [initialProject] preselects the project the user opened
/// from, so a tapped project does not have to be picked twice.
Future<void> showPiDurableNewSessionSheet({
  required BuildContext context,
  required void Function(ProjectSummary project, SessionSummary session)
  onCreated,
  ProjectSummary? initialProject,
}) {
  return DetailSheet.show(
    context: context,
    title: 'New Pi Durable Session',
    initialSize: 0.7,
    maxSize: 0.95,
    child: _NewSessionContent(
      onCreated: onCreated,
      initialProject: initialProject,
    ),
  );
}

class _NewSessionContent extends ConsumerStatefulWidget {
  const _NewSessionContent({required this.onCreated, this.initialProject});

  final void Function(ProjectSummary project, SessionSummary session) onCreated;
  final ProjectSummary? initialProject;

  @override
  ConsumerState<_NewSessionContent> createState() => _NewSessionContentState();
}

class _NewSessionContentState extends ConsumerState<_NewSessionContent> {
  late ProjectSummary? _project = widget.initialProject;
  RuntimeModelSummary? _model;
  PiThinkingLevel _thinkingLevel = PiThinkingLevel.medium;
  bool _creating = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    if (_project == null) {
      return _ProjectPicker(
        onSelected: (project) {
          setState(() => _project = project);
        },
      );
    }

    final models = ref.watch(piDurableModelsProvider);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(AppIcons.folder, size: 16, color: theme.textMuted),
              const SizedBox(width: Spacing.sm),
              Expanded(
                child: Text(
                  _project!.path,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: theme.text, fontSize: 13),
                ),
              ),
              TextButton(
                onPressed: _creating
                    ? null
                    : () => setState(() => _project = null),
                child: const Text('Change'),
              ),
            ],
          ),
          const SizedBox(height: Spacing.lg),
          Text(
            'Thinking level',
            style: TextStyle(
              color: theme.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: Spacing.sm),
          Wrap(
            spacing: Spacing.sm,
            runSpacing: Spacing.sm,
            children: [
              for (final level in PiThinkingLevel.values)
                _Chip(
                  label: level.displayName,
                  selected: level == _thinkingLevel,
                  onTap: () => setState(() => _thinkingLevel = level),
                ),
            ],
          ),
          const SizedBox(height: Spacing.xl),
          Text(
            'Model',
            style: TextStyle(
              color: theme.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: Spacing.sm),
          models.when(
            loading: () => const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (error, _) => Text(
              'Could not load models: ${humanizeError(error)}',
              style: TextStyle(color: theme.error, fontSize: 13),
            ),
            data: (list) => Column(
              children: [
                for (final model in list)
                  _Chip(
                    label: model.label.isEmpty ? model.id : model.label,
                    selected: model.id == _model?.id,
                    onTap: () => setState(() => _model = model),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Spacing.xxl),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _creating ? null : _create,
              child: Text(_creating ? 'Creating...' : 'Create session'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _create() async {
    final project = _project;
    if (project == null) return;
    setState(() => _creating = true);
    try {
      final created = await ref
          .read(bridgeServiceProvider)
          .pdCreateSession(
            cwd: project.path,
            provider: _model?.providerId,
            modelId: _model?.id,
            thinkingLevel: _thinkingLevel.wireValue,
            title: project.name,
          );
      if (!mounted) return;
      setState(() => _creating = false);
      if (created == null) {
        showError(context, 'The bridge did not create the session');
        return;
      }
      Navigator.of(context).pop();
      widget.onCreated(project, sessionSummaryOf(created));
    } catch (error) {
      if (!mounted) return;
      setState(() => _creating = false);
      showError(context, 'Could not create session: ${humanizeError(error)}');
    }
  }
}

class _ProjectPicker extends ConsumerWidget {
  const _ProjectPicker({required this.onSelected});

  final void Function(ProjectSummary project) onSelected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final projectsAsync = ref.watch(piDurableProjectsProvider);
    return projectsAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          'Could not list projects: ${humanizeError(error)}',
          style: TextStyle(color: theme.error, fontSize: 13),
        ),
      ),
      data: (projects) {
        if (projects.isEmpty) {
          return Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              children: [
                Icon(AppIcons.folderOff, size: 48, color: theme.textMuted),
                const SizedBox(height: Spacing.lg),
                Text(
                  'No projects found.\nOpen one from the Projects tab first.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: theme.textMuted, fontSize: 14),
                ),
              ],
            ),
          );
        }
        return ListView.builder(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          itemCount: projects.length,
          itemBuilder: (context, index) {
            final project = projects[index];
            return ListTile(
              leading: Icon(AppIcons.folder, color: theme.textMuted, size: 20),
              title: Text(
                project.name,
                style: TextStyle(color: theme.text, fontSize: 15),
              ),
              subtitle: Text(
                project.path,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: theme.textMuted, fontSize: 12),
              ),
              onTap: () => onSelected(project),
            );
          },
        );
      },
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: Insets.chip,
        decoration: BoxDecoration(
          color: selected
              ? theme.primary.withValues(alpha: 0.15)
              : theme.backgroundElement,
          borderRadius: Radii.brSm,
          border: Border.all(
            color: selected ? theme.primary : theme.borderSubtle,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? theme.primary : theme.text,
            fontSize: 13,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}
