#!/bin/bash

# Standalone script to install Claude Code slash commands
# This ensures all slash commands are properly installed

# Don't exit on error - we'll handle errors explicitly

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Functions for colored output
print_header() {
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║              Claude Parallel Work - Slash Commands Installer            ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════╝${NC}"
    echo
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

# Main installation function
install_slash_commands() {
    print_header
    
    # Determine script directory
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    SOURCE_COMMANDS_DIR="$SCRIPT_DIR/commands"
    DEST_COMMANDS_DIR="$HOME/.claude/commands"
    
    print_step "Installing Claude Code slash commands..."
    print_info "Source directory: $SOURCE_COMMANDS_DIR"
    print_info "Destination directory: $DEST_COMMANDS_DIR"
    echo
    
    # Check if source commands directory exists
    if [ ! -d "$SOURCE_COMMANDS_DIR" ]; then
        print_error "Commands directory not found at: $SOURCE_COMMANDS_DIR"
        print_info "Please run this script from the claude-parallel-work directory"
        exit 1
    fi
    
    # List all expected command files
    local expected_commands=(
        "break-down-to-work-plan.md"
        "orchestrate-tasks.md"
        "work-plan-from-doc.md"
    )
    
    # Check which files exist
    print_step "Checking for command files..."
    local found_files=()
    local missing_files=()
    
    for cmd in "${expected_commands[@]}"; do
        if [ -f "$SOURCE_COMMANDS_DIR/$cmd" ]; then
            found_files+=("$cmd")
            print_success "Found: $cmd"
        else
            missing_files+=("$cmd")
            print_warning "Missing: $cmd"
        fi
    done
    
    echo
    
    if [ ${#found_files[@]} -eq 0 ]; then
        print_error "No command files found!"
        exit 1
    fi
    
    # Create destination directory if it doesn't exist
    if [ ! -d "$DEST_COMMANDS_DIR" ]; then
        print_step "Creating Claude commands directory..."
        mkdir -p "$DEST_COMMANDS_DIR"
        if [ $? -ne 0 ]; then
            print_error "Failed to create directory: $DEST_COMMANDS_DIR"
            exit 1
        fi
        print_success "Directory created: $DEST_COMMANDS_DIR"
    else
        print_info "Destination directory already exists"
    fi
    
    echo
    
    # Copy each file individually with detailed feedback
    print_step "Copying slash commands..."
    local copied_count=0
    local failed_count=0
    
    print_info "Starting to copy ${#found_files[@]} files..."
    for i in "${!found_files[@]}"; do
        filename="${found_files[$i]}"
        print_info "Processing file $((i+1)) of ${#found_files[@]}: $filename"
        local source_file="$SOURCE_COMMANDS_DIR/$filename"
        local dest_file="$DEST_COMMANDS_DIR/$filename"
        
        echo -e "${BLUE}Processing:${NC} $filename"
        
        # Check if file already exists
        if [ -f "$dest_file" ]; then
            print_info "Updating existing command: $filename"
        else
            print_info "Installing new command: $filename"
        fi
        
        # Copy the file with verbose output
        cp_output=$(cp -v "$source_file" "$dest_file" 2>&1)
        cp_result=$?
        
        if [ $cp_result -eq 0 ]; then
            echo "$cp_output"
            print_success "Successfully copied: $filename"
            copied_count=$((copied_count + 1))
        else
            print_error "Failed to copy: $filename"
            print_error "Error: $cp_output"
            failed_count=$((failed_count + 1))
        fi
        
        # Add a small delay to ensure output is flushed
        sleep 0.1
    done
    
    echo
    
    # Summary
    print_step "Installation Summary"
    print_info "Commands found: ${#found_files[@]}"
    print_info "Commands copied: $copied_count"
    if [ $failed_count -gt 0 ]; then
        print_warning "Commands failed: $failed_count"
    fi
    
    echo
    
    # List installed commands
    if [ $copied_count -gt 0 ]; then
        print_success "Successfully installed $copied_count slash command(s)"
        print_info "Available commands in Claude Code:"
        
        # List all .md files in destination
        for cmd_file in "$DEST_COMMANDS_DIR"/*.md; do
            if [ -f "$cmd_file" ]; then
                local cmd_name=$(basename "$cmd_file" .md)
                echo -e "  ${GREEN}•${NC} /${cmd_name}"
            fi
        done
        
        echo
        print_info "You can now use these commands in Claude Code to:"
        echo "  - Generate parallel task plans from requirements"
        echo "  - Orchestrate complex multi-step workflows"
        echo "  - Convert documentation into executable tasks"
    else
        print_error "No commands were successfully copied"
        exit 1
    fi
    
    # Check if any expected commands are missing
    if [ ${#missing_files[@]} -gt 0 ]; then
        echo
        print_warning "The following expected commands were not found:"
        for cmd in "${missing_files[@]}"; do
            echo "  - $cmd"
        done
    fi
    
    echo
    print_success "Installation complete!"
}

# Run the installation
install_slash_commands