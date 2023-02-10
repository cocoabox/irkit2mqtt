const {Nibble , Byte} = require('../binary-tools');
const {IrData2} = require('../IrData2');
const IrkitAppliance = require('../IrkitAppliance');

class NationalA75C3026IrData extends IrData2 {
    constructor() {
        super(410 ,                           // T = 410 μs
            ['8.39T-high' , '4.07T'] ,    // leader pulses/spaces
            ['1.10T-high' , '3.09T'] ,      // bit 1
            ['1.10T-high' , '0.96T'] ,      // bit 0
            '1T' ,                    // stop pulse
            76488 ,                 // data frame length (μs)
            ['8.39T-high' , '4.07T']     // repeat headers
        );
    }
}

/**
 * converts a number into N bits (in array of int 0 and int 1);
 * output is bit-reversed, i.e. the least significant bit at position 0
 * of the output array
 *
 * @param {number} n
 * @param {number} bits
 * @return {number[]}
 * @private
 */
function to_Nbit_binary(n , bits) {
    if ( ! bits || bits > 32 ) throw 'expecting bits to be 1..32';
    var out = Number(n & ((1 << bits) - 1)).toString(2);
    return ('0'.repeat(bits - out.length) + out).split('').reverse().map(n => parseInt(n));
}

const TEMP_MIN = 16;
const TEMP_MAX = 32;

const consts = {
    mode : {
        auto : 0x0 ,
        dry : 0x2 ,
        cool : 0x3 ,
        warm : 0x4
    } ,
    direction : {
        swing : 0xF , // 1111
        1 : 0x1 ,
        2 : 0x2 ,
        3 : 0x3 ,
        4 : 0x4 ,
        5 : 0x5
    } ,
    strength : {
        quiet : 0x3 ,
        1 : 0x3 ,
        2 : 0x4 ,
        3 : 0x5 ,
        4 : 0x7 ,
        powerful : 0xA ,
        auto : 0xA
    } ,
};

// constant frame 1 of out of two data frames transmitted
const HEADER_DATA = [
    new Byte(64) ,
    new Byte(4) ,     // customer code
    new Nibble(0) ,     // parity
    new Nibble(7) ,     // data 0 (4bit)
];

class NationalA75C3026 extends IrkitAppliance {
    constructor({irkit_inst , setup , restore_state_cache , log} = {}) {
        super({irkit_inst , setup , restore_state_cache , log});

        this.log('[NationalA75C3026] my state is:' , this.states);
        this.log('[NationalA75C3026] setting initial state');
        this.set_states(Object.assign({
            power : false ,
            temp : 25 ,
            mode : 'cool' ,
            timer : 'unset' ,
            direction : 'swing' ,
            strength : 'auto' ,
            internal_dry : true ,
            odour_reduction : true ,
        } , restore_state_cache ?? {}));
        this.log('[NationalA75C3026] my state is:' , this.states);
    }

    static get appliance_type() {
        return 'air-conditioner';
    }

    static get interface() {
        return {
            power : {
                type : 'boolean' ,
            } ,
            mode : {
                type : 'string' ,
                only : Object.keys(consts.mode) ,
            } ,
            timer : {
                type : 'string' ,
                only : ['on' , 'off' , 'unset'] ,
            } ,
            temp : {
                type : 'number' ,
                range : {min : TEMP_MIN , max : TEMP_MAX} ,
            } ,
            direction : {
                type : ['string' , 'number'] ,
                only : Object.keys(consts.direction) ,
            } ,
            strength : {
                type : ['string' , 'number'] ,
                only : Object.keys(consts.strength) ,
            } ,
            timer_hours : {
                type : 'number' ,
                only : [0.5 , 1 , 2 , 3 , 4 , 5 , 6 , 7 , 8 , 9 , 10 , 11 , 12] ,
            } ,
            internal_dry : {
                type : 'boolean'
            } ,
            odour_reduction : {
                type : 'boolean'
            } ,
        };
    }

    after_set_state() {
    }

    create_irkit_data({
                          power ,
                          mode ,
                          temp ,
                          direction ,
                          strength ,
                          timer ,
                          timer_hours ,
                          internal_dry ,
                          odour_reduction ,
                      } = {}
    ) {
        const on_timer_hours = timer === 'on' ? timer_hours : null;
        const off_timer_hours = timer === 'off' ? timer_hours : null;

        if ( typeof consts.mode[mode] === 'undefined' )
            throw 'invalid `mode`; expecting : ' + Object.keys(consts.mode);

        if ( typeof temp === 'undefined' ) temp = 25;
        else if ( typeof temp !== 'number' || temp < 16 || temp > 32 )
            throw 'expecting `temp` to be a number of value 16..32';

        else if ( typeof consts.direction[direction] === 'undefined' )
            throw 'expecting `direction` to be:' + Object.keys(consts.direction);

        const strength_num = strength in consts.strength
            ? consts.strength[strength] : consts.strength.auto;

        const ir_data_bits = (new NationalA75C3026IrData())
            // --- begin frame #1 (doesn't seem to change)
            .append(HEADER_DATA)
            .append(new Byte(32))
            .append(new Byte(0))
            .append(new Byte(0))
            .append(new Byte(0))
            .append(new Byte(96))
            .terminate_frame();
        // --- we need to compute the  sum of each 8-bit segments in frame #2
        const all_bits = [];
        ir_data_bits.on_received_bit = bit => all_bits.push(bit);

        const make_data789 = (on_timer_mins = '' , off_timer_mins = '') => {
            if ( ! on_timer_mins ) on_timer_mins = 0x600;
            if ( ! off_timer_mins ) off_timer_mins = 0x600;
            const bits = [].concat(
                to_Nbit_binary(on_timer_mins , 12) ,
                to_Nbit_binary(off_timer_mins , 12)
            );
            const byte1 = bits.splice(0 , 8);
            const byte2 = bits.splice(0 , 8);
            const byte3 = bits;
            return [new Byte(byte1) , new Byte(byte2) , new Byte(byte3)];
        };
        // --- begin frame #2 (pressed buttons)
        ir_data_bits
            .start_frame()
            .append(HEADER_DATA)
            .append(new Byte(32))
            .append(new Byte(0))
            // data 2a : power and timer
            .append_bit(!! power)
            .append_bit(timer === 'off')
            .append_bit(timer === 'on')
            .append_bit(0)
            // data 2b : operation mode
            .append_nibble(new Nibble(to_Nbit_binary(consts.mode[mode] , 4)))
            // data 3 : temperature
            .append_byte(new Byte(to_Nbit_binary(temp * 2 , 8)))
            // data 4 : fixed
            .append(new Byte(1))
            // data 5a : direction
            .append_nibble(new Nibble(to_Nbit_binary(consts.direction[direction] , 4)))
            // data 5b : strength
            .append_nibble(new Nibble(to_Nbit_binary(strength_num , 4)))
            // data 6 : 0000 0000
            .append(new Byte(0))
            // data 7, 8, 9: (two 12-bit integers split into 3 bytes)
            .append(make_data789(
                on_timer_hours ? on_timer_hours * 60 : '' ,
                off_timer_hours ? off_timer_hours * 60 : ''
            ))
            // data 10
            .append_bits([strength === 'powerful' , 0 , 0 , 0])
            .append_bits([0 , strength === 'quiet' , !! internal_dry , 0])
            // data 11,12,13 : 固定（たぶん）
            .append([new Byte(0) , new Byte(1) , new Byte(0)])
            // data 14a : 固定（たぶん） 0010
            .append_bits([0 , 1 , 1 , 0])
            // data 14b
            .append_bits([!! odour_reduction , 0 , 0 , 0]);

        // --- compute sum
        if ( all_bits.length ) {
            let bin_strs = [];
            while (all_bits.length > 0)
                bin_strs.push(all_bits.splice(0 , 8).join(''));
            const sum = bin_strs.reduce(
                (sum , bin_str) => sum + parseInt(bin_str.split('').reverse().join('') , 2) , 0);
            let sum_str = Number(sum & 0xFF).toString(2);
            sum_str = ('0'.repeat(8 - sum_str.length) + sum_str).split('').reverse().join('');
            ir_data_bits.append_bits(sum_str.split('').map(n => parseInt(n)));
        }
        ir_data_bits.append_time('1T'); // final stop bit

        const irkit_dict = ir_data_bits.to_irkit_data();
        this.log.info('generated infrared transmission for state' , {
            power ,
            mode ,
            temp ,
            direction ,
            strength ,
            timer ,
            timer_hours ,
            internal_dry ,
            odour_reduction ,
        } , '==>' , ir_data_bits.bits.join('').replace(/[]/g).replace(/(\d{4})/g , '$1 '));
        return irkit_dict;
    }

    generate_irkit_data() {
        const power = this.get_state('power');
        const mode = this.get_state('mode');
        const temp = this.get_state('temp');
        const direction = this.get_state('direction');
        const strength = this.get_state('strength');
        const timer = this.get_state('timer' , 'unset');
        const timer_hours = this.get_state('timer_hours' , 0);
        const internal_dry = this.get_state('internal_dry' , true);
        const odour_reduction = this.get_state('odour_reduction' , true);

        const multi = [
            this.create_irkit_data({
                power , mode , temp , direction , strength ,
                timer , timer_hours , internal_dry ,
                odour_reduction ,
            }) ,
        ];

        return {multi};
    }
}

module.exports = {
    model : 'A75C3026' ,
    appliance_class : NationalA75C3026 ,
};
