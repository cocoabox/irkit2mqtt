#!/bin/bash
DIR="$(dirname "$(readlink -f "$0")")"
cat "$DIR"/irkit2mqtt.service.template  | sed 's|DIR|'$DIR'|' > /etc/systemd/system/irkit2mqtt.service
systemctl enable irkit2mqtt

echo "starting..." >&2
systemctl restart irkit2mqtt
