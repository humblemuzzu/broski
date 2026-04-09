import 'package:broski/providers/app_auth_provider.dart';
import 'package:broski/providers/app_subscription_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

/// Dedicated account / personal-info screen.
///
/// Contains: profile header, manage subscription, restore purchases,
/// sign-out, and delete-account.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appAuth = ref.watch(appAuthProvider);
    final appSub = ref.watch(appSubscriptionProvider);
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final user = appAuth.user;
    final displayName = user?.displayName ?? 'Broski User';
    final email = user?.email;
    final provider = user?.provider; // 'google' | 'apple'
    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'Account',
          style: TextStyle(
            color: ocTheme.text,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        leading: IconButton(
          icon: Icon(AppIcons.back, color: ocTheme.text),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
          children: [
            // ── Profile card ──────────────────────────────────────────
            Container(
              padding: Insets.screenAll,
              decoration: BoxDecoration(
                color: theme.colorScheme.surface.withValues(alpha: 0.5),
                borderRadius: Radii.brXl,
                border: Border.all(color: ocTheme.borderSubtle),
              ),
              child: Row(
                children: [
                  // Avatar
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Text(
                        _initials(displayName, email),
                        style: TextStyle(
                          color: theme.colorScheme.primary,
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: Spacing.lg),
                  // Name + email + sign-in method
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          displayName,
                          style: TextStyle(
                            color: theme.colorScheme.onSurface,
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (email != null) ...[
                          const SizedBox(height: Spacing.xs),
                          Text(
                            email,
                            style: TextStyle(
                              color: theme.colorScheme.onSurface.withValues(
                                alpha: 0.6,
                              ),
                              fontSize: 13,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                        const SizedBox(height: 6),
                        _SignInBadge(provider: provider),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: Spacing.xxl),
            // ── Subscription section ──────────────────────────────────
            const _SectionLabel(title: 'Subscription'),
            const SizedBox(height: 10),
            Container(
              decoration: BoxDecoration(
                color: theme.colorScheme.surface.withValues(alpha: 0.5),
                borderRadius: Radii.brLg,
                border: Border.all(color: ocTheme.borderSubtle),
              ),
              child: Column(
                children: [
                  if (appSub.managementUrl != null) ...[
                    _Tile(
                      title: 'Manage Subscription',
                      subtitle: 'Billing, plan changes, cancel anytime',
                      icon: AppIcons.creditCard,
                      onTap: () => launchUrl(
                        Uri.parse(appSub.managementUrl!),
                        mode: LaunchMode.externalApplication,
                      ),
                    ),
                    const _TileDivider(),
                  ],
                  _Tile(
                    title: 'Restore Purchases',
                    subtitle: 'Reinstalled or switched devices',
                    icon: AppIcons.restore,
                    onTap: () {
                      if (appSub.isLoading) return;
                      ref
                          .read(appSubscriptionProvider.notifier)
                          .restorePurchases();
                      showInfo(context, 'Restoring purchases...');
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: Spacing.xxl),
            // ── Sign out ──────────────────────────────────────────────
            const _SectionLabel(title: 'Session'),
            const SizedBox(height: 10),
            Container(
              decoration: BoxDecoration(
                color: theme.colorScheme.surface.withValues(alpha: 0.5),
                borderRadius: Radii.brLg,
                border: Border.all(color: ocTheme.borderSubtle),
              ),
              child: _Tile(
                title: 'Sign Out',
                subtitle: 'Remove this device from your account',
                icon: AppIcons.logout,
                onTap: () async {
                  final confirmed = await _confirmSignOut(context);
                  if (!confirmed || !context.mounted) return;
                  await ref.read(appAuthProvider.notifier).signOut();
                  if (context.mounted) {
                    Navigator.of(context).popUntil((route) => route.isFirst);
                  }
                },
              ),
            ),
            const SizedBox(height: Spacing.xxl),
            // ── Danger zone ───────────────────────────────────────────
            const _SectionLabel(title: 'Danger Zone'),
            const SizedBox(height: 10),
            Container(
              decoration: BoxDecoration(
                color: theme.colorScheme.error.withValues(alpha: 0.05),
                borderRadius: Radii.brLg,
                border: Border.all(
                  color: theme.colorScheme.error.withValues(alpha: 0.2),
                ),
              ),
              child: _Tile(
                title: 'Delete Account',
                subtitle: 'Permanently delete all your data',
                icon: AppIcons.delete,
                iconColor: theme.colorScheme.error,
                titleColor: theme.colorScheme.error,
                onTap: () => _showDeleteAccountDialog(context),
              ),
            ),
            const SizedBox(height: 60),
          ],
        ),
      ),
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────
  String _initials(String name, String? email) {
    if (name.isNotEmpty && name != 'Broski User') {
      final parts = name.trim().split(RegExp(r'\s+'));
      if (parts.length >= 2) {
        return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
      }
      return name[0].toUpperCase();
    }
    if (email != null && email.isNotEmpty) {
      return email[0].toUpperCase();
    }
    return 'B';
  }

  Future<bool> _confirmSignOut(BuildContext context) async {
    return await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Sign Out?'),
            content: const Text(
              'You will need to sign in again to use Broski.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Sign Out'),
              ),
            ],
          ),
        ) ??
        false;
  }

  void _showDeleteAccountDialog(BuildContext context) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const _DeleteAccountDialog(),
    );
  }
}

// ─── Shared widgets ─────────────────────────────────────────────────
class _SignInBadge extends StatelessWidget {
  const _SignInBadge({this.provider});
  final String? provider;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = switch (provider) {
      'google' => 'Google',
      'apple' => 'Apple',
      _ => 'Signed in',
    };
    final icon = switch (provider) {
      'apple' => AppIcons.apple,
      _ => AppIcons.shieldCheck,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: theme.colorScheme.primary.withValues(alpha: 0.1),
        borderRadius: Radii.brSm,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: theme.colorScheme.primary),
          const SizedBox(width: Spacing.xs),
          Text(
            label,
            style: TextStyle(
              color: theme.colorScheme.primary,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Text(
      title.toUpperCase(),
      style: TextStyle(
        color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.2,
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
    this.iconColor,
    this.titleColor,
  });
  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onTap;
  final Color? iconColor;
  final Color? titleColor;
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
            Icon(icon, color: iconColor ?? theme.colorScheme.primary, size: 22),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: titleColor ?? theme.colorScheme.onSurface,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 3),
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

class _TileDivider extends StatelessWidget {
  const _TileDivider();
  @override
  Widget build(BuildContext context) {
    return Divider(
      height: 1,
      thickness: 1,
      indent: 16,
      endIndent: 16,
      color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.08),
    );
  }
}

// ─── Delete account dialog (moved from settings_screen) ─────────────
class _DeleteAccountDialog extends ConsumerStatefulWidget {
  const _DeleteAccountDialog();
  @override
  ConsumerState<_DeleteAccountDialog> createState() =>
      _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends ConsumerState<_DeleteAccountDialog> {
  final _confirmController = TextEditingController();
  final _feedbackController = TextEditingController();
  String? _selectedReason;
  bool _isDeleting = false;
  String? _error;
  static const _reasons = [
    'No longer need it',
    'Too expensive',
    'Switching to another app',
    'Privacy concerns',
    'Technical issues',
    'Other',
  ];
  bool get _canDelete =>
      _confirmController.text.trim().toUpperCase() == 'DELETE';
  @override
  void dispose() {
    _confirmController.dispose();
    _feedbackController.dispose();
    super.dispose();
  }

  Future<void> _performDelete() async {
    if (!_canDelete || _isDeleting) return;
    setState(() {
      _isDeleting = true;
      _error = null;
    });
    try {
      await ref.read(appSubscriptionProvider.notifier).signOut();
      await ref
          .read(appAuthProvider.notifier)
          .deleteAccount(
            reason: _selectedReason,
            feedback: _feedbackController.text.trim().isNotEmpty
                ? _feedbackController.text.trim()
                : null,
          );
      if (mounted) {
        Navigator.of(context).pop();
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isDeleting = false;
          _error = humanizeError(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AlertDialog(
      title: Row(
        children: [
          Icon(AppIcons.warning, color: theme.colorScheme.error),
          const SizedBox(width: Spacing.sm),
          Text(
            'Delete Account',
            style: TextStyle(color: theme.colorScheme.error),
          ),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'This action is permanent and cannot be undone. All your data will be deleted:',
              style: TextStyle(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.8),
              ),
            ),
            const SizedBox(height: Spacing.md),
            _bulletPoint('Your account and profile', theme),
            _bulletPoint('All session tokens', theme),
            _bulletPoint('Subscription records', theme),
            _bulletPoint('RevenueCat event history', theme),
            const SizedBox(height: Spacing.lg),
            Text(
              'Your subscription (if active) will NOT be automatically cancelled. '
              'Please cancel it through your App Store settings first.',
              style: TextStyle(
                color: theme.colorScheme.error,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: Spacing.xl),
            Text(
              'Why are you leaving? (optional)',
              style: TextStyle(
                color: theme.colorScheme.onSurface,
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: Spacing.sm),
            DropdownButtonFormField<String>(
              initialValue: _selectedReason,
              decoration: const InputDecoration(
                hintText: 'Select a reason',
                border: OutlineInputBorder(),
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
              ),
              items: _reasons
                  .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                  .toList(),
              onChanged: (v) => setState(() => _selectedReason = v),
            ),
            const SizedBox(height: Spacing.md),
            TextField(
              controller: _feedbackController,
              maxLines: 2,
              decoration: const InputDecoration(
                hintText: 'Any additional feedback? (optional)',
                border: OutlineInputBorder(),
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
              ),
            ),
            const SizedBox(height: Spacing.xl),
            Text(
              'Type DELETE to confirm:',
              style: TextStyle(
                color: theme.colorScheme.onSurface,
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: Spacing.sm),
            TextField(
              controller: _confirmController,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'DELETE',
                border: const OutlineInputBorder(),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                enabledBorder: OutlineInputBorder(
                  borderSide: BorderSide(
                    color: _canDelete
                        ? theme.colorScheme.error
                        : theme.colorScheme.outline,
                  ),
                ),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: Spacing.md),
              Text(
                _error!,
                style: TextStyle(color: theme.colorScheme.error, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isDeleting ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: _canDelete && !_isDeleting ? _performDelete : null,
          style: ElevatedButton.styleFrom(
            backgroundColor: theme.colorScheme.error,
            foregroundColor: theme.colorScheme.onError,
          ),
          child: _isDeleting
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Delete Account'),
        ),
      ],
    );
  }

  Widget _bulletPoint(String text, ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.only(left: 8, bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('  ', style: TextStyle(color: theme.colorScheme.error)),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
