import 'dart:io';

import 'package:broski/providers/appearance_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Screen for configuring custom background wallpaper, shade, and per-screen toggles.
///
/// Extracted from AppearanceScreen to separate background settings from tool card settings.
class BackgroundScreen extends ConsumerWidget {
  const BackgroundScreen({super.key});
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
          'Background',
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
            onPressed: () {
              ref.read(appearanceProvider.notifier).clearBackground();
              ref
                  .read(appearanceProvider.notifier)
                  .setSelectedShade(BackgroundShade.none);
              ref.read(appearanceProvider.notifier).setAllScreensEnabled(true);
            },
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
            // Custom Background Image Section
            const _SectionHeader(title: 'Wallpaper'),
            const SizedBox(height: Spacing.md),
            _BackgroundSection(settings: settings),
            const SizedBox(height: Spacing.xxxl),
            // Background Shade Picker
            const _SectionHeader(title: 'Background Shade'),
            const SizedBox(height: Spacing.md),
            const _BackgroundShadePreview(),
            const SizedBox(height: Spacing.xxxl),
            // Per-screen background toggles
            const _SectionHeader(title: 'Screen Selection'),
            const SizedBox(height: Spacing.md),
            const _ScreenBackgroundToggles(),
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

// Background section with custom image picker
class _BackgroundSection extends ConsumerWidget {
  const _BackgroundSection({required this.settings});
  final AppearanceSettings settings;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final theme = Theme.of(context);
    return _SettingsCard(
      child: Column(
        children: [
          // Custom background image preview/picker
          InkWell(
            onTap: () => _showBackgroundOptions(context, ref),
            borderRadius: Radii.sheetTop,
            child: Padding(
              padding: Insets.card,
              child: Row(
                children: [
                  // Thumbnail or placeholder
                  Container(
                    width: 60,
                    height: 100,
                    decoration: BoxDecoration(
                      color: ocTheme.bgRaised,
                      borderRadius: Radii.brSm,
                      border: Border.all(color: ocTheme.borderSubtle),
                      image: settings.hasCustomBackground
                          ? DecorationImage(
                              image: FileImage(
                                File(settings.customBackgroundPath!),
                              ),
                              fit: BoxFit.cover,
                            )
                          : null,
                    ),
                    child: settings.hasCustomBackground
                        ? null
                        : Icon(
                            AppIcons.camera,
                            color: theme.colorScheme.onSurface.withValues(
                              alpha: 0.4,
                            ),
                            size: 24,
                          ),
                  ),
                  const SizedBox(width: Spacing.lg),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Custom Background',
                          style: TextStyle(
                            color: theme.colorScheme.onSurface,
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: Spacing.xs),
                        Text(
                          settings.hasCustomBackground
                              ? 'Tap to change or remove'
                              : 'Add a personal wallpaper',
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
                  Icon(
                    AppIcons.chevronRight,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                    size: 20,
                  ),
                ],
              ),
            ),
          ),
          // Only show opacity/blur sliders if custom background is set
          if (settings.hasCustomBackground) ...[
            _Divider(),
            _SliderTileWithLabel(
              title: 'Opacity',
              value: settings.backgroundOpacity,
              min: 0.05,
              max: 0.5,
              divisions: 9,
              valueLabel: '${(settings.backgroundOpacity * 100).toInt()}%',
              onChanged: (v) =>
                  ref.read(appearanceProvider.notifier).setBackgroundOpacity(v),
            ),
            _Divider(),
            _SliderTileWithLabel(
              title: 'Blur',
              value: settings.backgroundBlur,
              min: 0,
              max: 20,
              divisions: 20,
              valueLabel: '${settings.backgroundBlur.toInt()}',
              onChanged: (v) =>
                  ref.read(appearanceProvider.notifier).setBackgroundBlur(v),
            ),
          ],
        ],
      ),
    );
  }

  void _showBackgroundOptions(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Background',
      initialSize: 0.35,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Choose from gallery
          ListTile(
            leading: Container(
              padding: Insets.cardXs,
              decoration: BoxDecoration(
                color: theme.colorScheme.primary.withValues(alpha: 0.15),
                borderRadius: Radii.brMd,
              ),
              child: Icon(
                AppIcons.photoLibrary,
                color: theme.colorScheme.primary,
              ),
            ),
            title: const Text('Choose from Gallery'),
            subtitle: const Text('Pick a vertical image for best results'),
            onTap: () async {
              Navigator.pop(context);
              final success = await ref
                  .read(appearanceProvider.notifier)
                  .pickBackgroundImage();
              if (context.mounted && !success) {
                showInfo(context, 'Failed to set background');
              }
            },
          ),
          // Remove background (only if one is set)
          if (settings.hasCustomBackground) ...[
            const SizedBox(height: Spacing.sm),
            ListTile(
              leading: Container(
                padding: Insets.cardXs,
                decoration: BoxDecoration(
                  color: theme.colorScheme.error.withValues(alpha: 0.15),
                  borderRadius: Radii.brMd,
                ),
                child: Icon(AppIcons.delete, color: theme.colorScheme.error),
              ),
              title: const Text('Remove Background'),
              subtitle: const Text('Go back to theme default'),
              onTap: () {
                Navigator.pop(context);
                ref.read(appearanceProvider.notifier).clearBackground();
              },
            ),
          ],
          const SizedBox(height: Spacing.lg),
        ],
      ),
    );
  }
}

// Slider with custom label formatting
class _SliderTileWithLabel extends StatelessWidget {
  const _SliderTileWithLabel({
    required this.title,
    required this.value,
    required this.min,
    required this.max,
    required this.divisions,
    required this.valueLabel,
    required this.onChanged,
  });
  final String title;
  final double value;
  final double min;
  final double max;
  final int divisions;
  final String valueLabel;
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
                  valueLabel,
                  style: TextStyle(
                    color: theme.colorScheme.primary,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: Spacing.sm),
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

// Selectable background shade picker
class _BackgroundShadePreview extends ConsumerWidget {
  const _BackgroundShadePreview();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final theme = Theme.of(context);
    final settings = ref.watch(appearanceProvider);
    final shades = [
      (BackgroundShade.none, 'Default', ocTheme.background, 'Theme default'),
      (BackgroundShade.deep, 'Deep', ocTheme.bgDeep, 'Deepest background'),
      (BackgroundShade.base, 'Base', ocTheme.background, 'Main background'),
      (BackgroundShade.raised, 'Raised', ocTheme.bgRaised, 'Elevated surfaces'),
      (BackgroundShade.hover, 'Hover', ocTheme.bgHover, 'Hover state'),
      (BackgroundShade.active, 'Active', ocTheme.bgActive, 'Active/pressed'),
      (
        BackgroundShade.highlight,
        'Highlight',
        ocTheme.bgHighlight,
        'Highlighted',
      ),
      (BackgroundShade.overlay, 'Overlay', ocTheme.bgOverlay, 'Modal overlays'),
    ];
    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      padding: Insets.card,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Info text
          Row(
            children: [
              Icon(
                AppIcons.palette,
                size: 14,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Tap to select a background shade',
                  style: TextStyle(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: Spacing.lg),
          // Shade swatches (selectable)
          ...shades.map((shade) {
            final isSelected = settings.selectedShade == shade.$1;
            return Padding(
              padding: Insets.bottomSm,
              child: InkWell(
                onTap: () => ref
                    .read(appearanceProvider.notifier)
                    .setSelectedShade(shade.$1),
                borderRadius: Radii.brMd,
                child: Container(
                  padding: Insets.cardXs,
                  decoration: BoxDecoration(
                    color: isSelected
                        ? theme.colorScheme.primary.withValues(alpha: 0.1)
                        : Colors.transparent,
                    borderRadius: Radii.brMd,
                    border: isSelected
                        ? Border.all(color: theme.colorScheme.primary, width: 2)
                        : null,
                  ),
                  child: Row(
                    children: [
                      // Color swatch
                      Container(
                        width: 48,
                        height: 32,
                        decoration: BoxDecoration(
                          color: shade.$3,
                          borderRadius: Radii.brSm,
                          border: Border.all(
                            color: theme.colorScheme.onSurface.withValues(
                              alpha: 0.1,
                            ),
                          ),
                        ),
                        child: shade.$1 == BackgroundShade.none
                            ? Icon(
                                AppIcons.block,
                                size: 16,
                                color: theme.colorScheme.onSurface.withValues(
                                  alpha: 0.3,
                                ),
                              )
                            : null,
                      ),
                      const SizedBox(width: Spacing.md),
                      // Label and description
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              shade.$2,
                              style: TextStyle(
                                color: theme.colorScheme.onSurface,
                                fontSize: 13,
                                fontWeight: isSelected
                                    ? FontWeight.w700
                                    : FontWeight.w600,
                              ),
                            ),
                            Text(
                              shade.$4,
                              style: TextStyle(
                                color: theme.colorScheme.onSurface.withValues(
                                  alpha: 0.5,
                                ),
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ),
                      ),
                      // Selection indicator
                      if (isSelected)
                        Icon(
                          AppIcons.checkCircle,
                          color: theme.colorScheme.primary,
                          size: 20,
                        )
                      else
                        // Hex code
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.bgRaised,
                            borderRadius: Radii.brSm,
                          ),
                          child: Text(
                            '#${shade.$3.toARGB32().toRadixString(16).substring(2).toUpperCase()}',
                            style:
                                AppTypography.codeSmall(
                                  color: theme.colorScheme.onSurface.withValues(
                                    alpha: 0.7,
                                  ),
                                ).copyWith(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}

// Per-screen background toggle section
class _ScreenBackgroundToggles extends ConsumerWidget {
  const _ScreenBackgroundToggles();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final theme = Theme.of(context);
    final settings = ref.watch(appearanceProvider);
    // Only show this section if there's a custom background or shade
    if (!settings.hasCustomBackground && !settings.hasCustomShade) {
      return Container(
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brLg,
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        padding: Insets.card,
        child: Row(
          children: [
            Icon(
              AppIcons.info,
              size: 18,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
            ),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Text(
                'Select a background image or shade above to enable',
                style: TextStyle(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
      );
    }
    final screens = [
      (AppScreen.chat, AppIcons.chatBubble, 'Chat'),
      (AppScreen.projects, AppIcons.gridView, 'Projects'),
      (AppScreen.browse, AppIcons.folder, 'Browse'),
      (AppScreen.sessions, AppIcons.history, 'Sessions'),
      (AppScreen.settings, AppIcons.tune, 'Settings'),
    ];
    // Check if all screens are enabled (empty means all enabled)
    final allEnabled = settings.enabledScreens.isEmpty;
    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      padding: Insets.card,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header with toggle all
          Row(
            children: [
              Icon(
                AppIcons.dashboard,
                size: 18,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(width: Spacing.md),
              Expanded(
                child: Text(
                  'Select screens to apply background',
                  style: TextStyle(
                    color: theme.colorScheme.onSurface,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              // Toggle all button
              GestureDetector(
                onTap: () {
                  if (allEnabled) {
                    ref
                        .read(appearanceProvider.notifier)
                        .setAllScreensEnabled(false);
                  } else {
                    ref
                        .read(appearanceProvider.notifier)
                        .setAllScreensEnabled(true);
                  }
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: allEnabled
                        ? theme.colorScheme.primary.withValues(alpha: 0.15)
                        : ocTheme.bgRaised,
                    borderRadius: Radii.brSm,
                  ),
                  child: Text(
                    allEnabled ? 'All' : 'Custom',
                    style: TextStyle(
                      color: allEnabled
                          ? theme.colorScheme.primary
                          : theme.colorScheme.onSurface.withValues(alpha: 0.7),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: Spacing.lg),
          // Screen toggles
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: screens.map((screen) {
              final isEnabled = settings.isEnabledForScreen(screen.$1);
              return _ScreenToggleChip(
                screenId: screen.$1,
                icon: screen.$2,
                label: screen.$3,
                isEnabled: isEnabled,
                onTap: () {
                  ref
                      .read(appearanceProvider.notifier)
                      .toggleScreenEnabled(screen.$1);
                },
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}

class _ScreenToggleChip extends StatelessWidget {
  const _ScreenToggleChip({
    required this.screenId,
    required this.icon,
    required this.label,
    required this.isEnabled,
    required this.onTap,
  });
  final String screenId;
  final IconData icon;
  final String label;
  final bool isEnabled;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isEnabled
              ? theme.colorScheme.primary.withValues(alpha: 0.15)
              : ocTheme.bgRaised,
          borderRadius: Radii.brMd,
          border: Border.all(
            color: isEnabled
                ? theme.colorScheme.primary.withValues(alpha: 0.5)
                : ocTheme.borderSubtle,
            width: isEnabled ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 16,
              color: isEnabled
                  ? theme.colorScheme.primary
                  : theme.colorScheme.onSurface.withValues(alpha: 0.5),
            ),
            const SizedBox(width: Spacing.sm),
            Text(
              label,
              style: TextStyle(
                color: isEnabled
                    ? theme.colorScheme.primary
                    : theme.colorScheme.onSurface.withValues(alpha: 0.7),
                fontSize: 13,
                fontWeight: isEnabled ? FontWeight.w600 : FontWeight.w500,
              ),
            ),
            const SizedBox(width: 6),
            Icon(
              isEnabled ? AppIcons.checkCircle : AppIcons.circleOutlined,
              size: 16,
              color: isEnabled
                  ? theme.colorScheme.primary
                  : theme.colorScheme.onSurface.withValues(alpha: 0.3),
            ),
          ],
        ),
      ),
    );
  }
}
