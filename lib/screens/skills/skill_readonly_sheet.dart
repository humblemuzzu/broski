import 'package:broski/models/skill.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Read-only preview of a skill the bridge cannot read back through a
/// get-skill op; the body is read straight from [Skill.path].
Future<void> showSkillReadonlySheet({
  required BuildContext context,
  required WidgetRef ref,
  required Skill skill,
}) async {
  final content =
      _orNull(skill.content) ?? await _readSkillMarkdown(ref, skill.path);
  if (!context.mounted) return;
  final oc = OpenCodeTheme.of(context);
  final description = _orNull(skill.description);
  DetailSheet.show(
    context: context,
    title: skill.name,
    initialSize: 0.5,
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (description != null)
            Text(description, style: TextStyle(color: oc.text, fontSize: 14)),
          if (content != null) ...[
            const SizedBox(height: Spacing.md),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: oc.backgroundElement,
                borderRadius: Radii.brMd,
                border: Border.all(color: oc.border),
              ),
              child: Text(
                content,
                style: AppTypography.codeSmall(color: oc.text),
              ),
            ),
          ],
          const SizedBox(height: Spacing.md),
          Text(
            'Source: ${_sourceLabel(skill)}',
            style: TextStyle(color: oc.textMuted, fontSize: 13),
          ),
          if (skill.path.isNotEmpty) ...[
            const SizedBox(height: Spacing.xs),
            Text(
              'Path: ${skill.path}',
              style: TextStyle(color: oc.textMuted, fontSize: 13),
            ),
          ],
        ],
      ),
    ),
  );
}

String _sourceLabel(Skill skill) {
  if (skill.source == SkillSource.builtin) return 'OpenCode SDK';
  final piSource = skill.extra?['piSource'] as String?;
  if (piSource != null && piSource.isNotEmpty) return piSource;
  return skill.source.displayName;
}

Future<String?> _readSkillMarkdown(WidgetRef ref, String path) async {
  if (path.isEmpty) return null;
  try {
    final file = await ref.read(bridgeServiceProvider).readFile(path);
    return _orNull(file.content);
  } catch (_) {
    return null;
  }
}

String? _orNull(String? value) {
  final trimmed = value?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}
