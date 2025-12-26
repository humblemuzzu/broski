#!/bin/bash
# ============================================================================
# Broski Configuration
# Single source of truth for all domain/URL configuration
# ============================================================================

# ============================================================================
# CHANGE THIS WHEN YOUR DOMAIN IS LIVE
# ============================================================================
BROSKI_DOMAIN="broskiapp.dev"
BROSKI_INSTALL_URL="https://${BROSKI_DOMAIN}/install"
BROSKI_HELP_URL="https://${BROSKI_DOMAIN}/help"
BROSKI_DOCS_URL="https://${BROSKI_DOMAIN}/docs"

# App Store URLs
TAILSCALE_IOS_URL="https://apps.apple.com/app/tailscale/id1470499037"
TAILSCALE_ANDROID_URL="https://play.google.com/store/apps/details?id=com.tailscale.ipn"
TAILSCALE_MAC_APPSTORE="macappstore://apps.apple.com/app/tailscale/id1475387142"

# Broski App URLs (update when app is on stores)
BROSKI_IOS_URL=""  # TODO: Add when published
BROSKI_ANDROID_URL=""  # TODO: Add when published

# Bridge defaults
DEFAULT_BRIDGE_PORT=18274
OPENCODE_INSTALL_CMD="bun install -g opencode"

# Version
BROSKI_VERSION="1.0.0"
