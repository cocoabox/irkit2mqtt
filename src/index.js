#!/usr/bin/env node

const Irkit2Mqtt = require('./Irkit2Mqtt');
const fs = require('fs');

(async function() {
    process.on('unhandledRejection', console.dir);


    const conf_path = process.argv[2] ?? (process.env?.CONF_PATH ?? `${__dirname}/../conf/irkit2mqtt.json5`);
    if (! conf_path) {
        console.warn('usage : node . [CONF_FILE]');
        process.exit(1);
    }

    if (! fs.existsSync(conf_path)) {
        console.warn('conf not found :', conf_path);
        process.exit(1);
    }
    const irkit2mqtt = new Irkit2Mqtt(conf_path);

    async function on_quit() {
        console.log('closing...');
        await irkit2mqtt.close({force: false});
        process.exit(0);
    }
    process.on('SIGINT', on_quit);
    process.on('SIGTERM', on_quit);

})();
