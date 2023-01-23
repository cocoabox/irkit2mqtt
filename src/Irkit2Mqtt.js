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
                return {type: 'appliance', plugin};
            }
            else if (plugin?.model && plugin?.mqtt_rewrite) {
                console.log(`plugin : ${name_only}`);
                return {type: 'mqtt_rewrite', plugin};
            }
        }
        catch (err) {
            console.warn('failed to load', require_path, "because", err);
        }
    });

function plugin_find(model, type='appliance') {
    const plugin_key = {
        appliance: 'appliance_class',
        mqtt_rewrite: 'mqtt_rewrite',
    }[type];
    if (! plugin_key) 
        throw new Error(`expecting type to be either "appliance" or "mqtt_rewrite"; got : ${type}`);

    return plugins.find(p => p.type === type && p.plugin.model === model).plugin[plugin_key];
}

function iso_date() {
    return (new Date(Date.now() - (new Date).getTimezoneOffset() * 60 * 1000)).toISOString();
}

function to255scale(val, min, max)  {
    return Math.round((val-min) / (max-min) * 255);
}
function from255scale (val255, min, max) {
    return Math.round(val255 / 255 * (max - min) + min);
}

function convert_to_boolean  (user_val)  {
    if (['boolean', 'number'].includes(typeof user_val)) return !! user_val;
    return {
        'true': true, 'false': false,
        '1': true, '0': false,
        'yes': true, 'no': false,
        'y': true, 'n': false,
        'on': true, 'off': false,
    }[`${user_val}`.trim().toLowerCase()] ?? undefined;
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

        this.incoming_topic_pattern = /(__hello__|([^\/]+)\/((do)\/([^\/]+)|(set)|(ex)\/([^\/]+)\/set))$/;
        this.mqtt_subscribe([
            `${this.#topic_prefix}/__hello__`,
            `${this.#topic_prefix}/+/set`,
            `${this.#topic_prefix}/+/do/+`,
            `${this.#topic_prefix}/+/ex/+/set`,  // expanded topic
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
                        appliance_class: plugin_find(model, 'appliance'),
                        model,
                        setup,
                    }];
                })
            );
            this.#setup_discovery();
            this.#setup_interval_pub();
            this.#setup_metrics_report();
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
        this.#publish_appliance_status_individually(appliance_name);
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
        if (! name) {
            console.warn('attempted to get_irkit_inst(NULL) in ', (new Error).stack);
            console.warn('- irkits:', this.#irkits);
            console.warn('- appliances:', this.#appliances);
            return;
        }
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

        const discovery_func = async () => {
            if (this.#discovering) return;

            // do we need discover?
            let need_discovery = false;
            for (const [irkit_name, i] of Object.entries(this.#irkits)) {
                const {inst} = i;
                if (! inst || ! inst.health) {
                    need_discovery = true;
                    break;
                }
            }
            if (! need_discovery) {
                console.log("[discover] all good ; no need");
                return;
            }

            this.#discovering = true;
            console.log("[discover] this.#irkits = ", this.#irkits);

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
            } };

        setInterval(() => {
            discovery_func();
        }, (conf.interval ?? 120) * 1000);
        console.log(`[discover] every ${conf.interval} secs`);
        discovery_func();
    }

    mqtt_publish(topic, body, {publish_opts,wait_connect_timeout}={}) {
        const wait_msec_after = wait_msec_after_publish;
        return super.mqtt_publish(topic, body, {publish_opts,wait_connect_timeout,wait_msec_after});
    }

    async mqtt_on_message(topic, message_obj) {
        const mat = topic.match(this.incoming_topic_pattern);
        const appliance_name = mat?.[2];
        let topic_type;
        let ex_state_name;
        let action_name;
        if (mat?.[1] === '__hello__') {
            return this.#publish_all_appliances();
        }
        else if (mat?.[6] === 'set') {
            topic_type = 'set';
        }
        else if (mat?.[7] === 'ex') {
            topic_type = 'ex';
            ex_state_name = mat?.[8];
        }
        else if (mat?.[4] === 'do') {
            topic_type = 'do';
            action_name = mat?.[5];
        }
        else {
            console.warn('topic doesnt match any known patterns (set,ex,do) :', topic);
            this.mqtt_publish(`${topic}/result`, "bad-request");
            return;
        }
        try {
            switch(topic_type) {
                case 'ex': 
                    if (message_obj instanceof Buffer) {
                        message_obj = message_obj.toString('utf8');
                    }
                    const set_err = await this.#appliance_set_individual_state(
                        appliance_name, ex_state_name, message_obj);
                    this.mqtt_publish(`${topic}/result`, set_err ? set_err : "ok");
                    break; 
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
                    console.warn(`unsupported operation : ${topic_type}`);
            }
        }
        catch (error) {
            console.warn('uncaught exception when processing appliance message', error);
            this.mqtt_publish(`${topic}/result`, "error");
        }
    }
    async #publish_all_appliances() {
        console.log('publishing ALL appliance statuses');
        for (const appliance_name of Object.keys(this.#appliances)) {
            await this.#publish_appliance_status(appliance_name);
        }
    }

    #send_springload_timers; // = { appliance_name: {timer:*, resolve:*, reject:*}
    #send_springload_set(appliance_name, wait_sec) {
        return new Promise((resolve, reject) => {
            if (! this.#send_springload_timers) {
                this.#send_springload_timers = {};
            }
            const timer = setTimeout(() => {
                delete this.#send_springload_timers[appliance_name];
                console.log(`[springload] sending to ${appliance_name} at`, iso_date());
                const inst = this.#get_appliance_inst(appliance_name);
                if (!inst) return;
                console.log('[springload] validating states');
                inst.remove_invalid_states();

                console.log('[springload] ⚡️ sending states', inst.states);

                inst.send().then(() => {
                    console.log('[springload] sending completed');
                    resolve();
                }
                ).catch(error => {
                    console.warn('[springload] sending failed :', error);
                    reject();
                });
            }, (wait_sec ?? 3) * 1000);

            this.#send_springload_timers[appliance_name] = {timer, resolve, reject};

            console.log(`[springload] ${wait_sec} secs, starting now :`, iso_date());
        });
    }
    #send_springload_clear(appliance_name) {
        console.log(`[springload] clearing ${appliance_name}`);
        if (! this.#send_springload_timers) {
            this.#send_springload_timers = {};
        }
        const existing = this.#send_springload_timers[appliance_name];
        if (existing) {
            const {timer, resolve, reject} = existing;
            console.log(`[springload] clearing ${appliance_name}`);
            clearTimeout( timer );
            resolve('later');
            delete this.#send_springload_timers[appliance_name];
        }
    }

    /**
     * process incoming ex-field update request
     * @param {string} appliance_name
     * @param {string} ex_field_name
     *      ex field name provided by user; ex-field are defined in mqtt-rewrite plugins
     * @param {Buffer|string|number|object} state_value
     *      ex field value provided by user
     * @return {Promise<string|undefined>}
     *      return error message string 
     */
    async #appliance_set_individual_state(appliance_name, ex_field_name, state_value) {
        const inst = this.#get_appliance_inst(appliance_name);
        if (! inst) {
            console.warn('appliance instance not found :', appliance_name);
            return 'offline';
        }
        const rewrite_plugin = this.#get_mqtt_rewrite_plugin(appliance_name);
        if (! rewrite_plugin) {
            console.warn(`no mqtt_rewrite plugin exists for ${appliance_model}`);
            return 'bad-request';
        }
        const expansion_def = rewrite_plugin[ex_field_name];
        if (! expansion_def) {
            console.warn(`no mqtt_rewrite definition for ${ex_field_name}`);
            return 'bad-request';
        }
        const {set, mapped_state} = expansion_def;
        const final_state_name = typeof mapped_state === 'string' ? mapped_state :
            typeof mapped_state === 'function' ? null : ex_field_name;
        let final_value;
        if (typeof set === 'function') {
            try {
                const ctx = {
                    convert_to_boolean,
                    to255scale,
                    from255scale,
                    appliance: inst,
                };
                final_value = set.apply(ctx, [state_value, inst.states]);
                if (typeof final_value === 'undefined') {
                    console.warn(`⚠️  nothing returned from ${appliance_name}'s : mqtt_rewrite_plugin.${ex_field_name}.set() ; state_value =`, state_value);
                    final_value = state_value;
                }
            }
            catch (error) {
                console.warn('failed to process set value', state_value, 'because', error);
                return 'bad-value';
            }
        } 
        else if (set === 'bool' || set === 'boolean') {
            if (typeof state_value === 'boolean') {
                // do nothing
            }
            else if (typeof state_value === 'string') {
                // convert string to boolean
                final_value = convert_to_boolean( state_value );
                if (typeof final_value === 'undefined') {
                    console.warn('failed to convert to boolean :', state_value);
                    return 'bad-value';
                }
            }
            else if (typeof state_value === 'number') {
                final_value = !! state_value;
            }
            else {
                final_value = !! parseInt(state_value.toString('utf8'));
            }
        }
        else if (set === 'number') {
            if (typeof state_value === 'number') {
                // do nothing
            }
            else if (typeof state_value === 'string') {
                final_value = parseFloat(state_value);
            }
            else {
                final_value = parseFloat(state_value.toString('utf8'));
            }
        }
        else if (set === 'string') {
            final_value = state_value.toString('utf8');
        }
        else if (set === 'object') {
            if (typeof state_value === 'object') {
                final_value = state_value;
            }
            else {
                console.warn('expecting object {KEY:VAL, ...}, got:', state_value);
                return 'bad-value';
            }
        }
        else {
            console.warn(`🔥 unknown value for ${appliance_name}'s : mqtt_rewrite_plugin.${ex_field_name}.set`);
            return 'bad-config';
        }
        //
        // finally, call appliance's set_state() function
        //
        if (! final_state_name && typeof final_value === 'object') {
            if (! inst.set_states(final_value)) {
                console.warn(`supplied statename/value dict failed validation :`, final_value);
                return 'invalid';
            }
        }
        else {
            if (! inst.set_state(final_state_name, final_value)) {
                console.warn(`supplied value for state ${ex_field_name} failed validation :`, state_value);
                return 'invalid';
            }
        }
        this.#send_springload_clear(appliance_name);
        this.#send_springload_set(appliance_name, this.config?.springload_sec ?? 3);
        // return error (or return undefined for no error)
    }

    /**
     * @param {string} appliance_name
     * @param {object} set_dict
     * @return {Promise<string|undefined>}
     */
    async #appliance_set(appliance_name, set_dict) {
        const inst = this.#get_appliance_inst(appliance_name);
        if (! inst) {
            console.warn('appliance instance not found :', appliance_name);
            return 'offline';
        }
        inst.set_states(set_dict);
        // springload: if we're flooded with set state requests, then wait until we're
        // in the clear for 3 seconds (config.springload_sec) before sending any IR
        // messages
        this.#send_springload_clear(appliance_name);
        try {
            const springload_result = await this.#send_springload_set(appliance_name, this.config?.springload_sec ?? 3);
            // ^ may be "later" or undefined
            if (!springload_result || 'later' === springload_result) return;
            // return error (or return undefined for no error)
            else return springload_result;
        }
        catch (error) {
            console.warn('#send_springload_set raised an exception', error);
            return 'error';
        }
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

    #get_mqtt_rewrite_plugin(appliance_name) {
        const appliance_model = this.#appliances[appliance_name].model;
        return plugin_find(appliance_model, 'mqtt_rewrite');
    }

    //
    // publish ex-fields
    //
    async #publish_appliance_status_individually(appliance_name) {
        const {get_inst, get_irkit, model} =  this.#appliances[appliance_name];
        if (! get_inst || ! get_irkit) {
            throw new Error(`🔥 appliance not found : ${appliance_name}`);
        }
        const expa = this.#get_mqtt_rewrite_plugin(appliance_name);
        const inst = get_inst();
        const ctx = { // callback context for calling plugin's mapped_state() and get()
            convert_to_boolean,
            to255scale,
            from255scale,
            appliance: inst,
        };        
        if (Object.keys(expa).length === 0) {
            return;
        }
        console.log('appliance status update (individual) :', appliance_name);
        for (const [exposed_name, e] of Object.entries(expa)) {
            const {mapped_state, get} = e;

            const state_value = 
                typeof mapped_state === 'function' ? mapped_state.apply(ctx, [inst.states])
                : inst.get_state(mapped_state ?? exposed_name);
            let message;
            if (state_value === null || typeof state_value === 'undefined') 
                continue;
            if (get === 'as-is') {
                message = typeof state_value === 'string' 
                    ? Buffer.from(state_value, 'utf8')
                    : Array.isArray(state_value) 
                    ? Buffer.from(state_value.map(n => `${n}`).join(','), 'utf8')
                    : Buffer.from(JSON.stringify(state_value), 'utf8');
            }
            else if (get === 'number') {
                message = parseFloat(state_value);
                if (isNaN(message)) continue;
            }
            else if (get === 'boolean') {
                message = typeof state_value === 'boolean' 
                    ? state_value
                    : typeof state_value === 'nubmer'
                    ? !! state_value
                    : !! parseInt(state_value);
            }
            else if (get === 'string') {
                message = `${state_value}`;
            }
            else if (get === 'json') {
                message = Buffer.from(JSON.stringify(state_value), 'utf8');
            }
            else if (typeof get === 'function') {
                try {
                    // let plugin convert the state value to something home-assistant recognises
                    const get_res = get.apply(ctx, [state_value, inst.states]);
                    message = typeof get_res === 'undefined' ? state_value : get_res;
                }
                catch (error) {
                    console.warn(`⚠️  appliance ${appliance_name}'s mqtt_rewrite_plugin.${exposed_name}.get raised an exception:`, error);
                    continue;
                }
            }
            else {
                console.warn(`⚠️  appliance ${appliance_name}'s mqtt_rewrite_plugin.${exposed_name}.get is unknown : ${get} ; publishing state_value as-is`);
                message = state_value;
            }
            await this.mqtt_publish(`${this.#topic_prefix}/${appliance_name}/ex/${exposed_name}`, message);
        }
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
            (this.config.update_interval ?? 120) * 1000);
    }
    #metrics_report_timer;
    #setup_metrics_report() {
        if (this.#metrics_report_timer) {
            clearInterval(this.#metrics_report_timer);
        }
        this.#metrics_report_timer = setInterval(async () => {
            for(const irkit_name of Object.keys(this.#irkits)) {
                const irkit_inst = this.#get_irkit_inst(irkit_name);
                if (irkit_inst) {
                    const dev_metrics = irkit_inst.metrics;
                    console.log(`[metrics] irkit ${irkit_name} report :`, dev_metrics);
                    await this.mqtt_publish(`${this.#topic_prefix}/__irkit__/${irkit_name}/metrics`, dev_metrics);
                }
            }
        }, (this.config.metrics_interval ?? 120) * 1000);
    }
}

module.exports = Irkit2Mqtt;

