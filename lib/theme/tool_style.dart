import 'package:flutter/material.dart';
import 'opencode_theme.dart';

/// Tool type enumeration for consistent styling
enum ToolType {
  thinking, // AI reasoning, planning
  edit, // File modifications, patches
  read, // File reading, content retrieval
  write, // File creation
  bash, // Shell commands, terminal
  search, // File search, grep, glob
  todo, // Task management
  subtask, // Agent delegation
  unknown, // Fallback
}

/// Available icon packs for tool icons
enum IconPack {
  material, // Default Material icons (outlined)
  materialFilled, // Material icons (filled)
  minimal, // Simple, minimal icons
  rounded, // Rounded style icons
}

/// Icon pack metadata for settings UI
class IconPackInfo {
  const IconPackInfo({
    required this.id,
    required this.name,
    required this.description,
  });

  final IconPack id;
  final String name;
  final String description;
}

/// All available icon packs
const allIconPacks = [
  IconPackInfo(
    id: IconPack.material,
    name: 'Material Outlined',
    description: 'Clean outlined icons (default)',
  ),
  IconPackInfo(
    id: IconPack.materialFilled,
    name: 'Material Filled',
    description: 'Solid filled icons',
  ),
  IconPackInfo(
    id: IconPack.minimal,
    name: 'Minimal',
    description: 'Simple, lightweight icons',
  ),
  IconPackInfo(
    id: IconPack.rounded,
    name: 'Rounded',
    description: 'Soft rounded icons',
  ),
];

/// Configuration for tool card styling
class ToolStyleConfig {
  const ToolStyleConfig({
    required this.label,
    required this.colorGetter,
    required this.materialIcon,
    required this.materialFilledIcon,
    required this.minimalIcon,
    required this.roundedIcon,
  });

  /// Human-readable label
  final String label;

  /// Function to get color from theme
  final Color Function(OpenCodeTheme theme) colorGetter;

  /// Icons for each pack
  final IconData materialIcon;
  final IconData materialFilledIcon;
  final IconData minimalIcon;
  final IconData roundedIcon;

  /// Get icon for a specific pack
  IconData getIcon(IconPack pack) {
    switch (pack) {
      case IconPack.material:
        return materialIcon;
      case IconPack.materialFilled:
        return materialFilledIcon;
      case IconPack.minimal:
        return minimalIcon;
      case IconPack.rounded:
        return roundedIcon;
    }
  }
}

/// Helper class for consistent tool styling across the app
class ToolStyle {
  ToolStyle._();

  /// Get tool type from tool name string
  static ToolType getToolType(String toolName) {
    final name = toolName.toLowerCase();

    // Thinking/reasoning patterns
    if (name.contains('think') ||
        name.contains('reason') ||
        name.contains('plan')) {
      return ToolType.thinking;
    }

    // Edit/patch patterns
    if (name.contains('edit') ||
        name.contains('patch') ||
        name.contains('update') ||
        name.contains('modify')) {
      return ToolType.edit;
    }

    // Read patterns
    if (name.contains('read') ||
        name.contains('view') ||
        name.contains('cat') ||
        name.contains('head') ||
        name.contains('tail')) {
      return ToolType.read;
    }

    // Write/create patterns
    if (name.contains('write') ||
        name.contains('create') ||
        name.contains('new') ||
        name.contains('touch')) {
      return ToolType.write;
    }

    // Bash/shell patterns
    if (name.contains('bash') ||
        name.contains('shell') ||
        name.contains('exec') ||
        name.contains('run') ||
        name.contains('command') ||
        name.contains('terminal')) {
      return ToolType.bash;
    }

    // Search patterns
    if (name.contains('search') ||
        name.contains('find') ||
        name.contains('grep') ||
        name.contains('glob') ||
        name.contains('list') ||
        name.contains('ls')) {
      return ToolType.search;
    }

    // Subtask/agent patterns - check BEFORE todo patterns
    // "Task" tool (exact match) is used for subagent invocation
    if (name == 'task' ||
        name.contains('subtask') ||
        name.contains('delegate') ||
        name.contains('agent') ||
        name.contains('spawn')) {
      return ToolType.subtask;
    }

    // Todo patterns - but NOT "task" (which is subtask)
    if (name.contains('todo') || name.contains('plan')) {
      return ToolType.todo;
    }

    return ToolType.unknown;
  }

  /// Current icon pack (can be changed via settings)
  static IconPack _currentIconPack = IconPack.material;

  /// Get the current icon pack
  static IconPack get currentIconPack => _currentIconPack;

  /// Set the icon pack
  static void setIconPack(IconPack pack) {
    _currentIconPack = pack;
  }

  /// Get style configuration for a tool type
  static ToolStyleConfig getConfig(ToolType type) {
    switch (type) {
      case ToolType.thinking:
        return ToolStyleConfig(
          label: 'Thinking',
          colorGetter: (t) => t.toolThinking,
          materialIcon: Icons.psychology_outlined,
          materialFilledIcon: Icons.psychology,
          minimalIcon: Icons.lightbulb_outline,
          roundedIcon: Icons.psychology_rounded,
        );
      case ToolType.edit:
        return ToolStyleConfig(
          label: 'Edit',
          colorGetter: (t) => t.toolEdit,
          materialIcon: Icons.edit_outlined,
          materialFilledIcon: Icons.edit,
          minimalIcon: Icons.create_outlined,
          roundedIcon: Icons.edit_rounded,
        );
      case ToolType.read:
        return ToolStyleConfig(
          label: 'Read',
          colorGetter: (t) => t.toolRead,
          materialIcon: Icons.article_outlined,
          materialFilledIcon: Icons.article,
          minimalIcon: Icons.description_outlined,
          roundedIcon: Icons.article_rounded,
        );
      case ToolType.write:
        return ToolStyleConfig(
          label: 'Write',
          colorGetter: (t) => t.toolWrite,
          materialIcon: Icons.add_box_outlined,
          materialFilledIcon: Icons.add_box,
          minimalIcon: Icons.note_add_outlined,
          roundedIcon: Icons.add_box_rounded,
        );
      case ToolType.bash:
        return ToolStyleConfig(
          label: 'Command',
          colorGetter: (t) => t.toolBash,
          materialIcon: Icons.terminal_outlined,
          materialFilledIcon: Icons.terminal,
          minimalIcon: Icons.code_outlined,
          roundedIcon: Icons.terminal_rounded,
        );
      case ToolType.search:
        return ToolStyleConfig(
          label: 'Search',
          colorGetter: (t) => t.toolSearch,
          materialIcon: Icons.search_outlined,
          materialFilledIcon: Icons.search,
          minimalIcon: Icons.manage_search_outlined,
          roundedIcon: Icons.search_rounded,
        );
      case ToolType.todo:
        return ToolStyleConfig(
          label: 'Todo',
          colorGetter: (t) => t.toolTodo,
          materialIcon: Icons.checklist_outlined,
          materialFilledIcon: Icons.checklist,
          minimalIcon: Icons.task_alt_outlined,
          roundedIcon: Icons.checklist_rounded,
        );
      case ToolType.subtask:
        return ToolStyleConfig(
          label: 'Subtask',
          colorGetter: (t) => t.toolSubtask,
          materialIcon: Icons.account_tree_outlined,
          materialFilledIcon: Icons.account_tree,
          minimalIcon: Icons.share_outlined,
          roundedIcon: Icons.account_tree_rounded,
        );
      case ToolType.unknown:
        return ToolStyleConfig(
          label: 'Tool',
          colorGetter: (t) => t.textMuted,
          materialIcon: Icons.build_outlined,
          materialFilledIcon: Icons.build,
          minimalIcon: Icons.settings_outlined,
          roundedIcon: Icons.build_rounded,
        );
    }
  }

  /// Get the accent color for a tool name
  static Color getColor(BuildContext context, String toolName) {
    final theme = OpenCodeTheme.of(context);
    final type = getToolType(toolName);
    return getConfig(type).colorGetter(theme);
  }

  /// Get the icon for a tool name (uses current icon pack)
  static IconData getIcon(String toolName, [IconPack? pack]) {
    final type = getToolType(toolName);
    return getConfig(type).getIcon(pack ?? _currentIconPack);
  }

  /// Get icon for a specific tool type and pack
  static IconData getIconForType(ToolType type, [IconPack? pack]) {
    return getConfig(type).getIcon(pack ?? _currentIconPack);
  }

  /// Get the label for a tool name
  static String getLabel(String toolName) {
    final type = getToolType(toolName);
    return getConfig(type).label;
  }

  /// Get a styled container decoration for a tool card
  static BoxDecoration getCardDecoration(
    BuildContext context,
    String toolName, {
    bool isExpanded = false,
    bool isRunning = false,
    bool hasError = false,
  }) {
    final theme = OpenCodeTheme.of(context);
    final color = getColor(context, toolName);

    // Use subtle background with accent color for border
    final borderColor = hasError
        ? theme.error.withValues(alpha: 0.6)
        : isRunning
        ? color.withValues(alpha: 0.8)
        : color.withValues(alpha: 0.4);

    return BoxDecoration(
      color: isExpanded ? theme.bgActive : theme.bgRaised,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: borderColor, width: isRunning ? 1.5 : 1.0),
    );
  }

  /// Get a styled icon widget for a tool
  static Widget getIconWidget(
    BuildContext context,
    String toolName, {
    double size = 18,
    bool isRunning = false,
    bool hasError = false,
  }) {
    final theme = OpenCodeTheme.of(context);
    final color = getColor(context, toolName);
    final icon = getIcon(toolName);

    final iconColor = hasError
        ? theme.error
        : isRunning
        ? color
        : color.withValues(alpha: 0.8);

    Widget iconWidget = Icon(icon, size: size, color: iconColor);

    // Add subtle glow for running state
    if (isRunning) {
      return Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: color.withValues(alpha: 0.3),
              blurRadius: 8,
              spreadRadius: 1,
            ),
          ],
        ),
        child: iconWidget,
      );
    }

    return iconWidget;
  }

  /// Get a status indicator for tool state
  static Widget getStatusIndicator(
    BuildContext context, {
    required bool isRunning,
    required bool isComplete,
    required bool hasError,
    double size = 8,
  }) {
    final theme = OpenCodeTheme.of(context);

    Color color;
    if (hasError) {
      color = theme.error;
    } else if (isRunning) {
      color = theme.info;
    } else if (isComplete) {
      color = theme.success;
    } else {
      color = theme.textMuted;
    }

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: isRunning
            ? [
                BoxShadow(
                  color: color.withValues(alpha: 0.5),
                  blurRadius: 4,
                  spreadRadius: 1,
                ),
              ]
            : null,
      ),
    );
  }
}
