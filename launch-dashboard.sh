#!/bin/bash

# Claude Parellel Work Dashboard Launcher
# Quick launcher for the complete dashboard experience

echo "🚀 Claude Parellel Work Dashboard Launcher"
echo "=================================="

# Check for command line arguments
LAUNCH_MODE="browser"
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Usage: $0 [--help|-h]"
    echo ""
    echo "Options:"
    echo "  --help, -h        Show this help message"
    echo ""
    echo "Launches Claude Parellel Work Dashboard in browser"
    exit 0
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to wait for port to be available
wait_for_port() {
    local port=$1
    local max_wait=30
    local wait_count=0
    
    echo "Waiting for port $port to be available..."
    while [ $wait_count -lt $max_wait ]; do
        if check_port $port; then
            echo -e "${GREEN}✅ Port $port is ready!${NC}"
            return 0
        fi
        sleep 1
        wait_count=$((wait_count + 1))
        echo -n "."
    done
    
    echo -e "${RED}❌ Timeout waiting for port $port${NC}"
    return 1
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || ! grep -q "claude-parallel-work" package.json; then
    echo -e "${RED}❌ Error: Please run this script from the claude-parallel-work root directory${NC}"
    exit 1
fi

# Check if enhanced server is already running
if check_port 47821; then
    echo -e "${YELLOW}⚠️  Enhanced server already running on port 47821${NC}"
    SERVER_RUNNING=true
else
    SERVER_RUNNING=false
fi

# Check if dashboard is already running
if check_port 5173; then
    echo -e "${YELLOW}⚠️  Dashboard already running on port 5173${NC}"
    DASHBOARD_RUNNING=true
else
    DASHBOARD_RUNNING=false
fi

# If both are running, just open browser
if [ "$SERVER_RUNNING" = true ] && [ "$DASHBOARD_RUNNING" = true ]; then
    echo -e "${GREEN}🎯 Both services are already running!${NC}"
    echo -e "${BLUE}📱 Opening dashboard in browser...${NC}"
    
    # Open browser
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "http://localhost:5173"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open "http://localhost:5173" 2>/dev/null || firefox "http://localhost:5173" 2>/dev/null || chromium "http://localhost:5173" 2>/dev/null
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
        start "http://localhost:5173"
    fi
    
    echo -e "${GREEN}✅ Dashboard should now be open in your browser${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}🔧 Starting Claude Parellel Work Dashboard...${NC}"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing main dependencies...${NC}"
    npm install
fi

if [ ! -d "dashboard/node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dashboard dependencies...${NC}"
    cd dashboard && npm install && cd ..
fi

# Build TypeScript if needed
if [ ! -d "dist" ] || [ ! -f "dist/server.js" ]; then
    echo -e "${YELLOW}🔨 Building TypeScript...${NC}"
    npm run build
fi

# Start enhanced server if not running
if [ "$SERVER_RUNNING" = false ]; then
    echo -e "${BLUE}🚀 Starting enhanced server...${NC}"
    npm run start:dashboard &
    SERVER_PID=$!
    
    # Wait for server to start
    if wait_for_port 47821; then
        echo -e "${GREEN}✅ Enhanced server running on http://localhost:47821${NC}"
    else
        echo -e "${RED}❌ Failed to start enhanced server${NC}"
        kill $SERVER_PID 2>/dev/null
        exit 1
    fi
else
    echo -e "${GREEN}✅ Enhanced server already running${NC}"
fi

# Start dashboard if not running
if [ "$DASHBOARD_RUNNING" = false ]; then
    echo -e "${BLUE}🎨 Starting dashboard...${NC}"
    cd dashboard
    npm run dev &
    DASHBOARD_PID=$!
    cd ..
    
    # Wait for dashboard to start
    if wait_for_port 5173; then
        echo -e "${GREEN}✅ Dashboard running on http://localhost:5173${NC}"
    else
        echo -e "${RED}❌ Failed to start dashboard${NC}"
        kill $DASHBOARD_PID 2>/dev/null
        [ "$SERVER_RUNNING" = false ] && kill $SERVER_PID 2>/dev/null
        exit 1
    fi
else
    echo -e "${GREEN}✅ Dashboard already running${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Claude Parellel Work Dashboard is ready!${NC}"
echo ""

echo -e "${BLUE}📊 Dashboard:${NC} http://localhost:5173"
echo -e "${BLUE}🔧 Enhanced Server:${NC} http://localhost:47821"

echo ""
echo -e "${YELLOW}💡 Tip: Use Ctrl+C to stop services${NC}"
echo -e "${YELLOW}💡 Use 'docker ps | grep claude-parallel-work' to monitor containers${NC}"
echo ""

# Keep script running to manage background processes
if [ "$SERVER_RUNNING" = false ] || [ "$DASHBOARD_RUNNING" = false ]; then
    echo "Press Ctrl+C to stop services..."
    
    # Trap Ctrl+C to cleanup
    trap 'echo -e "\n${YELLOW}🛑 Stopping services...${NC}"; [ "$SERVER_RUNNING" = false ] && kill $SERVER_PID 2>/dev/null; [ "$DASHBOARD_RUNNING" = false ] && kill $DASHBOARD_PID 2>/dev/null; echo -e "${GREEN}✅ Services stopped${NC}"; exit 0' INT
    
    # Wait for processes
    while true; do
        sleep 1
    done
fi
