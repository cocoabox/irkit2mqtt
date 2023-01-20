"use strict";

const path = require('path');
const IrkitAppliance = require('../IrkitAppliance');
const {Byte} = require('../binary-tools');
const {IrData2} = require('../IrData2');


//
// const irkit = new Irkit('192.168.1.xxx');    // discoverされたirkitのIPアドレスでIrKitオブジェクトを作成
// const tv = new ToshibaTv(irkit);
//
// await tv.set_state({station_type:'chideji', ch: 1});
// await tv.set_state({station_type:'chideji', ch: 1.1}); // ＮＨＫ総合２・東京
//
// await tv.do_action('vol_up', [4]); // adds volume to the volume bar; should be multiples of 2 (1 is minimal)
// await tv.do_action('toggle_power');
//
class ToshibaCT90485IrData extends IrData2 {
    constructor() {
        super(565,                // T = 630 μs
            ['16T-high', '8T'],   // leader pulses/spaces
            ['1T-high', '3T'],    // bit 1
            ['1T-high', '1T'],    // bit 0
            '1T',                 // stop pulse
            107000,               // data frame length (μs)
            [['16T-high', '47T', '1T'], ['16T-high', '47T', '1T']],
            // repeats are 16T,47T,1T
            [107400, 107400]           // repeat0 = 107400 μs ; repeatN = 107400 μs
        );
    }
}


class ToshibaTV extends IrkitAppliance {
    constructor(irkit_inst) {
        super(irkit_inst, {});
    }
    static get appliance_type() {
        return 'tv';
    }
    static #get_key_bytes(key_name) {
        return {
            // each key is 4 x 8 bits = 32 bits
            // there is no constant "customer code"
            '1': [ 2, 253, 128, 127 ],
            '2': [ 2, 253, 64, 191 ],
            '3': [ 2, 253, 192, 63 ],
            '4': [ 2, 253, 32, 223 ],
            '5': [ 2, 253, 160, 95 ],
            '6': [ 2, 253, 96, 159 ],
            '7': [ 2, 253, 224, 31 ],
            '8': [ 2, 253, 16, 239 ],
            '9': [ 2, 253, 144, 111 ],
            '10': [ 2, 253, 80, 175 ],
            '11': [ 2, 253, 208, 47 ],
            '12': [ 2, 253, 48, 207 ],
            power: [ 2, 253, 72, 183 ],
            input: [ 2, 253, 240, 15 ],
            displ: [ 2, 253, 56, 199 ],
            '4k': [ 2, 125, 62, 193 ],
            subti: [ 194, 61, 74, 181 ],
            audio: [ 2, 253, 200, 55 ],
            chideji: [ 2, 253, 94, 161 ],
            bs: [ 2, 253, 62, 193 ],
            cs: [ 2, 253, 190, 65 ],
            ch_up: [ 2, 253, 216, 39 ],
            ch_down: [ 2, 253, 248, 7 ],
            mute: [ 2, 253, 8, 247 ],
            mirukore: [ 2, 125, 44, 211 ],
            submen: [ 2, 253, 228, 27 ],
            vol_up: [ 2, 253, 88, 167 ],
            vol_down: [ 2, 253, 120, 135 ],
            '2gamen': [ 2, 253, 148, 107 ],
            tsugi_miru_navi: [ 2, 125, 186, 69 ],
            scene_kensaku: [ 2, 125, 178, 77 ],
            rokuga_list: [ 2, 125, 20, 235 ],
            tv_guide: [ 2, 253, 118, 137 ], // 番組表
            back: [ 2, 253, 220, 35 ],
            end: [ 2, 253, 60, 195 ],
            pg_up: [ 2, 125, 4, 251 ],
            pg_down: [ 2, 125, 132, 123 ],
            pg_left: [ 2, 125, 68, 187 ],
            pg_right: [ 2, 125, 196, 59 ],
            up: [ 2, 253, 124, 131 ],
            down: [ 2, 253, 252, 3 ],
            left: [ 2, 253, 250, 5 ],
            right: [ 2, 253, 218, 37 ],
            confirm: [ 2, 253, 188, 67 ],
            blue: [ 2, 253, 206, 49 ],
            red: [ 2, 253, 46, 209 ],
            green: [ 2, 253, 174, 81 ],
            yellow: [ 2, 253, 110, 145 ],
            d_data: [ 194, 61, 40, 215 ],
            preferences: [ 2, 253, 11, 244 ],
            link: [ 2, 125, 18, 237 ],
            rewind: [ 2, 125, 52, 203 ],
            play: [ 2, 125, 180, 75 ],
            fast_fwd: [ 2, 125, 116, 139 ],
            prev: [ 2, 125, 228, 27 ],
            stop: [ 2, 125, 212, 43 ],
            pause: [ 2, 253, 10, 245 ],
            next: [ 2, 125, 100, 155 ],
            clear_audio: [ 2, 125, 98, 157 ],
            netflix: [ 2, 253, 185, 70 ],
            tsutaya: [ 2, 253, 108, 147 ]
        }[key_name];
    }
    static get actions() {
        return {
            toggle_power: {args:[]},
            play: {args:[]},
            pause: {args:[]},
            fast_fwd: {args:[]},
            rewind: {args:[]},
            next: {args:[]},
            prev: {args:[]},
            tv_guide: {args:[]},
            vol_up:{args:['number']},
            vol_down:{args:['number']},
            ch_up: {args:[]},
            ch_down: {args:[]},
        }
    }
    static #make_irkit_dict(key, repeats=0)  {
        const nums = this.#get_key_bytes(key);
        if (! nums) throw new Error(`invalid key ${key}`);

        const irkit_dict = (new ToshibaCT90485IrData())
            .append(nums.map(k => new Byte(k)))
            .terminate_frame()
            .append_repeats(repeats+1)
            .to_irkit_data();
        return irkit_dict;
    }

    static get interface() {
        return {
            power: {type:'boolean', null_ok: true},
            station_type:{type:'string',only:[ 'chideji', 'bs', 'cs' ]},
            ch: {type:'number', range: {min:1,max:12}},
        };
    }
    action(action_name, args) {
        const adjust_volume = (key_name, amt=1) => {
            if (amt < 2) {
                return {single: this.constructor.#make_irkit_dict('vol_up', 1)};
            }
            if (amt >= 2) {
                const multi = [];
                for (let i = 0; i < Math.round(amt/2); ++i) {
                    multi.push( this.constructor.#make_irkit_dict(key_name, 5) );
                    multi.push( {sleep: 200} );
                }
                return {multi};
            }
        };
        switch(action_name) {
            case 'toggle_power':
            case 'power': return {multi: [
                this.constructor.#make_irkit_dict('power'),
                {sleep:5000},
            ]};
            case 'play': return {single: this.constructor.#make_irkit_dict('play')};
            case 'pause': return {single: this.constructor.#make_irkit_dict('pause')};
            case 'fast_fwd': return {single: this.constructor.#make_irkit_dict('fast_fwd')};
            case 'rewind': return {single: this.constructor.#make_irkit_dict('rewind')};
            case 'next': return {single: this.constructor.#make_irkit_dict('next')};
            case 'prev': return {single: this.constructor.#make_irkit_dict('prev')};
            case 'tv_guide': return {single: this.constructor.#make_irkit_dict('tv_guide')};
            case 'vol_up': return adjust_volume('vol_up',args[0]);
            case 'vol_down': return adjust_volume('vol_down',args[0]);
            case 'ch_up': return {single: this.constructor.#make_irkit_dict('ch_up')};
            case 'ch_down': return {single: this.constructor.#make_irkit_dict('ch_down')};
            default: return;
        }
    }
    generate_irkit_data() {
       const steps = [];
        const add_sleep = msec => {
            console.log("add_sleep", msec);
            steps.push({sleep: msec});
        };
        const add_key = (key_name, repeats=0) => {
            console.log(`# add key: ${key_name}` + (repeats ? ` with ${repeats} repeats` : ''));
            const irkit_dict = this.constructor.#make_irkit_dict(key_name, repeats);
            console.log('adding:', JSON.stringify(irkit_dict));
            steps.push(irkit_dict);
        };
        const power = this.get_state('power', null);
        const station_type = this.get_state('station_type', 'chideji');
        const ch = this.get_state('ch', null);
        if (typeof power === 'boolean') {
            this.set_state('power', null); // debounce this state because there's no way to tell whether the power is on
            add_key('power');
            if (! power) {
                return {multi: steps};
            }
            add_sleep(5000); // TV startup takes 3.7 sec 
        }
        if (typeof station_type === 'string') {
            switch(station_type) {
                case 'chideji': add_key('chideji'); break;
                case 'cs': add_key('cs'); break;
                case 'bs': add_key('bs'); break;
                default:
            }
            add_sleep(1000);
        }
        if (typeof ch === 'number') {
            if (ch >= 1&& ch <=12) {
                // example: 1  --> NHK
                // example: 1.1 --> press 1 twice : NHK --> NHK総合２
                // example: 1.2 --> press 2 twice : NHK --> NHK総合２ --> NHK総合３
                // details : https://www.yuhisa.com/tv/terra-list-tokyo/
                //
                // this TV is state based; e.g. for CH 901 902 903
                // if we are in Ch 902, pressing [9] once will go to 903
                // if we are in Ch 903, pressing [9] twice will go to 902
                // i.e. which channel we go depends on current state; 
                // therefore we need to temporarily change to a completely irrelavent
                // channel, then start from the 901 etc (see temp_ch below)
                // 
                const ch_whole = Math.floor(ch);
                const temp_ch = ch_whole === 1 ? 2 : 1;
                add_key(`${temp_ch}`);
                add_sleep(250);

                add_key(`${ch_whole}`);
                add_sleep(500);
                const ch_decim = Math.round(ch % 1 * 10, 2);
                console.log("adding more :", ch_decim);
                for (let i of [...Array(ch_decim).keys()]) {
                    add_key(`${ch_whole}`);
                    add_sleep(500);
                }
            }
            else  {
                throw new Error('invalid ch ; expecting 1,2,..,12');
            }
        }
        return {multi: steps};
    }

}

module.exports = {
    model: 'toshiba-ct90485',
    appliance_class: ToshibaTV,
};
