/**
 * since there is only "Number" in JS, but let's .. well, let's
 * just pretend we can manipulate individual bits
 *
 */
class Bit {
    /**
     * @param {string|number|boolean} value
     *      should be "1", "0", 1, 0, true, false
     */
    constructor(value) {
        this.value = value === "1"
            ? 1
            : value === "0"
                ? 0
                : value ? 1 : 0
    }

    toString() {
        return this.to_binary_str()
    }

    to_binary_str() {
        return this.value ? "1" : "0"
    }

    to_number() {
        return this.value ? 1 : 0
    }

    flip() {
        // = (~ this.value) & 0x1
        this.value = this.value ? 0 : 1
        return this
    }

    set(value) {
        this.value = value ? 1 : 0
    }

    /**
     * @param {...Bit|...number} source bits, from high to low
     * @return {Nibble[]}
     */
    static concat_to_nibbles(_) {
        var args = _ instanceof Array ? _ : Array.prototype.slice.call(arguments)
        if (args.length % 4 !== 0) {
            args = [].concat(args, new Array(4 - args.length % 4).fill(new Bit(0)))
            console.warn("appending 0's at the end")
        }
        var nibbles = []
        for (var i = 0; i < args.length; i += 4) {
            nibbles.push(new Nibble([
                args[i] instanceof Bit ? args[i].value : args[i] ? 1 : 0,
                args[i + 1] instanceof Bit ? args[i + 1].value : args[i + 1] ? 1 : 0,
                args[i + 2] instanceof Bit ? args[i + 2].value : args[i + 2] ? 1 : 0,
                args[i + 3] instanceof Bit ? args[i + 3].value : args[i + 3] ? 1 : 0
            ]))
        }
        return nibbles
    }

    /**
     * @param {...Bit|...number} source bits, from high to low
     * @return {Byte[]}
     */
    static concat_to_bytes(_) {
        var args = _ instanceof Array ? _ : Array.prototype.slice.call(arguments)
        if (args.length % 8 !== 0) {
            args = [].concat(args, new Array(8 - args.length % 8).fill(new Bit(0)))
            console.warn("appending 0's at the end")
        }
        var bytes = []
        for (var i = 0; i < args.length; i += 4) {
            bytes.push(new Byte([
                args[i] instanceof Bit ? args[i].value : args[i] ? 1 : 0,
                args[i + 1] instanceof Bit ? args[i + 1].value : args[i + 1] ? 1 : 0,
                args[i + 2] instanceof Bit ? args[i + 2].value : args[i + 2] ? 1 : 0,
                args[i + 3] instanceof Bit ? args[i + 3].value : args[i + 3] ? 1 : 0,
                args[i + 4] instanceof Bit ? args[i + 4].value : args[i + 4] ? 1 : 0,
                args[i + 5] instanceof Bit ? args[i + 5].value : args[i + 5] ? 1 : 0,
                args[i + 6] instanceof Bit ? args[i + 6].value : args[i + 6] ? 1 : 0,
                args[i + 7] instanceof Bit ? args[i + 7].value : args[i + 7] ? 1 : 0
            ]))
        }
        return bytes
    }

}


class Nibble {
    /**
     * @param {string|number|Bit[]|number[]|string[]} from_what
     *      "1101" ==> gives 1101b (13)
     *      [1, 1, 0, 1] ==> gives 1101b (13)
     */
    constructor(from_what) {
        this.value = 0

        if (typeof from_what === "string" && from_what.length === 4)
            from_what = from_what.replace(/[^01]/g, "").split("");

        if (typeof from_what === "number") {
            if (from_what > 0xF)
                console.warn(`provided number ${from_what} is greater than 1111b; stripping`);
            this.value = from_what & 0xF
        }

        if (from_what && from_what.length) {
            let bits = [],
                max = from_what.length > 4 ? 4 : from_what.length

            for (let i = 0; i < max; ++i) {
                let fw = from_what[i],
                    bit = fw instanceof Bit
                        ? (fw.value ? 1 : 0)
                        : typeof fw === "number"
                            ? (fw ? 1 : 0)
                            : typeof fw === "string"
                                ? (fw === "1" ? 1 : 0)
                                : 0
                bits[i] = bit
            }
            this.value = 0 | (bits[0] << 3) | (bits[1] << 2) | (bits[2] << 1) | (bits[3])
        }

    }

    toString() {
        return this.to_binary_str()
    }

    to_numbers() {
        return [
            (this.value | 0x8) === this.value ? 1 : 0,
            (this.value | 0x4) === this.value ? 1 : 0,
            (this.value | 0x2) === this.value ? 1 : 0,
            (this.value | 0x1) === this.value ? 1 : 0
        ]
    }

    for_each_bit(callback) {
        this.to_numbers.forEach(callback)
    }

    to_binary_str() {
        return this.to_numbers().map(n => "" + n).join("")
    }

    to_bits() {
        return this.to_numbers().map(n => new Bit(n))
    }

    to_number() {
        return this.value >>> 0
    }

    /**
     * reverse the significance of all bits
     * @return {this}
     */
    reverse() {
        let n = this.value, re = 0
        for (let i = 0; i < 4; i++) {
            re = (re << 1) | (n & 1);
            n >>>= 1;
        }
        this.value = re
        return this
    }

    /**
     * flip 0 and 1
     * @return {this}
     */
    flip() {
        this.value = ( (~this.value) >>> 0 & 0xF)
        return this
    }

    /**
     * concatenate a list of Nibble into a Uint8Array
     * @param {...Nibble}
     * @return {Uint8Array}
     */
    static concat_to_uint8array(_) {
        var args = _ instanceof Array ? _ : Array.prototype.slice.call(arguments)
        if (args.length % 2 !== 0) {
            console.warn("padding with 0000 at the end")
            args.push(new Nibble(0))
        }

        var uint8array = new Uint8Array(args.length / 2)

        for (var i = 0; i < args.length; i += 2) {
            var high_nibble = args[i].to_number(),
                low_nibble = args[i + 1].to_number()
            uint8array[i / 2] = byte_.to_number(
                (high_nibble << 4) | low_nibble
            )
        }
        return uint8array
    }

    /**
     * @param {...Nibble}
     * @return {Buffer}
     */
    static concat_to_buffer(_) {
        var args = Array.prototype.slice.call(arguments)
        return Buffer.from(this.to_uint8array(args))
    }
}

class Byte {
    /**
     * @param {string|number|Bit[]|number[]|string[]|Nibble[]} from_what
     *      "a" --> 01100001
     *      "0110 0001" --> 01100001
     *      97  --> 01100001
     *      [0,1,1,0,0,0,0,1] --01100001
     *      [new Nibble("0110"), new Nibble("0001") --> 01100001
     */
    constructor(from_what) {
        this.value = 0
        if (from_what.array instanceof Array
            && from_what.start
            && from_what.array[start]
        ) {
            let arr = [], i = from_what.start
            while (arr.length < 8) {
                arr.push(typeof from_what.array[i] === "undefined" ? 0 : from_what.array[i])
                ++i;
            }
        }
        // e.g. "a" --> 97
        if (typeof from_what === "string" && from_what.length === 1)
            from_what = from_what.charCodeAt(0);

        // e.g. "11001100"
        if (typeof from_what === "string" && from_what.length === 8)
            from_what = from_what.replace(/[^01]/g, "").split("");

        if (typeof from_what === "number") {
            if (from_what > 0xFF)
                console.warn(`provided number ${from_what} is greater than 11111111b (0xFF); stripping`);
            from_what = Number(from_what & 0xFF).toString(2)
            from_what = ('0'.repeat(8 - from_what.length) + from_what).split('').map(n => parseInt(n))
        }

        //console.log('from_what=', JSON.stringify(from_what), from_what instanceof Array, from_what.constructor.name)

        if (from_what && from_what.length === 2 && from_what[0] instanceof Nibble) {
            //console.log('ARRAY1=', from_what)

            this.value = (from_what[0].to_number() << 4) | (from_what[1].to_number())
        }
        else if (from_what.constructor.name === 'Array') {
            //console.log('ARRAY2=', from_what)
            let bits = [],
                max = from_what.length > 8 ? 8 : (from_what.length + 1)

            for (let i = 0; i < max; ++i) {
                let fw = from_what[i],
                    bit = fw instanceof Bit
                        ? (fw.value ? 1 : 0)
                        : typeof fw === "number"
                            ? (fw ? 1 : 0)
                            : typeof fw === "string"
                                ? (fw === "1" ? 1 : 0)
                                : 0
                bits[i] = bit
            }
            this.value = 0
                | (bits[0] << 7)
                | (bits[1] << 6)
                | (bits[2] << 5)
                | (bits[3] << 4)
                | (bits[4] << 3)
                | (bits[5] << 2)
                | (bits[6] << 1)
                | (bits[7])
        }
        else {
            console.warn('Byte construction : unknown `from_what`:', from_what, typeof from_what)
        }
    }

    toString() {
        return this.to_binary_str()
    }

    to_binary_str() {
        return this.to_numbers().map(n => n + "").join("")
    }

    to_numbers() {
        return [
            (this.value | 0x80) === this.value ? 1 : 0,
            (this.value | 0x40) === this.value ? 1 : 0,
            (this.value | 0x20) === this.value ? 1 : 0,
            (this.value | 0x10) === this.value ? 1 : 0,
            (this.value | 0x8) === this.value ? 1 : 0,
            (this.value | 0x4) === this.value ? 1 : 0,
            (this.value | 0x2) === this.value ? 1 : 0,
            (this.value | 0x1) === this.value ? 1 : 0
        ];
    }

    to_bits() {
        return this.to_numbers().map(n => new Bit(n))
    }

    /**
     * returns the High (most significant, Left-hand-side, whatever) 4 bits
     * @return {Nibble}
     */
    high_nibble() {
        return new Nibble((this.value & 0xF0) >> 4)
    }

    /**
     * returns the High (least significant, Right-hand-side, whatever) 4 bits
     * @return {Nibble}
     */
    low_nibble() {
        return new Nibble(this.value & 0x0F)
    }

    /**
     * returns the high and low nibbles of the byte
     * @returns {Nibble[]}
     */
    to_nibbles() {
        return [this.high_nibble(), this.low_nibble()]
    }

    /**
     * traverse from highest to lowest nibble
     * @param {function} callback = function(nibble_instance) {..}
     * @return {this}
     */
    for_each_nibble(callback) {
        this.to_nibbles().forEach(callback)
        return this
    }

    /**
     * traverse from highest to lowest bit
     * @param {function} callback = function(bit_as_num) {..}
     * @return {this}
     */
    for_each_bit(callback) {
        this.to_numbers().forEach(callback)
        return this
    }

    to_number() {
        return this.value >>> 0
    }

    to_char() {
        return String.fromCharCode(this.value)
    }

    reverse() {
        let n = this.value, re = 0
        for (let i = 0; i < 8; i++) {
            re = (re << 1) | (n & 1)
            n >>>= 1
        }
        this.value = re
        return this
    }

    to_buffer() {
        return new Buffer([this.value])
    }

    append_to_buffer(buffer) {
        return Buffer.concat([buffer, this.to_buffer()])
    }

    /**
     * @param {TypedArray} arr
     * @return {TypedArray}
     */
    append_to_typedarray(arr) {
        var new_array = new (arr.constructor)(arr.length + 1)
        new_array.set(arr, 0)
        new_array.set([this.value], arr.length)
        return new_array
    }

    flip() {
        this.value = ( (~this.value) >>> 0 & 0xFF)
        return this
    }
}


module.exports = {
    Bit: Bit,
    Nibble: Nibble,
    Byte: Byte
}