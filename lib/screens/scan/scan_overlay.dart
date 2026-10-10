import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// The scan window's cutout, corner brackets and sweeping line, drawn over the
/// live camera.
class ScanOverlay extends StatelessWidget {
  const ScanOverlay({
    super.key,
    required this.scanLineAnimation,
    required this.cornerPulseAnimation,
  });

  final AnimationController scanLineAnimation;
  final AnimationController cornerPulseAnimation;

  @override
  Widget build(BuildContext context) {
    final window = _ScanWindow.of(context);
    return Stack(
      children: [
        CustomPaint(
          size: window.size,
          painter: _OverlayPainter(scanRect: window.cutout),
        ),
        _CornerBrackets(animation: cornerPulseAnimation, window: window),
        _ScanLine(animation: scanLineAnimation, window: window),
      ],
    );
  }
}

/// Where the scan window sits, about 65% of the screen width, centred a little
/// above the middle.
class _ScanWindow {
  const _ScanWindow({
    required this.size,
    required this.left,
    required this.top,
    required this.extent,
  });

  factory _ScanWindow.of(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final extent = size.width * 0.65;
    return _ScanWindow(
      size: size,
      left: (size.width - extent) / 2,
      top: (size.height - extent) / 2 - 20,
      extent: extent,
    );
  }

  final Size size;
  final double left;
  final double top;
  final double extent;

  double get right => size.width - left - extent;
  double get bottom => size.height - top - extent;
  Rect get cutout => Rect.fromLTWH(left, top, extent, extent);
}

class _CornerBrackets extends StatelessWidget {
  const _CornerBrackets({required this.animation, required this.window});

  final AnimationController animation;
  final _ScanWindow window;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: animation,
      builder: (context, _) {
        final opacity = 0.6 + 0.4 * animation.value;
        return Stack(
          children: [
            Positioned(
              left: window.left - 2,
              top: window.top - 2,
              child: _CornerBracket(opacity: opacity, rotation: 0),
            ),
            Positioned(
              right: window.left - 2,
              top: window.top - 2,
              child: _CornerBracket(opacity: opacity, rotation: 1),
            ),
            Positioned(
              left: window.left - 2,
              bottom: window.bottom - 2,
              child: _CornerBracket(opacity: opacity, rotation: 3),
            ),
            Positioned(
              right: window.left - 2,
              bottom: window.bottom - 2,
              child: _CornerBracket(opacity: opacity, rotation: 2),
            ),
          ],
        );
      },
    );
  }
}

class _ScanLine extends StatelessWidget {
  const _ScanLine({required this.animation, required this.window});

  final AnimationController animation;
  final _ScanWindow window;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: animation,
      builder: (context, _) => Positioned(
        left: window.left + 16,
        right: window.right + 16,
        top: window.top + (window.extent * animation.value),
        child: Container(
          height: 2,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                Colors.transparent,
                const Color(0xFF2ECB71).withValues(alpha: 0.8),
                const Color(0xFF2ECB71),
                const Color(0xFF2ECB71).withValues(alpha: 0.8),
                Colors.transparent,
              ],
              stops: const [0.0, 0.2, 0.5, 0.8, 1.0],
            ),
            borderRadius: Radii.brXs,
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF2ECB71).withValues(alpha: 0.4),
                blurRadius: 12,
                spreadRadius: 2,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _OverlayPainter extends CustomPainter {
  _OverlayPainter({required this.scanRect});
  final Rect scanRect;
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = Colors.black.withValues(alpha: 0.6);
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), paint);
    final clearPaint = Paint()..blendMode = BlendMode.clear;
    canvas.saveLayer(Rect.fromLTWH(0, 0, size.width, size.height), Paint());
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), paint);
    canvas.drawRRect(
      RRect.fromRectAndRadius(scanRect, const Radius.circular(20)),
      clearPaint,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _OverlayPainter oldDelegate) =>
      oldDelegate.scanRect != scanRect;
}

class _CornerBracket extends StatelessWidget {
  const _CornerBracket({required this.opacity, required this.rotation});
  final double opacity;
  final int rotation; // 0=top-left, 1=top-right, 2=bottom-right, 3=bottom-left
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 36,
      height: 36,
      child: CustomPaint(
        painter: _CornerBracketPainter(
          color: Colors.white.withValues(alpha: opacity),
          rotation: rotation,
        ),
      ),
    );
  }
}

class _CornerBracketPainter extends CustomPainter {
  _CornerBracketPainter({required this.color, required this.rotation});
  final Color color;
  final int rotation;
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    final path = Path();
    const len = 28.0;
    switch (rotation) {
      case 0:
        path.moveTo(0, len);
        path.lineTo(0, 0);
        path.lineTo(len, 0);
        break;
      case 1:
        path.moveTo(size.width - len, 0);
        path.lineTo(size.width, 0);
        path.lineTo(size.width, len);
        break;
      case 2:
        path.moveTo(size.width, size.height - len);
        path.lineTo(size.width, size.height);
        path.lineTo(size.width - len, size.height);
        break;
      case 3:
        path.moveTo(len, size.height);
        path.lineTo(0, size.height);
        path.lineTo(0, size.height - len);
        break;
    }
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _CornerBracketPainter old) =>
      old.color != color || old.rotation != rotation;
}
