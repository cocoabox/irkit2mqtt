"use strict";

const path = require('path');
const IrkitAppliance = require('../IrkitAppliance');
const {Bit} = require('../binary-tools');
const {IrData2} = require('../IrData2');

//
// 東芝 FRC-205T(K) , FRC205T(W)
//
// const irkit = new Irkit('192.168.1.xxx');    // discoverされたirkitのIPアドレスでIrKitオブジェクトを作成
// const lamp = new ToshibaCeilingLamp(irkit, {ch:1});  // リモコンCh=1
//
// await lamp.set_states({mode: 'off'}).send(); // 消灯
// await lamp.set_states({mode: 'max'}).send(); // 全光 
// await lamp.set_states({mode: 'normal'}).send(); // 全光 
// await lamp.set_states({mode: 'theater'}).send(); // シアター
//
// await lamp.set_states({mode: 'normal', advanced:true, brightness: 5}).send(); // 全光-?明るさ5/20
// await lamp.set_states({mode: 'normal', advanced:true, 'color-temp': 13}).send(); // 全光->やや冷たい色温度13/20
// await lamp.set_states({mode: 'normal', advanced:true, brightness: 0, r: 5, b: 5}).send(); // 紫色 (赤、青それぞれ5/10に設定)
//
class ToshibaFRC205TIrData extends IrData2 {
    constructor() {
        super(630,                // T = 630 μs
            ['16T-high', '8T'],   // leader pulses/spaces
            ['1T-high', '1T'],    // bit 1
            ['1T-high', '3T'],    // bit 0
            '1T',                 // stop pulse
            121510,               // data frame length (μs)
            [['15.87T-high', '3.87T', '1.12T'], ['17T-high', '3.87T', '1.12T']],
            // repeat headers: first repeat is 16T,4T,1T; later repeats are 17T,4T,1T
            [122150, 122860]           // repeat0 = 122510 μs ; repeatN = 122860 μs
        );
    }
}

const customer_code = [
    [0, 0, 0, 1, 1, 0, 0, 0],
    [1, 1, 0, 0, 1, 1, 1, 1]
];

const rgb_max = 10;

//
// my_light.set_states({
//      mode: 'normal',
//      advanced: true,
//      brightness: 20,
// });
//
// my_light.set_states({
//      mode: 'theater',
// });
//
//
class ToshibaCeilingLamp extends IrkitAppliance {
    #ch;
    constructor(irkit_inst, setup={}) {
        setup = Object.assign({ch:1}, setup);
        super(irkit_inst, setup);
        this.#ch = setup.ch;
    }
    static get appliance_type() {
        return 'light';
    }

    #get_key_bits(key_name) {
        return {
            max: {ch2: [0, 0, 0, 1, 0, 1, 1, 1], ch1: [0, 0, 0, 1, 0, 1, 1, 0]},
            kirei: {ch2: [1, 0, 0, 1, 1, 0, 1, 1], ch1: [1, 0, 0, 1, 1, 0, 1, 0]},
            theater: {ch1: [0, 0, 1, 0, 1, 0, 1, 0], ch2: [0, 0, 1, 0, 1, 0, 1, 1]},
            benkyo: {ch1: [0, 0, 0, 1, 1, 0, 1, 0], ch2: [0, 0, 0, 1, 1, 0, 1, 1]},
            relax: {ch1: [1, 1, 0, 0, 1, 0, 1, 0], ch2: [1, 1, 0, 0, 1, 0, 1, 1]},
            "night-light": {ch1: [0, 0, 0, 0, 1, 1, 1, 0], ch2: [0, 0, 0, 0, 1, 1, 1, 1]},
            "oyasumi-assist": {ch1: [0, 0, 0, 0, 0, 0, 1, 0], ch2: [0, 0, 0, 0, 0, 0, 1, 1]},
            off: {ch1: [0, 0, 1, 0, 1, 1, 1, 0], ch2: [0, 0, 1, 0, 1, 1, 1, 1]},
            color: {ch1: [0, 1, 1, 0, 1, 0, 1, 0], ch2: [0, 1, 1, 0, 1, 0, 1, 1]},
            "30mins": {ch1: [1, 1, 0, 1, 1, 1, 1, 0], ch2: [1, 1, 0, 1, 1, 1, 1, 1]},
            "60mins": {ch1: [0, 1, 0, 1, 1, 1, 1, 0], ch2: [0, 1, 0, 1, 1, 1, 1, 1]},
            "brightness-down": {ch2: [0, 0, 0, 0, 0, 1, 1, 1], ch1: [0, 0, 0, 0, 0, 1, 1, 0]},
            "brightness-up": {ch2: [0, 0, 1, 0, 0, 1, 1, 1], ch1: [0, 0, 1, 0, 0, 1, 1, 0]},
            "color-temp-down": {ch2: [0, 0, 1, 0, 0, 0, 1, 0], ch1: [0, 1, 0, 1, 0, 1, 1, 0]},
            "color-temp-up": {ch2: [1, 0, 0, 0, 1, 0, 0, 1], ch1: [0, 1, 0, 0, 1, 0, 0, 1]},
            "blue-down": {ch2: [1, 0, 0, 0, 0, 1, 1, 1], ch1: [1, 0, 0, 0, 0, 1, 1, 0]},
            "blue-up": {ch2: [0, 0, 1, 0, 0, 1, 0, 0], ch1: [1, 0, 1, 0, 0, 1, 0, 0]},
            "green-down": {ch2: [0, 1, 1, 0, 0, 1, 0, 0], ch1: [1, 1, 1, 0, 0, 1, 0, 0]},
            "green-up": {ch2: [0, 0, 0, 1, 0, 1, 0, 0], ch1: [1, 0, 0, 1, 0, 1, 0, 0]},
            "red-down": {ch2: [0, 1, 0, 1, 0, 1, 0, 0], ch1: [1, 1, 0, 1, 0, 1, 0, 0]},
            "red-up": {ch2: [0, 0, 1, 1, 0, 1, 0, 0], ch1: [1, 0, 1, 1, 0, 1, 0, 0]},
        }[key_name]?.[`ch${this.setup?.ch ?? 1}`];
    }

    static get interface() {
        return {
            advanced: {
                type: 'boolean',
            },
            mode: {
                type: 'string',
                only: ['max', 'off', 'normal', 'benkyo', 'relax', 'theater', 'kirei', 'color', 'night-light', 'oyasumi-assist'],
            },
            brightness: {
                type: 'number',
                callback: (brightness, states) => {
                    const mode = states?.mode;
                    const [min, max] = this.brightness_range(mode);
                    if (null === min || null === max) {
                        console.warn(`cannot determine available brightness for mode : ${mode}`);
                        return false;
                    }
                    return brightness >= min && brightness <= max;
                },
                null_ok: true,
            },
            color_temp: {
                type: 'number',
                range: {min: 1, max: 21},
                null_ok: true,
            },
            r: {
                type: 'number',
                range: {min: 0, max: rgb_max},
                null_ok: true,
            },
            g: {
                type: 'number',
                range: {min: 0, max: rgb_max},
                null_ok: true,
            },
            b: {
                type: 'number',
                range: {min: 0, max: rgb_max},
                null_ok: true,
            },
        };
    }
    static brightness_range(mode) {
        switch (mode) {
            case 'off': return [0, 0];
            case 'normal': return [0, 20];
            case 'theater':
            case 'benkyo':
            case 'relax':
            case 'oyasumi-assist':
            case 'kirei': return [1, 10];
            case 'night-light':  return [1, 6];
            default: return [null, null];
        }
    }

    #get_irkit_dict(key_name, repeats=0) {
            const bits = this.#get_key_bits(key_name);
            if (! bits) {
                throw new Error('unknown key_name :', key_name);
            }
            const irkit_dict = (new ToshibaFRC205TIrData())
                .append_bits(customer_code[0])
                .append_bits(customer_code[1])
                .append_bits(bits)
                .append_bits(bits.map(n => (new Bit(n)).flip().to_number()))
                .terminate_frame()
                .append_repeats(repeats)
                .to_irkit_data();
            console.log('adding:', JSON.stringify(irkit_dict));
            return irkit_dict;
    }

    generate_irkit_data() {
        const steps = [];
        const add_sleep = msec => {
            console.log("add_sleep", msec);
            steps.push({sleep: msec});
        };
        const add_key = (key_name, repeats=0) => {
            console.log(`# add key: ${key_name}` + (repeats ? ` with ${repeats} repeats` : ''));
            const irkit_dict = this.#get_irkit_dict(key_name, repeats);
            console.log('# adding:', JSON.stringify(irkit_dict));
            steps.push(irkit_dict);
        };
        // brightness/color temp: press key_up/key_down until we reach wanted_level 
        const adjust_level = (current_level, wanted_level, key_name_up, key_name_down, can_repeat=true) => {
            if (wanted_level === null) return;
            const key_name = current_level > wanted_level ? key_name_down
                : current_level < wanted_level ? key_name_up
                : null;
            if (! key_name) return;
            console.log(`adjust(current_level=${current_level}, wanted_level=${wanted_level}, keys=${key_name_up}, ${key_name_down})`);
            let cur = current_level;
            const step = () => {
                // repeat cap; super long IR signal cannot be sent/processed; 
                // it has to be broken down into multiple chunks
                const delta_cap = 10;
                const delta = Math.abs(cur - wanted_level) > delta_cap ? delta_cap : Math.abs(cur - wanted_level);
                if (can_repeat && delta >= 2) {
                    let step_amt = cur > wanted_level ? (-1 * delta)
                        : cur < wanted_level ? delta
                        : 0;
                    let step_sign = step_amt < 0 ? -1 : 1;
                    step_amt = Math.abs(step_amt);

                    const repeats = delta + 2;
                    console.log('delta', delta, '; step_amt', step_amt, '; repeats', repeats);

                    add_key(key_name);
                    add_sleep(300);
                    add_key(key_name, repeats);
                    cur += step_amt * step_sign;
                    add_sleep(300 * repeats);
                }
                else {
                    const step_amt = cur > wanted_level ? -1
                        : cur < wanted_level ? 1 
                        : 0;
                    add_key(key_name);
                    cur += step_amt;
                    add_sleep(300);
                }
            };
            let num_steps = 0;
            while (cur !== wanted_level && ++num_steps <= 25) {
                step();
                num_steps++;
            }
        };
        // when adjusting RGB, to go from 0 to 1, we press "key_down" once;
        // to go from 0 to MAX, we press "key_up" once
        const adjust_rgb_level_from_zero = (wanted_level, key_name_up, key_name_down) => {
            let cur = 0;
            if (! wanted_level) {
                return;
            }
            if (wanted_level === rgb_max) {
                console.log(`adjust_rgb_level_from_zero(${key_name_up}) and exit`);
                add_key(key_name_up);
                return;
            }
            console.log(`adjust_rgb_level_from_zero(${wanted_level}) ; key_down:${key_name_down}`);

            add_key(key_name_down);
            add_sleep(800);
            cur++;
            
            const step = () => {
                const delta = Math.abs(cur - wanted_level);
                if (delta >= 2) {
                    let step_amt = cur > wanted_level ? (-1 * delta)
                        : cur < wanted_level ? delta
                        : 0;
                    let step_sign = step_amt < 0 ? -1 : 1;
                    step_amt = Math.abs(step_amt);
                    const repeats = delta + 2;
                    console.log('adjust_rgb_level_from_zero: delta', delta, '; step_amt', step_amt, '; repeats', repeats);

                    add_key(key_name_up);
                    add_sleep(300);
                    add_key(key_name_up, repeats);
                    cur += step_amt * step_sign;
                    add_sleep(300 * repeats);
                }
                else {
                    const step_amt = cur > wanted_level ? -1
                        : cur < wanted_level ? 1
                        : 0;
                    add_key(key_name_up);
                    cur += step_amt;
                    add_sleep(300);
                }
            };
            let num_steps = 0;
            while (wanted_level > cur && ++num_steps <= 25) {
                step();
                num_steps++;
            }
        };
        // 
        // 1. send MODE key
        // 2. advanced: adjust brightness
        // 3. advanced: (normal mode only) adjust color temp
        // 4. advanced: (normal mode only) adjust RGB
        //
        const mode = this.get_state('mode', 'normal');
        const wanted_brightness = this.get_state('brightness', null);
        let adjust_brightness = true;
        if (mode === 'normal' && ! wanted_brightness) {
            add_key('off');
            adjust_brightness = false;
        }
        else {
            switch(mode) {
                case 'off':
                    add_key('off');
                    break;
                case 'max':
                case 'normal':
                    add_key('max');
                    break;
                case 'kirei':
                case 'benkyo':
                case 'color':
                case 'oyasumi-assist':
                case 'night-light':
                    add_key(mode);
                    break;
                case 'theater':
                case 'relax':
                    add_key(mode);
                    add_sleep(250);
                    add_key(mode);
                    break;
                default:
                    console.warn(`unknown mode : ${mode} ; default to "normal"`);
                    add_key('normal');
            }
        }
        const [min_bright, max_bright] = this.constructor.brightness_range(mode);
        if (this.get_state('advanced', false)) {
            this.set_state('advanced', false);
            // takes at most 3.5 sec for the light to fade from 0 to 100% brightness
            add_sleep(3600);

            // down-adjust brightness
            if (adjust_brightness) {
                const initial_brightness = max_bright;
                let can_repeat = true;
                if (mode === 'night-light') {
                    // night light REMEMBERS brightness used last, there's no way to 
                    // tell the initial brightness; so we manually max out the brightness
                    // then turn it down step by step
                    for (let i = 0; i < 6; ++i) {
                        add_key('brightness-up');
                        add_sleep(100);
                    }
                    // night-light doesnt' allow long-pressing UP DOWN to adjuts brightness
                    can_repeat = false;
                }
                adjust_level(initial_brightness, wanted_brightness, 
                    'brightness-up', 'brightness-down', can_repeat);
            }
            if (mode === 'normal') {
                // adjust color temp
                const initial_color_temp = 10;
                const wanted_color_temp = this.get_state('color_temp', null);
                adjust_level(initial_color_temp, wanted_color_temp, 'color-temp-up', 'color-temp-down');

                // adjust R,G,B
                for (const {want, up, down} of [
                    {want:this.get_state('r', null), up:'red-up', down: 'red-down' },
                    {want:this.get_state('g', null), up:'green-up', down: 'green-down' },
                    {want:this.get_state('b', null), up:'blue-up', down: 'blue-down' },
                ]) {
                    adjust_rgb_level_from_zero(want, up, down);
                }
            }
        }
        return {multi: steps};
    }

    static get actions() {
        return {
            max: {args:[]},
            off: {args:[]},
            theater: {args:[]},
            kirei: {args:[]},
            benkyo: {args:[]},
            relax: {args:[]},
            'night-light': {args:[]},
            'oyasumi-assist': {args:[]},
            'color': {args:[]},
        };
    }

    action(action_name, args) {
        switch(action_name) {
            case 'normal':
            case 'max':
                this.internal_set_state('mode', 'normal');
                return {single: this.#get_irkit_dict(action_name, 1)};
            case 'off':
            case 'theater':
            case 'kirei':
            case 'benkyo':
            case 'relax':
            case 'night-light':
            case 'oyasumi-assist':
            case 'color':
                this.internal_set_state('mode', action_name);
                return {single: this.#get_irkit_dict(action_name, 1)};
            default:
                console.warn('unknown action_name supplied to action () :', action_name);
                return;
        }
    }

}

module.exports = {
    model: 'toshiba-frc205t',
    appliance_class: ToshibaCeilingLamp,
};
