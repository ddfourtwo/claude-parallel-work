# High-Performance Claude Code Execution Container
# Optimized for fast startup and minimal resource usage
FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies first (without nodejs)
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    python3 \
    python3-pip \
    rsync \
    ca-certificates \
    gnupg \
    lsb-release \
    openssh-client \
    sudo \
    libsecret-tools \
    dbus \
    dbus-x11 \
    gnome-keyring \
    tmux \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install Node.js 20.x (required for Claude CLI)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get update && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Verify Node.js version and install Claude Code CLI globally
RUN node --version && npm --version \
    && npm install -g @anthropic-ai/claude-code

# Set up D-Bus and keyring environment for Linux credential storage (as root)
RUN mkdir -p /var/lib/dbus && \
    dbus-uuidgen > /var/lib/dbus/machine-id

# Create non-root user for security
RUN useradd -m -s /bin/bash node \
    && echo 'node ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers \
    && mkdir -p /workspace \
    && chown node:node /workspace \
    && mkdir -p /home/node/.local/share/keyrings \
    && mkdir -p /home/node/.node \
    && chown -R node:node /home/node/.local \
    && chown -R node:node /home/node/.node

# Switch to non-root user
USER node
WORKDIR /workspace

# Set up default git config (required for Claude Code)
RUN git config --global user.name "Claude Code" \
    && git config --global user.email "node@anthropic.com" \
    && git config --global init.defaultBranch main

# Pre-warm Claude Code CLI (reduces first-run latency)
RUN timeout 10s node --version || true

# Set production environment for optimal performance
ENV NODE_ENV=production
ENV DEBIAN_FRONTEND=noninteractive

# Health check for container pool management
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
    CMD echo "ready" || exit 1

# Expose no ports by default (security)
EXPOSE 0

# Default command keeps container alive for pool reuse
# Container will be terminated explicitly when no longer needed
CMD ["sleep", "infinity"]
