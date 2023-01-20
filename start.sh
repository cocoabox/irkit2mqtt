#!/bin/bash
DIR="$(dirname "$(readlink -f "$0")")"

PID_FILE=/tmp/irkit2mqtt.pid
PID=$(cat "$PID_FILE" 2>/dev/null )
if [[ ! -z "$PID" ]]; then
    kill -15 "$PID"
fi

if [[ ! -z "$1" ]]; then
    if [[ -f "$1" ]]; then 
        CONF_FILE="$1"
        echo "conf file : $1" >&2
    else
        echo "conf file not found : $1" >&2
    fi
else 
    echo -e "=====\nusage: start [CONF_JSON_PATH]\n=====\n" >&2
    CONF_FILE="$DIR/conf/irkit2mqtt.json5"
fi

LOG_LOCATION=$(cat "$DIR/conf/log-location.txt")
if [[ ! -z "$LOG_LOCATION" ]]; then
    echo "to see logs, type : tail -F '$LOG_LOCATION'" >&2
fi
LOGROTATE_DATE_FORMAT="%Y-%m-%d"

/usr/bin/env node "$DIR/src" "$CONF_FILE" 2>&1 | while read LINE; do
    if [[ -z "$LOG_LOCATION" ]]; then
        echo "$LINE"
    else 
        echo "$LINE" >> "$LOG_LOCATION"
    fi    
done &

PID=$!

echo "$PID" > "$PID_FILE"

EXITING=0
bye() {
    EXITING=1
    echo "bye" >&2
    kill -15 "$PID"
    rm "$PID_FILE"
    exit 0
}
trap bye SIGINT
trap bye SIGTERM

do_my_log_rotate() {
    local OLD_DATE="$1"
    local ROTATE_FROM="$LOG_LOCATION"
    local ROTATE_TO="${ROTATE_FROM}_${OLD_DATE}.log.gz"
    echo "==> Rotating : $ROTATE_FROM → $ROTATE_TO" >&2
    cat "$ROTATE_FROM" | gzip > "$ROTATE_TO"
    echo "(log rotated)" > "$ROTATE_FROM"
}

TODAY=`date +${LOGROTATE_DATE_FORMAT}`
while true; do
    if [[ $EXITING -eq 1 ]]; then
        sleep 5
        continue
    fi
   
    if [[ ! -z "$LOG_LOCATION" ]]; then 
        TODAY2=`date +${LOGROTATE_DATE_FORMAT}`
        if [[ "$TODAY" != "$TODAY2" ]]; then
            echo "** LOG ROTATE ($TODAY vs $TODAY2) **"
            do_my_log_rotate "$TODAY"
        fi
        TODAY="$TODAY2"
    fi

    sleep 5

    kill -0 "$PID"
    if [[ $? -ne 0 ]]; then
        bye
    fi
done
