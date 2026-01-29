import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/highlight_color.dart';
import '../models/nav_bar_style.dart';
import '../models/prompt_accent_color.dart';
import '../providers/highlights_provider.dart';
import '../providers/input_style_provider.dart';
import '../providers/nav_bar_style_provider.dart';
import '../providers/prompt_accent_provider.dart';
import '../providers/service_providers.dart';
import '../providers/theme_provider.dart';
import '../theme/opencode_theme.dart';
import 'appearance_screen.dart';
import 'background_screen.dart';
import 'theme_selector_screen.dart';

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
    final inputStyle = ref.watch(inputStyleProvider);
    final navBarStyle = ref.watch(navBarStyleProvider);
    final notificationsEnabled = ref.watch(notificationsEnabledProvider);
    final highlights = ref.watch(highlightsProvider);
    final selectedHighlightColor = highlights.color;
    final promptAccent = ref.watch(promptAccentProvider);
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
          icon: Icon(
            Icons.arrow_back_rounded,
            color: theme.colorScheme.onSurface,
          ),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Appearance Section
          _SectionHeader(title: 'Appearance'),
          const SizedBox(height: 12),
          _SettingsCard(
            child: Column(
              children: [
                _NavigationTile(
                  title: 'Color Theme',
                  subtitle: currentThemeInfo?.name ?? 'OpenCode',
                  icon: Icons.palette_rounded,
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
                      const SizedBox(width: 8),
                      Icon(
                        Icons.chevron_right_rounded,
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
                  title: 'Tool Cards',
                  subtitle: 'Icons, colors, and card styling',
                  icon: Icons.dashboard_customize_rounded,
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const AppearanceScreen()),
                  ),
                ),
                _Divider(),
                _NavigationTile(
                  title: 'Background',
                  subtitle: 'Wallpaper, shade, and per-screen settings',
                  icon: Icons.wallpaper_rounded,
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const BackgroundScreen()),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 28),

          // Input Bar Section
          _SectionHeader(title: 'Input Bar'),
          const SizedBox(height: 12),
          _SettingsCard(
            child: Column(
              children: [
                _RadioTile(
                  title: 'ChatGPT Style',
                  subtitle: 'Rounded pill with send button',
                  icon: Icons.chat_bubble_outline_rounded,
                  isSelected: inputStyle == InputBarStyle.chatgpt,
                  onTap: () => ref
                      .read(inputStyleProvider.notifier)
                      .setStyle(InputBarStyle.chatgpt),
                ),
                _Divider(),
                _RadioTile(
                  title: 'CLI Style',
                  subtitle: 'Terminal-like with agent selector',
                  icon: Icons.terminal_rounded,
                  isSelected: inputStyle == InputBarStyle.cli,
                  onTap: () => ref
                      .read(inputStyleProvider.notifier)
                      .setStyle(InputBarStyle.cli),
                ),
              ],
            ),
          ),

          // Only show prompt accent when CLI style is selected
          if (inputStyle == InputBarStyle.cli) ...[
            const SizedBox(height: 28),

            // Prompt Accent Section
            _SectionHeader(title: 'Prompt Accent'),
            const SizedBox(height: 12),
            _SettingsCard(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.border_left_rounded,
                          color: theme.colorScheme.primary,
                          size: 22,
                        ),
                        const SizedBox(width: 12),
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
                              const SizedBox(height: 4),
                              Text(
                                'Left bar color in CLI-style input',
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
                    const SizedBox(height: 16),
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
                              borderRadius: BorderRadius.circular(10),
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
                                    Icons.check_rounded,
                                    color: _contrastColor(displayColor),
                                    size: 20,
                                  )
                                : null,
                          ),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 12),
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
          _SectionHeader(title: 'Navigation Bar'),
          const SizedBox(height: 12),
          _SettingsCard(
            child: Column(
              children: [
                _RadioTile(
                  title: 'Classic',
                  subtitle: 'Simple rounded bar with labels',
                  icon: Icons.view_agenda_rounded,
                  isSelected: navBarStyle == NavBarStyle.classic,
                  onTap: () => ref
                      .read(navBarStyleProvider.notifier)
                      .setStyle(NavBarStyle.classic),
                ),
                _Divider(),
                _RadioTile(
                  title: 'Glassmorphic',
                  subtitle: 'Floating glass with blur effect',
                  icon: Icons.blur_on_rounded,
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
          _SectionHeader(title: 'Highlights'),
          const SizedBox(height: 12),
          _SettingsCard(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.star_rounded,
                        color: theme.colorScheme.primary,
                        size: 22,
                      ),
                      const SizedBox(width: 12),
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
                            const SizedBox(height: 4),
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
                  const SizedBox(height: 16),
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
                            borderRadius: BorderRadius.circular(10),
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
                                  Icons.check_rounded,
                                  color: _contrastColor(displayColor),
                                  size: 20,
                                )
                              : null,
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 12),
                  // Selected color name
                  Text(
                    selectedHighlightColor.displayName,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
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
          _SectionHeader(title: 'Notifications'),
          const SizedBox(height: 12),
          _SettingsCard(
            child: _ToggleTile(
              title: 'Push Notifications',
              subtitle: 'Alert when background sessions complete',
              icon: Icons.notifications_rounded,
              value: notificationsEnabled,
              onChanged: (v) =>
                  ref.read(notificationsEnabledProvider.notifier).setEnabled(v),
            ),
          ),

          const SizedBox(height: 100),
        ],
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
        borderRadius: BorderRadius.circular(16),
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
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(icon, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: 12),
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
                  const SizedBox(height: 4),
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
                  Icons.chevron_right_rounded,
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
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(icon, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: 12),
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
                  const SizedBox(height: 4),
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
            const SizedBox(width: 8),
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
                      Icons.check,
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
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(icon, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: 12),
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
                  const SizedBox(height: 4),
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
            const SizedBox(width: 8),
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
