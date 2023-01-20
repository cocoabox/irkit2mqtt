const MqttClient = require("./MqttClient");
const Irkit = require('./Irkit');
const {discover, arp} = require('./discover');

const fs = require('fs');

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

function iso_date() {
    return (new Date(Date.now() - (new Date).getTimezoneOffset() * 60 * 1000)).toISOString();
}

const wait_msec_after_publish = 1000;

class Irkit2Mqtt extends MqttClient {
    #conf;
    #irkits;
    // ^ { IRKIT_NAME: { mac:STR, ip:STR, inst:* }, ...
    #appliances;
    // ^ { APPLIANCE_NAME: {irkit_name:STR, inst:*, get_inst(), get_irkit(), appliance_class:CLASS}, ... }
    #topic_prefix;
    constructor(conf_path) {
        super(conf_path, {connect_on_construct: false, message_type: 'auto'}); 

        this.#topic_prefix = this.config?.topic_prefix ?? 'irkit2mqtt';

        this.incoming_topic_pattern = /([^\/]+)\/(set|do)(\/([^\/]+))?$/;
        this.mqtt_subscribe([
            `${this.#topic_prefix}/+/set`,
            `${this.#topic_prefix}/+/do/+`,
        ]);
        this.throttle_cooldown_time_sec = 5; 

        this.mqtt_connect();
        this.on('mqtt-connect', () => {
            // set up runtime structure #irkits
            this.#irkits = Object.fromEntries(Object.entries(this.config.irkits ?? {}).map(a => {
                const [irkit_name, {mac}] = a;
                return [irkit_name, {mac, instance: null}];
            }));
            // set up runtime structure #appliances for internal use
            this.#appliances = Object.fromEntries(
                Object.entries((this.config.appliances ?? {})).map(a => {
                    const [appliance_name, {irkit, model, setup}] = a;
                    return [appliance_name, {
                        model,
                        irkit_name: irkit, 
                        inst: null, // to be populated during get_inst() call
                        get_irkit: () => this.#get_irkit_inst(irkit),
                        get_inst: () => this.#get_appliance_inst(appliance_name),
                        appliance_class: plugins.find(p => p.model === model)?.appliance_class,
                        model,
                        setup,
                    }];
                })
            );
            this.#setup_discovery();
            this.#setup_interval_pub();
        });
    }
    async close({force}) {
        return await super.mqtt_close({force});
    }

    #on_irkit_health_change(irkit_name, is_healthy) {
        console.log(`[EVENT] irkit ${irkit_name} health changed`);
        Object.entries(this.#appliances).filter(a => {
            const [appliance_name, dict] = a;
            return dict.irkit_name === irkit_name;
        }).forEach( a => {
            const [appliance_name, dict] = a;
            this.#get_appliance_inst(appliance_name); 
            this.#publish_appliance_online(appliance_name);
        });        
    }

    #on_irkit_message(irkit_name, {message, guessed}={}) {
        console.log(`[EVENT] irkit ${irkit_name} message`);
        this.mqtt_publish(`${this.#topic_prefix}/__irkit__/${irkit_name}/message`, {
            message, guessed
        });
    }
    #on_appliance_state_updated(appliance_name, states) {
        console.log(`[EVENT] appliance ${appliance_name} state updated`, JSON.stringify(states));
        this.#publish_appliance_status(appliance_name);
    }

    #get_appliance_inst(name) {
        const {model, inst, irkit_name, appliance_class, setup} = this.#appliances[name] ?? {};
        if (inst) {
            return inst;
        }
        // need to instantiate
        const irkit_inst = this.#get_irkit_inst(irkit_name);
        if (!irkit_inst) {
            console.warn(`appliance ${name} : irkit ${irkit_name} is down`);
            return;
        }
        if (! appliance_class) {
            console.warn(`🔥 appliance ${name} : no such plugin : ${model}`);
            return;
        }
        console.log(`instantiating ${model} with name ${name}`);
        const new_inst = new appliance_class(irkit_inst, setup);
        this.#appliances[name].inst = new_inst 
        new_inst.on('state-updated', (states) => {
            this.#on_appliance_state_updated(name, states);
        });
        return new_inst;
    }
    #get_irkit_inst(name) {
        if (! (name in this.#irkits)) {
            throw new Error(`🔥 irkit ${name} is not defined`);
        }
        return this.#irkits[name]?.instance;
    }
    #irkit_arrived(irkit_name, irkit_inst) {
        console.log('irkit has arrived :', irkit_name);
        // event handlers
        irkit_inst.on('health', h => {
            this.#on_irkit_health_change(irkit_name, h);
        });
        irkit_inst.on('message', ({message, guessed}) => {
            this.#on_irkit_message(irkit_name, {message, guessed});
        });

        Object.entries(this.#appliances).filter(a => {
            const [appliance_name, dict] = a;
            return dict.irkit_name === irkit_name;
        }).forEach( a => {
            const [appliance_name, dict] = a;
            this.#get_appliance_inst(appliance_name); 
            this.#publish_appliance_status(appliance_name);
            this.#publish_appliance_online(appliance_name);
        });

    }

    #discovering; 
    #setup_discovery() {
        const conf = this.config.discovery ?? {};
        // console.log('discovery settings', JSON.stringify(conf));

        const discovery_func = async () => {
            if (this.#discovering) return;
            this.#discovering = true;

            const get_mac_addresses_wanted = () => {
                return Object.entries(this.#irkits)
                    .filter(a => a[1].instance === null)
                    .map(a => a[1].mac);
            };

            let mac_addresses_wanted = get_mac_addresses_wanted();

            const process_ip_mac_pairs = async (ip_mac_pairs) => {
                const wanted = get_mac_addresses_wanted();
                const filtered = ip_mac_pairs.filter(imp => wanted.includes(imp.mac));
                // ^ [ {ip:XX, mac:XX}, ... ]
                for (const [irkit_name, i] of Object.entries(this.#irkits)) {
                    // only instntiate Itkit instances for entries that has an empty "instance" field
                    const pair = filtered.find(imp => imp.mac === i.mac && ! i.instance);
                    if (pair) {
                        try {
                            if (await Irkit.is_irkit(pair.ip)) {
                                if (i.instance) {
                                    console.warn('killing existing instance');
                                    i.instance.stop_poll();
                                    i.instance.stop_and_clear_queue();
                                }
                                console.log('+ creating irkit :', irkit_name);
                                const instance = new Irkit(pair.ip);
                                this.#irkits[irkit_name] = {
                                    mac: i.mac,
                                    ip: pair.ip,
                                    instance,
                                };
                                this.#irkit_arrived(irkit_name, instance);
                            }
                        }catch(error) {
                            console.log('failed to inspect', pair.ip, 'because', error);
                        }
                    }
                }
            };
            const discover_using_arp = async () => {
                try { 
                    const arp_res = await arp({interface: interfac});
                    const {ip_mac_pairs} = arp_res;
                    await process_ip_mac_pairs(ip_mac_pairs);
                }
                catch (error ) {
                    console.warn('discover_using_arp failed');
                    return {};
                }
                
            };

            const interfac = conf?.interface ?? '';
            const scan_target = conf?.scan_target ?? '';
            const nmap = conf?.nmap ?? '/usr/bin/nmap';

            // early scan
            if( conf?.fast) {
                try {
                    console.log('[discovery] early scan');
                    await discover_using_arp();
                    mac_addresses_wanted = get_mac_addresses_wanted();
                }
                finally {
                    if (mac_addresses_wanted.length === 0) {
                        console.log('early scan has found all Irkits');
                        this.#discovering = false;
                        return;
                    }
                    console.log('early scan finished , still want', mac_addresses_wanted);
                }
            }

            if (scan_target) {
                try {
                    console.log('[discovery] slow discovery');
                    const {discovered} = await discover(scan_target, {interface: interfac, nmap});
                    await process_ip_mac_pairs(discovered);
                }
                catch(error) {
                    console.log('discover error :', error);
                    this.#discovering = false;
                    return;
                }
            }
            else {
                console.log('cannot nmap, running arp');
                try  {
                    await discover_using_arp({nmap: conf?.nmap});
                }
                catch (error) {
                    console.warn('error while arp', error);
                    this.#discovering = false;
                    return;
                }
            }
        };
        setInterval(() => {
            discovery_func();
        }, (conf.interval ?? 600) * 1000);
        discovery_func();
    }

    mqtt_publish(topic, body, {publish_opts,wait_connect_timeout}={}) {
        const wait_msec_after = wait_msec_after_publish;
        super.mqtt_publish(topic, body, {publish_opts,wait_connect_timeout,wait_msec_after});
    }

    async mqtt_on_message(topic, message_obj) {
        const mat = topic.match(this.incoming_topic_pattern);
        const appliance_name = mat?.[1];
        const op = mat?.[2];
        const action_name = mat?.[4];
        if (appliance_name && op) {
            try {
                switch(op) {
                    case 'set':
                        if (message_obj instanceof Buffer) {
                            console.warn(`for this topic "${topic}" valid JSON message body is required; got :`, message_obj.toString());
                            this.mqtt_publish(`${topic}/result`, "bad-request");
                        }
                        if (typeof message_obj === 'object') {
                            const err = await this.#appliance_set(appliance_name, message_obj);
                            this.mqtt_publish(`${topic}/result`, err ? err : "ok");
                        }
                        else {
                            console.warn(`for this topic "${topic}" a JSON message body is required; got :`, message_obj);
                            this.mqtt_publish(`${topic}/result`, "bad-request");
                        }
                        break;
                    case 'do':
                        if (! action_name) {
                            console.warn('action name is required in topic');
                            this.mqtt_publish(`${topic}/result`, "bad-request");
                        }
                        else if (message_obj === null || typeof message_obj === 'undefined') {
                            const err = await this.#appliance_do(appliance_name, action_name, []);
                            this.mqtt_publish(`${topic}/result`, err ? err : "ok");
                        }
                        else if (Array.isArray(message_obj)) {
                            const err = await this.#appliance_do(appliance_name, action_name, message_obj);
                            this.mqtt_publish(`${topic}/result`, err ? err : "ok");
                        }
                        else if (['boolean', 'string', 'number'].includes(typeof message_obj)) {
                            const err = await this.#appliance_do(appliance_name, action_name, [message_obj]);
                            this.mqtt_publish(`${topic}/result`, err ? err : "ok");
                        }
                        else {
                            console.warn(`for this topic "${topic}" either JSON (Array) or primitive type is required as message body`);
                            this.mqtt_publish(`${topic}/result`, "bad-request");
                        }
                        break;
                    default:
                        console.warn(`unsupported operation : ${op}`);
                }
            }
            catch (error) {
                console.warn('uncaught exception when processing appliance message', error);
                this.mqtt_publish(`${topic}/result`, "error");
            }
        }
        else {
            console.warn(`we don't know how to process this topic "${topic}"`);
            this.mqtt_publish(`${topic}/result`, "bad-request");
        }
    }

    #send_springload_timers;
    #send_springload_set(appliance_name, wait_sec) {
        if (! this.#send_springload_timers) {
            this.#send_springload_timers = {};
        }
        this.#send_springload_timers[appliance_name] = setTimeout(() => {
            console.log(`[springload] sending to ${appliance_name} at`, iso_date());
            const inst = this.#get_appliance_inst(appliance_name);
            if (inst) {
                inst.send();
                delete this.#send_springload_timers[appliance_name];
            }
        }, (wait_sec ?? 1) * 1000);
        console.log(`[springload] ${wait_sec} secs, starting now :`, iso_date());
    }
    #send_springload_clear(appliance_name) {
        console.log(`[springload] clearing ${appliance_name}`);
        if (! this.#send_springload_timers) {
            this.#send_springload_timers = {};
        }
        delete this.#send_springload_timers[appliance_name];
    }

    async #appliance_set(appliance_name, set_dict) {
        const inst = this.#get_appliance_inst(appliance_name);
        if (! inst) {
            console.warn('appliance instance not found :', appliance_name);
            return 'offline';
        }
        inst.set_states(set_dict);
        this.#send_springload_clear(appliance_name);
        this.#send_springload_set(appliance_name, this.config?.springload_sec ?? 3);
        // return no error
    }

    async #appliance_do(appliance_name, action_name, arg_array) {
        const inst = this.#get_appliance_inst(appliance_name);
        if (! inst) {
            console.warn('appliance instance not found :', appliance_name);
            return 'offline';
        }
        try {
            await inst.do_action(action_name, arg_array);
        }
        catch (e) {
            const {error} = e;
            switch(error) {
                case 'bad-args':
                    console.warn('arg validation failed:', arg_array);
                    return 'bad-request';
                case 'action-not-found': 
                    console.warn('action not found :', action);
                    return 'bad-request';
                case 'do-action-exception':
                    console.warn('appliance internal error');
                    return 'error';
                default:
                    console.warn('unknown exception :', e);
                    return 'error';
            }
        }
    }
    async #publish_appliance_online(appliance_name) {
        const {get_inst, get_irkit} =  this.#appliances[appliance_name];
        if (! get_inst || ! get_irkit) {
            throw new Error(`🔥 appliance not found : ${appliance_name}`);
        }
        // console.log("📣 publishing ONLINE status because: ", (new Error).stack);
        const irkit_inst = get_irkit();
        const irkit_healthy = (!! irkit_inst) && irkit_inst.health === true;
        if (!irkit_healthy) {
            console.log(`🔴 irkit for appliance ${appliance_name} is down`);
        }
        await this.mqtt_publish(`${this.#topic_prefix}/${appliance_name}/availability`, irkit_healthy ? 'yes':'no');
    }
    async #publish_appliance_status(appliance_name) {
        const {get_inst, get_irkit, model} =  this.#appliances[appliance_name];
        if (! get_inst || ! get_irkit) {
            throw new Error(`🔥 appliance not found : ${appliance_name}`);
        }
        console.log('appliance status update :', appliance_name);
        const inst = get_inst();
        const appliance_type = inst?.constructor.appliance_type;
        const irkit_inst = get_irkit();
        const state = inst ? inst.states : null;
        const msg = { model, appliance_type, state };
        await this.mqtt_publish(`${this.#topic_prefix}/${appliance_name}`, msg);
    }
    #interval_pub_timer;
    #interval_publishing;
    #setup_interval_pub() {
        if (this.#interval_pub_timer) {
            clearInterval(this.#interval_pub_timer);
        }
        const pub_func = async ()=>{
            if (this.#interval_publishing) return;
            this.#interval_publishing = true;
            for (const appliance_name of Object.keys(this.#appliances)) {
                await this.#publish_appliance_status(appliance_name);
            }

        };

        this.#interval_pub_timer = setInterval(pub_func,
            (this.config.update_interval || 120) * 1000);
    }
}

module.exports = Irkit2Mqtt;

