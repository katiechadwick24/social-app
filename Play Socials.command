#!/bin/bash
# Make sure node is found regardless of how it was installed
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"

cd "/Users/kt/Library/CloudStorage/Dropbox-Thepassivepractice/Katie Chadwick/Socials App"

echo ""
echo "  Starting Socials App..."
echo ""

node server.js
