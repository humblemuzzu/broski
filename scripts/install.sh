#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh" 2>/dev/null || {
  BROSKI_DOMAIN="broskiapp.com"
  BROSKI_HELP_URL="https://${BROSKI_DOMAIN}/help"
  TAILSCALE_MAC_APPSTORE="macappstore://apps.apple.com/app/tailscale/id1475387142"
  TAILSCALE_IOS_URL="https://apps.apple.com/app/tailscale/id1470499037"
  TAILSCALE_ANDROID_URL="https://play.google.com/store/apps/details?id=com.tailscale.ipn"
  DEFAULT_BRIDGE_PORT=18274
  BROSKI_VERSION="1.0.0"
}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

TAILSCALE_CLI="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

print_banner() {
  echo -e "${CYAN}"
  cat << 'EOF'
   ██████╗ ██████╗  ██████╗ ███████╗██╗  ██╗██╗
   ██╔══██╗██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██║
   ██████╔╝██████╔╝██║   ██║███████╗█████╔╝ ██║
   ██╔══██╗██╔══██╗██║   ██║╚════██║██╔═██╗ ██║
   ██████╔╝██║  ██║╚██████╔╝███████║██║  ██╗██║
   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝
EOF
  echo -e "${NC}"
  echo "        Code from your phone. Your Mac does the work."
  echo ""
}

print_step() {
  echo -e "\n${BOLD}${BLUE}→ $1${NC}\n"
}

print_success() {
  echo -e "  ${GREEN}✓${NC} $1"
}

print_error() {
  echo -e "  ${RED}✗${NC} $1"
}

print_warning() {
  echo -e "  ${YELLOW}!${NC} $1"
}

print_info() {
  echo -e "  ${CYAN}ℹ${NC} $1"
}

ask_yes_no() {
  local prompt="$1"
  local default="${2:-Y}"
  
  if [[ "$default" == "Y" ]]; then
    prompt="$prompt [Y/n]: "
  else
    prompt="$prompt [y/N]: "
  fi
  
  read -p "$prompt" response
  response=${response:-$default}
  
  [[ "$response" =~ ^[Yy] ]]
}

wait_for_enter() {
  read -p "  Press ENTER to continue..."
}

check_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    print_error "This installer only supports macOS."
    print_info "For Linux, see: ${BROSKI_HELP_URL}"
    exit 1
  fi
  
  local macos_version=$(sw_vers -productVersion)
  print_success "macOS $macos_version"
}

check_architecture() {
  local arch=$(uname -m)
  if [[ "$arch" == "arm64" ]]; then
    print_success "Apple Silicon ($arch)"
  else
    print_success "Intel ($arch)"
  fi
}

check_bun() {
  if command -v bun &> /dev/null; then
    local version=$(bun --version)
    print_success "Bun v$version"
    return 0
  else
    print_error "Bun not found"
    return 1
  fi
}

check_opencode() {
  if command -v opencode &> /dev/null; then
    local version=$(opencode --version 2>/dev/null || echo "installed")
    print_success "OpenCode $version"
    return 0
  else
    print_error "OpenCode not found"
    return 1
  fi
}

check_broski_bridge() {
  if command -v broski-bridge &> /dev/null; then
    print_success "broski-bridge installed"
    return 0
  else
    print_error "broski-bridge not found"
    return 1
  fi
}

check_tailscale_installed() {
  if [[ -d "/Applications/Tailscale.app" ]]; then
    return 0
  else
    return 1
  fi
}

check_tailscale_connected() {
  if ! check_tailscale_installed; then
    return 1
  fi
  
  local status=$("$TAILSCALE_CLI" status 2>/dev/null)
  if [[ $? -ne 0 ]] || [[ "$status" == *"Tailscale is stopped"* ]]; then
    return 1
  fi
  
  return 0
}

get_tailscale_ip() {
  if check_tailscale_connected; then
    "$TAILSCALE_CLI" ip -4 2>/dev/null
  fi
}

install_bun() {
  print_step "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  
  if command -v bun &> /dev/null; then
    print_success "Bun installed successfully"
  else
    print_error "Bun installation failed"
    print_info "Try manually: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
}

install_opencode() {
  print_step "Installing OpenCode..."
  bun install -g opencode
  
  if command -v opencode &> /dev/null; then
    print_success "OpenCode installed successfully"
  else
    print_warning "OpenCode may need shell restart to be found"
  fi
}

install_broski_bridge() {
  print_step "Installing Broski Bridge..."
  
  local bridge_path="${SCRIPT_DIR}/../packages/bridge"
  if [[ -d "$bridge_path" ]]; then
    cd "$bridge_path"
    bun install
    bun link
    print_success "Broski Bridge linked from source"
  else
    print_warning "Bridge not found at $bridge_path"
    print_info "Run from the broski repo root, or install manually"
  fi
}

install_tailscale() {
  print_step "Installing Tailscale..."
  
  echo ""
  print_info "Tailscale is a free VPN that lets you access your Mac from anywhere."
  print_info "It's made by ex-Google engineers and used by thousands of developers."
  echo ""
  
  if check_tailscale_installed; then
    print_success "Tailscale is already installed"
    return 0
  fi
  
  print_info "Opening App Store to install Tailscale..."
  open "${TAILSCALE_MAC_APPSTORE}"
  
  echo ""
  print_info "Please install Tailscale from the App Store."
  print_info "After installing, come back here and press ENTER."
  wait_for_enter
  
  if ! check_tailscale_installed; then
    print_warning "Tailscale doesn't seem to be installed yet."
    print_info "You can install it later and run 'broski setup-tailscale'"
    return 1
  fi
  
  print_success "Tailscale installed"
  return 0
}

setup_tailscale() {
  print_step "Setting up Tailscale..."
  
  if check_tailscale_connected; then
    local ip=$(get_tailscale_ip)
    print_success "Already connected! Your Tailscale IP: $ip"
    return 0
  fi
  
  print_info "Opening Tailscale..."
  open -a Tailscale
  
  echo ""
  print_info "Please log in to Tailscale in the menu bar (top-right of screen)."
  print_info "You can use Google, Microsoft, GitHub, or email."
  echo ""
  print_info "Waiting for you to connect..."
  
  local attempts=0
  local max_attempts=60
  
  while ! check_tailscale_connected; do
    sleep 5
    attempts=$((attempts + 1))
    
    if [[ $attempts -ge $max_attempts ]]; then
      print_warning "Timeout waiting for Tailscale connection."
      print_info "You can set up Tailscale later. Run 'broski-bridge' when ready."
      return 1
    fi
    
    echo -ne "\r  Waiting... ($((attempts * 5))s)    "
  done
  
  echo ""
  local ip=$(get_tailscale_ip)
  print_success "Connected! Your Tailscale IP: $ip"
  return 0
}

show_phone_instructions() {
  local tailscale_ip=$(get_tailscale_ip)
  
  echo ""
  echo -e "${BOLD}────────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "${BOLD}  📱 PHONE SETUP${NC}"
  echo ""
  
  if [[ -n "$tailscale_ip" ]]; then
    echo "  For remote access (anywhere in the world):"
    echo ""
    echo "  1. Install Tailscale on your phone:"
    echo "     • iPhone: ${TAILSCALE_IOS_URL}"
    echo "     • Android: ${TAILSCALE_ANDROID_URL}"
    echo ""
    echo "  2. Log in with the SAME account you used on your Mac"
    echo ""
    echo "  3. Build/install the Broski app on your phone"
    echo ""
    echo "  4. Scan the QR code when you run 'broski-bridge'"
    echo ""
  else
    echo "  1. Make sure your phone is on the same WiFi as your Mac"
    echo ""
    echo "  2. Build/install the Broski app on your phone"
    echo ""
    echo "  3. Scan the QR code when you run 'broski-bridge'"
    echo ""
  fi
  
  echo -e "${BOLD}────────────────────────────────────────────────────────────────${NC}"
  echo ""
}

main() {
  clear
  print_banner
  
  echo "  Welcome! This will install everything you need to use Broski."
  echo "  It takes about 5 minutes."
  echo ""
  
  if ! ask_yes_no "  Ready to start?"; then
    echo ""
    print_info "No problem! Run this script again when you're ready."
    exit 0
  fi
  
  print_step "Step 1/4: Checking your system"
  check_macos
  check_architecture
  
  print_step "Step 2/4: Checking dependencies"
  
  local need_bun=false
  local need_opencode=false
  local need_bridge=false
  local need_tailscale_install=false
  local need_tailscale_setup=false
  local want_tailscale=true
  
  if ! check_bun; then need_bun=true; fi
  if ! check_opencode; then need_opencode=true; fi
  if ! check_broski_bridge; then need_bridge=true; fi
  
  if check_tailscale_installed; then
    if check_tailscale_connected; then
      local ts_ip=$(get_tailscale_ip)
      print_success "Tailscale connected ($ts_ip)"
    else
      print_warning "Tailscale installed but not connected"
      need_tailscale_setup=true
    fi
  else
    print_info "Tailscale not installed"
    need_tailscale_install=true
  fi
  
  if $need_tailscale_install; then
    echo ""
    echo -e "  ${BOLD}Do you want remote access?${NC}"
    echo "  This lets you code from anywhere - coffee shop, office, traveling."
    echo "  It requires Tailscale (free, 2 minutes to set up)."
    echo ""
    
    if ask_yes_no "  Install Tailscale for remote access?" "Y"; then
      want_tailscale=true
    else
      want_tailscale=false
      print_info "Skipping Tailscale. You can add it later with: broski setup-tailscale"
    fi
  fi
  
  print_step "Step 3/4: Installing components"
  
  if $need_bun; then
    install_bun
  fi
  
  if $need_opencode; then
    install_opencode
  fi
  
  if $need_bridge; then
    install_broski_bridge
  fi
  
  if $want_tailscale && $need_tailscale_install; then
    if install_tailscale; then
      setup_tailscale
    fi
  elif $need_tailscale_setup; then
    setup_tailscale
  fi
  
  print_step "Step 4/4: All done!"
  
  echo ""
  if command -v bun &> /dev/null; then
    print_success "Bun $(bun --version)"
  fi
  if command -v opencode &> /dev/null; then
    print_success "OpenCode installed"
  fi
  print_success "Broski Bridge ready"
  
  if check_tailscale_connected; then
    local ts_ip=$(get_tailscale_ip)
    print_success "Tailscale ($ts_ip)"
  elif $want_tailscale; then
    print_warning "Tailscale (not connected - connect via menu bar)"
  else
    print_info "Tailscale (skipped - local network only)"
  fi
  
  show_phone_instructions
  
  echo ""
  if ask_yes_no "  Start Broski Bridge now?" "Y"; then
    echo ""
    exec broski-bridge
  else
    echo ""
    print_info "To start Broski later, just run:"
    echo ""
    echo "      broski-bridge"
    echo ""
  fi
}

main "$@"
