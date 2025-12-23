import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/message.dart';

class MessageBubble extends StatelessWidget {
  const MessageBubble({super.key, required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == MessageRole.user;
    final isSystem = message.role == MessageRole.system;
    final isError = message.error != null;

    // Error messages get red styling
    if (isError) {
      return Align(
        alignment: Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 8),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
          constraints: const BoxConstraints(maxWidth: 340),
          decoration: BoxDecoration(
            color: const Color(0xFF2A1F1F),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xFF4A3535), width: 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.error_outline,
                    color: Color(0xFFEF4444),
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    message.error ?? 'Error',
                    style: const TextStyle(
                      color: Color(0xFFEF4444),
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
              if (message.text.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  message.text,
                  style: const TextStyle(
                    color: Color(0xFFD4D4D8),
                    fontSize: 15,
                    height: 1.5,
                  ),
                ),
              ],
            ],
          ),
        ),
      );
    }

    // System messages - skip if just diff data
    if (isSystem && message.text.isEmpty) {
      return const SizedBox.shrink();
    }

    // User messages - right aligned, blue accent
    if (isUser) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.only(left: 50, right: 0, top: 8, bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          decoration: BoxDecoration(
            color: const Color(0xFF3B82F6),
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(20),
              topRight: Radius.circular(20),
              bottomLeft: Radius.circular(20),
              bottomRight: Radius.circular(4),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.1),
                blurRadius: 6,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Text(
            message.text,
            style: GoogleFonts.inter(
              color: Colors.white,
              fontSize: 15,
              height: 1.5,
              fontWeight: FontWeight.w400,
            ),
          ),
        ),
      );
    }

    // AI messages - left aligned, subtle styling with markdown support
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(right: 50, left: 0, top: 8, bottom: 8),
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: const Color(0xFF1F2128),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFF2A2D36), width: 1),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // AI badge - subtle, minimal
            Row(
              children: [
                Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    color: const Color(0xFF2A2D36),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.auto_awesome,
                    size: 14,
                    color: Color(0xFF6B7280),
                  ),
                ),
                const SizedBox(width: 8),
                const Spacer(),
                if (message.isStreaming) _buildStreamingCursor(),
              ],
            ),
            const SizedBox(height: 12),

            // Message text with markdown
            if (message.text.isEmpty)
              Text(
                'Thinking...',
                style: GoogleFonts.inter(
                  fontSize: 15,
                  color: const Color(0xFF71717A),
                  height: 1.6,
                  fontStyle: FontStyle.italic,
                ),
              )
            else
              MarkdownBody(
                data: message.text,
                selectable: true,
                styleSheet: MarkdownStyleSheet(
                  p: GoogleFonts.inter(
                    fontSize: 15,
                    color: const Color(0xFFD4D4D8),
                    height: 1.6,
                  ),
                  h1: GoogleFonts.inter(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFFE4E4E7),
                    height: 1.4,
                  ),
                  h2: GoogleFonts.inter(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFFE4E4E7),
                    height: 1.4,
                  ),
                  h3: GoogleFonts.inter(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFFE4E4E7),
                    height: 1.4,
                  ),
                  strong: const TextStyle(
                    fontWeight: FontWeight.w600,
                    color: Color(0xFFE4E4E7),
                  ),
                  em: const TextStyle(
                    fontStyle: FontStyle.italic,
                    color: Color(0xFFD4D4D8),
                  ),
                  code: GoogleFonts.jetBrainsMono(
                    fontSize: 14,
                    backgroundColor: const Color(0xFF17181C),
                    color: const Color(0xFF93C5FD),
                  ),
                  codeblockPadding: const EdgeInsets.all(12),
                  codeblockDecoration: BoxDecoration(
                    color: const Color(0xFF17181C),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF2A2D36)),
                  ),
                  listBullet: GoogleFonts.inter(
                    fontSize: 15,
                    color: const Color(0xFF71717A),
                  ),
                  listIndent: 24,
                  blockquotePadding: const EdgeInsets.only(left: 16),
                  blockquoteDecoration: const BoxDecoration(
                    border: Border(
                      left: BorderSide(color: Color(0xFF3B82F6), width: 3),
                    ),
                  ),
                  a: const TextStyle(
                    color: Color(0xFF60A5FA),
                    decoration: TextDecoration.underline,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildStreamingCursor() {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.0, end: 1.0),
      duration: const Duration(milliseconds: 800),
      builder: (context, value, child) {
        return Opacity(
          opacity: value > 0.5 ? 1.0 : 0.2,
          child: Container(
            width: 7,
            height: 7,
            decoration: const BoxDecoration(
              color: Color(0xFF60A5FA),
              shape: BoxShape.circle,
            ),
          ),
        );
      },
      onEnd: () {
        // Loop the animation
      },
    );
  }
}
