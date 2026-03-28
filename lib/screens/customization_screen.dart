import 'package:broski/models/glow_style.dart';
import 'package:broski/models/highlight_color.dart';
import 'package:broski/models/nav_bar_style.dart';
import 'package:broski/models/prompt_accent_color.dart';
import 'package:broski/providers/font_provider.dart';
import 'package:broski/providers/glow_style_provider.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/providers/input_style_provider.dart';
import 'package:broski/providers/nav_bar_style_provider.dart';
import 'package:broski/providers/prompt_accent_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/theme_provider.dart';
import 'package:broski/screens/appearance_screen.dart';
import 'package:broski/screens/background_screen.dart';
import 'package:broski/screens/font_selector_screen.dart';
import 'package:broski/screens/theme_selector_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Helper to get contrasting text color for a background
Color _contrastColor(Color background) {
  // Calculate luminance and return white or black
  final luminance = background.computeLuminance();
  return luminance > 0.5 ? Colors.black : Colors.white;
}

/// Unified customization screen for all appearance and UX settings
class CustomizationScreen extends ConsumerWidget {
  const CustomizationScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final currentThemeInfo = ref.watch(currentThemeInfoProvider);
    final currentUIFont = ref.watch(currentUIFontProvider);
    final currentCodeFont = ref.watch(currentCodeFontProvider);
    final inputStyle = ref.watch(inputStyleProvider);
    final navBarStyle = ref.watch(navBarStyleProvider);
    final notificationsEnabled = ref.watch(notificationsEnabledProvider);
    final highlights = ref.watch(highlightsProvider);
    final selectedHighlightColor = highlights.color;
    final promptAccent = ref.watch(promptAccentProvider);
    final glowStyle = ref.watch(glowStyleProvider);
    final ocTheme = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'Customization',
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
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: ListView(
          padding: Insets.screenAll,
          children: [
            // Appearance Section
            const _SectionHeader(title: 'Appearance'),
            const SizedBox(height: Spacing.md),
            _SettingsCard(
              child: Column(
                children: [
                  _NavigationTile(
                    title: 'Color Theme',
                    subtitle: currentThemeInfo?.name ?? 'OpenCode',
                    icon: AppIcons.palette,
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 16,
                          height: 16,
                          decoration: BoxDecoration(
                            color:
                                currentThemeInfo?.primaryColor ??
                                theme.colorScheme.primary,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: theme.colorScheme.onSurface.withValues(
                                alpha: 0.2,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: Spacing.sm),
                        Icon(
                          AppIcons.chevronRight,
                          size: 20,
                          color: theme.colorScheme.onSurface.withValues(
                            alpha: 0.5,
                          ),
                        ),
                      ],
                    ),
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const ThemeSelectorScreen(),
                      ),
                    ),
                  ),
                  _Divider(),
                  _NavigationTile(
                    title: 'Typography',
                    subtitle:
                        '${currentUIFont.displayName} / ${currentCodeFont.displayName}',
                    icon: AppIcons.textFields,
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const FontSelectorScreen(),
                      ),
                    ),
                  ),
                  _Divider(),
                  _NavigationTile(
                    title: 'Tool Cards',
                    subtitle: 'Icons, colors, and card styling',
                    icon: AppIcons.dashboard,
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const AppearanceScreen(),
                      ),
                    ),
                  ),
                  _Divider(),
                  _NavigationTile(
                    title: 'Background',
                    subtitle: 'Wallpaper, shade, and per-screen settings',
                    icon: AppIcons.wallpaper,
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const BackgroundScreen(),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),
            // Input Bar Section
            const _SectionHeader(title: 'Input Bar'),
            const SizedBox(height: Spacing.md),
            _SettingsCard(
              child: Column(
                children: [
                  _RadioTile(
                    title: 'ChatGPT Style',
                    subtitle: 'Rounded pill with send button',
                    icon: AppIcons.chatBubble,
                    isSelected: inputStyle == InputBarStyle.chatgpt,
                    onTap: () => ref
                        .read(inputStyleProvider.notifier)
                        .setStyle(InputBarStyle.chatgpt),
                  ),
                  _Divider(),
                  _RadioTile(
                    title: 'CLI Style',
                    subtitle: 'Terminal-like with agent selector',
                    icon: AppIcons.terminal,
                    isSelected: inputStyle == InputBarStyle.cli,
                    onTap: () => ref
                        .read(inputStyleProvider.notifier)
                        .setStyle(InputBarStyle.cli),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),
            // Prompt Glow Section — applies to both input bar styles
            const _SectionHeader(title: 'Prompt Glow'),
            const SizedBox(height: Spacing.md),
            // Glow Style picker
            _SettingsCard(
              child: Column(
                children: [
                  _RadioTile(
                    title: 'No Glow',
                    subtitle: 'Clean, minimal input bar',
                    icon: AppIcons.block,
                    isSelected: glowStyle == GlowStyle.none,
                    onTap: () => ref
                        .read(glowStyleProvider.notifier)
                        .setStyle(GlowStyle.none),
                  ),
                  _Divider(),
                  _RadioTile(
                    title: 'Left Only',
                    subtitle: 'Accent glow on the left edge',
                    icon: AppIcons.borderLeft,
                    isSelected: glowStyle == GlowStyle.leftOnly,
                    onTap: () => ref
                        .read(glowStyleProvider.notifier)
                        .setStyle(GlowStyle.leftOnly),
                  ),
                  _Divider(),
                  _RadioTile(
                    title: 'Full Border',
                    subtitle: 'Glow along the entire visible border',
                    icon: AppIcons.borderAll,
                    isSelected: glowStyle == GlowStyle.fullBorder,
                    onTap: () => ref
                        .read(glowStyleProvider.notifier)
                        .setStyle(GlowStyle.fullBorder),
                  ),
                ],
              ),
            ),
            // Accent color picker (shown when glow is enabled)
            if (glowStyle != GlowStyle.none) ...[
              const SizedBox(height: Spacing.lg),
              _SettingsCard(
                child: Padding(
                  padding: Insets.card,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            AppIcons.palette,
                            color: theme.colorScheme.primary,
                            size: 22,
                          ),
                          const SizedBox(width: Spacing.md),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Accent Color',
                                  style: TextStyle(
                                    color: theme.colorScheme.onSurface,
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: Spacing.xs),
                                Text(
                                  'Color of the glow border',
                                  style: TextStyle(
                                    color: theme.colorScheme.onSurface
                                        .withValues(alpha: 0.6),
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: Spacing.lg),
                      // Color swatches
                      Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: PromptAccentColor.values.map((color) {
                          final isSelected = color == promptAccent;
                          final displayColor = color.getColor(ocTheme.primary);
                          return GestureDetector(
                            onTap: () => ref
                                .read(promptAccentProvider.notifier)
                                .setColor(color),
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: displayColor,
                                borderRadius: Radii.brMd,
                                border: Border.all(
                                  color: isSelected
                                      ? theme.colorScheme.onSurface
                                      : Colors.transparent,
                                  width: 2,
                                ),
                                boxShadow: isSelected
                                    ? [
                                        BoxShadow(
                                          color: displayColor.withValues(
                                            alpha: 0.4,
                                          ),
                                          blurRadius: 8,
                                          spreadRadius: 1,
                                        ),
                                      ]
                                    : null,
                              ),
                              child: isSelected
                                  ? Icon(
                                      AppIcons.check,
                                      color: _contrastColor(displayColor),
                                      size: 20,
                                    )
                                  : null,
                            ),
                          );
                        }).toList(),
                      ),
                      const SizedBox(height: Spacing.md),
                      // Selected color name
                      Text(
                        promptAccent.displayName,
                        style: TextStyle(
                          color: theme.colorScheme.onSurface.withValues(
                            alpha: 0.5,
                          ),
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 28),
            // Navigation Section
            const _SectionHeader(title: 'Navigation Bar'),
            const SizedBox(height: Spacing.md),
            _SettingsCard(
              child: Column(
                children: [
                  _RadioTile(
                    title: 'Classic',
                    subtitle: 'Simple rounded bar with labels',
                    icon: AppIcons.viewAgenda,
                    isSelected: navBarStyle == NavBarStyle.classic,
                    onTap: () => ref
                        .read(navBarStyleProvider.notifier)
                        .setStyle(NavBarStyle.classic),
                  ),
                  _Divider(),
                  _RadioTile(
                    title: 'Glassmorphic',
                    subtitle: 'Floating glass with blur effect',
                    icon: AppIcons.blurOn,
                    isSelected: navBarStyle == NavBarStyle.glassmorphic,
                    onTap: () => ref
                        .read(navBarStyleProvider.notifier)
                        .setStyle(NavBarStyle.glassmorphic),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),
            // Highlights Section
            const _SectionHeader(title: 'Highlights'),
            const SizedBox(height: Spacing.md),
            _SettingsCard(
              child: Padding(
                padding: Insets.card,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          AppIcons.star,
                          color: theme.colorScheme.primary,
                          size: 22,
                        ),
                        const SizedBox(width: Spacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Highlight Color',
                                style: TextStyle(
                                  color: theme.colorScheme.onSurface,
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: Spacing.xs),
                              Text(
                                'Color for pinned sessions and projects',
                                style: TextStyle(
                                  color: theme.colorScheme.onSurface.withValues(
                                    alpha: 0.6,
                                  ),
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: Spacing.lg),
                    // Color swatches
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: HighlightColor.values.map((color) {
                        final isSelected = color == selectedHighlightColor;
                        final displayColor = color.forBrightness(
                          theme.brightness,
                          themePrimary: ocTheme.primary,
                        );
                        return GestureDetector(
                          onTap: () => ref
                              .read(highlightsProvider.notifier)
                              .setColor(color),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            width: 40,
                            height: 40,
                            decoration: BoxDecoration(
                              color: displayColor,
                              borderRadius: Radii.brMd,
                              border: Border.all(
                                color: isSelected
                                    ? theme.colorScheme.onSurface
                                    : Colors.transparent,
                                width: 2,
                              ),
                              boxShadow: isSelected
                                  ? [
                                      BoxShadow(
                                        color: displayColor.withValues(
                                          alpha: 0.4,
                                        ),
                                        blurRadius: 8,
                                        spreadRadius: 1,
                                      ),
                                    ]
                                  : null,
                            ),
                            child: isSelected
                                ? Icon(
                                    AppIcons.check,
                                    color: _contrastColor(displayColor),
                                    size: 20,
                                  )
                                : null,
                          ),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: Spacing.md),
                    // Selected color name
                    Text(
                      selectedHighlightColor.displayName,
                      style: TextStyle(
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.5,
                        ),
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 28),
            // Notifications Section
            const _SectionHeader(title: 'Notifications'),
            const SizedBox(height: Spacing.md),
            _SettingsCard(
              child: _ToggleTile(
                title: 'Push Notifications',
                subtitle: 'Alert when background sessions complete',
                icon: AppIcons.notification,
                value: notificationsEnabled,
                onChanged: (v) => ref
                    .read(notificationsEnabledProvider.notifier)
                    .setEnabled(v),
              ),
            ),
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

// Navigation tile (opens another screen)
class _NavigationTile extends StatelessWidget {
  const _NavigationTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
    this.trailing,
  });
  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onTap;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brLg,
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Icon(icon, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: Spacing.md),
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
                  const SizedBox(height: Spacing.xs),
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
            trailing ??
                Icon(
                  AppIcons.chevronRight,
                  size: 20,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                ),
          ],
        ),
      ),
    );
  }
}

// Radio tile for single selection
class _RadioTile extends StatelessWidget {
  const _RadioTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.isSelected,
    required this.onTap,
  });
  final String title;
  final String subtitle;
  final IconData icon;
  final bool isSelected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brLg,
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Icon(icon, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: Spacing.md),
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
                  const SizedBox(height: Spacing.xs),
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
            const SizedBox(width: Spacing.sm),
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: isSelected
                      ? theme.colorScheme.primary
                      : theme.colorScheme.onSurface.withValues(alpha: 0.3),
                  width: 2,
                ),
                color: isSelected
                    ? theme.colorScheme.primary
                    : Colors.transparent,
              ),
              child: isSelected
                  ? Icon(
                      AppIcons.check,
                      size: 14,
                      color: theme.colorScheme.onPrimary,
                    )
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

// Toggle tile with switch
class _ToggleTile extends StatelessWidget {
  const _ToggleTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.value,
    required this.onChanged,
  });
  final String title;
  final String subtitle;
  final IconData icon;
  final bool value;
  final ValueChanged<bool> onChanged;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: () => onChanged(!value),
      borderRadius: Radii.brLg,
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Icon(icon, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: Spacing.md),
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
                  const SizedBox(height: Spacing.xs),
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
            const SizedBox(width: Spacing.sm),
            Switch.adaptive(value: value, onChanged: onChanged),
          ],
        ),
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
