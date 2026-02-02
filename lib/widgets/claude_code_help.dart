import 'package:flutter/material.dart';

import '../theme/opencode_theme.dart';
import 'chat/detail_sheet.dart';

enum ClaudeCodeHelpTopic { toolsOverview, subagents, customTools, plugins }

void showClaudeCodeHelpSheet(
  BuildContext context, {
  required ClaudeCodeHelpTopic topic,
}) {
  final theme = OpenCodeTheme.of(context);

  String title;
  List<Widget> body;

  switch (topic) {
    case ClaudeCodeHelpTopic.toolsOverview:
      title = 'Claude Code power features';
      body = [
        _p(
          theme,
          'Subagents: specialized helpers Claude can delegate to (via the Task tool).',
        ),
        _p(
          theme,
          'Custom tools: your own MCP tools (HTTP or scripts) exposed as `mcp__broski-custom-tools__<name>`.',
        ),
        _p(
          theme,
          'Plugins: Claude Code plugins that add commands, skills, hooks, and MCP servers.',
        ),
        const SizedBox(height: 8),
        _p(theme, 'Quick access:'),
        _bullet(theme, 'Type `@tool:` to insert a custom tool name'),
        _bullet(theme, 'Type `/` to browse available slash commands'),
      ];
      break;
    case ClaudeCodeHelpTopic.subagents:
      title = 'Subagents';
      body = [
        _p(
          theme,
          'Subagents are specialized agents Claude can invoke via the Task tool for focused subtasks.',
        ),
        _bullet(theme, 'Create/edit subagents in this screen'),
        _bullet(
          theme,
          'Select an active subagent from Chat → menu → Claude Code → Tools → Subagents',
        ),
        const SizedBox(height: 8),
        _p(
          theme,
          'Tip: use clear descriptions like “Use for frontend UI polish” so Claude routes tasks correctly.',
        ),
      ];
      break;
    case ClaudeCodeHelpTopic.customTools:
      title = 'Custom tools';
      body = [
        _p(
          theme,
          'Custom tools are MCP tools Claude Code can call while solving your request.',
        ),
        _bullet(theme, 'Create a tool (HTTP or script) and enable it'),
        _bullet(
          theme,
          'In chat, type `@tool:` to insert a tool name into your prompt',
        ),
        _bullet(
          theme,
          'Tool names look like `mcp__broski-custom-tools__<ToolName>`',
        ),
        const SizedBox(height: 8),
        _p(
          theme,
          'Example prompt: “Use `mcp__broski-custom-tools__jiraSearch` to find relevant tickets.”',
        ),
      ];
      break;
    case ClaudeCodeHelpTopic.plugins:
      title = 'Plugins';
      body = [
        _p(
          theme,
          'Plugins add Claude Code commands/skills/hooks. They’re discovered from `~/.claude/plugins/` and any custom paths you add here.',
        ),
        _bullet(
          theme,
          'Add a plugin path (must contain `.claude-plugin/plugin.json`)',
        ),
        _bullet(theme, 'Enable/disable plugins, then Reload to refresh'),
        _bullet(theme, 'Use `/` in chat to access plugin slash commands'),
      ];
      break;
  }

  DetailSheet.show(
    context: context,
    title: title,
    initialSize: 0.7,
    child: Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
      child: DefaultTextStyle(
        style: TextStyle(color: theme.text, fontSize: 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: body,
        ),
      ),
    ),
  );
}

Widget _p(OpenCodeTheme theme, String text) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Text(text, style: TextStyle(color: theme.textMuted, height: 1.35)),
  );
}

Widget _bullet(OpenCodeTheme theme, String text) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Container(
            width: 4,
            height: 4,
            decoration: BoxDecoration(
              color: theme.textMuted,
              shape: BoxShape.circle,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: TextStyle(color: theme.textMuted, height: 1.35),
          ),
        ),
      ],
    ),
  );
}
