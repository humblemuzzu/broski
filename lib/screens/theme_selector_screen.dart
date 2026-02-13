
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../providers/theme_provider.dart';
import '../theme/opencode_theme.dart';
import '../theme/themes/all_themes.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
/// Theme selector screen with live preview
/// Layout: Top half shows component preview, bottom half shows theme list
class ThemeSelectorScreen extends ConsumerStatefulWidget {
  const ThemeSelectorScreen({super.key});
  @override
  ConsumerState<ThemeSelectorScreen> createState() =>
      _ThemeSelectorScreenState();
}
class _ThemeSelectorScreenState extends ConsumerState<ThemeSelectorScreen> {
  late String _previewThemeId;
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  @override
  void initState() {
    super.initState();
    _previewThemeId = ref.read(themeProvider).themeId;
  }
  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }
  List<ThemeInfo> get filteredThemes {
    if (_searchQuery.isEmpty) return allThemes;
    final query = _searchQuery.toLowerCase();
    return allThemes.where((t) {
      return t.name.toLowerCase().contains(query) ||
          t.id.toLowerCase().contains(query) ||
          (t.description?.toLowerCase().contains(query) ?? false);
    }).toList();
  }
  List<dynamic> _buildSectionedList(List<ThemeInfo> themes) {
    if (_searchQuery.isNotEmpty) return themes;
    final items = <dynamic>[];
    final broskiThemes = themes.take(broskiThemeCount).toList();
    final communityThemes = themes.skip(broskiThemeCount).toList();
    if (broskiThemes.isNotEmpty) {
      items.add('BROSKI THEMES');
      items.addAll(broskiThemes);
    }
    if (communityThemes.isNotEmpty) {
      items.add('COMMUNITY THEMES');
      items.addAll(communityThemes);
    }
    return items;
  }
  void _selectTheme(String themeId) {
    setState(() => _previewThemeId = themeId);
  }
  void _applyTheme() {
    ref.read(themeProvider.notifier).setTheme(_previewThemeId);
    Navigator.of(context).pop();
  }
  @override
  Widget build(BuildContext context) {
    final currentThemeId = ref.watch(themeProvider).themeId;
    final previewTheme = getThemeById(_previewThemeId) ?? opencodeDarkTheme;
    final previewInfo = getThemeInfoById(_previewThemeId);
    return Scaffold(
      backgroundColor: previewTheme.background,
      appBar: AppBar(
        backgroundColor: previewTheme.backgroundPanel,
        title: Text('Themes', style: TextStyle(color: previewTheme.text)),
        leading: IconButton(
          icon: Icon(AppIcons.close, color: previewTheme.text),
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          if (_previewThemeId != currentThemeId)
            TextButton(
              onPressed: _applyTheme,
              child: Text(
                'Apply',
                style: TextStyle(
                  color: previewTheme.primary,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: Column(
        children: [
          // Top half: Preview
          Expanded(
            flex: 5,
            child: _ThemePreview(
              theme: previewTheme,
              themeName: previewInfo?.name ?? 'Unknown',
              themeDescription: previewInfo?.description,
            ),
          ),
          // Divider
          Container(height: 1, color: previewTheme.borderSubtle),
          // Bottom half: Theme list with search
          Expanded(
            flex: 5,
            child: Column(
              children: [
                // Search bar
                Padding(
                  padding: Insets.cardSm,
                  child: TextField(
                    controller: _searchController,
                    style: TextStyle(color: previewTheme.text),
                    decoration: InputDecoration(
                      hintText: 'Search themes...',
                      hintStyle: TextStyle(color: previewTheme.textMuted),
                      prefixIcon: Icon(
                        AppIcons.search,
                        color: previewTheme.textMuted,
                      ),
                      filled: true,
                      fillColor: previewTheme.backgroundElement,
                      border: OutlineInputBorder(
                        borderRadius: Radii.brMd,
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                    ),
                    onChanged: (value) => setState(() => _searchQuery = value),
                  ),
                ),
                // Theme list with sections
                Expanded(
                  child: ListView.builder(
                    padding: Insets.cardH,
                    itemCount: _buildSectionedList(filteredThemes).length,
                    itemBuilder: (context, index) {
                      final item = _buildSectionedList(filteredThemes)[index];
                      if (item is String) {
                        return _SectionHeader(
                          label: item,
                          previewTheme: previewTheme,
                        );
                      }
                      final themeInfo = item as ThemeInfo;
                      final isSelected = themeInfo.id == _previewThemeId;
                      final isCurrent = themeInfo.id == currentThemeId;
                      return _ThemeListItem(
                        themeInfo: themeInfo,
                        isSelected: isSelected,
                        isCurrent: isCurrent,
                        isDefault: themeInfo.id == defaultThemeId,
                        previewTheme: previewTheme,
                        onTap: () => _selectTheme(themeInfo.id),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      ),
    );
  }
}
/// Theme preview showing app components with the selected theme
class _ThemePreview extends StatelessWidget {
  const _ThemePreview({
    required this.theme,
    required this.themeName,
    this.themeDescription,
  });
  final OpenCodeTheme theme;
  final String themeName;
  final String? themeDescription;
  @override
  Widget build(BuildContext context) {
    return Container(
      color: theme.background,
      padding: Insets.card,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Theme name header
          Row(
            children: [
              Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: theme.primary,
                  shape: BoxShape.circle,
                ),
              ),
              SizedBox(width: Spacing.sm),
              Text(
                themeName,
                style: TextStyle(
                  color: theme.text,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              if (themeDescription != null) ...[
                SizedBox(width: Spacing.sm),
                Text(
                  '- $themeDescription',
                  style: AppTypography.labelLarge(color: theme.textMuted),
                ),
              ],
            ],
          ),
          SizedBox(height: Spacing.lg),
          // Sample components
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Message bubbles preview
                  _PreviewCard(
                    theme: theme,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // User message
                        Align(
                          alignment: Alignment.centerRight,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 10,
                            ),
                            decoration: BoxDecoration(
                              color: theme.primary,
                              borderRadius: Radii.brLg,
                            ),
                            child: Text(
                              'Hello! How are you?',
                              style: TextStyle(
                                color: theme.selectedListItemText,
                                fontSize: 14,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        // AI message
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          decoration: BoxDecoration(
                            color: theme.backgroundPanel,
                            borderRadius: Radii.brLg,
                            border: Border.all(color: theme.borderSubtle),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'I\'m doing great! Here\'s some code:',
                                style: TextStyle(
                                  color: theme.text,
                                  fontSize: 14,
                                ),
                              ),
                              SizedBox(height: Spacing.sm),
                              Container(
                                padding: Insets.cardXs,
                                decoration: BoxDecoration(
                                  color: theme.backgroundElement,
                                  borderRadius: Radii.brSm,
                                ),
                                child: Text(
                                  'const greeting = "Hello";',
                                  style: AppTypography.codeSmall(color: theme.syntaxString),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: Spacing.md),
                  // Status indicators
                  _PreviewCard(
                    theme: theme,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _StatusChip(
                          label: 'Success',
                          color: theme.success,
                          theme: theme,
                        ),
                        _StatusChip(
                          label: 'Warning',
                          color: theme.warning,
                          theme: theme,
                        ),
                        _StatusChip(
                          label: 'Error',
                          color: theme.error,
                          theme: theme,
                        ),
                        _StatusChip(
                          label: 'Info',
                          color: theme.info,
                          theme: theme,
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: Spacing.md),
                  // Diff preview
                  _PreviewCard(
                    theme: theme,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Diff Preview',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        SizedBox(height: Spacing.sm),
                        Container(
                          padding: Insets.cardXs,
                          decoration: BoxDecoration(
                            color: theme.diffAddedBg,
                            borderRadius: const BorderRadius.vertical(
                              top: Radius.circular(6),
                            ),
                          ),
                          child: Row(
                            children: [
                              Text(
                                '+',
                                style: AppTypography.codeSmall(color: theme.diffAdded).copyWith(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              SizedBox(width: Spacing.sm),
                              Text(
                                'Added line',
                                style: AppTypography.codeSmall(color: theme.diffAdded),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: Insets.cardXs,
                          decoration: BoxDecoration(
                            color: theme.diffRemovedBg,
                            borderRadius: const BorderRadius.vertical(
                              bottom: Radius.circular(6),
                            ),
                          ),
                          child: Row(
                            children: [
                              Text(
                                '-',
                                style: TextStyle(
                                  color: theme.diffRemoved,
                                  fontFamily: AppTypography.codeFontFamily,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              SizedBox(width: Spacing.sm),
                              Text(
                                'Removed line',
                                style: AppTypography.codeSmall(color: theme.diffRemoved),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
class _PreviewCard extends StatelessWidget {
  const _PreviewCard({required this.theme, required this.child});
  final OpenCodeTheme theme;
  final Widget child;
  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: child,
    );
  }
}
class _StatusChip extends StatelessWidget {
  const _StatusChip({
    required this.label,
    required this.color,
    required this.theme,
  });
  final String label;
  final Color color;
  final OpenCodeTheme theme;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: Radii.brSm,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.label,
    required this.previewTheme,
  });
  final String label;
  final OpenCodeTheme previewTheme;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 14, top: 16, bottom: 8),
      child: Text(
        label,
        style: TextStyle(
          color: previewTheme.textMuted.withValues(alpha: 0.6),
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}
/// Theme list item
class _ThemeListItem extends StatelessWidget {
  const _ThemeListItem({
    required this.themeInfo,
    required this.isSelected,
    required this.isCurrent,
    this.isDefault = false,
    required this.previewTheme,
    required this.onTap,
  });
  final ThemeInfo themeInfo;
  final bool isSelected;
  final bool isCurrent;
  final bool isDefault;
  final OpenCodeTheme previewTheme;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: isSelected
            ? previewTheme.primary.withValues(alpha: 0.15)
            : Colors.transparent,
        borderRadius: Radii.brMd,
        child: InkWell(
          onTap: onTap,
          borderRadius: Radii.brMd,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                // Color indicator
                Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    color: themeInfo.primaryColor,
                    shape: BoxShape.circle,
                    border: Border.all(color: previewTheme.border, width: 1),
                  ),
                ),
                const SizedBox(width: 14),
                // Theme name and description
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            themeInfo.name,
                            style: TextStyle(
                              color: isSelected
                                  ? previewTheme.primary
                                  : previewTheme.text,
                              fontSize: 15,
                              fontWeight: isSelected
                                  ? FontWeight.w600
                                  : FontWeight.w500,
                            ),
                          ),
                          if (isDefault) ...[
                            SizedBox(width: Spacing.sm),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color:
                                    previewTheme.primary.withValues(alpha: 0.12),
                                borderRadius: Radii.brXs,
                              ),
                              child: Text(
                                'Default',
                                style: TextStyle(
                                  color: previewTheme.primary,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      if (themeInfo.description != null)
                        Text(
                          themeInfo.description!,
                          style: TextStyle(
                            color: previewTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                    ],
                  ),
                ),
                // Current indicator
                if (isCurrent)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: previewTheme.success.withValues(alpha: 0.15),
                      borderRadius: Radii.brXs,
                    ),
                    child: Text(
                      'Current',
                      style: TextStyle(
                        color: previewTheme.success,
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                // Selected checkmark
                if (isSelected) ...[
                  SizedBox(width: Spacing.sm),
                  Icon(
                    AppIcons.checkCircle,
                    color: previewTheme.primary,
                    size: 20,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
