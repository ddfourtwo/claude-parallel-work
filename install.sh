#!/bin/bash

# Claude Parallel Work MCP Server Installation Script
# Interactive installer with configuration generation + CLI command setup

set -e

# Parse command line arguments
USE_DEFAULTS=false
for arg in "$@"; do
    case $arg in
        --default|--defaults)
            USE_DEFAULTS=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --default, --defaults    Run with all default values (non-interactive)"
            echo "  --help, -h              Show this help message"
            echo ""
            echo "Examples:"
            echo "  ./install.sh            Interactive installation"
            echo "  ./install.sh --default  Non-interactive installation with defaults"
            exit 0
            ;;
    esac
done

echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                        ║"
echo "║    ███████╗  █████╗ ███████╗ █████╗ ██╗     ██╗     ███████╗██╗        ║"
echo "║    ██╔══██╗██╔══██╗██╔══██╗ ██╔══██╗██║     ██║     ██╔════╝██║        ║"
echo "║    ███████║███████║███████╔╝███████║██║     ██║     █████╗  ██║        ║"
echo "║    ██╔════╝██╔══██║██╔══██╗ ██╔══██║██║     ██║     ██╔══╝  ██║        ║"
echo "║    ██║     ██║  ██║██║  ██║ ██║  ██║███████╗███████╗███████╗███████╗   ║"
echo "║    ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚══════╝   ║"
echo "║                                                                        ║"
echo "║    ██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗                                 ║"
echo "║    ██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝                                 ║"
echo "║    ██║ █╗ ██║██║   ██║██████╔╝█████╔╝                                  ║"
echo "║    ██║███╗██║██║   ██║██╔══██╗██╔═██╗                                  ║"
echo "║    ╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗                                 ║"
echo "║     ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝                                 ║"
echo "║                                                                        ║"
echo "║         🚀 PARALLEL TASK EXECUTION • 🔒 SECURE CONTAINERS              ║"
echo "║                                                                        ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
if [ "$USE_DEFAULTS" = true ]; then
    echo "Running in non-interactive mode with defaults..."
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
DEFAULT_INSTALL_DIR="$HOME/mcp-servers/claude-parallel-work"
DEFAULT_DEBUG="false"
DEFAULT_CONTAINER_DEBUG="false"
DEFAULT_SUPERVISOR_MODE="true"

# Functions
print_header() {
    # Header is now shown at the beginning of the script
    :
}

print_step() {
    echo -e "${BLUE}▶${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${PURPLE}ℹ${NC} $1"
}

# Helper function for prompts that respects --default flag
prompt_with_default() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    
    if [ "$USE_DEFAULTS" = true ]; then
        eval "$var_name='$default'"
        echo -e "${CYAN}$prompt${NC} ${GREEN}[Using default: $default]${NC}"
    else
        read -p "$prompt" "$var_name"
        eval "$var_name=\${$var_name:-$default}"
    fi
}

detect_docker_provider() {
    print_step "Checking Docker environment..."
    
    # Initialize variables
    DOCKER_AVAILABLE=false
    DOCKER_PROVIDER="none"
    DOCKER_HOST_DETECTED=""
    DOCKER_STATUS="not_installed"
    
    # Check current environment
    if [ -n "$DOCKER_HOST" ]; then
        print_info "Existing DOCKER_HOST found: $DOCKER_HOST"
        DOCKER_HOST_DETECTED="$DOCKER_HOST"
    fi
    
    # Check if docker command exists
    if ! command -v docker &> /dev/null; then
        print_warning "Docker command not found"
        
        # Check for Colima
        if command -v colima &> /dev/null; then
            print_info "Colima detected but Docker CLI not found"
            print_info "You may need to install docker client: brew install docker"
        fi
        
        return
    fi
    
    # Docker command exists, now detect provider
    
    # 1. Check for Colima - improved detection logic
    if command -v colima &> /dev/null; then
        print_info "Colima command found, checking status..."
        COLIMA_STATUS=$(colima status 2>&1 || echo "not running")
        print_info "Colima status output: $COLIMA_STATUS"
        
        # Check if Colima is running - look for runtime info in status output
        if [[ "$COLIMA_STATUS" == *"runtime:"* ]] || [[ "$COLIMA_STATUS" == *"colima is running"* ]]; then
            print_success "Colima confirmed running"
            
            # First check if Colima context is active
            ACTIVE_CONTEXT=$(docker context ls --format "{{.Name}}" --filter "current=true" 2>/dev/null | head -1 || echo "")
            print_info "Active Docker context: ${ACTIVE_CONTEXT:-default}"
            
            # Extract socket path from Colima status output
            # Look for line containing "socket:" and extract the unix:// path
            COLIMA_SOCKET_LINE=$(echo "$COLIMA_STATUS" | grep "socket:" || echo "")
            if [[ -n "$COLIMA_SOCKET_LINE" ]]; then
                # Extract everything after "socket: " (handles both with and without quotes)
                COLIMA_SOCKET_PATH=$(echo "$COLIMA_SOCKET_LINE" | sed -E 's/.*socket:[[:space:]]*//' | tr -d '"')
                print_info "Found socket in status: $COLIMA_SOCKET_PATH"
                DOCKER_HOST_DETECTED="$COLIMA_SOCKET_PATH"
            else
                # Fallback to default Colima socket path
                COLIMA_SOCKET="$HOME/.colima/default/docker.sock"
                if [ -S "$COLIMA_SOCKET" ]; then
                    DOCKER_HOST_DETECTED="unix://$COLIMA_SOCKET"
                    print_info "Using default Colima socket: $DOCKER_HOST_DETECTED"
                fi
            fi
            
            # Verify Docker works and set provider
            if docker info &> /dev/null 2>&1; then
                DOCKER_PROVIDER="colima"
                print_success "Colima detected as Docker provider"
                print_info "Using socket: $DOCKER_HOST_DETECTED"
                
                # Store Colima version
                COLIMA_VERSION=$(colima version 2>/dev/null | head -n1 || echo "unknown")
            else
                print_warning "Colima running but Docker API not accessible"
            fi
            
        else
            print_info "Colima installed but not running"
            print_info "Status: $COLIMA_STATUS"
            print_info "Start it with: colima start"
        fi
    else
        print_info "Colima not found in PATH"
    fi
    
    # 2. Check for Docker Desktop
    if [ "$DOCKER_PROVIDER" = "none" ]; then
        # Check for Docker Desktop on macOS
        if [ -d "/Applications/Docker.app" ] || [ -d "$HOME/Applications/Docker.app" ]; then
            # Docker Desktop for Mac - check if docker is accessible
            if docker info &> /dev/null; then
                DOCKER_PROVIDER="docker-desktop"
                DOCKER_HOST=""  # Docker Desktop uses default socket
                print_success "Docker Desktop detected and running"
            else
                print_info "Docker Desktop installed but Docker daemon not accessible"
            fi
        elif [ -S "/var/run/docker.sock" ]; then
            # Standard Docker socket exists
            if docker info &> /dev/null; then
                DOCKER_PROVIDER="docker-desktop"
                DOCKER_HOST=""
                print_success "Docker detected via standard socket"
            fi
        elif [ -f "/usr/bin/dockerd" ] || [ -f "/usr/local/bin/dockerd" ]; then
            # Native Docker daemon (Linux)
            if systemctl is-active docker &>/dev/null || service docker status &>/dev/null; then
                DOCKER_PROVIDER="native"
                DOCKER_HOST=""
                print_success "Native Docker daemon detected and running"
            fi
        fi
    fi
    
    # 3. Check for Podman (Docker compatibility)
    if [ "$DOCKER_PROVIDER" = "none" ] && command -v podman &> /dev/null; then
        if podman machine list 2>/dev/null | grep -q "Running"; then
            DOCKER_PROVIDER="podman"
            print_info "Podman detected in Docker compatibility mode"
        fi
    fi
    
    # Final fallback - if Docker works but provider is still unknown
    if [ "$DOCKER_PROVIDER" = "none" ] && docker info &> /dev/null; then
        # Check current DOCKER_HOST to determine provider
        if [ -n "$DOCKER_HOST_DETECTED" ]; then
            if [[ "$DOCKER_HOST_DETECTED" == *"colima"* ]]; then
                DOCKER_PROVIDER="colima"
                print_info "Detected Colima via DOCKER_HOST: $DOCKER_HOST_DETECTED"
            else
                DOCKER_PROVIDER="unknown"
                print_info "Docker working with custom DOCKER_HOST: $DOCKER_HOST_DETECTED"
            fi
        else
            DOCKER_PROVIDER="unknown"
            print_info "Docker working but provider could not be determined"
        fi
    fi
    
    # Test Docker connectivity regardless of provider
    if docker info &> /dev/null; then
        DOCKER_AVAILABLE=true
        DOCKER_STATUS="operational"
        print_success "Docker API connectivity confirmed"
        
        # Show Docker info
        DOCKER_VERSION=$(docker --version 2>/dev/null || echo "version unknown")
        print_info "Docker version: $DOCKER_VERSION"
        print_success "Provider: $DOCKER_PROVIDER"
        
        # Preserve existing DOCKER_HOST if it's already set and working
        if [ -n "$DOCKER_HOST_DETECTED" ] && [ "$DOCKER_PROVIDER" != "docker-desktop" ]; then
            print_info "Using DOCKER_HOST: $DOCKER_HOST_DETECTED"
        fi
        
        # Test container functionality
        if docker run --rm hello-world &> /dev/null; then
            print_success "Container execution test passed"
        else
            print_warning "Container execution test failed - may have permission issues"
        fi
        
    else
        print_error "Docker command available but API not accessible"
        DOCKER_STATUS="api_unreachable"
        DOCKER_AVAILABLE=false
        
        echo
        print_info "💡 Troubleshooting suggestions:"
        if command -v colima &> /dev/null; then
            echo "   - Start Colima: colima start"
        fi
        if [ -d "/Applications/Docker.app" ]; then
            echo "   - Start Docker Desktop from Applications"
        fi
        echo "   - Check Docker daemon: docker version"
        echo "   - Check permissions: sudo usermod -aG docker $USER"
    fi
}

check_prerequisites() {
    print_step "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ from https://nodejs.org"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | sed 's/v//')
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d. -f1)
    if [ "$NODE_MAJOR" -lt 18 ]; then
        print_error "Node.js version $NODE_VERSION detected. Please upgrade to Node.js 18+"
        exit 1
    fi
    print_success "Node.js $NODE_VERSION detected"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm"
        exit 1
    fi
    print_success "npm $(npm --version) detected"
    
    # Check Git
    if ! command -v git &> /dev/null; then
        print_error "Git is not installed. Please install Git"
        exit 1
    fi
    print_success "Git $(git --version | cut -d' ' -f3) detected"
    
    # Check Docker with provider detection
    detect_docker_provider
}

detect_existing_installation() {
    if [ -d "$DEFAULT_INSTALL_DIR" ]; then
        EXISTING_INSTALL=true
        print_info "Existing installation detected at: $DEFAULT_INSTALL_DIR"
        
        # Try to read existing configuration
        if [ -f "$DEFAULT_INSTALL_DIR/.env" ]; then
            EXISTING_CONFIG=true
            print_info "Existing configuration found"
            
            # Parse existing settings
            if grep -q "MCP_CLAUDE_DEBUG=true" "$DEFAULT_INSTALL_DIR/.env" 2>/dev/null; then
                EXISTING_DEBUG="true"
            else
                EXISTING_DEBUG="false"
            fi
            
            if grep -q "MCP_ENABLE_SECURE_EXECUTION=true" "$DEFAULT_INSTALL_DIR/.env" 2>/dev/null; then
                EXISTING_SECURE="true"
            else
                EXISTING_SECURE="false"
            fi
            
            
            # Check for container debug setting
            if grep -q "CLAUDE_PARALLEL_DEBUG_NO_CLEANUP=true" "$DEFAULT_INSTALL_DIR/.env" 2>/dev/null; then
                EXISTING_CONTAINER_DEBUG="true"
            else
                EXISTING_CONTAINER_DEBUG="false"
            fi
        else
            EXISTING_CONFIG=false
        fi
    else
        EXISTING_INSTALL=false
        EXISTING_CONFIG=false
    fi
}

get_user_input() {
    print_step "Gathering installation preferences..."
    echo
    
    # Check for existing installation
    detect_existing_installation
    
    if [ "$EXISTING_INSTALL" = true ]; then
        echo -e "${YELLOW}Existing installation found!${NC}"
        if [ "$EXISTING_CONFIG" = true ]; then
            echo -e "Current settings:"
            echo "  Debug mode: $EXISTING_DEBUG"
            echo "  Secure execution: $EXISTING_SECURE"
            if [ "$DOCKER_AVAILABLE" = true ]; then
                echo "  Container debug: $EXISTING_CONTAINER_DEBUG"
            fi
            echo
            echo -e "${CYAN}What would you like to do?${NC}"
            echo "1. Update with current settings (recommended)"
            echo "2. Reconfigure all settings"
            echo "3. Cancel installation"
            prompt_with_default "Choose [1/2/3] (default: 1): " "1" UPDATE_CHOICE
            
            case "$UPDATE_CHOICE" in
                1)
                    # Use existing settings
                    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
                    DEBUG_MODE="$EXISTING_DEBUG"
                    SECURE_EXECUTION="$EXISTING_SECURE"
                    CONTAINER_DEBUG="$EXISTING_CONTAINER_DEBUG"
                    SKIP_CONFIG_PROMPTS=true
                    ;;
                2)
                    SKIP_CONFIG_PROMPTS=false
                    ;;
                3)
                    echo "Installation cancelled."
                    exit 0
                    ;;
                *)
                    print_info "Invalid choice, using existing settings"
                    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
                    DEBUG_MODE="$EXISTING_DEBUG"
                    SECURE_EXECUTION="$EXISTING_SECURE"
                    CONTAINER_DEBUG="$EXISTING_CONTAINER_DEBUG"
                    SKIP_CONFIG_PROMPTS=true
                    ;;
            esac
        else
            echo "No configuration file found, will reconfigure."
            SKIP_CONFIG_PROMPTS=false
        fi
    else
        SKIP_CONFIG_PROMPTS=false
    fi
    
    if [ "$SKIP_CONFIG_PROMPTS" = false ]; then
        # Installation directory
        echo -e "${CYAN}Where would you like to install claude-parallel-work?${NC}"
        echo -e "Default: ${DEFAULT_INSTALL_DIR}"
        prompt_with_default "Install directory (press Enter for default): " "$DEFAULT_INSTALL_DIR" INSTALL_DIR
        
        # Advanced settings
        echo
        echo -e "${CYAN}Configure advanced settings? [y/N]${NC}"
        prompt_with_default "Advanced config [y/N] (default: N): " "N" ADVANCED_INPUT
        if [[ "$ADVANCED_INPUT" =~ ^[yY] ]]; then
            # Debug mode
            echo
            echo -e "${CYAN}Enable debug mode? (recommended for troubleshooting)${NC}"
            echo -e "Shows detailed execution logs and error messages"
            echo -e "Default: ${DEFAULT_DEBUG}"
            prompt_with_default "Enable debug [y/N] (default: N): " "N" DEBUG_INPUT
            case "$DEBUG_INPUT" in
                [yY]|[yY][eE][sS]) DEBUG_MODE="true" ;;
                [nN]|[nN][oO]) DEBUG_MODE="false" ;;
                *) DEBUG_MODE="$DEFAULT_DEBUG" ;;
            esac
            
            # Secure execution - always enabled when Docker is available
            if [ "$DOCKER_AVAILABLE" = true ]; then
                SECURE_EXECUTION="true"
                print_info "Secure containerized execution enabled (Docker available)"
            else
                print_warning "Docker not available - secure execution will be disabled"
                SECURE_EXECUTION="false"
            fi
            
            # Server supervisor mode
            echo
            echo -e "${CYAN}Enable automatic server restart on crashes?${NC}"
            echo -e "The supervisor monitors the MCP server and automatically restarts it if it crashes"
            echo -e "This improves reliability but uses slightly more resources"
            echo -e "Default: Y"
            prompt_with_default "Enable supervisor mode [Y/n] (default: Y): " "Y" SUPERVISOR_INPUT
            case "$SUPERVISOR_INPUT" in
                [nN]|[nN][oO]) SUPERVISOR_MODE="false" ;;
                *) SUPERVISOR_MODE="true" ;;
            esac
            
            # Container debug mode
            if [ "$DOCKER_AVAILABLE" = true ]; then
                echo
                echo -e "${CYAN}Keep containers running after execution for debugging?${NC}"
                echo -e "This prevents automatic container cleanup (useful for debugging)"
                echo -e "Default: ${DEFAULT_CONTAINER_DEBUG}"
                prompt_with_default "Enable container debug [y/N] (default: N): " "N" CONTAINER_DEBUG_INPUT
                case "$CONTAINER_DEBUG_INPUT" in
                    [yY]|[yY][eE][sS]) CONTAINER_DEBUG="true" ;;
                    [nN]|[nN][oO]) CONTAINER_DEBUG="false" ;;
                    *) CONTAINER_DEBUG="$DEFAULT_CONTAINER_DEBUG" ;;
                esac
            else
                CONTAINER_DEBUG="false"
            fi
        else
            # Use defaults when not configuring advanced settings
            DEBUG_MODE="$DEFAULT_DEBUG"
            if [ "$DOCKER_AVAILABLE" = true ]; then
                SECURE_EXECUTION="true"
            else
                SECURE_EXECUTION="false"
            fi
            CONTAINER_DEBUG="$DEFAULT_CONTAINER_DEBUG"
            SUPERVISOR_MODE="$DEFAULT_SUPERVISOR_MODE"
        fi
    fi
    
    echo
    if [ "$EXISTING_INSTALL" = true ]; then
        print_info "Update configuration:"
    else
        print_info "Installation configuration:"
    fi
    echo "  Install directory: $INSTALL_DIR"
    echo "  Debug mode: $DEBUG_MODE"
    echo "  Secure execution: $SECURE_EXECUTION"
    echo "  Supervisor mode: $SUPERVISOR_MODE"
    if [ "$DOCKER_AVAILABLE" = true ]; then
        echo "  Container debug: $CONTAINER_DEBUG"
    fi
    echo
    
    if [ "$EXISTING_INSTALL" = true ]; then
        prompt_with_default "Proceed with update? [Y/n] (default: Y): " "Y" CONFIRM
    else
        prompt_with_default "Proceed with installation? [Y/n] (default: Y): " "Y" CONFIRM
    fi
    
    if [[ "$CONFIRM" =~ ^[nN] ]]; then
        echo "Operation cancelled."
        exit 0
    fi
}

install_server() {
    if [ "$EXISTING_INSTALL" = true ]; then
        print_step "Updating claude-parallel-work MCP server..."
    else
        print_step "Installing claude-parallel-work MCP server..."
    fi
    
    # Capture original working directory before we change directories
    ORIGINAL_DIR="$(pwd)"
    
    # Create install directory
    mkdir -p "$(dirname "$INSTALL_DIR")"
    
    # Clone or update repository
    if [ -d "$INSTALL_DIR" ]; then
        print_info "Directory exists, updating..."
        
        # Check if we can change to the directory
        if ! cd "$INSTALL_DIR" 2>/dev/null; then
            print_error "Cannot access directory: $INSTALL_DIR"
            exit 1
        fi
        
        print_info "Changed to directory: $(pwd)"
        
        # Check if it's a git repository
        if [ -d ".git" ]; then
            print_info "Checking git repository configuration..."
            
            # Check if we're pointing to the old repository
            CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
            if [[ "$CURRENT_REMOTE" == *"grahama1970/claude-code-mcp-enhanced"* ]]; then
                print_info "Updating git remote URL to new repository..."
                if git remote set-url origin https://github.com/ddfourtwo/claude-parallel-work.git; then
                    print_success "Git remote updated to ddfourtwo/claude-parallel-work"
                else
                    print_error "Failed to update git remote URL"
                    exit 1
                fi
            fi
            
            # Try to check git status first
            if ! git status &>/dev/null; then
                print_warning "Git repository appears corrupted"
                print_info "Skipping git operations - will use local source files"
            elif ! git remote get-url origin &>/dev/null; then
                print_warning "No git remote 'origin' configured"
                print_info "Skipping git pull - using local files"
            else
                # Check what remote we have
                REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
                print_info "Current remote: $REMOTE_URL"
                
                # Only try to pull if we have a valid remote
                if [ -n "$REMOTE_URL" ]; then
                    print_info "Attempting to pull latest changes..."
                    # Add timeout to prevent hanging, and skip if it fails
                    if timeout 10s git pull origin main 2>&1 | tee /tmp/git-pull-output.log; then
                        print_success "Code updated successfully"
                    else
                        if [ $? -eq 124 ]; then
                            print_warning "Git pull timed out after 10 seconds"
                        else
                            print_warning "Git pull failed (this is okay, will use local files)"
                        fi
                        if [ -f /tmp/git-pull-output.log ]; then
                            print_info "Git output: $(cat /tmp/git-pull-output.log | head -3)"
                        fi
                        print_info "Continuing with existing files..."
                    fi
                else
                    print_info "No valid remote URL, skipping pull"
                fi
            fi
            
            # After git operations (success or failure), check if we need to update from local source
            if [ "$ORIGINAL_DIR" != "$INSTALL_DIR" ]; then
                print_info "Checking for local source updates..."
                
                # Check if we're running from the source repository
                # Use original directory that we captured earlier
                SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
                
                print_info "Original working directory: $ORIGINAL_DIR"
                print_info "Script directory: $SCRIPT_DIR"
                print_info "Install directory: $INSTALL_DIR"
                
                # Check original directory first, then script directory
                SOURCE_DIR=""
                if [ -f "$ORIGINAL_DIR/package.json" ] && grep -q "claude-parallel-work" "$ORIGINAL_DIR/package.json" 2>/dev/null; then
                    SOURCE_DIR="$ORIGINAL_DIR"
                    print_info "Found claude-parallel-work package.json in original directory"
                elif [ -f "$SCRIPT_DIR/package.json" ] && grep -q "claude-parallel-work" "$SCRIPT_DIR/package.json" 2>/dev/null; then
                    SOURCE_DIR="$SCRIPT_DIR"
                    print_info "Found claude-parallel-work package.json in script directory"
                fi
                
                if [ -n "$SOURCE_DIR" ]; then
                    # Check if source and destination are the same
                    if [ "$SOURCE_DIR" = "$INSTALL_DIR" ]; then
                        print_info "Source and destination are the same - skipping copy"
                        print_success "Already running from install directory"
                    else
                        # Copy source files (excluding .git and node_modules)
                        print_info "Copying from $SOURCE_DIR to $INSTALL_DIR"
                        if command -v rsync &> /dev/null; then
                            rsync -av --exclude='.git' --exclude='node_modules' --exclude='dist' "$SOURCE_DIR/" "$INSTALL_DIR/"
                        else
                            # Fallback to cp if rsync not available
                            cp -r "$SOURCE_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true
                            rm -rf "$INSTALL_DIR/.git" "$INSTALL_DIR/node_modules" "$INSTALL_DIR/dist" 2>/dev/null || true
                        fi
                        
                        # Ensure executable permissions for shell scripts
                        chmod +x "$INSTALL_DIR/launch-dashboard.sh" 2>/dev/null || true
                        chmod +x "$INSTALL_DIR/install.sh" 2>/dev/null || true
                        
                        print_success "Local files copied successfully"
                    fi
                else
                    print_error "Cannot access remote repository and no local source found"
                    print_info "Please either:"
                    print_info "  1. Push the repository to GitHub: git push -u origin main"
                    print_info "  2. Make the repository public on GitHub"
                    print_info "  3. Use SSH authentication for private repositories"
                    exit 1
                fi
            fi
        else
            print_warning "Directory exists but is not a git repository"
            print_info "Backing up existing directory and cloning fresh..."
            cd ..
            mv "$INSTALL_DIR" "${INSTALL_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
            git clone https://github.com/ddfourtwo/claude-parallel-work.git "$INSTALL_DIR"
            cd "$INSTALL_DIR"
        fi
    else
        print_info "Cloning repository..."
        if git clone https://github.com/ddfourtwo/claude-parallel-work.git "$INSTALL_DIR"; then
            print_success "Repository cloned successfully"
            cd "$INSTALL_DIR"
        else
            print_warning "Failed to clone from remote repository"
            print_info "Falling back to local repository copy..."
            
            # Check if we're running from the source repository
            # Use original directory that we captured earlier
            SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            
            print_info "Original working directory: $ORIGINAL_DIR"
            print_info "Script directory: $SCRIPT_DIR"
            print_info "Install directory: $INSTALL_DIR"
            
            # Check original directory first, then script directory
            SOURCE_DIR=""
            if [ -f "$ORIGINAL_DIR/package.json" ] && grep -q "claude-parallel-work" "$ORIGINAL_DIR/package.json" 2>/dev/null; then
                SOURCE_DIR="$ORIGINAL_DIR"
                print_info "Found claude-parallel-work package.json in original directory"
            elif [ -f "$SCRIPT_DIR/package.json" ] && grep -q "claude-parallel-work" "$SCRIPT_DIR/package.json" 2>/dev/null; then
                SOURCE_DIR="$SCRIPT_DIR"
                print_info "Found claude-parallel-work package.json in script directory"
            fi
            
            if [ -n "$SOURCE_DIR" ]; then
                # Create install directory and copy files
                mkdir -p "$INSTALL_DIR"
                
                # Check if source and destination are the same
                if [ "$SOURCE_DIR" = "$INSTALL_DIR" ]; then
                    print_info "Source and destination are the same - skipping copy"
                    print_success "Already running from install directory"
                else
                    print_info "Copying from $SOURCE_DIR to $INSTALL_DIR"
                    if command -v rsync &> /dev/null; then
                        rsync -av --exclude='.git' --exclude='node_modules' --exclude='dist' "$SOURCE_DIR/" "$INSTALL_DIR/"
                    else
                        # Fallback to cp if rsync not available
                        cp -r "$SOURCE_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true
                        rm -rf "$INSTALL_DIR/.git" "$INSTALL_DIR/node_modules" "$INSTALL_DIR/dist" 2>/dev/null || true
                    fi
                    
                    # Ensure executable permissions for shell scripts
                    chmod +x "$INSTALL_DIR/launch-dashboard.sh" 2>/dev/null || true
                    chmod +x "$INSTALL_DIR/install.sh" 2>/dev/null || true
                    
                    print_success "Local files copied successfully"
                fi
                cd "$INSTALL_DIR"
                
                # Initialize as git repository
                git init
                git remote add origin https://github.com/ddfourtwo/claude-parallel-work.git
                git add .
                git commit -m "Initial install from local source"
                
                print_success "Local installation created successfully"
            else
                print_error "Cannot access remote repository and no local source found"
                print_info "Please either:"
                print_info "  1. Push the repository to GitHub first"
                print_info "  2. Make the repository public on GitHub"
                print_info "  3. Run this script from the claude-parallel-work source directory"
                exit 1
            fi
        fi
    fi
    
    # Install dependencies
    print_info "Installing Node.js dependencies..."
    npm install
    
    # Run cleanup script if it exists
    if [ -f "cleanup-old-files.sh" ]; then
        print_info "Running cleanup to remove obsolete files..."
        ./cleanup-old-files.sh
    fi
    
    # Build project
    print_info "Building TypeScript project..."
    npm run build
    
    if [ "$EXISTING_INSTALL" = true ]; then
        print_success "Server updated successfully"
    else
        print_success "Server installed successfully"
    fi
}

create_env_file() {
    print_step "Creating environment configuration..."
    
    # Backup existing .env if it exists
    if [ -f "$INSTALL_DIR/.env" ]; then
        print_info "Backing up existing .env file..."
        cp "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    cat > "$INSTALL_DIR/.env" << EOF
# Enhanced Claude Parallel Work MCP Server Configuration
# Generated by install script on $(date)

# Debug and logging
MCP_CLAUDE_DEBUG=$DEBUG_MODE

# Security settings
MCP_ENABLE_SECURE_EXECUTION=$SECURE_EXECUTION

# Server resilience
MCP_SUPERVISOR_MODE=$SUPERVISOR_MODE
MCP_SUPERVISOR_MAX_RESTARTS=10
MCP_SUPERVISOR_RESTART_WINDOW=60000
MCP_SUPERVISOR_SHUTDOWN_TIMEOUT=30000
MCP_SUPERVISOR_HEALTH_INTERVAL=5000
MCP_SUPERVISOR_LOG_CRASHES=true
MCP_SECURE_BY_DEFAULT=false
MCP_USE_ROOMODES=false
MCP_WATCH_ROOMODES=false

# Performance tuning
MCP_MAX_RETRIES=3
MCP_RETRY_DELAY_MS=1000

# Container settings (if Docker available)
# MCP_CONTAINER_MEMORY=2g
# MCP_CONTAINER_CPUS=2

# Debug settings for container cleanup
# Set to true to disable automatic container cleanup (for debugging)
CLAUDE_PARALLEL_DEBUG_NO_CLEANUP=$CONTAINER_DEBUG
EOF
    
    if [ "$EXISTING_INSTALL" = true ]; then
        print_success "Environment file updated at $INSTALL_DIR/.env"
    else
        print_success "Environment file created at $INSTALL_DIR/.env"
    fi
}

rebuild_docker_image() {
    print_step "Rebuilding Docker execution image..."
    
    cd "$INSTALL_DIR"
    
    # Check if Dockerfile exists
    if [ ! -f "docker/claude-execution/Dockerfile" ]; then
        print_error "Dockerfile not found at docker/claude-execution/Dockerfile"
        return 1
    fi
    
    # Build the Docker image
    print_info "Building claude-execution-anthropic:latest..."
    if docker build -t claude-execution-anthropic:latest docker/claude-execution/; then
        print_success "Docker image rebuilt successfully"
        
        # Clean up old containers using the old image
        print_info "Cleaning up old containers..."
        docker ps -a --filter "label=claude-parallel=true" --format "{{.ID}}" | xargs -r docker rm -f 2>/dev/null || true
        print_success "Old containers cleaned up"
        
        return 0
    else
        print_error "Docker image build failed"
        return 1
    fi
}

test_installation() {
    print_step "Testing installation..."
    
    # Test basic server startup
    cd "$INSTALL_DIR"
    
    # Check if the main server file exists
    if [ -f "dist/server.js" ]; then
        print_success "Server binary found at dist/server.js"
        
        # Try a quick syntax check
        if node --check dist/server.js 2>/dev/null; then
            print_success "Server syntax validation passed"
        else
            print_warning "Server syntax check failed - may need rebuild"
        fi
    else
        print_error "Server binary not found at dist/server.js"
        print_info "Available files in dist/:"
        ls -la dist/ 2>/dev/null || print_info "dist/ directory not found"
        return 1
    fi
    
    # Test Docker if enabled
    if [ "$SECURE_EXECUTION" = "true" ] && [ "$DOCKER_AVAILABLE" = true ]; then
        if docker run --rm hello-world > /dev/null 2>&1; then
            print_success "Docker integration test passed"
        else
            print_warning "Docker test failed - secure execution may not work"
        fi
    fi
}

generate_mcp_config() {
    print_step "Generating MCP configuration..."
    
    # Create configuration using echo statements (more reliable than heredoc)
    {
        echo "{"
        echo '  "mcpServers": {'
        echo '    "claude-parallel-work": {'
        echo '      "command": "node",'
        if [ "$SUPERVISOR_MODE" = "true" ]; then
            echo "      \"args\": [\"$INSTALL_DIR/dist/supervisor.js\"],"
        else
            echo "      \"args\": [\"$INSTALL_DIR/dist/server.js\"],"
        fi
        echo '      "env": {'
        echo "        \"MCP_CLAUDE_DEBUG\": \"$DEBUG_MODE\","
        echo "        \"MCP_ENABLE_SECURE_EXECUTION\": \"$SECURE_EXECUTION\","
        echo "        \"MCP_DOCKER_PROVIDER\": \"$DOCKER_PROVIDER\","
        echo "        \"MCP_DOCKER_AVAILABLE\": \"$DOCKER_AVAILABLE\","
        echo "        \"MCP_DOCKER_STATUS\": \"$DOCKER_STATUS\","
        echo "        \"CLAUDE_PARALLEL_WORK_ENABLE_STREAMING\": \"true\","
        echo "        \"CLAUDE_PARALLEL_WORK_STREAM_PORT\": \"47821\","
        echo "        \"CLAUDE_PARALLEL_DEBUG_NO_CLEANUP\": \"$CONTAINER_DEBUG\""
        
        # Add Docker-specific environment variables
        if [ -n "$DOCKER_HOST_DETECTED" ]; then
            echo ","
            echo "        \"DOCKER_HOST\": \"$DOCKER_HOST_DETECTED\""
        fi
        
        if [ "$DOCKER_PROVIDER" = "colima" ] && [ -n "${COLIMA_VERSION:-}" ]; then
            echo ","
            echo "        \"MCP_COLIMA_VERSION\": \"${COLIMA_VERSION}\""
        fi
        
        echo "      }"
        echo "    }"
        echo "  }"
        echo "}"
    } > "$INSTALL_DIR/claude_desktop_config.json"
    
    # Pretty print the configuration
    if command -v jq &> /dev/null; then
        jq . "$INSTALL_DIR/claude_desktop_config.json" > "$INSTALL_DIR/claude_desktop_config.json.tmp"
        mv "$INSTALL_DIR/claude_desktop_config.json.tmp" "$INSTALL_DIR/claude_desktop_config.json"
    fi
    
    print_success "MCP configuration generated at: $INSTALL_DIR/claude_desktop_config.json"
    
    # Display the configuration
    echo
    echo -e "${CYAN}Generated MCP Configuration:${NC}"
    echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cat "$INSTALL_DIR/claude_desktop_config.json"
    echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

detect_claude_config_path() {
    # Detect Claude Desktop config path based on OS
    case "$OSTYPE" in
        darwin*)
            CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
            OS_NAME="macOS"
            ;;
        msys*|mingw*|cygwin*)
            CONFIG_PATH="$APPDATA/Claude/claude_desktop_config.json"
            OS_NAME="Windows"
            ;;
        linux*)
            CONFIG_PATH="$HOME/.config/Claude/claude_desktop_config.json"
            OS_NAME="Linux"
            ;;
        *)
            CONFIG_PATH="~/.config/Claude/claude_desktop_config.json"
            OS_NAME="Unix-like"
            ;;
    esac
    
    # Also set Claude CLI config path
    CLI_CONFIG_PATH="$HOME/.claude.json"
}

update_claude_configs() {
    print_step "Installing MCP configuration..."
    
    detect_claude_config_path
    
    # Check what's available
    CLAUDE_DESKTOP_AVAILABLE=false
    CLAUDE_CLI_AVAILABLE=false
    
    if [ -d "$(dirname "$CONFIG_PATH")" ]; then
        CLAUDE_DESKTOP_AVAILABLE=true
    fi
    
    if [ -f "$CLI_CONFIG_PATH" ] || command -v claude &> /dev/null; then
        CLAUDE_CLI_AVAILABLE=true
    fi
    
    echo
    echo -e "${CYAN}Which Claude applications would you like to configure?${NC}"
    
    if [ "$CLAUDE_DESKTOP_AVAILABLE" = true ] && [ "$CLAUDE_CLI_AVAILABLE" = true ]; then
        echo "1. Claude Desktop only"
        echo "2. Claude CLI only"
        echo "3. Both Claude Desktop and Claude CLI (recommended)"
        echo "4. Skip automatic configuration"
        prompt_with_default "Choose [1/2/3/4] (default: 3): " "3" CONFIG_CHOICE
    elif [ "$CLAUDE_DESKTOP_AVAILABLE" = true ]; then
        echo "1. Claude Desktop"
        echo "2. Skip automatic configuration"
        prompt_with_default "Choose [1/2] (default: 1): " "1" CONFIG_CHOICE
        if [ "$CONFIG_CHOICE" = "2" ]; then
            CONFIG_CHOICE=4
        fi
    elif [ "$CLAUDE_CLI_AVAILABLE" = true ]; then
        echo "1. Claude CLI"
        echo "2. Skip automatic configuration"
        prompt_with_default "Choose [1/2] (default: 1): " "1" CONFIG_CHOICE
        if [ "$CONFIG_CHOICE" = "1" ]; then
            CONFIG_CHOICE=2
        else
            CONFIG_CHOICE=4
        fi
    else
        print_warning "No Claude applications detected"
        echo -e "${PURPLE}📝 Manual installation required${NC}"
        echo -e "  Claude Desktop: Copy the configuration to ${BLUE}$CONFIG_PATH${NC}"
        echo -e "  Claude CLI: Add MCP server to ${BLUE}$CLI_CONFIG_PATH${NC}"
        return 0
    fi
    
    case "$CONFIG_CHOICE" in
        1)
            if [ "$CLAUDE_DESKTOP_AVAILABLE" = true ]; then
                update_claude_desktop_config
            else
                print_warning "Claude Desktop not available, skipping"
            fi
            ;;
        2)
            if [ "$CLAUDE_CLI_AVAILABLE" = true ]; then
                update_claude_cli_config
            else
                print_warning "Claude CLI not available, skipping"
            fi
            ;;
        3)
            if [ "$CLAUDE_DESKTOP_AVAILABLE" = true ]; then
                update_claude_desktop_config
                echo
            fi
            if [ "$CLAUDE_CLI_AVAILABLE" = true ]; then
                update_claude_cli_config
            fi
            ;;
        4)
            print_info "Skipping automatic configuration"
            echo -e "${PURPLE}📝 Manual installation required${NC}"
            echo -e "  Claude Desktop: Copy the configuration to ${BLUE}$CONFIG_PATH${NC}"
            echo -e "  Claude CLI: Add MCP server to ${BLUE}$CLI_CONFIG_PATH${NC}"
            return 0
            ;;
        *)
            print_warning "Invalid choice, skipping automatic configuration"
            return 0
            ;;
    esac
}

update_claude_desktop_config() {
    print_info "Configuring Claude Desktop..."
    
    # Check if Claude Desktop config exists
    if [ ! -f "$CONFIG_PATH" ]; then
        print_info "Claude Desktop config not found, creating new one..."
        mkdir -p "$(dirname "$CONFIG_PATH")"
        echo '{}' > "$CONFIG_PATH"
    fi
    
    # Create backup
    BACKUP_PATH="${CONFIG_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$CONFIG_PATH" "$BACKUP_PATH"
    print_info "Backup created: $BACKUP_PATH"
    
    # Check if jq is available for JSON manipulation
    if command -v jq &> /dev/null; then
        update_config_with_jq
    else
        print_warning "jq not found, using manual JSON update method"
        update_config_manual
    fi
}

update_config_with_jq() {
    print_info "Using jq for precise JSON manipulation..."
    
    # Read the claude-parallel-work config from the generated file
    if [ ! -f "$INSTALL_DIR/claude_desktop_config.json" ]; then
        print_error "Generated config file not found: $INSTALL_DIR/claude_desktop_config.json"
        return 1
    fi
    
    # Extract just the claude-parallel-work configuration
    NEW_CONFIG=$(jq '.mcpServers["claude-parallel-work"]' "$INSTALL_DIR/claude_desktop_config.json")
    
    if [ "$NEW_CONFIG" = "null" ] || [ -z "$NEW_CONFIG" ]; then
        print_error "Could not extract claude-parallel-work configuration from generated file"
        return 1
    fi
    
    # Update the configuration using jq
    TEMP_CONFIG=$(mktemp)
    jq \
        --argjson newConfig "$NEW_CONFIG" \
        '.mcpServers["claude-parallel-work"] = $newConfig | .mcpServers //= {}' \
        "$CONFIG_PATH" > "$TEMP_CONFIG"
    
    if [ $? -eq 0 ]; then
        mv "$TEMP_CONFIG" "$CONFIG_PATH"
        print_success "Claude Desktop configuration updated successfully"
    else
        rm -f "$TEMP_CONFIG"
        print_error "Failed to update configuration with jq"
        update_config_manual
    fi
}

update_config_manual() {
    print_info "Using manual JSON update method..."
    
    # This is a fallback method - less precise but works without jq
    print_warning "Manual update method - please verify the configuration"
    
    # Read existing config
    EXISTING_CONFIG=$(cat "$CONFIG_PATH")
    
    # Check if existing config has mcpServers
    if echo "$EXISTING_CONFIG" | grep -q '"mcpServers"'; then
        print_info "Merging with existing mcpServers..."
        print_warning "⚠️ Manual merge required - please edit $CONFIG_PATH"
        print_info "Add the claude-parallel-work configuration from:"
        print_info "$INSTALL_DIR/claude_desktop_config.json"
    else
        # No mcpServers section, we can add it
        print_info "Adding mcpServers section..."
        
        # Remove the last closing brace and add our config
        TEMP_CONFIG=$(mktemp)
        head -n -1 "$CONFIG_PATH" > "$TEMP_CONFIG"
        
        # Add comma if file has content
        if [ -s "$TEMP_CONFIG" ] && [ "$(tail -c 2 "$TEMP_CONFIG")" != "{" ]; then
            echo "," >> "$TEMP_CONFIG"
        fi
        
        # Add mcpServers section
        echo '  "mcpServers": {' >> "$TEMP_CONFIG"
        echo '    "claude-parallel-work": {' >> "$TEMP_CONFIG"
        echo '      "command": "node",' >> "$TEMP_CONFIG"
        if [ "$SUPERVISOR_MODE" = "true" ]; then
            echo "      \"args\": [\"$INSTALL_DIR/dist/supervisor.js\"]," >> "$TEMP_CONFIG"
        else
            echo "      \"args\": [\"$INSTALL_DIR/dist/server.js\"]," >> "$TEMP_CONFIG"
        fi
        echo '      "env": {' >> "$TEMP_CONFIG"
        echo "        \"MCP_CLAUDE_DEBUG\": \"$DEBUG_MODE\"," >> "$TEMP_CONFIG"
        echo "        \"MCP_ENABLE_SECURE_EXECUTION\": \"$SECURE_EXECUTION\"," >> "$TEMP_CONFIG"
        echo "        \"MCP_DOCKER_PROVIDER\": \"$DOCKER_PROVIDER\"," >> "$TEMP_CONFIG"
        echo "        \"MCP_DOCKER_AVAILABLE\": \"$DOCKER_AVAILABLE\"," >> "$TEMP_CONFIG"
        echo "        \"MCP_DOCKER_STATUS\": \"$DOCKER_STATUS\"," >> "$TEMP_CONFIG"
        echo "        \"CLAUDE_PARALLEL_WORK_ENABLE_STREAMING\": \"true\"," >> "$TEMP_CONFIG"
        echo "        \"CLAUDE_PARALLEL_WORK_STREAM_PORT\": \"47821\"," >> "$TEMP_CONFIG"
        echo "        \"CLAUDE_PARALLEL_DEBUG_NO_CLEANUP\": \"$CONTAINER_DEBUG\"" >> "$TEMP_CONFIG"
        
        if [ -n "$DOCKER_HOST_DETECTED" ]; then
            echo "," >> "$TEMP_CONFIG"
            echo "        \"DOCKER_HOST\": \"$DOCKER_HOST_DETECTED\"" >> "$TEMP_CONFIG"
        fi
        
        echo '      }' >> "$TEMP_CONFIG"
        echo '    }' >> "$TEMP_CONFIG"
        echo '  }' >> "$TEMP_CONFIG"
        echo '}' >> "$TEMP_CONFIG"
        
        mv "$TEMP_CONFIG" "$CONFIG_PATH"
        print_success "Claude Desktop configuration updated"
    fi
}

update_claude_cli_config() {
    print_info "Configuring Claude CLI..."
    
    # Check if Claude CLI config exists
    if [ ! -f "$CLI_CONFIG_PATH" ]; then
        print_info "Claude CLI config not found, creating new one..."
        echo '{}' > "$CLI_CONFIG_PATH"
    fi
    
    # Create backup
    BACKUP_PATH="${CLI_CONFIG_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$CLI_CONFIG_PATH" "$BACKUP_PATH"
    print_info "Backup created: $BACKUP_PATH"
    
    # Check if jq is available
    if command -v jq &> /dev/null; then
        update_cli_config_with_jq
    else
        print_warning "jq not found, using manual JSON update method"
        update_cli_config_manual
    fi
}

update_cli_config_with_jq() {
    print_info "Using jq to update Claude CLI configuration..."
    
    # Read the claude-parallel-work config
    if [ ! -f "$INSTALL_DIR/claude_desktop_config.json" ]; then
        print_error "Generated config file not found"
        return 1
    fi
    
    # Extract the MCP server config
    MCP_CONFIG=$(jq '.mcpServers["claude-parallel-work"]' "$INSTALL_DIR/claude_desktop_config.json")
    
    # Update CLI config
    TEMP_CONFIG=$(mktemp)
    jq \
        --argjson mcpConfig "$MCP_CONFIG" \
        '.mcpServers["claude-parallel-work"] = $mcpConfig | .mcpServers //= {}' \
        "$CLI_CONFIG_PATH" > "$TEMP_CONFIG"
    
    if [ $? -eq 0 ]; then
        mv "$TEMP_CONFIG" "$CLI_CONFIG_PATH"
        print_success "Claude CLI configuration updated successfully"
    else
        rm -f "$TEMP_CONFIG"
        print_error "Failed to update Claude CLI configuration with jq"
        update_cli_config_manual
    fi
}

update_cli_config_manual() {
    print_info "Using manual JSON update method for Claude CLI..."
    print_warning "⚠️ Manual configuration required"
    print_info "Please add the claude-parallel-work server configuration to: $CLI_CONFIG_PATH"
    print_info "Configuration available at: $INSTALL_DIR/claude_desktop_config.json"
}

restart_claude_desktop() {
    if [ "$CLAUDE_DESKTOP_AVAILABLE" = true ] && [ "$OS_NAME" = "macOS" ]; then
        echo
        echo -e "${CYAN}Would you like to restart Claude Desktop to apply changes?${NC}"
        prompt_with_default "Restart Claude Desktop? [Y/n] (default: Y): " "Y" RESTART_CHOICE
        
        case "$RESTART_CHOICE" in
            [nN]|[nN][oO])
                print_info "Please restart Claude Desktop manually to apply changes"
                ;;
            *)
                print_info "Restarting Claude Desktop..."
                osascript -e 'quit app "Claude"' 2>/dev/null || true
                sleep 2
                open -a "Claude" 2>/dev/null || print_warning "Could not restart Claude Desktop automatically"
                ;;
        esac
    fi
}

setup_cli_command() {
    print_step "Setting up global CLI command..."
    
    # Get the current directory (where claude-parallel-work is located)
    CLAUDE_PARALLEL_WORK_DIR="$(pwd)"
    
    # Determine the best installation location for CLI
    if [ -w "/usr/local/bin" ]; then
        CLI_INSTALL_DIR="/usr/local/bin"
    elif [ -d "$HOME/.local/bin" ]; then
        CLI_INSTALL_DIR="$HOME/.local/bin"
        # Ensure it's in PATH
        if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
            print_info "Adding $HOME/.local/bin to PATH..."
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc 2>/dev/null || true
        fi
    else
        # Create ~/.local/bin if it doesn't exist
        mkdir -p "$HOME/.local/bin"
        CLI_INSTALL_DIR="$HOME/.local/bin"
        print_info "Created $HOME/.local/bin and adding to PATH..."
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc 2>/dev/null || true
    fi

    print_info "CLI installation directory: $CLI_INSTALL_DIR"

    # Create the CLI wrapper script
    CLI_SCRIPT="$CLI_INSTALL_DIR/parallel-work"

    print_info "Creating CLI command at $CLI_SCRIPT..."

    cat > "$CLI_SCRIPT" << 'EOF'
#!/bin/bash

# Parallel Work CLI - Global command for server and debugging
# Generated by install.sh

PARALLEL_WORK_DIR="REPLACE_WITH_INSTALL_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Function to check if we're in a valid directory
check_directory() {
    if [ ! -d "$PARALLEL_WORK_DIR" ]; then
        echo -e "${RED}❌ Error: Parallel Work directory not found at $PARALLEL_WORK_DIR${NC}"
        echo -e "${YELLOW}💡 Tip: Re-run install.sh from the claude-parallel-work directory${NC}"
        exit 1
    fi
}

# Function to show usage
show_usage() {
    echo -e "${BOLD}${BLUE}⚡ Parallel Work CLI${NC}"
    echo ""
    echo -e "${GREEN}${BOLD}USAGE:${NC}"
    echo "  parallel-work <command> [options]"
    echo ""
    echo -e "${GREEN}${BOLD}COMMANDS:${NC}"
    echo -e "  ${CYAN}dashboard${NC}           Open the visual dashboard"
    echo -e "  ${CYAN}status${NC}              Check server and service status"
    echo -e "  ${CYAN}logs${NC} [options]      View and follow server logs"
    echo -e "  ${CYAN}follow${NC}              Follow task execution logs in real-time"
    echo -e "  ${CYAN}restart${NC}             Restart the MCP server"
    echo -e "  ${CYAN}stop${NC}                Stop all services"
    echo -e "  ${CYAN}health${NC}              Run comprehensive health check"
    echo -e "  ${CYAN}config${NC}              Show current configuration"
    echo -e "  ${CYAN}version${NC}             Show version information"
    echo -e "  ${CYAN}help${NC}                Show this help message"
    echo ""
    echo -e "${GREEN}${BOLD}LOG OPTIONS:${NC}"
    echo -e "  ${CYAN}logs${NC}                View recent server logs"
    echo -e "  ${CYAN}logs -f${NC}             Follow server logs in real-time"
    echo -e "  ${CYAN}logs -e${NC}             View error logs only"
    echo -e "  ${CYAN}logs -t 50${NC}          Show last 50 lines"
    echo -e "  ${CYAN}logs --containers${NC}    View container execution logs"
    echo ""
    echo -e "${GREEN}${BOLD}EXAMPLES:${NC}"
    echo -e "  ${YELLOW}parallel-work dashboard${NC}     # Launch visual monitoring interface"
    echo -e "  ${YELLOW}parallel-work follow${NC}        # Follow task execution in real-time"
    echo -e "  ${YELLOW}parallel-work status${NC}        # Check if everything is running"
    echo -e "  ${YELLOW}parallel-work restart${NC}       # Restart crashed server"
    echo ""
    echo -e "${BLUE}💡 The dashboard provides real-time monitoring of:${NC}"
    echo "  • Background task execution"
    echo "  • Git diff management"
    echo "  • Container logs streaming"
    echo "  • Server health and metrics"
}

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to find processes using claude-parallel-work ports
find_claude_processes() {
    local processes=""
    
    # Check port 47821 (enhanced server)
    if check_port 47821; then
        local pid=$(lsof -ti :47821)
        if [ -n "$pid" ]; then
            processes+="$pid "
        fi
    fi
    
    # Check port 5173 (dashboard)
    if check_port 5173; then
        local pid=$(lsof -ti :5173)
        if [ -n "$pid" ]; then
            processes+="$pid "
        fi
    fi
    
    # Check for npm processes related to claude-parallel-work
    local npm_pids=$(pgrep -f "npm.*dashboard\|npm.*start:dashboard\|node.*server")
    if [ -n "$npm_pids" ]; then
        processes+="$npm_pids "
    fi
    
    echo "$processes" | tr ' ' '\n' | sort -u | tr '\n' ' '
}

# Function to show version information
show_version() {
    echo -e "${BOLD}${BLUE}⚡ Parallel Work${NC}"
    echo ""
    if [ -f "$PARALLEL_WORK_DIR/package.json" ]; then
        local version=$(grep '"version"' "$PARALLEL_WORK_DIR/package.json" | sed 's/.*"version": *"\([^"]*\)".*/\1/')
        echo -e "Version: ${GREEN}$version${NC}"
    else
        echo -e "Version: ${YELLOW}Unknown${NC}"
    fi
    echo -e "Install Directory: ${CYAN}$PARALLEL_WORK_DIR${NC}"
    echo ""
}

# Function to show configuration
show_config() {
    echo -e "${BOLD}${BLUE}⚙️ Current Configuration${NC}"
    echo ""
    if [ -f "$PARALLEL_WORK_DIR/.env" ]; then
        echo -e "${YELLOW}Configuration from .env:${NC}"
        while IFS= read -r line; do
            if [[ "$line" =~ ^[A-Z] ]] && [[ "$line" == *"="* ]]; then
                echo -e "  ${CYAN}${line}${NC}"
            fi
        done < "$PARALLEL_WORK_DIR/.env"
    else
        echo -e "${RED}❌ Configuration file not found${NC}"
    fi
    echo ""
}

# Function for enhanced logs viewing
show_logs() {
    local follow=false
    local errors_only=false
    local tail_lines=50
    local show_containers=false
    
    # Parse log options
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--follow)
                follow=true
                shift
                ;;
            -e|--errors)
                errors_only=true
                shift
                ;;
            -t|--tail)
                tail_lines="$2"
                shift 2
                ;;
            --containers)
                show_containers=true
                shift
                ;;
            *)
                shift
                ;;
        esac
    done
    
    echo -e "${BOLD}${BLUE}📄 Server Logs${NC}"
    echo ""
    
    local logs_dir="$PARALLEL_WORK_DIR/logs"
    
    if [ ! -d "$logs_dir" ]; then
        echo -e "${RED}❌ Logs directory not found: $logs_dir${NC}"
        return 1
    fi
    
    if [ "$show_containers" = true ]; then
        echo -e "${YELLOW}🐳 Container Execution Logs:${NC}"
        if ls "$logs_dir"/*-task-*.log 1> /dev/null 2>&1; then
            ls -lt "$logs_dir"/*-task-*.log | head -10 | while read -r line; do
                echo -e "  ${CYAN}$(echo "$line" | awk '{print $9}' | xargs basename)${NC} ($(echo "$line" | awk '{print $6, $7, $8}'))"
            done
            echo ""
            echo -e "${BLUE}💡 Use 'tail -f $logs_dir/CONTAINER-task-ID.log' to follow specific container logs${NC}"
        else
            echo -e "${YELLOW}No container logs found${NC}"
        fi
        return
    fi
    
    if [ "$errors_only" = true ]; then
        local log_file="$logs_dir/server-error.log"
        echo -e "${YELLOW}📋 Error logs from: ${CYAN}$log_file${NC}"
        echo ""
        
        if [ -f "$log_file" ]; then
            if [ "$follow" = true ]; then
                tail -f "$log_file"
            else
                tail -n "$tail_lines" "$log_file"
            fi
        else
            echo -e "${GREEN}✅ No error logs found${NC}"
        fi
    else
        local log_file="$logs_dir/server-combined.log"
        echo -e "${YELLOW}📋 Server logs from: ${CYAN}$log_file${NC}"
        echo ""
        
        if [ -f "$log_file" ]; then
            if [ "$follow" = true ]; then
                echo -e "${BLUE}Following logs... (Press Ctrl+C to stop)${NC}"
                echo ""
                tail -f "$log_file"
            else
                tail -n "$tail_lines" "$log_file"
            fi
        else
            echo -e "${RED}❌ Log file not found${NC}"
        fi
    fi
}

# Function for following task execution logs
follow_tasks() {
    echo -e "${BOLD}${BLUE}👁️ Following Task Execution${NC}"
    echo ""
    
    local logs_dir="$PARALLEL_WORK_DIR/logs"
    
    if [ ! -d "$logs_dir" ]; then
        echo -e "${RED}❌ Logs directory not found: $logs_dir${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}📡 Monitoring all task execution logs...${NC}"
    echo -e "${BLUE}Press Ctrl+C to stop${NC}"
    echo ""
    
    # Follow server logs and filter for task-related activity
    if [ -f "$logs_dir/server-combined.log" ]; then
        tail -f "$logs_dir/server-combined.log" | grep --line-buffered -E "(task_worker|task-|Tool invoked|Background execution|Container|Diff|GitDiff)"
    else
        echo -e "${RED}❌ Server log file not found${NC}"
        return 1
    fi
}

# Change to parallel-work directory
cd "$PARALLEL_WORK_DIR" || {
    echo -e "${RED}❌ Failed to change to Parallel Work directory${NC}"
    exit 1
}

# Parse command and options
COMMAND="$1"
shift

case "$COMMAND" in
    "dashboard"|"open"|"launch")
        echo -e "${BLUE}🚀 Launching Parallel Work Dashboard...${NC}"
        check_directory
        exec ./launch-dashboard.sh
        ;;
    
    "status"|"check")
        echo -e "${BLUE}📊 Parallel Work Status Check${NC}"
        echo ""
        
        # Check enhanced server (port 47821)
        if check_port 47821; then
            echo -e "${GREEN}✅ Enhanced Server: Running on port 47821${NC}"
        else
            echo -e "${RED}❌ Enhanced Server: Not running on port 47821${NC}"
        fi
        
        # Check dashboard (port 5173)
        if check_port 5173; then
            echo -e "${GREEN}✅ Dashboard: Running on port 5173${NC}"
        else
            echo -e "${RED}❌ Dashboard: Not running on port 5173${NC}"
        fi
        
        # Check if both are running
        if check_port 47821 && check_port 5173; then
            echo ""
            echo -e "${GREEN}🎯 Dashboard is ready!${NC}"
            echo -e "${BLUE}🌐 Open: http://localhost:5173${NC}"
        elif check_port 47821 && ! check_port 5173; then
            echo ""
            echo -e "${YELLOW}⚠️  Server running, but dashboard not started${NC}"
            echo -e "${BLUE}💡 Run: parallel-work dashboard${NC}"
        elif ! check_port 47821 && check_port 5173; then
            echo ""
            echo -e "${YELLOW}⚠️  Dashboard running, but server not started${NC}"
            echo -e "${BLUE}💡 Run: parallel-work start${NC}"
        else
            echo ""
            echo -e "${YELLOW}⚠️  Neither service is running${NC}"
            echo -e "${BLUE}💡 Run: parallel-work dashboard${NC}"
        fi
        ;;
    
    "build")
        echo -e "${BLUE}🏗️  Building Parallel Work Dashboard...${NC}"
        check_directory
        npm run build:dashboard
        ;;
    
    "start"|"server")
        echo -e "${BLUE}🚀 Starting Enhanced Server...${NC}"
        check_directory
        if check_port 47821; then
            echo -e "${YELLOW}⚠️  Enhanced server already running on port 47821${NC}"
            exit 0
        fi
        npm run start:dashboard &
        echo -e "${GREEN}✅ Enhanced server started in background${NC}"
        echo -e "${BLUE}💡 Use 'parallel-work dashboard' to open the dashboard${NC}"
        ;;
        
    "follow"|"monitor")
        follow_tasks
        ;;
    
    "restart")
        echo -e "${BLUE}🔄 Restarting Parallel Work Server...${NC}"
        check_directory
        
        # Stop services first
        local processes=$(find_claude_processes)
        if [ -n "$processes" ]; then
            echo -e "${YELLOW}🛑 Stopping existing services...${NC}"
            for pid in $processes; do
                kill "$pid" 2>/dev/null && echo -e "${GREEN}✅ Stopped process $pid${NC}"
            done
            sleep 3
        fi
        
        # Start server again
        echo -e "${BLUE}🚀 Starting server...${NC}"
        npm run start:dashboard &
        sleep 2
        
        if check_port 47821; then
            echo -e "${GREEN}✅ Server restarted successfully${NC}"
        else
            echo -e "${RED}❌ Failed to restart server${NC}"
            exit 1
        fi
        ;;
    
    "stop"|"kill")
        echo -e "${BLUE}🛑 Stopping Parallel Work services...${NC}"
        
        local processes=$(find_claude_processes)
        if [ -z "$processes" ]; then
            echo -e "${YELLOW}⚠️  No Parallel Work services found running${NC}"
            exit 0
        fi
        
        echo -e "${YELLOW}🔍 Found processes: $processes${NC}"
        for pid in $processes; do
            if kill "$pid" 2>/dev/null; then
                echo -e "${GREEN}✅ Stopped process $pid${NC}"
            else
                echo -e "${YELLOW}⚠️  Process $pid already stopped or not accessible${NC}"
            fi
        done
        
        # Wait a moment and check ports again
        sleep 2
        if ! check_port 47821 && ! check_port 5173; then
            echo -e "${GREEN}✅ All services stopped successfully${NC}"
        else
            echo -e "${YELLOW}⚠️  Some services may still be running${NC}"
        fi
        ;;
    
    "logs"|"log")
        show_logs "$@"
        ;;
        
    "config"|"configuration")
        show_config
        ;;
        
    "version"|"--version"|"-v")
        show_version
        ;;
    
    "health")
        echo -e "${BLUE}🏥 Parallel Work Health Check${NC}"
        check_directory
        
        # Build if needed
        if [ ! -f "dist/health-check.js" ]; then
            echo -e "${YELLOW}🔨 Building project...${NC}"
            npm run build
        fi
        
        # Run the health check
        node dist/health-check.js
        ;;
    
    "help"|"-h"|"--help"|"")
        show_usage
        ;;
    
    *)
        echo -e "${RED}❌ Unknown command: $COMMAND${NC}"
        echo ""
        show_usage
        exit 1
        ;;
esac
EOF

    # Replace the placeholder with actual install directory
    sed -i.bak "s|REPLACE_WITH_INSTALL_DIR|$INSTALL_DIR|g" "$CLI_SCRIPT"
    rm -f "$CLI_SCRIPT.bak"

    # Make the script executable
    chmod +x "$CLI_SCRIPT"

    print_success "CLI command created at $CLI_SCRIPT"
    
    # Check if the install directory is in PATH
    if [[ ":$PATH:" == *":$CLI_INSTALL_DIR:"* ]]; then
        print_success "CLI command ready to use: parallel-work"
    else
        print_warning "$CLI_INSTALL_DIR is not in your PATH"
        print_info "Add this to your shell profile:"
        echo "   export PATH=\"$CLI_INSTALL_DIR:\$PATH\""
    fi
}

copy_slash_commands() {
    print_step "Installing Claude Code slash commands..."
    
    # Define the source and destination directories
    SOURCE_COMMANDS_DIR="$INSTALL_DIR/commands"
    DEST_COMMANDS_DIR="$HOME/.claude/commands"
    
    # Check if source commands directory exists
    if [ ! -d "$SOURCE_COMMANDS_DIR" ]; then
        print_warning "Commands directory not found at $SOURCE_COMMANDS_DIR"
        print_info "Skipping slash commands installation"
        return 0
    fi
    
    # Check if there are any command files to copy
    if ! ls "$SOURCE_COMMANDS_DIR"/*.md >/dev/null 2>&1; then
        print_warning "No command files found in $SOURCE_COMMANDS_DIR"
        return 0
    fi
    
    # Create destination directory if it doesn't exist
    if [ ! -d "$DEST_COMMANDS_DIR" ]; then
        print_info "Creating Claude commands directory: $DEST_COMMANDS_DIR"
        mkdir -p "$DEST_COMMANDS_DIR"
        if [ $? -ne 0 ]; then
            print_error "Failed to create commands directory"
            return 1
        fi
    fi
    
    # Copy command files
    print_info "Copying slash commands..."
    local copied_count=0
    
    for cmd_file in "$SOURCE_COMMANDS_DIR"/*.md; do
        if [ -f "$cmd_file" ]; then
            local filename=$(basename "$cmd_file")
            
            # Check if file already exists in destination
            if [ -f "$DEST_COMMANDS_DIR/$filename" ]; then
                print_info "Updating existing command: $filename"
            else
                print_info "Installing new command: $filename"
            fi
            
            # Copy the file
            cp "$cmd_file" "$DEST_COMMANDS_DIR/"
            if [ $? -eq 0 ]; then
                ((copied_count++))
            else
                print_warning "Failed to copy $filename"
            fi
        fi
    done
    
    if [ $copied_count -gt 0 ]; then
        print_success "Installed $copied_count slash commands to $DEST_COMMANDS_DIR"
        print_info "Available commands:"
        for cmd_file in "$DEST_COMMANDS_DIR"/*.md; do
            if [ -f "$cmd_file" ]; then
                local cmd_name=$(basename "$cmd_file" .md)
                echo "  • /$cmd_name"
            fi
        done
        print_info "Use these commands in Claude Code to generate optimized task plans"
    else
        print_warning "No slash commands were copied"
    fi
}

show_completion_message() {
    echo
    echo -e "${GREEN}"
    echo "╔════════════════════════════════════════════════════════════════════════╗"
    echo "║                                                                        ║"
    if [ "$EXISTING_INSTALL" = true ]; then
        echo "║                        🎉 UPDATE COMPLETE! 🎉                          ║"
    else
        echo "║                     🎉 INSTALLATION COMPLETE! 🎉                      ║"
    fi
    echo "║                                                                        ║"
    echo "║  ███████╗██╗   ██╗ ██████╗ ██████╗███████╗███████╗███████╗██╗          ║"
    echo "║  ██╔════╝██║   ██║██╔════╝██╔════╝██╔════╝██╔════╝██╔════╝██║          ║"
    echo "║  ███████╗██║   ██║██║     ██║     █████╗  ███████╗███████╗██║          ║"
    echo "║  ╚════██║██║   ██║██║     ██║     ██╔══╝  ╚════██║╚════██║╚═╝          ║"
    echo "║  ███████║╚██████╔╝╚██████╗╚██████╗███████╗███████║███████║██╗          ║"
    echo "║  ╚══════╝ ╚═════╝  ╚═════╝ ╚═════╝╚══════╝╚══════╝╚══════╝╚═╝          ║"
    echo "║                                                                        ║"
    echo "╚════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo
    
    print_info "Server installed at: $INSTALL_DIR"
    print_info "Configuration saved to: $INSTALL_DIR/claude_desktop_config.json"
    echo
    
    detect_claude_config_path
    
    echo -e "${CYAN}📋 Configuration Status${NC}"
    echo -e "${GREEN}  ✅ MCP configuration generated${NC}"
    echo -e "     📁 ${BLUE}$INSTALL_DIR/claude_desktop_config.json${NC}"
    if [ -n "$DOCKER_HOST_DETECTED" ]; then
        echo -e "     🐳 Docker: ${CYAN}$DOCKER_HOST_DETECTED${NC}"
    fi
    
    # Check if automatic installation happened by looking for backup files
    DESKTOP_BACKUP_COUNT=$(ls "${CONFIG_PATH}.backup."* 2>/dev/null | wc -l)
    CLI_BACKUP_COUNT=$(ls "${CLI_CONFIG_PATH}.backup."* 2>/dev/null | wc -l)
    
    if [ "$DESKTOP_BACKUP_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✅ Claude Desktop configuration updated automatically${NC}"
        echo -e "   📁 Backup saved: ${BLUE}${CONFIG_PATH}.backup.*${NC}"
    fi
    
    if [ "$CLI_BACKUP_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✅ Claude CLI configuration updated automatically${NC}"
        echo -e "   📁 Backup saved: ${BLUE}${CLI_CONFIG_PATH}.backup.*${NC}"
    fi
    
    if [ "$DESKTOP_BACKUP_COUNT" -eq 0 ] && [ "$CLI_BACKUP_COUNT" -eq 0 ]; then
        echo -e "${YELLOW}⚠️ Manual configuration may be required${NC}"
        echo -e "   Claude Desktop: ${BLUE}$CONFIG_PATH${NC}"
        echo -e "   Claude CLI: ${BLUE}$CLI_CONFIG_PATH${NC}"
    fi
    echo
    
    echo -e "${CYAN}🚀 Quick Start${NC}"
    echo
    echo -e "${YELLOW}  1. Test MCP connection:${NC}"
    echo -e "     ${CYAN}\"Check system_status\"${NC}"
    echo
    
    echo -e "${YELLOW}  2. Try example workflows:${NC}"
    if [ "$SECURE_EXECUTION" = "true" ]; then
        echo -e "     ${CYAN}\"Create a simple Python calculator\"${NC}"
        echo -e "     ${CYAN}\"Build a React todo app with parallel tasks\"${NC}"
    else
        echo -e "${YELLOW}     ⚠️  Docker not available - install for full features${NC}"
    fi
    echo
    
    echo -e "${YELLOW}  3. CLI commands:${NC}"
    echo -e "     ${CYAN}parallel-work dashboard${NC}  # Real-time monitoring"
    echo -e "     ${CYAN}parallel-work status${NC}     # Check services"
    echo -e "     ${CYAN}parallel-work help${NC}       # All commands"
    echo
    
    echo -e "${PURPLE}📚 Docs: github.com/ddfourtwo/claude-parallel-work${NC}"
    echo
    
    echo -e "${CYAN}🛠️  Available Tools:${NC}"
    echo -e "${YELLOW}  Planning & Breakdown:${NC}"
    # echo "    • break_down_to_work_plan - AI-powered parallel task planning"
    # echo "    • work_plan_from_docs - Convert PRDs/specs to executable plans"
    echo "    • get_next_tasks - Find ready tasks for parallel execution"
    echo
    echo -e "${YELLOW}  Execution & Development:${NC}"
    echo "    • task_worker - Secure containerized code execution"
    echo "    • answer_worker_question - Respond to Claude's questions"
    echo "    • set_task_status - Update task progress"
    echo
    echo -e "${YELLOW}  Review & Version Control:${NC}"
    echo "    • review_changes - Preview all modifications"
    echo "    • apply_changes - Merge approved changes"
    echo "    • reject_changes - Discard unwanted changes"
    echo "    • request_revision - Iterate based on feedback"
    echo
    echo -e "${YELLOW}  Monitoring & Management:${NC}"
    echo "    • work_status - Track execution progress"
    echo "    • system_status - Check environment health"
    echo "    • open_dashboard - Launch real-time dashboard"
    echo "    • view_container_logs - Debug container execution"
    echo
}

# Main installation flow
main() {
    print_header
    
    check_prerequisites
    echo
    
    get_user_input
    echo
    
    install_server
    echo
    
    create_env_file
    echo
    
    test_installation
    echo
    
    # Offer to rebuild Docker image if Docker is available and secure execution is enabled
    if [ "$SECURE_EXECUTION" = "true" ] && [ "$DOCKER_AVAILABLE" = true ]; then
        echo -e "${CYAN}Would you like to rebuild the Docker execution image?${NC}"
        echo -e "${YELLOW}This is recommended if:${NC}"
        echo "  • This is your first installation"
        echo "  • You've updated from an older version"
        echo
        prompt_with_default "Rebuild Docker image? [Y/n] (default: n): " "n" REBUILD_DOCKER
        
        if [[ ! "$REBUILD_DOCKER" =~ ^[nN] ]]; then
            rebuild_docker_image
            echo
        else
            print_info "Skipping Docker image rebuild"
            print_warning "You may need to rebuild manually if execution fails:"
            echo "   cd $INSTALL_DIR && docker build -t claude-execution-anthropic:latest docker/claude-execution/"
            echo
        fi
    fi
    
    generate_mcp_config
    echo
    
    update_claude_configs
    echo
    
    # Copy slash commands
    copy_slash_commands
    echo
    
    setup_cli_command
    echo
    
    show_completion_message
    echo
    
    # Offer to restart Claude Desktop
    restart_claude_desktop
}

# Run main function
main "$@"
