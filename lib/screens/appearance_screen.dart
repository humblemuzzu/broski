import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../models/card_style.dart';
import '../providers/appearance_provider.dart';
import '../providers/card_style_provider.dart';
import '../theme/opencode_theme.dart';
import '../theme/tool_style.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';

class AppearanceScreen extends ConsumerWidget {
  const AppearanceScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final settings = ref.watch(appearanceProvider);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'Tool Cards',
          style: TextStyle(
            color: theme.colorScheme.onSurface,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        leading: IconButton(
          icon: Icon(AppIcons.back, color: theme.colorScheme.onSurface),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          TextButton(
            onPressed: () =>
                ref.read(appearanceProvider.notifier).resetToDefaults(),
            child: Text(
              'Reset',
              style: TextStyle(
                color: theme.colorScheme.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: ListView(
          padding: Insets.screenAll,
          children: [
            // Live Preview Section
            _SectionHeader(title: 'Preview'),
            SizedBox(height: Spacing.md),
            _ToolPreviewCard(settings: settings),
            SizedBox(height: Spacing.xxxl),
            // Icon Pack Section
            _SectionHeader(title: 'Icon Style'),
            SizedBox(height: Spacing.md),
            _IconPackSelector(settings: settings),
            SizedBox(height: Spacing.xxxl),
            // Tool Colors Toggle
            _SectionHeader(title: 'Colors'),
            SizedBox(height: Spacing.md),
            _SettingsCard(
              child: Column(
                children: [
                  _ToggleTile(
                    title: 'Tool Colors',
                    subtitle: 'Use unique colors for each tool type',
                    value: settings.useToolColors,
                    onChanged: (v) => ref
                        .read(appearanceProvider.notifier)
                        .setUseToolColors(v),
                  ),
                  _Divider(),
                  _ToggleTile(
                    title: 'Colored Borders',
                    subtitle: 'Show colored borders on tool cards',
                    value: settings.showToolBorders,
                    onChanged: (v) => ref
                        .read(appearanceProvider.notifier)
                        .setShowToolBorders(v),
                  ),
                ],
              ),
            ),
            SizedBox(height: Spacing.xxxl),
            // Card Style Section
            _SectionHeader(title: 'Card Style'),
            SizedBox(height: Spacing.md),
            _SettingsCard(
              child: Column(
                children: [
                  _SliderTile(
                    title: 'Corner Radius',
                    value: settings.cardBorderRadius,
                    min: 4,
                    max: 24,
                    divisions: 10,
                    onChanged: (v) => ref
                        .read(appearanceProvider.notifier)
                        .setCardBorderRadius(v),
                  ),
                  _Divider(),
                  _ToggleTile(
                    title: 'Compact Mode',
                    subtitle: 'Smaller cards and tighter spacing',
                    value: settings.compactMode,
                    onChanged: (v) =>
                        ref.read(appearanceProvider.notifier).setCompactMode(v),
                  ),
                ],
              ),
            ),
            SizedBox(height: Spacing.xxxl),
            // Card Header Section
            _SectionHeader(title: 'Card Headers'),
            SizedBox(height: Spacing.md),
            const _CardHeaderStyleSelector(),
            SizedBox(height: Spacing.xxxl),
            // Tool Color Reference
            _SectionHeader(title: 'Tool Color Reference'),
            SizedBox(height: Spacing.md),
            _ToolColorGrid(),
            const SizedBox(height: 100),
          ],
        ),
      ),
    );
  }
}

// Section header widget
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) {
    return Text(
      title.toUpperCase(),
      style: TextStyle(
        color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.5),
        fontSize: 12,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.5,
      ),
    );
  }
}

// Settings card container
class _SettingsCard extends StatelessWidget {
  const _SettingsCard({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: child,
    );
  }
}

// Live preview of all tool types
class _ToolPreviewCard extends StatelessWidget {
  const _ToolPreviewCard({required this.settings});
  final AppearanceSettings settings;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final theme = Theme.of(context);
    // Show a sample of tool types
    final previewTools = [
      ('thinking', 'Thinking...', true), // running
      ('edit', 'Editing file.dart', false), // completed
      ('bash', 'Running npm install', false),
      ('read', 'Reading config.json', false),
    ];
    return Container(
      padding: Insets.card,
      decoration: BoxDecoration(
        color: ocTheme.background,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Label
          Row(
            children: [
              Icon(
                AppIcons.visibility,
                size: 14,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
              ),
              const SizedBox(width: 6),
              Text(
                'Live Preview',
                style: TextStyle(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          SizedBox(height: Spacing.md),
          // Preview cards
          ...previewTools.map(
            (tool) => Padding(
              padding: Insets.bottomSm,
              child: _MiniToolCard(
                toolName: tool.$1,
                title: tool.$2,
                isRunning: tool.$3,
                settings: settings,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// Mini tool card for preview
class _MiniToolCard extends StatelessWidget {
  const _MiniToolCard({
    required this.toolName,
    required this.title,
    required this.isRunning,
    required this.settings,
  });
  final String toolName;
  final String title;
  final bool isRunning;
  final AppearanceSettings settings;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final theme = Theme.of(context);
    final toolColor = settings.useToolColors
        ? ToolStyle.getColor(context, toolName)
        : ocTheme.textMuted;
    final icon = ToolStyle.getIcon(toolName, settings.iconPack);
    return Container(
      padding: EdgeInsets.all(settings.compactMode ? 10 : 14),
      decoration: BoxDecoration(
        color: ocTheme.bgRaised,
        borderRadius: BorderRadius.circular(settings.cardBorderRadius),
        border: settings.showToolBorders
            ? Border.all(
                color: isRunning
                    ? toolColor.withValues(alpha: 0.8)
                    : toolColor.withValues(alpha: 0.4),
                width: isRunning ? 1.5 : 1.0,
              )
            : Border.all(color: ocTheme.borderSubtle),
      ),
      child: Row(
        children: [
          // Icon with optional glow
          Container(
            decoration: isRunning
                ? BoxDecoration(
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: toolColor.withValues(alpha: 0.3),
                        blurRadius: 8,
                        spreadRadius: 1,
                      ),
                    ],
                  )
                : null,
            child: Icon(
              icon,
              size: settings.compactMode ? 16 : 18,
              color: toolColor,
            ),
          ),
          SizedBox(width: settings.compactMode ? 8 : 12),
          Expanded(
            child: Text(
              title,
              style: TextStyle(
                color: theme.colorScheme.onSurface,
                fontSize: settings.compactMode ? 13 : 14,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          // Status indicator
          if (isRunning)
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor: AlwaysStoppedAnimation(toolColor),
              ),
            )
          else
            Icon(AppIcons.checkCircle, size: 16, color: ocTheme.success),
        ],
      ),
    );
  }
}

// Icon pack selector — lets users choose between 3 Lucide icon sets
class _IconPackSelector extends StatelessWidget {
  const _IconPackSelector({required this.settings});
  final AppearanceSettings settings;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Column(
        children: allIconPacks.asMap().entries.map((entry) {
          final index = entry.key;
          final pack = entry.value;
          final isSelected = settings.iconPack == pack.id;
          return Column(
            children: [
              if (index > 0) _Divider(),
              _IconPackTile(pack: pack, isSelected: isSelected),
            ],
          );
        }).toList(),
      ),
    );
  }
}

// Icon pack tile with preview icons
class _IconPackTile extends ConsumerWidget {
  const _IconPackTile({required this.pack, required this.isSelected});
  final IconPackInfo pack;
  final bool isSelected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    // Sample tool types to preview
    final sampleTypes = [
      ToolType.thinking,
      ToolType.edit,
      ToolType.bash,
      ToolType.search,
    ];
    return InkWell(
      onTap: () => ref.read(appearanceProvider.notifier).setIconPack(pack.id),
      borderRadius: Radii.brLg,
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Radio<IconPack>(
              value: pack.id,
              // ignore: deprecated_member_use
              groupValue: isSelected ? pack.id : null,
              // ignore: deprecated_member_use
              onChanged: (v) {
                if (v != null) {
                  ref.read(appearanceProvider.notifier).setIconPack(v);
                }
              },
            ),
            SizedBox(width: Spacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    pack.name,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  SizedBox(height: Spacing.xxs),
                  Text(
                    pack.description,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            // Icon preview row
            Row(
              mainAxisSize: MainAxisSize.min,
              children: sampleTypes.map((type) {
                final config = ToolStyle.getConfig(type);
                final color = config.colorGetter(ocTheme);
                return Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Icon(
                    config.getIcon(pack.id),
                    size: 18,
                    color: isSelected ? color : color.withValues(alpha: 0.5),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }
}

// Toggle tile widget
class _ToggleTile extends StatelessWidget {
  const _ToggleTile({
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: () => onChanged(!value),
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  SizedBox(height: Spacing.xs),
                  Text(
                    subtitle,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            Switch.adaptive(value: value, onChanged: onChanged),
          ],
        ),
      ),
    );
  }
}

// Slider tile widget
class _SliderTile extends StatelessWidget {
  const _SliderTile({
    required this.title,
    required this.value,
    required this.min,
    required this.max,
    required this.divisions,
    required this.onChanged,
  });
  final String title;
  final double value;
  final double min;
  final double max;
  final int divisions;
  final ValueChanged<double> onChanged;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: Insets.card,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: theme.colorScheme.onSurface,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary.withValues(alpha: 0.15),
                  borderRadius: Radii.brSm,
                ),
                child: Text(
                  '${value.toInt()}px',
                  style: TextStyle(
                    color: theme.colorScheme.primary,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: Spacing.sm),
          Slider(
            value: value,
            min: min,
            max: max,
            divisions: divisions,
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }
}

// Divider
class _Divider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Divider(
      height: 1,
      thickness: 1,
      indent: 16,
      endIndent: 16,
      color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.1),
    );
  }
}

// Tool color reference grid
class _ToolColorGrid extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final theme = Theme.of(context);
    final tools = [
      (ToolType.thinking, 'Thinking', 'AI reasoning'),
      (ToolType.edit, 'Edit', 'File changes'),
      (ToolType.read, 'Read', 'File content'),
      (ToolType.write, 'Write', 'New files'),
      (ToolType.bash, 'Command', 'Shell/terminal'),
      (ToolType.search, 'Search', 'Find files'),
      (ToolType.todo, 'Todo', 'Task tracking'),
      (ToolType.subtask, 'Subtask', 'Agent delegation'),
    ];
    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Wrap(
        children: tools.asMap().entries.map((entry) {
          final tool = entry.value;
          final config = ToolStyle.getConfig(tool.$1);
          final color = config.colorGetter(ocTheme);
          return SizedBox(
            width: MediaQuery.of(context).size.width / 2 - 28,
            child: Padding(
              padding: Insets.cardSm,
              child: Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.15),
                      borderRadius: Radii.brSm,
                    ),
                    child: Icon(
                      config.getIcon(ToolStyle.currentIconPack),
                      size: 18,
                      color: color,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          tool.$2,
                          style: TextStyle(
                            color: theme.colorScheme.onSurface,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          tool.$3,
                          style: TextStyle(
                            color: theme.colorScheme.onSurface.withValues(
                              alpha: 0.5,
                            ),
                            fontSize: 11,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

/// Card header style selector - lets users choose header and border styles
class _CardHeaderStyleSelector extends ConsumerWidget {
  const _CardHeaderStyleSelector();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final cardStyle = ref.watch(cardStyleProvider);
    return _SettingsCard(
      child: Column(
        children: [
          // Header Style Section
          Padding(
            padding: Insets.card,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      AppIcons.layers,
                      size: 16,
                      color: theme.colorScheme.primary,
                    ),
                    SizedBox(width: Spacing.sm),
                    Text(
                      'Header Style',
                      style: TextStyle(
                        color: theme.colorScheme.onSurface,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: Spacing.md),
                // Header style options
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: CardHeaderStyle.values.map((style) {
                    final isSelected = cardStyle.headerStyle == style;
                    return _StyleOptionChip(
                      label: style.displayName,
                      description: style.description,
                      isSelected: isSelected,
                      onTap: () => ref
                          .read(cardStyleProvider.notifier)
                          .setHeaderStyle(style),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
          _Divider(),
          // Border Visibility Section
          Padding(
            padding: Insets.card,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      AppIcons.borderStyle,
                      size: 16,
                      color: theme.colorScheme.primary,
                    ),
                    SizedBox(width: Spacing.sm),
                    Text(
                      'Border Style',
                      style: TextStyle(
                        color: theme.colorScheme.onSurface,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: Spacing.md),
                // Border visibility options
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: CardBorderVisibility.values.map((visibility) {
                    final isSelected = cardStyle.borderVisibility == visibility;
                    return _StyleOptionChip(
                      label: visibility.displayName,
                      description: visibility.description,
                      isSelected: isSelected,
                      onTap: () => ref
                          .read(cardStyleProvider.notifier)
                          .setBorderVisibility(visibility),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
          _Divider(),
          // Live Preview
          Padding(
            padding: Insets.card,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      AppIcons.visibility,
                      size: 14,
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'Preview',
                      style: TextStyle(
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.5,
                        ),
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: Spacing.md),
                _CardStylePreview(cardStyle: cardStyle),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Option chip for style selection
class _StyleOptionChip extends StatelessWidget {
  const _StyleOptionChip({
    required this.label,
    required this.description,
    required this.isSelected,
    required this.onTap,
  });
  final String label;
  final String description;
  final bool isSelected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected
              ? theme.colorScheme.primary.withValues(alpha: 0.15)
              : ocTheme.bgRaised,
          borderRadius: Radii.brMd,
          border: Border.all(
            color: isSelected
                ? theme.colorScheme.primary
                : ocTheme.borderSubtle,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: isSelected
                        ? theme.colorScheme.primary
                        : theme.colorScheme.onSurface,
                    fontSize: 13,
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
                  ),
                ),
                if (isSelected) ...[
                  const SizedBox(width: 6),
                  Icon(
                    AppIcons.checkCircle,
                    size: 14,
                    color: theme.colorScheme.primary,
                  ),
                ],
              ],
            ),
            SizedBox(height: Spacing.xxs),
            Text(
              description,
              style: TextStyle(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                fontSize: 10,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Preview card showing current header/border style
class _CardStylePreview extends StatelessWidget {
  const _CardStylePreview({required this.cardStyle});
  final CardStyleSettings cardStyle;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final theme = Theme.of(context);
    // Determine colors based on style
    final Color headerBg;
    final Color borderColor;
    final toolColor = ocTheme.toolEdit; // Use edit tool color for preview
    switch (cardStyle.headerStyle) {
      case CardHeaderStyle.solid:
        headerBg = ocTheme.cardHeaderBg;
      case CardHeaderStyle.tinted:
        headerBg = toolColor.withValues(alpha: 0.1);
      case CardHeaderStyle.minimal:
        headerBg = Colors.transparent;
    }
    switch (cardStyle.borderVisibility) {
      case CardBorderVisibility.subtle:
        borderColor = ocTheme.cardBorderSubtle;
      case CardBorderVisibility.visible:
        borderColor = ocTheme.cardHeaderBorder;
      case CardBorderVisibility.accent:
        borderColor = toolColor.withValues(alpha: 0.6);
    }
    return Container(
      decoration: BoxDecoration(
        color: ocTheme.bgRaised,
        borderRadius: Radii.brMd,
        border: Border.all(color: borderColor),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: headerBg,
              border: Border(
                bottom: BorderSide(color: borderColor, width: 0.5),
              ),
            ),
            child: Row(
              children: [
                Icon(AppIcons.edit, size: 14, color: toolColor),
                SizedBox(width: Spacing.sm),
                Text(
                  'Edit',
                  style: TextStyle(
                    color: ocTheme.cardHeaderText,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: ocTheme.diffAdded.withValues(alpha: 0.15),
                    borderRadius: Radii.brXs,
                  ),
                  child: Text(
                    '+5',
                    style: TextStyle(
                      color: ocTheme.diffAdded,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                SizedBox(width: Spacing.xs),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: ocTheme.diffRemoved.withValues(alpha: 0.15),
                    borderRadius: Radii.brXs,
                  ),
                  child: Text(
                    '-2',
                    style: TextStyle(
                      color: ocTheme.diffRemoved,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Body
          Padding(
            padding: Insets.cardSm,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'lib/example.dart',
                  style: AppTypography.codeSmall(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                  ),
                ),
                SizedBox(height: Spacing.sm),
                // Diff preview lines
                _DiffPreviewLine(
                  text: '- final old = "value";',
                  isRemoved: true,
                  addedColor: ocTheme.diffAdded,
                  removedColor: ocTheme.diffRemoved,
                ),
                _DiffPreviewLine(
                  text: '+ final updated = "new";',
                  isRemoved: false,
                  addedColor: ocTheme.diffAdded,
                  removedColor: ocTheme.diffRemoved,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DiffPreviewLine extends StatelessWidget {
  const _DiffPreviewLine({
    required this.text,
    required this.isRemoved,
    required this.addedColor,
    required this.removedColor,
  });
  final String text;
  final bool isRemoved;
  final Color addedColor;
  final Color removedColor;
  @override
  Widget build(BuildContext context) {
    final color = isRemoved ? removedColor : addedColor;
    return Container(
      margin: const EdgeInsets.only(bottom: 2),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: Radii.brXs,
        border: Border(left: BorderSide(color: color, width: 2)),
      ),
      child: Text(
        text,
        style: AppTypography.codeSmall(color: color).copyWith(fontSize: 10),
      ),
    );
  }
}
