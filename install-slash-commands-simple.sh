#!/bin/bash

# Simple, robust slash commands installer

echo "=== Claude Parallel Work - Slash Commands Installer ==="
echo

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SOURCE_DIR="$SCRIPT_DIR/commands"
DEST_DIR="$HOME/.claude/commands"

echo "Source: $SOURCE_DIR"
echo "Destination: $DEST_DIR"
echo

# Check source directory
if [ ! -d "$SOURCE_DIR" ]; then
    echo "ERROR: Commands directory not found at $SOURCE_DIR"
    exit 1
fi

# Create destination directory
mkdir -p "$DEST_DIR" || {
    echo "ERROR: Cannot create $DEST_DIR"
    exit 1
}

echo "Installing slash commands..."
echo

# Copy each file explicitly
echo "1. Copying break-down-to-work-plan.md..."
if [ -f "$SOURCE_DIR/break-down-to-work-plan.md" ]; then
    cp -v "$SOURCE_DIR/break-down-to-work-plan.md" "$DEST_DIR/"
    echo "   ✓ Done"
else
    echo "   ✗ File not found"
fi
echo

echo "2. Copying orchestrate-tasks.md..."
if [ -f "$SOURCE_DIR/orchestrate-tasks.md" ]; then
    cp -v "$SOURCE_DIR/orchestrate-tasks.md" "$DEST_DIR/"
    echo "   ✓ Done"
else
    echo "   ✗ File not found"
fi
echo

echo "3. Copying work-plan-from-doc.md..."
if [ -f "$SOURCE_DIR/work-plan-from-doc.md" ]; then
    cp -v "$SOURCE_DIR/work-plan-from-doc.md" "$DEST_DIR/"
    echo "   ✓ Done"
else
    echo "   ✗ File not found"
fi
echo

echo "=== Installation Complete ==="
echo
echo "Installed commands:"
for file in "$DEST_DIR"/*.md; do
    if [ -f "$file" ]; then
        filename=$(basename "$file" .md)
        echo "  • /$filename"
    fi
done
echo
echo "You can now use these slash commands in Claude Code!"