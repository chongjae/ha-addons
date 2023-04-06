#!/usr/bin/env bash

set -e

share_dir="/share/Inoshade"
js_file="easyroll_blind.js"

if [ ! -f "$share_dir/$js_file" ]; then
    if ! mkdir -p "$share_dir"; then
        echo "ERROR: Failed to create directory $share_dir"
        exit 1
    fi

    if ! mv "/$js_file" "$share_dir"; then
        echo "ERROR: Failed to move $js_file to $share_dir"
        exit 1
    fi
fi

echo "INFO: Running easyroll_blind Addon..."
cd "$share_dir"
if ! node "$js_file"; then
    echo "ERROR: Failed to run $js_file"
    exit 1
fi
