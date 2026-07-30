#!/bin/bash
# Only the render's own Chrome, split by process type, plus the frame counter.
OUT="$1"; LOG="$2"
echo "t,procs,total_mb,browser_mb,gpu_mb,renderer_mb,node_mb,frame" > "$OUT"
START=$(date +%s)
while pgrep -f "hyperframes render" > /dev/null 2>&1; do
  NOW=$(( $(date +%s) - START ))
  P=$(ps -Ao rss,args | grep "cache/hyperframes/chrome" | grep -v grep)
  TOT=$(echo "$P" | awk '{s+=$1;n++} END{print (n+0)","int(s/1024)}')
  BR=$(echo "$P" | grep -v -- "--type=" | awk '{s+=$1} END{print int(s/1024)}')
  GPU=$(echo "$P" | grep -- "--type=gpu-process" | awk '{s+=$1} END{print int(s/1024)}')
  REN=$(echo "$P" | grep -- "--type=renderer" | awk '{s+=$1} END{print int(s/1024)}')
  ND=$(ps -Ao rss,args | grep "bin/hyperframes render" | grep -v grep | awk '{s+=$1} END{print int(s/1024)}')
  FR=$(grep -oE "[0-9]+/[0-9]+ frames|frame [0-9]+" "$LOG" 2>/dev/null | tail -1 | tr -d '\n')
  echo "$NOW,$TOT,$BR,$GPU,$REN,$ND,$FR" >> "$OUT"
  sleep 10
done
echo "RENDER PROCESS GONE" >> "$OUT"
