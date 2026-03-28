import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// Floating session history card with red/green glow and rollback entries.
/// Used by the Safety Net onboarding page.
class OnboardingSessionHistoryCard extends StatelessWidget {
  const OnboardingSessionHistoryCard({super.key});
  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        // ── Red glow at top
        Positioned(
          top: 0,
          left: 20,
          right: 20,
          height: 100,
          child: Container(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: Alignment.topCenter,
                radius: 1.2,
                colors: [
                  const Color(0xFFFF4444).withValues(alpha: 0.18),
                  Colors.transparent,
                ],
              ),
            ),
          ),
        ),
        // ── Green glow at bottom
        Positioned(
          bottom: 0,
          left: 20,
          right: 20,
          height: 100,
          child: Container(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: Alignment.bottomCenter,
                radius: 1.2,
                colors: [
                  const Color(0xFF50FA7B).withValues(alpha: 0.10),
                  Colors.transparent,
                ],
              ),
            ),
          ),
        ),
        // ── Card
        Center(
          child: Container(
            width: double.infinity,
            margin: const EdgeInsets.symmetric(vertical: 24),
            padding: const EdgeInsets.fromLTRB(20, 22, 20, 22),
            decoration: BoxDecoration(
              color: const Color(0xFF161616),
              borderRadius: Radii.brLg,
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.08),
                width: 1,
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ── Header
                Row(
                  children: [
                    const Text(
                      'Session History',
                      style: TextStyle(
                        fontFamily: 'GeistSans',
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                        letterSpacing: -0.2,
                      ),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.1),
                        borderRadius: Radii.brSm,
                      ),
                      child: Text(
                        'Now',
                        style: TextStyle(
                          fontFamily: 'GeistSans',
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          color: Colors.white.withValues(alpha: 0.6),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                // ── Entry 1: Modified auth.ts (error)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Column(
                      children: [
                        Container(
                          width: 10,
                          height: 10,
                          decoration: const BoxDecoration(
                            color: Color(0xFFFF4444),
                            shape: BoxShape.circle,
                          ),
                        ),
                        Container(
                          width: 1.5,
                          height: 32,
                          color: Colors.white.withValues(alpha: 0.08),
                        ),
                      ],
                    ),
                    const SizedBox(width: 14),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Modified auth.ts',
                          style: TextStyle(
                            fontSize: 14,
                            fontFamily: AppTypography.codeFontFamily,
                            color: const Color(0xFFFF6B6B),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          'Caused 2 errors',
                          style: TextStyle(
                            fontFamily: 'GeistSans',
                            fontSize: 12,
                            color: Colors.white.withValues(alpha: 0.4),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                // ── Entry 2: Rolled back (success)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      margin: const EdgeInsets.only(top: 2),
                      decoration: const BoxDecoration(
                        color: Color(0xFF50FA7B),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Rolled back to clean state',
                          style: TextStyle(
                            fontSize: 14,
                            fontFamily: AppTypography.codeFontFamily,
                            color: const Color(0xFF50FA7B),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          'Restored v2.4.1',
                          style: TextStyle(
                            fontFamily: 'GeistSans',
                            fontSize: 12,
                            color: Colors.white.withValues(alpha: 0.4),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: Spacing.xxl),
                // ── "Undo Last Action" button
                Container(
                  width: double.infinity,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.1),
                    borderRadius: Radii.brMd,
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.06),
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        AppIcons.replay,
                        size: 18,
                        color: Colors.white.withValues(alpha: 0.8),
                      ),
                      const SizedBox(width: 10),
                      Text(
                        'Undo Last Action',
                        style: TextStyle(
                          fontFamily: 'GeistSans',
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: Colors.white.withValues(alpha: 0.85),
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
    );
  }
}
