import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:flutter/material.dart';

/// How an operation presents itself where the app lists it: the icon of its
/// row and the line under its name.
typedef PanelLook = ({IconData icon, String blurb});

/// One look for every kind the contract defines, so a new kind does not
/// compile until it has one.
PanelLook panelLook(BackendOpKind kind) => switch (kind) {
  BackendOpKind.rewindFiles => (
    icon: AppIcons.undo,
    blurb: 'Put the files back as they were here',
  ),
  BackendOpKind.navigateTree => (
    icon: AppIcons.callSplit,
    blurb: 'Go on from this point',
  ),
  BackendOpKind.readTree => (
    icon: AppIcons.gitBranch,
    blurb: 'The conversation as a tree',
  ),
  BackendOpKind.labelEntry => (
    icon: AppIcons.star,
    blurb: 'Name this point of the conversation',
  ),
  BackendOpKind.abortBranchSummary => (
    icon: AppIcons.cancel,
    blurb: 'Stop the summary of what is left',
  ),
  BackendOpKind.runShell => (
    icon: AppIcons.terminal,
    blurb: 'Run a command on the Mac',
  ),
  BackendOpKind.takeOver => (
    icon: AppIcons.phone,
    blurb: 'Run this session from your phone',
  ),
  BackendOpKind.sessionSettings => (
    icon: AppIcons.tune,
    blurb: 'What this session does on its own',
  ),
  BackendOpKind.sessionTools => (
    icon: AppIcons.tools,
    blurb: 'The tools this session may use',
  ),
  BackendOpKind.systemPrompt => (
    icon: AppIcons.menuBook,
    blurb: 'The instructions this session runs with',
  ),
  BackendOpKind.exportSession => (
    icon: AppIcons.share,
    blurb: 'Write it aside and send it here',
  ),
  BackendOpKind.exportPart => (
    icon: AppIcons.download,
    blurb: 'The rest of an export',
  ),
  BackendOpKind.importSession => (
    icon: AppIcons.upload,
    blurb: 'Read one in from this phone',
  ),
  BackendOpKind.changedFiles => (
    icon: AppIcons.diff,
    blurb: 'What this session changed',
  ),
  BackendOpKind.refreshModels => (
    icon: AppIcons.refresh,
    blurb: 'Read the model lists again',
  ),
  BackendOpKind.configFiles => (
    icon: AppIcons.fileCode,
    blurb: 'The files that configure this project',
  ),
  BackendOpKind.configFile => (
    icon: AppIcons.fileText,
    blurb: 'One configuration file',
  ),
  BackendOpKind.settingsOverview => (
    icon: AppIcons.dashboard,
    blurb: 'The settings in effect here',
  ),
  BackendOpKind.mcpServers => (
    icon: AppIcons.hub,
    blurb: 'The servers that give it tools',
  ),
  BackendOpKind.plugins => (
    icon: AppIcons.extension_,
    blurb: 'What this project loads',
  ),
  BackendOpKind.tasks => (
    icon: AppIcons.loop,
    blurb: 'What runs in the background',
  ),
  BackendOpKind.contextUsage => (
    icon: AppIcons.dataUsage,
    blurb: 'How full the context is',
  ),
  BackendOpKind.customTools => (
    icon: AppIcons.build,
    blurb: 'The tools the bridge itself serves',
  ),
  BackendOpKind.customTool => (
    icon: AppIcons.handyman,
    blurb: 'One of those tools',
  ),
};
