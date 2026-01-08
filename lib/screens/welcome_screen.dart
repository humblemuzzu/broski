import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/onboarding_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/onboarding_widgets.dart';

class WelcomeScreen extends ConsumerStatefulWidget {
  const WelcomeScreen({super.key});

  @override
  ConsumerState<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends ConsumerState<WelcomeScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );

    _fadeAnimation = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.0, 0.6, curve: Curves.easeOut),
    );

    _slideAnimation =
        Tween<Offset>(begin: const Offset(0, 0.1), end: Offset.zero).animate(
          CurvedAnimation(
            parent: _animController,
            curve: const Interval(0.0, 0.6, curve: Curves.easeOutCubic),
          ),
        );

    _animController.forward();
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(flex: 1),
              // Hero section
              FadeTransition(
                opacity: _fadeAnimation,
                child: SlideTransition(
                  position: _slideAnimation,
                  child: Column(
                    children: [
                      _buildLogo(theme),
                      const SizedBox(height: 28),
                      Text(
                        'Broski',
                        style: TextStyle(
                          fontSize: 36,
                          fontWeight: FontWeight.bold,
                          color: theme.text,
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Control AI coding agents\nfrom your phone',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 18,
                          color: theme.textMuted,
                          height: 1.4,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const Spacer(flex: 1),
              // Features
              FadeTransition(
                opacity: _fadeAnimation,
                child: Column(
                  children: [
                    OnboardingFeatureRow(
                      icon: Icons.smartphone_rounded,
                      title: 'Your Phone',
                      subtitle: 'Chat, approve, and control remotely',
                      iconColor: theme.primary,
                    ),
                    const SizedBox(height: 12),
                    OnboardingFeatureRow(
                      icon: Icons.computer_rounded,
                      title: 'Your Mac',
                      subtitle: 'Runs OpenCode, Claude Code, or Codex',
                      iconColor: theme.info,
                    ),
                    const SizedBox(height: 12),
                    OnboardingFeatureRow(
                      icon: Icons.wifi_rounded,
                      title: 'Anywhere',
                      subtitle: 'Same WiFi or across the world',
                      iconColor: theme.success,
                    ),
                  ],
                ),
              ),
              const Spacer(flex: 1),
              // Actions
              FadeTransition(
                opacity: _fadeAnimation,
                child: Column(
                  children: [
                    OnboardingButton(
                      label: 'Get Started',
                      onPressed: () {
                        ref
                            .read(onboardingProvider.notifier)
                            .setHasMacSetup(false);
                      },
                    ),
                    const SizedBox(height: 12),
                    OnboardingButton(
                      label: 'I already have the bridge running',
                      variant: OnboardingButtonVariant.ghost,
                      onPressed: () {
                        ref
                            .read(onboardingProvider.notifier)
                            .setHasMacSetup(true);
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLogo(OpenCodeTheme theme) {
    return Container(
      width: 88,
      height: 88,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            theme.primary.withValues(alpha: 0.2),
            theme.primary.withValues(alpha: 0.08),
          ],
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: theme.primary.withValues(alpha: 0.3),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: theme.primary.withValues(alpha: 0.2),
            blurRadius: 32,
            spreadRadius: 0,
          ),
        ],
      ),
      child: Icon(Icons.code_rounded, size: 40, color: theme.primary),
    );
  }
}
