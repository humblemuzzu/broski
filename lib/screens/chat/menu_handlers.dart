import 'package:broski/screens/sheets/cc_hooks_sheet.dart';
import 'package:broski/screens/sheets/cc_quick_settings_sheet.dart';
import 'package:broski/screens/sheets/cc_skills_sheet.dart';
import 'package:flutter/material.dart';

/// Handles Claude Code overflow menu actions.
/// Extracted from chat_screen.dart `_handleClaudeCodeMenuAction`.
void handleClaudeCodeMenuAction(
  BuildContext context,
  String value, {
  required VoidCallback onStop,
  required VoidCallback onShowProjectTools,
  required VoidCallback onShowModel,
  required VoidCallback onShowTools,
  required VoidCallback onShowCommands,
  required VoidCallback onShowMcp,
  required VoidCallback onFork,
}) {
  switch (value) {
    case 'stop':
      onStop();
    case 'project_tools':
      onShowProjectTools();
    case 'cc_model':
      onShowModel();
    case 'cc_tools':
      onShowTools();
    case 'cc_commands':
      onShowCommands();
    case 'cc_skills':
      showCcSkillsSheet(context);
    case 'cc_hooks':
      showCcHooksSheet(context);
    case 'cc_mcp':
      onShowMcp();
    case 'cc_fork':
      onFork();
    case 'cc_quick_settings':
      showCCQuickSettingsSheet(context);
  }
}
