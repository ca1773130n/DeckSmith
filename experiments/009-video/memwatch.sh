#!/bin/bash
# Sample Chrome/node memory every 5s while a render runs.
OUT="$1"
echo "t,chrome_procs,chrome_rss_mb,node_rss_mb,free_mb,swap_used_mb" > "$OUT"
START=$(date +%s)
while true; do
  NOW=$(( $(date +%s) - START ))
  CH=$(ps -Ao rss,comm | grep -iE "Chrom|headless_shell" | awk '{s+=$1; n++} END {print n+0","int(s/1024)}')
  ND=$(ps -Ao rss,comm | grep -E "bin/node$|/node$" | awk '{s+=$1} END {print int(s/1024)}')
  FREE=$(vm_stat | awk '/Pages free/{f=$3} /page size of/{ps=$8} END {gsub(/\./,"",f); print int(f*16384/1048576)}')
  SW=$(sysctl -n vm.swapusage | awk '{print $6}' | tr -d 'M')
  echo "$NOW,$CH,$ND,$FREE,$SW" >> "$OUT"
  sleep 5
done
