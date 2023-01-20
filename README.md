INSTALLING
===========

1. run `npm i`

1. create `conf/irkit2mqtt.json5` (use [conf-sample](conf-sample) as a reference)

1. copy or symlink cert files to `conf/certs/*`, adding all references to above conf json file

1. enter path of log file to `conf/log-location.txt` (to omit logging, or log to syslog, skip this step)

1. run `install-service.sh` to enable systemd service and start running
