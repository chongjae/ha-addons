#!/bin/sh

share_dir=/share/bestin

copy_file() {
    if [ ! -f "$share_dir/$1" ]; then
        mkdir -p "$share_dir"
        mv "/$1" "$share_dir"
    fi
}

run_node() {
    echo "INFO: Running HDC BESTIN WallPad RS485 Addon..."
    cd "$share_dir"
    node bestin_wallpad.js
}

copy_file "bestin_wallpad.js"
copy_file "const.js"
copy_file "logger.js"

if [ -f "$share_dir/bestin_wallpad.js" ]; then
    run_node
else
    echo "ERROR: Failed to copy 'bestin_wallpad.js' to $share_dir"
    exit 1
fi
