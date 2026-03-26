import 'package:flutter/material.dart';

/// CustomPainter that draws a glowing border around a fully rounded pill shape.
class PillGlowPainter extends CustomPainter {
  PillGlowPainter({
    required this.color,
    required this.radius,
    required this.strokeWidth,
  });
  final Color color;
  final double radius;
  final double strokeWidth;
  @override
  void paint(Canvas canvas, Size size) {
    final hw = strokeWidth / 2;
    final rect = RRect.fromRectAndRadius(
      Rect.fromLTWH(
        hw,
        hw,
        size.width - strokeWidth,
        size.height - strokeWidth,
      ),
      Radius.circular(radius - hw),
    );
    // 1) Outer glow
    final glowPaint = Paint()
      ..color = color.withValues(alpha: 0.45)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth + 8
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8);
    canvas.drawRRect(rect, glowPaint);
    // 2) Solid accent line
    final solidPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    canvas.drawRRect(rect, solidPaint);
  }

  @override
  bool shouldRepaint(covariant PillGlowPainter oldDelegate) =>
      oldDelegate.color != color ||
      oldDelegate.radius != radius ||
      oldDelegate.strokeWidth != strokeWidth;
}
