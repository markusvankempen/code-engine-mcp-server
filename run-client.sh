#!/bin/bash

# Load environment variables from .env file
if [ -f "../.env" ]; then
    export $(cat ../.env | grep -v '^#' | xargs)
fi

# Run the MCP client
node build/simple-client.js "$@"

# Made by MVK
