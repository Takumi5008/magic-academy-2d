#!/bin/bash
cd "$(dirname "$0")"
PORT=8123
(sleep 1 && open "http://localhost:$PORT/") &
echo "魔法学院を起動しています... ブラウザが自動で開きます。"
echo "終了するには、このウィンドウで Ctrl+C を押してください。"
python3 -m http.server "$PORT"
