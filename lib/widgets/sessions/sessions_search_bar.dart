import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

class SessionsSearchBar extends StatelessWidget {
  const SessionsSearchBar({
    super.key,
    required this.controller,
    required this.onChanged,
    this.hintText = 'Search sessions...',
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final String hintText;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return TextField(
      controller: controller,
      onChanged: onChanged,
      style: TextStyle(color: ocTheme.text, fontSize: 14),
      decoration: InputDecoration(
        hintText: hintText,
        hintStyle: TextStyle(color: ocTheme.textMuted, fontSize: 14),
        prefixIcon: Icon(AppIcons.search, color: ocTheme.textMuted, size: 20),
        suffixIcon: controller.text.isNotEmpty
            ? IconButton(
                icon: Icon(AppIcons.close, color: ocTheme.textMuted, size: 18),
                onPressed: () {
                  controller.clear();
                  onChanged('');
                },
              )
            : null,
        filled: true,
        fillColor: ocTheme.backgroundElement,
        border: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: ocTheme.borderSubtle),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: ocTheme.borderSubtle),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: ocTheme.primary),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 10,
        ),
      ),
    );
  }
}
