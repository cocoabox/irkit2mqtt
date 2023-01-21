#!/usr/bin/env node

const {Bit, Byte, Nibble} = require('./binary-tools')

class IrData2 {
    /**
     * @param {number} T                     base number T (in microsec)
     * @param {number[]|string[]} leader     pulse/spaces in the leader, e.g. ['16T-high', '8T'], [1180, 502] (in microsec)
     * @param {number[]|string[]} bit1       pulse/spaces that forms a "1 bit"; e.g. ['1.01T-high', '1.0T']
     * @param {number[]|string[]} bit0       pulse/spaces that forms a "0 bit"
     * @param {number|string} stop_pulse     if there's a stop pulse at the end of your last bit, specify here, e.g. "1T", 500  (usec)
     * @param {number} frame_length     length of each data frame in microsec; required
     * @param {number[]|string[]|number[][]|string[][]} repeat
     * @param {number|number[]} repeat_length  if your repeats are of different length than the data frame, pass
     */
    constructor(T, leader, bit1, bit0, stop_pulse, frame_length, repeat, repeat_length) {
        this._T = T
        this._leader = leader instanceof Array ? leader : [leader];
        this._bit1 = bit1 && bit1 instanceof Array ? bit1 : ['1T-high', '1T'];
        this._bit0 = bit0 && bit0 instanceof Array ? bit0 : ['1T-high', '3T'];
        this._stop_pulse = stop_pulse

        this._frame_length = frame_length
        this._repeat = repeat
            ? (repeat instanceof Array && repeat[0] instanceof Array ? repeat : [repeat])
            : ""    // no repeats
        this._repeat_length = repeat_length
            ? (repeat_length instanceof Array ? repeat_length : [repeat_length])
            : ""    // no repeats
        this._frame_length = frame_length

        this._repeat_count = 0  // used to keep track of which _repeat to use

        this._on_received_bit = '';
        /**
         * @type {number[][]|string[][]}
         *
         * [FRAME_ARR, FRAME_ARR, ...]
         * where FRAME_ARR is [ nnn, nnn, 'nnn ticks', 'end' ]
         */
        this._frames = []
        this.start_frame()

        this._bits = []

    }

    set on_received_bit(callback_func) {
        if (!callback_func) {
            this._on_received_bit = '';
            return;
        }
        if (typeof callback_func === 'function')
            this._on_received_bit = callback_func;
        else
            throw 'expecting function; received:', callback_func;
    }

    /**
     * @return {{Ts: number[], length: number}}
     */
    get_repeat_info() {
        if (!this._repeat || !this._repeat_length) {
            console.warn(`_repaet or _repeat_length is undefined`)
            return;
        }
        if (!this._repeat_count) {
            // use first repeat
            return {Ts: this._repeat[0], length: this._repeat_length[0]}
        }
        else {
            let idx = this._repeat_count >= this._repeat.length ? this._repeat.length - 1 : this._repeat_count
            return {Ts: this._repeat[idx], length: this._repeat_length[idx]}
        }
    }

    terminate_frame() {
        // append a STOP
        if (this._stop_pulse)
            this.append_time(`${this._stop_pulse}-high`);

        // compute current frame length
        var current_frame = this.get_last_frame(),
            current_frame_length = current_frame.reduce(
                (sum, v) => sum + (typeof v === "number" ? v : v && v.ticks ? v.ticks : 0)
                , 0)

        if (current_frame_length <= this._frame_length) {
            var need_spacing = this._frame_length - current_frame_length,
                need_ticks = 2 * need_spacing
            //console.log(`need_spacing=${need_spacing} microsec; need_ticks=${need_ticks} ticks`)
            while (need_ticks) {
                let tcks = need_ticks >= 65535 ? 65535 : need_ticks
                this.append_time(`${tcks} ticks-low`)
                need_ticks -= tcks
            }
        }
        //console.log(`current_frame_length=${current_frame_length}; `,
        //    JSON.stringify(current_frame.map(a=>typeof a === "number" ? Math.round(a) : a)))
        current_frame.push('end')

        return this
    }

    start_frame() {
        //console.log("starting new frame")
        this._frames.push([])
        this._append_leader()

        return this
    }

    get_last_frame() {
        if (!this._frames.length) return;
        return this._frames[this._frames.length - 1]
    }

    parse_time(time) {
        if (typeof time === "number") return {tim: time, ext: ""};

        let mat = (time + '').match(/^(([0-9]+)|([0-9+\.]+)\s*T|([0-9\.]+)\s*ticks)(\-(high|low))?$/),
            // mat 2 : number (usec)
            // mat 3 : number, decimal (T)
            // mat 4 : number (ticks)
            // mat 6 : "high" or "low"
            tim = mat && mat[2] ? parseInt(mat[2])
                : mat && mat[3] ? parseFloat(mat[3]) * this._T
                    : mat && mat[4] ? {ticks: Math.round(parseFloat(mat[4]))}
                        : 0,
            out = {tim: tim, ext: mat ? mat[6] : null}
        //console.log("OUT:",out)
        return out
    }

    append_repeats(n) {
        if (n)
            for (let i = 0; i < n; ++i) this.append_repeat();
        return this
    }

    /**
     * append a repeat (may be repeat1 or repeatN) to the current stream
     */
    append_repeat() {
        var repeat_info = this.get_repeat_info()
        if (!repeat_info)
            throw "no repeat info defined";

        this._frames.push([])
        this.append_time.apply(this, repeat_info.Ts)

        var current_frame = this.get_last_frame(),
            current_len = current_frame.reduce((sum, val) => sum + val, 0),
            remaining_len = repeat_info.length - current_len,
            need_ticks = 2 * remaining_len

        while (need_ticks) {
            let tcks = need_ticks >= 65535 ? 65535 : need_ticks
            if (current_frame.length % 2 == 0)
                current_frame.push(0);
            current_frame.push({ticks: tcks})
            need_ticks -= tcks
        }

        // done !
        this._repeat_count++
    }

    _append_leader() {
        this.append_time.apply(this, this._leader)
    }

    _is_next_high() {
        var last_frame = this.get_last_frame()
        if (!last_frame) return;
        return last_frame.length % 2 === 0
    }

    /**
     * @param {...string|...number} time
     *      appends one or more space ("low") or pulse ("high") to the signal; accpeted formats:
     *          NNNN (in microsec)
     *          'nnn.nnT' (in multiples of T)
     *          'NNNN-high' (force add N microseconds of pulse)
     *          'NNNN-low' (force add N microseconds of space)
     */
    append_time(...time) {
        var current_frame = this.get_last_frame()
        if (current_frame && current_frame.indexOf('end') >= 0)
            throw 'current frame has ended';
        //console.log("appending times:", time)
        time.forEach(t => {
            let {tim, ext} = this.parse_time(t)

            if (ext) {
                // has high low
                let want_high = ext === 'high',
                    is_next_high = this._is_next_high()

                if ((want_high && is_next_high) || (!want_high && !is_next_high))
                    current_frame.push(tim);
                else {
                    // add a 0-length spacer, then add the time
                    current_frame.push(0)
                    current_frame.push(tim)
                }

            }
            else {
                if (tim)
                    current_frame.push(tim);
                else
                    console.warn(`invalid tim : ${tim}`);
            }
        })
        return this
    }

    /**
     * @param {boolean|number|Bit} bit
     * @return {IrData2}
     */
    append_bit(bit) {
        var bit_ = !!(bit instanceof Bit ? bit.value : bit),
            times = bit_ ? this._bit1 : this._bit0

        this._bits.push(bit_ ? 1 : 0)
        this.append_time.apply(this, times)


        if (typeof this._on_received_bit === 'function')
            this._on_received_bit(bit_ ? 1 : 0);

        return this
    }

    /**
     *
     * @param {number[]} bits
     * @return {IrData2}
     */
    append_bits(bits) {
        if (!(bits instanceof Array)) throw `expecting Array, got : ${bits}`
        bits.forEach(b => this.append_bit(b))
        return this
    }

    /**
     *
     * @param {number|Byte} byte
     * @return {IrData2}
     */
    append_byte(byte) {
        if (!(byte instanceof Byte))
            byte = new Byte(byte);
        return this.append_bits(byte.to_bits())
    }

    /**
     *
     * @param {Nibble|number} nibble
     * @return {IrData2}
     */
    append_nibble(nibble) {
        if (typeof nibble === 'number') nibble = new Nibble(nibble);
        return this.append_bits(nibble.to_bits())
    }

    /**
     * append a bit, byte or nibble
     *
     * @param {Byte|Nibble|Bit|Array} a
     * @return {IrData2}
     */
    append(a) {
        if (a instanceof Array) {
            a.forEach(aa => this.append(aa))
            return this;
        }
        switch (true) {
            case a instanceof Byte:
                return this.append_byte(a)
            case a instanceof Nibble:
                return this.append_nibble(a)
            case a instanceof Bit:
                return this.append_bit(a)
            default:
                throw 'expecting "a" to be Byte, Nibble or Bit instance'
        }
    }

    to_data() {
        var data = []
        this._frames.forEach(frame => {
            frame.forEach(t => {
                if (t === 'end') return;
                if (t && t.ticks) return data.push(Math.round(t.ticks));
                else if (typeof t === "number") {
                    let ticks = Math.round(t * 2)
                    data.push(ticks > 65535 ? 65535 : ticks)
                }
            })
        })
        return data
    }

    to_irkit_data() {
        return {format: "raw", freq: 38, data: this.to_data()}
    }

    toString() {
        return JSON.stringify(this.to_irkit_data())
    }

    get bits() {
        return this._bits
    }
}

class NecIrData extends IrData2 {
    /* from : http://elm-chan.org/docs/ir_format.html */
    constructor() {
        super(562,                // T = 562 microsec
            ['16T-high', '8T'],   // leader pulses/spaces
            ['1T-high', '1T'],    // bit 1
            ['1T-high', '3T'],    // bit 0
            '1T',                 // stop pulse
            108000,               // data frame length (108000 us)
            [['16T-high', '4T', '1T']],
            // repeat headers: first repeat is 16T,4T,1T; later repeats are 17T,4T,1T
            [108000]           // repeat0 = repeatN = 108000 us
        )
    }
}


module.exports = {
    IrData2: IrData2,
    NecIrData: NecIrData
}
