#!/bin/zsh
cd "$(dirname "$0")"
node run.mjs A0 6 4 > runs/A0.log 2>&1
node run.mjs A 8 4 > runs/A.log 2>&1
node run.mjs B 8 4 > runs/B.log 2>&1
echo ALLDONE
