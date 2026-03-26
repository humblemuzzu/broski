import 'package:flutter/material.dart';

/// CustomPainter that draws a glowing ∩-shaped border (left + top + right)
/// on the CLI input bar container.
class GlowBorderPainter extends CustomPainter {
  GlowBorderPainter({
    required this.color,
    required this.radius,
    required this.strokeWidth,
  });
  final Color color;
  final double radius;
  final double strokeWidth;
  @override
  void paint(Canvas canvas, Size size) {
    // Inset the path by half stroke width so the stroke sits on the container edge
    final hw = strokeWidth / 2;
    final r = radius - hw; // adjusted corner radius
    final path = Path()
      // Start at bottom-left edge
      ..moveTo(hw, size.height)
      // Up the left side to the start of the top-left corner
      ..lineTo(hw, radius)
      // Top-left rounded corner
      ..arcToPoint(Offset(radius, hw), radius: Radius.circular(r))
      // Across the top
      ..lineTo(size.width - radius, hw)
      // Top-right rounded corner
      ..arcToPoint(Offset(size.width - hw, radius), radius: Radius.circular(r))
      // Down the right side to the bottom
      ..lineTo(size.width - hw, size.height);
    // 1) Draw the outer glow (blurred, wider stroke)
    final glowPaint = Paint()
      ..color = color.withValues(alpha: 0.45)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth + 8
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8);
    canvas.drawPath(path, glowPaint);
    // 2) Draw the solid accent line on top
    final solidPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.butt;
    canvas.drawPath(path, solidPaint);
  }

  @override
  bool shouldRepaint(covariant GlowBorderPainter oldDelegate) =>
      oldDelegate.color != color ||
      oldDelegate.radius != radius ||
      oldDelegate.strokeWidth != strokeWidth;
}
