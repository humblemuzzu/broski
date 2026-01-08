import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/connection_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/onboarding_widgets.dart';

class ConnectScreen extends ConsumerStatefulWidget {
  const ConnectScreen({super.key});

  @override
  ConsumerState<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends ConsumerState<ConnectScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);

    _pulseAnimation = Tween<double>(begin: 0.4, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(connectionProvider);
    final theme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Animated connection indicator
                AnimatedBuilder(
                  animation: _pulseAnimation,
                  builder: (context, child) {
                    return Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: theme.primary.withValues(
                          alpha: 0.1 * _pulseAnimation.value,
                        ),
                        border: Border.all(
                          color: theme.primary.withValues(
                            alpha: 0.3 * _pulseAnimation.value,
                          ),
                          width: 2,
                        ),
                      ),
                      child: Center(
                        child: Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: theme.primary.withValues(
                              alpha: 0.15 * _pulseAnimation.value,
                            ),
                          ),
                          child: Icon(
                            Icons.link_rounded,
                            color: theme.primary,
                            size: 24,
                          ),
                        ),
                      ),
                    );
                  },
                ),
                const SizedBox(height: 32),
                Text(
                  'Connecting...',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: theme.text,
                  ),
                ),
                const SizedBox(height: 8),
                if (state.connection != null)
                  Text(
                    '${state.connection!.localIP}:${state.connection!.port}',
                    style: TextStyle(
                      fontSize: 14,
                      color: theme.textMuted,
                      fontFamily: 'monospace',
                    ),
                  ),
                if (state.error != null) ...[
                  const SizedBox(height: 24),
                  OnboardingInfoCard(
                    icon: Icons.error_outline_rounded,
                    title: 'Connection Failed',
                    content: state.error!,
                    color: theme.error,
                  ),
                ],
                const SizedBox(height: 48),
                OnboardingButton(
                  label: 'Scan Different QR',
                  variant: OnboardingButtonVariant.ghost,
                  onPressed: () =>
                      ref.read(connectionProvider.notifier).clearConnection(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
