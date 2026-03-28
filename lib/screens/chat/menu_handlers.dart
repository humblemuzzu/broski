import 'package:broski/screens/sheets/cc_hooks_sheet.dart';
import 'package:broski/screens/sheets/cc_skills_sheet.dart';
import 'package:broski/screens/sheets/cx_apps_sheet.dart';
import 'package:broski/screens/sheets/cx_auth_sheet.dart';
import 'package:broski/screens/sheets/cx_config_sheet.dart';
import 'package:broski/screens/sheets/cx_feedback_sheet.dart';
import 'package:broski/screens/sheets/cx_mcp_sheet.dart';
import 'package:broski/screens/sheets/cx_model_sheet.dart';
import 'package:broski/screens/sheets/cx_remote_skills_sheet.dart';
import 'package:broski/screens/sheets/cx_settings_sheet.dart';
import 'package:broski/screens/sheets/pi_model_sheet.dart';
import 'package:broski/screens/sheets/pi_skills_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
  }
}

/// Handles Codex overflow menu actions.
/// Extracted from chat_screen.dart `_handleCodexMenuAction`.
void handleCodexMenuAction(
  BuildContext context,
  WidgetRef ref,
  String value, {
  required VoidCallback onStop,
  required VoidCallback onShowProjectTools,
  required VoidCallback onShowSkills,
  required VoidCallback onShowAgents,
  required VoidCallback onStartReview,
}) {
  switch (value) {
    case 'stop':
      onStop();
    case 'project_tools':
      onShowProjectTools();
    case 'cx_model':
      CxModelSheet.show(context);
    case 'cx_settings':
      showCodexSettingsSheet(context);
    case 'cx_skills':
      onShowSkills();
    case 'cx_mcp':
      showCodexMcpSheet(context, ref);
    case 'cx_auth':
      showCodexAuthSheet(context, ref);
    case 'cx_agents':
      onShowAgents();
    case 'cx_config':
      showCodexConfigSheet(context, ref);
    case 'cx_review':
      onStartReview();
    case 'cx_feedback':
      showCodexFeedbackSheet(context, ref);
    case 'cx_apps':
      CxAppsSheet.show(context);
    case 'cx_remote_skills':
      CxRemoteSkillsSheet.show(context);
  }
}

/// Handles Pi overflow menu actions.
/// Extracted from chat_screen.dart `_handlePiMenuAction`.
void handlePiMenuAction(
  BuildContext context,
  String value, {
  required VoidCallback onStop,
  required VoidCallback onCycleThinking,
  required VoidCallback onShowSidebar,
  required VoidCallback onCompact,
  required VoidCallback onNewSession,
}) {
  switch (value) {
    case 'stop':
      onStop();
    case 'pi_model':
      showPiModelSheet(context);
    case 'pi_thinking':
      onCycleThinking();
    case 'pi_skills':
      showPiSkillsSheet(context);
    case 'pi_sidebar':
      onShowSidebar();
    case 'pi_compact':
      onCompact();
    case 'pi_new_session':
      onNewSession();
  }
}
