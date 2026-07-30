#!/bin/sh
# Per-frame luma stats for a directory of snapshot PNGs.
# Prints: <t> <YMIN> <YMAX> <YAVG>
# YMAX is the load-bearing number: a frame whose MAX luma equals the deck's
# background has NOTHING painted on it. Measuring ink, not bounding boxes.
for f in "$1"/frame-*.png; do
  t=$(basename "$f" | sed -E 's/.*-at-([0-9.]+)s\.png/\1/')
  s=$(ffmpeg -v error -i "$f" -vf "format=yuv420p,signalstats,metadata=print:file=-" -f null - 2>/dev/null |
      awk -F= '/lavfi.signalstats.YMIN/{mn=$2} /lavfi.signalstats.YMAX/{mx=$2} /lavfi.signalstats.YAVG/{av=$2} END{printf "%s %s %s", mn, mx, av}')
  echo "$t $s"
done
