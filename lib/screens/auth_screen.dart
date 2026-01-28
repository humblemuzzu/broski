import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_auth_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/onboarding_widgets.dart';

class AuthScreen extends ConsumerWidget {
  const AuthScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(appAuthProvider);
    final theme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(),
              Icon(Icons.lock_rounded, size: 44, color: theme.primary),
              const SizedBox(height: 16),
              Text(
                'Sign in to Broski',
                style: TextStyle(
                  color: theme.text,
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'We only store your account and subscription info.',
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.textMuted, height: 1.4),
              ),
              const SizedBox(height: 24),
              if (state.error != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: theme.error.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: theme.error.withValues(alpha: 0.2),
                    ),
                  ),
                  child: Text(
                    state.error!,
                    style: TextStyle(color: theme.error),
                  ),
                ),
              const Spacer(),
              if (Platform.isIOS)
                OnboardingButton(
                  label: 'Continue with Apple',
                  icon: Icons.apple,
                  isLoading: state.isLoading,
                  onPressed: () =>
                      ref.read(appAuthProvider.notifier).signInWithApple(),
                ),
              if (Platform.isIOS) const SizedBox(height: 12),
              OnboardingButton(
                label: 'Continue with Google',
                variant: OnboardingButtonVariant.secondary,
                icon: Icons.g_mobiledata_rounded,
                isLoading: state.isLoading,
                onPressed: () =>
                    ref.read(appAuthProvider.notifier).signInWithGoogle(),
              ),
              const SizedBox(height: 16),
              Text(
                'By continuing, you agree to our Terms and Privacy Policy.',
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.textMuted, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

