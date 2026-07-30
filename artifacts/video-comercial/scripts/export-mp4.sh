#!/bin/bash
set -x
cd /home/runner/workspace/artifacts/video-comercial/dist/public
/nix/store/flbj8bq2vznkcwss7sm0ky8rd0k6kar7-python-wrapped-0.1.0/bin/python3 -m http.server 4173 >/tmp/vidcap/http.log 2>&1 &
HTTP_PID=$!
sleep 1
cd /tmp/vidcap
rm -f raw.mkv timing.json capture.done
export CHROMIUM_BIN=/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium
XDOTOOL=/nix/store/k9h3c1q6cvl819cl933wss1nbl58wqcw-xdotool-3.20211022.1/bin/xdotool /nix/store/ds3bnbkkv55ig9243zw88xybk62aqaxx-xvfb-run-1+g87f6705/bin/xvfb-run -a -s "-screen 0 1920x1080x24" /nix/store/s7awkfc4pym4zj139fsxrjs5xwf5hhnd-nodejs-24.13.0-wrapped/bin/node capture.js
echo "exit=$?" > capture.done
kill $HTTP_PID

