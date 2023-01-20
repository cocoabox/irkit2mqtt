const readline = require("readline");
const JSON5 = require('json5');
const {splitSpacesExcludeQuotes} = require('quoted-string-space-split');

const fs = require('fs');
const Irkit = require('./Irkit');

const config = JSON5.parse(fs.readFileSync(`${__dirname}/conf/irkit2mqtt.json5`, 'utf8'));

const irkits = Object.fromEntries(Object.entries(config.irkits).map(i => {
    const [irkit_name, {mac, ip}] = i;
    if (ip) {
        console.log(`${irkit_name} at ${ip}`);
        const irkit_inst = new Irkit(ip);
        irkit_inst.on('message', msg => {
            console.log(`Irkit ${irkit_name} :`, JSON5.stringify(msg));
        });
        return [irkit_name, irkit_inst];
    }
    else {
        console.log("TODO: discover irkit with mac address", mac,"; for now this config entry will be ignored");
        return [irkit_name, null];
    }
}).filter(i => !! i[1]));

// load plugins
const plugins = fs.readdirSync(`${__dirname}/plugins/`)
    .filter(n => !! n.match(/\.js$/))
    .map(filename => {
        const name_only = filename.match(/^(.*?)\.js$/)?.[1];
        if (! name_only) return;
        const require_path = (`./plugins/${name_only}`);
        try {
            const plugin = require(require_path);
            if (plugin?.model && plugin?.appliance_class) {
                console.log(`plugin : ${name_only}`);
                return plugin;
            }
        }
        catch (err) {
            console.warn('failed to load', require_path, "because", err);
        }
    });

function sleep(msec) {
    return new Promise(resolve => setTimeout(() => resolve(), msec));
}
(async function() {

    try {

        const devices = Object.fromEntries(
            Object.entries(config.appliances).map(a => {
                const [appliance_name, {irkit, model, setup}] = a;
                const cls = plugins.find(p => p.model === model)?.appliance_class;
                if (! cls) { 
                    console.warn('plugin model not found :', model);
                    return [appliance_name, null];
                }
                const irkit_inst = irkits[irkit];
                if (!irkit_inst) {
                    console.warn('no such irkit with name :', irkit, '; available names are :', Object.keys(irkits));
                    return [appliance_name, null];
                }
                const appliance_inst = new cls(irkit_inst, setup);
                return [appliance_name, appliance_inst];
            }).filter(n => !! n[1])
        );

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const ask = (prompt) => {
            return new Promise(resolve => {
                rl.question(prompt, input => resolve(input));
            });
        };

        const cmds = [
            {
                cmds:['health'],
                help: ['gets healthy status of IrKit', 'usage: healht'],
                action: function(args_str) {
                    console.log(irkit.health);
                },
            },
            {
                cmds:['quit', 'q', 'exit'],
                help: ['quits this app', 'usage: quit'],
                action: function(args_str) {
                    process.exit(0);
                },
            },
            {
                cmds:['help','h', '?'],
                help: ['shows help screen', `usage: help`],
                action: function(args_str) {
                    cmds.forEach(c => {
                        console.log(c.cmds.join(', '));
                        console.log('    ' + c.help[0]);
                    });
                },
            },
            {
                cmds:['list','l'],
                help:['lists all devices', `usage: list`],
                action: function (args_str) {
                    Object.entries(this.devices).forEach(d => {
                        console.log([ d[0], d[1].constructor.name ].join('\t'));
                    });
                },
            },
            {
                cmds: ['get-state', 'get', 'g'],
                help: ['get device states', `usage: get-state [DEVICE_NAME]`],
                action: function (args_str) {
                    const device_name = args_str;
                    if (! device_name) {
                        this.help();
                        return;
                    }
                    try {
                        const dev = this.devices[device_name];
                        if (! dev) {
                            throw new Error(`device ${device_name} not found`);
                        }
                        console.log(JSON5.stringify(dev.states));
                    }
                    catch(error) {
                        console.warn(error);
                        return;
                    }

                },
            },
            {
                cmds: ['information', 'query', 'info', 'gi', 'i'],
                help: ['get information about available states/actions', `usage: get-interface [DEVICE_NAME]`],
                action: function (args_str) {
                    const device_name = args_str;
                    if (! device_name) {
                        this.help();
                        return;
                    }
                    try {
                        const dev = this.devices[device_name];
                        if (! dev) {
                            throw new Error(`device ${device_name} not found`);
                        }
                        console.log('states :\n');
                        for (const [state_name, i] of Object.entries(dev.constructor.interface)) {
                            console.log(state_name, i);
                        }
                        console.log('\nactions :\n');
                        for (const [action_name, a] of Object.entries(dev.constructor.actions)) {
                            const {args} = a;
                            console.log(action_name,'\targs :', args.join(', '));
                        }
                        console.log('');
                    }
                    catch(error) {
                        console.warn(error);
                        return;
                    }

                },
            },
            {
                cmds:['action', 'act', 'do_action', 'do', 'a', 'd'],
                help: ['perform an action on a device', `usage: action [DEVICE_NAME] [ACTION_NAME] [ACT_ARG] ...`],
                action: async function (args_str) {
                    const mat = args_str?.trim().match(/^([^\s]+)\s*(.*)?$/);
                    const device_name = mat?.[1];
                    if (! device_name) {
                        console.warn('no device name provided');
                        this.help();
                        return;
                    }
                    const mat2 = (mat?.[2] ?? '').trim().match(/^([^\s]+)\s*(.*)?$/);
                    const action_name = mat2?.[1];
                    if (!action_name) {
                        console.warn('no action name provided');
                        this.help();
                        return;
                    }
                    const remaining_str= mat2?.[2] ?? '';
                    const args = splitSpacesExcludeQuotes(remaining_str)
                        .map(a => ['true', 'false'].includes(a) ? JSON.parse(a) : a.match(/^[0-9\.]+$/) ? parseFloat(a) : a);

                    const dev = this.devices[device_name];
                    try {
                        await dev.do_action(action_name, args);
                    }
                    catch (error) {
                        console.warn(error);
                        return;
                    }
                },
            },
            {
                cmds:['set-state', 'set', 's'],
                help: ['set device state and send', `usage: set-state [DEVICE_NAME] [STATE_OBJ]`],
                action: async function (args_str) {
                    const mat = args_str?.trim().match(/^([^\s]+)\s*(.*)?$/);
                    if (! mat) {
                        this.help();
                        return;
                    }
                    const device_name = mat?.[1];
                    if (! device_name) {
                        this.help();
                        return;
                    }
                    const states_json = mat[2] ?? '{}';
                    try {
                        const states = JSON5.parse(states_json);
                        const dev = this.devices[device_name];
                        if (! dev) {
                            throw new Error(`device ${device_name} not found`);
                        }
                        if (! dev.set_states(states)) {
                            console.warn('failed to set state');    
                        }
                        else {
                            await dev.send();
                            console.log('\nDone');
                        }
                    }
                    catch(error) {
                        console.warn(error);
                        return;
                    }
                },
            },
        ];
        let empty = 0;
        while (true) {
            let answer;
            try {
                const health_string = JSON5.stringify(Object.fromEntries(Object.entries(irkits).map(i => {
                    const [irkit_name, irkit_inst] = i;
                    return [irkit_name, irkit_inst.health ? 'OK':'NG'];
                })));
                answer = await ask(`${health_string} > `);
            }
            catch (error) {
                console.warn(error);
                process.exit(1);
            }
            const mat = answer.trim().match(/^([^\s]+)\s*(.*)?$/);
            const user_cmd = mat?.[1]?.toLowerCase() ?? '';
            const args_str = mat?.[2];
            const matching_cmd = cmds.find(c => c.cmds.includes(user_cmd));
            if (! user_cmd) {
                if (empty++ >= 3) {
                    console.warn('for help type "help"');
                    empty = 0;
                }
                continue;
            }
            if (matching_cmd) {
                matching_cmd.action.apply({
                    devices, 
                    help: () => {
                        console.log(matching_cmd.help.join('\n'));
                    },
                }, [args_str]);
            }
            else {
                console.warn('no matching command ; for help type "help"');
            }

        }
    }
    catch (error) {
        console.warn('🔥 ', error.stack);
        process.exit(1);
    }

})();
