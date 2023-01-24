
const path = require('path');
const {Nibble, Byte} = require('../binary-tools');
const {IrData2} = require("../IrData2");
const IrkitAppliance = require("../IrkitAppliance");


const temp_min = 18;
const temp_max = 32;

const consts = {
    timer_byte16: {
        on: 0x3,          // 0011    on-timer SET
        on_cancel: 0x2,   // 0010    on-timer UNSET
        off: 0x5,         // 0101    off-timer SET
        off_cancel: 0x4,  // 0100    off-timer UNSET
        unset: 0x0        // 0000
    },
    byte21: {
        timer: {
            half_hour: 0x7,   // 0111
            whole_hour: 0x0,
        },
        strength: 0xA,        // 1010
        direction: 0x6,       // 0110
        temp: 0x2,            // 0010
        mode: 0x0,         
    },
    timer_byte22_first_half:{
        half_hour: [1,0],
        whole_hour: [0,0],
    },
    timer_byte22_second_half: {
        on: [1, 1],           
        on_cancel: [1, 1],   
        off: [0, 0],
        off_cancel: [0, 0],
        unset: [0, 0],
    },
    // for byte 13
    mode: {
        dry:  0b1100,
        cool: 0b0100,
        warm: 0b1000,
        ion:  0b0010,
        indoor_drying: 0b0010,
    },
    direction: {
        warm: {
            auto: 0b0001,
            1:    0b1001,
            2:    0b0101,
            3:    0b1101,
            4:    0b0011,
            swing:0b1111,
        },
        other: {
            ceiling:0b1001,
            1:      0b0101,
            2:      0b1101,
            3:      0b0011,
            4:      0b1011,
            swing:  0b1111,
            auto:   0b0001,
        },
    },
    strength: {
        auto: 0x4, // 0100
        1: 0xC,    // 1100
        2: 0xA,    // 1010
        3: 0xE,    // 1110
        4: 0x6     // 0110
    },
};

class SharpA909JBIrData extends IrData2 {
    constructor() {
        super(450,                      // T = 450 μs
            ['8.477T-high', '3.977T'],    // leader pulses/spaces
            ['1.192T-high', '2.619T'],    // bit 1
            ['1.192T-high', '0.906T'],    // bit 0
            '',                           // stop pulse
            '',                           // data frame length (μs)
            ''                            // repeat headers
        );
    }
}





class SharpA909JB extends IrkitAppliance {

    constructor(irkit_inst, setup, restore_state_cache) {
        super(irkit_inst, Object.assign({simple: true}, setup, restore_state_cache));
        if (! restore_state_cache) {
            this.set_states({
                power: false,
                temp:25,
                mode: 'cool',
                timer:'unset',
                timer_hours:0,
                direction: 'auto',
                strength: 'auto',
                internal_clean: true,
                ion: true,
                power_saving: false,
                simple: this.setup.simple,
            });
        }
    }
    static get appliance_type()  { return 'air-conditioner'; }
    static get interface() {
        return {
            power: { 
                type: 'boolean',
            },
            mode: {
                type: 'string',
                only: Object.keys(consts.mode),
            },
            timer: {
                type: 'string',
                only: Object.keys(consts.timer_byte16),
            },
            temp: {
                type: 'number',
                callback: (state_value, combined_states) => {
                    if (combined_states.mode === 'dry') {
                        return state_value >= -2 && state_value <= 2;
                    } 
                    else {
                        return state_value >= temp_min && state_value <= temp_max;
                    }
                },
            },
            direction: {
                type: ['string', 'number'],
                only: Object.entries(consts.direction).map(n => n[1]).map(o => Object.keys(o)).flat().filter((elem, idx, arr) => arr.indexOf(elem) === idx),
            },
            strength: {
                type: ['string', 'number'],
                only: Object.keys(consts.strength),
            },
            timer_hours: {
                type: 'number',
                only: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5],
            },
            internal_clean: { 
                type: 'boolean'
            },
            ion: { 
                type: 'boolean'
            },
            power_saving: { 
                type: 'boolean'
            },
            dry_hours: {
                type: 'number',
                range: {min:1, max: 6},
                null_ok: true,
            },
            simple: {
                type: 'boolean',
                null_ok: true,
            },
        };
    }
 
    after_set_state() {
        if (['warm', 'dry', 'indoor_drying'].includes(this.get_state('mode'))) {
            if (this.get_state('direction') === 'ceiling') {
                console.warn(`mode ${mode} does not support direction=ceiling; setting to auto`);
                this.internal_set_state('direction', 'auto');
            }
        }
    }

    static create_irkit_data({power, mode, temp, direction, strength, timer,
        timer_hours, internal_clean, ion, power_saving, dry_hours, manually_assign}={}
    ) {
        const to_Nbit_binary = (n, bits) =>  {
            if (!bits || bits > 32) throw new Error('expecting bits to be 1..32');
            var out = Number(n & ((1 << bits) - 1)).toString(2)
            return ('0'.repeat(bits - out.length) + out).split('').reverse().map(n => parseInt(n))
        }

        let irdata = (new SharpA909JBIrData)
        // -- header constant stuff--
            .append_byte(new Byte(0x55)) // #1~2 customer code : 0101 0101
            .append_byte(new Byte(0x5A)) // #3~4 customer code : 0101 1010
            .append_nibble(new Nibble(0x0F)) // #5 parity : 1111 (固定)
            .append_nibble(new Nibble(0x03)) // #6 constant? : 0011
            .append_byte(new Byte(0x08)); // #7~8 constant? : 0000 1000

        // console.log("1..8  :", irdata.bits.join('').replaceAll(/(.{4})/g, '$1 ' ));

        // --- #9: cool/warm temperature
        if (mode === 'warm' || mode === 'cool') {
            const n = new Nibble(to_Nbit_binary(temp - 17, 4));
            irdata.append_nibble(n);
        }
        else if (mode === 'indoor_drying') {
            irdata.append_nibble(new Nibble(dry_hours + 8));
        }
        else {
            irdata.append_nibble(new Nibble(0));
        }

        // console.log("1..9  :", irdata.bits.join('').replaceAll(/(.{4})/g, '$1 ' ));

        // --- #10: dry temperature
        if (mode === 'dry') {
            irdata.append_nibble(new Nibble( temp >=0 ? temp : (0b1000 | temp) ));
        }
        else {
            irdata.append_nibble(new Nibble(0));
        }
        // console.log("1..10 :", irdata.bits.join('').replaceAll(/(.{4})/g, '$1 ' ));

        // --- #11 : constant 1000
        irdata.append_nibble(new Nibble(0x08));
        // console.log("1..11 :", irdata.bits.join('').replaceAll(/(.{4})/g, '$1 ' ));

        // --- #12 mode
        // setting/cancelling timer: 0001
        // turnning off power      : 0100
        // turning  on power       : 1000
        // assigning properties    : 1100
        if (['on', 'on_cancel', 'off', 'off_cancel'].includes(timer)) {
            // set/cancel timer
            irdata.append_nibble(new Nibble(0b0001));
        }
        else if (! power) {
            irdata.append_nibble(new Nibble(0b0100));
        }
        else if (['strength', 'direction', 'temp'].includes(manually_assign)) {
            irdata.append_nibble(new Nibble(0b1100));
        }
        else {
            // turn on power
            irdata.append_nibble(new Nibble(0b1000));
        }
        // console.log("1..12 :", irdata.bits.join('').replaceAll(/(.{4})/g, '$1 ' ));


        // --- #13 mode
        irdata.append_nibble(new Nibble(consts.mode[mode]));

        // --- #14 strength
        irdata.append_nibble(new Nibble(consts.strength[strength]));

        // --- #15 timer hours (integer part)
        irdata.append_nibble(new Nibble(to_Nbit_binary(Math.floor(timer_hours), 4)));

        // --- #16 timer operation
        irdata.append_nibble(new Nibble(consts.timer_byte16[timer]));

        // --- #17 direction
        irdata.append_nibble(
            new Nibble(
                (consts.direction[ mode === 'warm' ? 'warm' : 'other' ][direction])
                ?? consts.direction.other.swing
            ));

        // --- #18,19 constant 0000 0000
        irdata.append_nibble(new Byte(0));

        // --- #20 (bit #1) power saving and internal clean
        irdata.append_bit(power_saving ? 1 : 0);
        irdata.append_bit(internal_clean ? 1 : 0);
        // --- #20 (bit 3,4) constant
        irdata.append_bits([0, 1]);

        // --- #21
        //     immediately after setting mode: 0000 (暖房、冷房、除湿、停止）
        //     after setting strength:         1010
        //     after setting direction:        0110
        //     after setting temp:             0010
        //     timer contains 0.5:             0111
        let half_hour = (timer_hours % 1 === 0.5);
        if (! manually_assign && ['on', 'off'].includes(timer)) {
            irdata.append_nibble(new Nibble( half_hour ? 0b0111 : 0b0000 ));
        }
        else {
            irdata.append_nibble(new Nibble(
                {
                    strength: 0b1010,
                    direction: 0b0110,
                    temp: 0b0010,
                }[manually_assign] ?? 0b0000
            ));
        }
        // --- #22 
        //   aaBB    aa= half_hour:10  whole_hour:00        
        //           BB= on_timer:11   off_timer:00
        switch (true) {
            case timer === 'on' && half_hour: irdata.append_nibble(new Nibble(0b1011));  break;
            case timer === 'on':
            case timer === 'on_cancel' : irdata.append_nibble(new Nibble(0b0011));  break;      
            case timer === 'off' && half_hour: irdata.append_nibble(new Nibble(0b1000));  break;
            case timer === 'off':
            case timer === 'off_cancel' : irdata.append_nibble(new Nibble(0b0000));  break;     
            default: irdata.append_nibble(new Nibble(0b0000)); 
        }

        // --- #23 ion ? 0010
        irdata.append_nibble(new Nibble(ion ? 0x2 : 0x0));

        // --- #24, 25 constant 0111 1000
        irdata.append_byte(new Byte(0x78));

        // now get all bits
        let bits = irdata.bits;
        let checksum = 0;
        for (let i = 0; i < bits.length; i += 4) {
            let nibb = 0 | (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | (bits[i + 3]);
            checksum ^= nibb;
        }
        irdata.append_nibble(new Nibble(checksum));

        irdata.append_time('1.038T'); // final stop pulse

        const irkit_dict = irdata.to_irkit_data();

        console.log('[debug] bits :', irdata.bits.join('').replace(/[]/g).replace(/(\d{4})/g, '$1 '));

        return irkit_dict;
    }


    generate_irkit_data() {
        const power = this.get_state('power');
        const mode = this.get_state('mode');
        const temp = this.get_state('temp');
        const direction = this.get_state('direction');
        const strength = this.get_state('strength');
        const timer = this.get_state('timer', 'unset');
        const timer_hours = this.get_state('timer_hours', 0);
        const internal_clean = this.get_state('internal_clean', true);
        const ion = this.get_state('ion', true);
        const power_saving = this.get_state('power_saving', true);
        const simple = this.get_state('simple');

        const base = {
            power, mode, temp, direction, strength,
            timer, timer_hours, internal_clean, 
            ion, power_saving,
        };
        const multi = ['on', 'off', 'on_cancel', 'off_cancel'].includes(timer) || ! power || simple
            ? [ // only simulate the MODE button
                this.constructor.create_irkit_data(Object.assign({}, base)),
            ]
            : [ // simulate the WIND DIRECTION, TEMP, STRENGTH buttons separately ?
                this.constructor.create_irkit_data(Object.assign({}, base, {manually_assign: 'mode'})),
                {sleep: 500},
                this.constructor.create_irkit_data(Object.assign({}, base, {manually_assign: 'direction'})),
                {sleep: 500},
                this.constructor.create_irkit_data(Object.assign({}, base, {manually_assign: 'temp'})),
                {sleep: 500},
                this.constructor.create_irkit_data(Object.assign({}, base, {manually_assign: 'strength'})),
                {sleep: 500},
            ];

        return {multi};
    }
}
module.exports = {
    model: 'A909JB',
    appliance_class: SharpA909JB,
};
