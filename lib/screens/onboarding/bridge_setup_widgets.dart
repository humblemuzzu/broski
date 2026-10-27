import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// A numbered step heading.
class BridgeStepHeader extends StatelessWidget {
  const BridgeStepHeader({
    super.key,
    required this.number,
    required this.title,
  });

  final String number;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: const BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              number,
              style: const TextStyle(
                color: Colors.black,
                fontSize: 15,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
        const SizedBox(width: 14),
        Text(
          title,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 22,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.3,
          ),
        ),
      ],
    );
  }
}

/// The full terminal card: traffic lights, a prompt, the command, a cursor.
class TerminalCommandCard extends StatelessWidget {
  const TerminalCommandCard({
    super.key,
    required this.copied,
    required this.cursor,
    required this.prefix,
    required this.rest,
    required this.command,
    required this.onCopy,
  });

  final bool copied;
  final Animation<double> cursor;
  final String prefix;
  final String rest;
  final String command;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: Radii.brLg,
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title bar
          Container(
            padding: Insets.section,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.04),
            ),
            child: Row(
              children: [
                _trafficDot(const Color(0xFFFF5F57)),
                const SizedBox(width: Spacing.sm),
                _trafficDot(const Color(0xFFFFBD2E)),
                const SizedBox(width: Spacing.sm),
                _trafficDot(const Color(0xFF28C840)),
                const Spacer(),
              ],
            ),
          ),
          // Body
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // $ + copy
                Row(
                  children: [
                    Text(
                      '\$',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.3),
                        fontSize: 14,
                        fontFamily: AppTypography.codeFontFamily,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const Spacer(),
                    GestureDetector(
                      onTap: () => onCopy(),
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 200),
                        child: Icon(
                          copied ? AppIcons.check : AppIcons.copy,
                          key: ValueKey('copy_$copied'),
                          color: copied
                              ? const Color(0xFF2ECB71)
                              : Colors.white.withValues(alpha: 0.35),
                          size: 18,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: Spacing.md),
                // Command
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: prefix,
                        style: TextStyle(
                          color: const Color(0xFF2ECB71),
                          fontSize: 15,
                          fontFamily: AppTypography.codeFontFamily,
                          fontWeight: FontWeight.w600,
                          height: 1.5,
                        ),
                      ),
                      if (rest.isNotEmpty)
                        TextSpan(
                          text: rest,
                          style: TextStyle(
                            color: const Color(
                              0xFF2ECB71,
                            ).withValues(alpha: 0.75),
                            fontSize: 15,
                            fontFamily: AppTypography.codeFontFamily,
                            fontWeight: FontWeight.w500,
                            height: 1.5,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 6),
                // Cursor
                FadeTransition(
                  opacity: cursor,
                  child: Container(
                    width: 8,
                    height: 18,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.5),
                      borderRadius: Radii.brXs,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The compact alternative to the terminal card, for one command and a label.
class BridgeOptionCard extends StatelessWidget {
  const BridgeOptionCard({
    super.key,
    required this.copied,
    required this.label,
    required this.description,
    required this.prefix,
    required this.rest,
    required this.command,
    required this.onCopy,
  });

  final bool copied;
  final String label;
  final String description;
  final String prefix;
  final String rest;
  final String command;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: Insets.card,
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: Radii.brLg,
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: Spacing.xs),
                    Text(
                      description,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.4),
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: () => onCopy(),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 200),
                  child: Icon(
                    copied ? AppIcons.check : AppIcons.copy,
                    key: ValueKey('copy_$copied'),
                    color: copied
                        ? const Color(0xFF2ECB71)
                        : Colors.white.withValues(alpha: 0.35),
                    size: 18,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: Spacing.md),
          // Inline command pill
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.4),
              borderRadius: Radii.brSm,
            ),
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '\$ ',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.3),
                      fontSize: 14,
                      fontFamily: AppTypography.codeFontFamily,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  TextSpan(
                    text: prefix,
                    style: TextStyle(
                      color: const Color(0xFF2ECB71),
                      fontSize: 14,
                      fontFamily: AppTypography.codeFontFamily,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (rest.isNotEmpty)
                    TextSpan(
                      text: rest,
                      style: TextStyle(
                        color: const Color(0xFF2ECB71).withValues(alpha: 0.75),
                        fontSize: 14,
                        fontFamily: AppTypography.codeFontFamily,
                        fontWeight: FontWeight.w500,
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

Widget _trafficDot(Color color) {
  return Container(
    width: 12,
    height: 12,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
  );
}
