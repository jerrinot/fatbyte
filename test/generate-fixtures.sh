#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JAVA_SRC="$SCRIPT_DIR/fixtures/java"
CLASS_OUT="$SCRIPT_DIR/fixtures/classes"

# Clean and create output directory
rm -rf "$CLASS_OUT"
mkdir -p "$CLASS_OUT"

# Compile all Java files
echo "Compiling test fixtures..."
javac -d "$CLASS_OUT" "$JAVA_SRC"/*.java

echo "Compilation complete."
echo "Generated $(find "$CLASS_OUT" -name '*.class' | wc -l) class files."

# Generate expected.json using Node.js script
echo "Generating expected values..."
node "$SCRIPT_DIR/extract-expected.js" "$CLASS_OUT" > "$SCRIPT_DIR/fixtures/expected.json"

echo "Done. Expected values written to fixtures/expected.json"
