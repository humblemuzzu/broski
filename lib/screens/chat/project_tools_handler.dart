import 'package:broski/models/project.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/widgets/project_tools_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the project tools sheet for the chat's working directory.
void showProjectToolsSheetAction({
  required BuildContext context,
  required WidgetRef ref,
  required String projectName,
  required String effectivePath,
}) {
  final project = ProjectSummary(
    id: '',
    name: projectName,
    path: effectivePath,
  );
  ref.read(selectionProvider.notifier).selectProject(project);
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => ProjectToolsSheet(project: project),
  );
}
