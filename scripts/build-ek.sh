#!/bin/bash
# Build EventKit Swift binaries for mac-mcp
# Run this on each Mac after cloning the repo.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building EventKit binaries..."

swiftc -O -o "$DIR/calendar-ek"  "$DIR/calendar-ek.swift"  -framework EventKit
echo "  calendar-ek  OK"

swiftc -O -o "$DIR/contacts-ek"  "$DIR/contacts-ek.swift"  -framework Contacts
echo "  contacts-ek  OK"

swiftc -O -o "$DIR/reminders-ek" "$DIR/reminders-ek.swift" -framework EventKit
echo "  reminders-ek OK"

echo ""
echo "Done. Now grant macOS permissions by running each binary once:"
echo "  $DIR/calendar-ek  list-calendars"
echo "  $DIR/reminders-ek list-lists"
echo "  $DIR/contacts-ek  search --query test"
echo ""
echo "Approve each permission dialog that appears."
