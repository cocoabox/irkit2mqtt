//
// see: http://elm-chan.org/docs/ir_format.html
//
function is_iris_oyama(times, T) {
    return Math.round(times[0] / T)	=== 9 && Math.round(times[1] / T)=== 9 ;
}

function is_nec(times, T) {
    return Math.round(times[0] / T)	=== 16 && Math.round(times[1] / T)=== 8;
}

function is_sony(times, T) {
    var verbose = T === 450 
    return Math.round(times[0] / T)	=== 4 ;
}

function is_aeha(times, t) {
    var pulse1 = Math.round(times[0] / t),
        pulse2 = Math.round(times[1] / t),
        is_aeha_ = pulse1 === 8 && pulse2 === 4 ;
    return is_aeha_;
}

function guess(times) {
    // console.log("guessing format and T ...")

    var aeha = [], iris_oyama = [], sony = [], nec = []
    //
    // try from 300 us --> 800 us; pick up all qualifying T's
    // then use the average (e.g if 400 ~ 450 are all qualifying
    // for AEHA format, then use 425)
    //
    for (var t = 300; t < 800; t += 5) {
        var a = is_aeha(times, t),
            s = is_sony(times, t),
            n = is_nec(times, t),
            i = is_iris_oyama(times, t)
        if (a) aeha.push(t);
        if (s) sony.push(t);
        if (i) iris_oyama.push(t);
        if (n) nec.push(t);
    }
    var sum = arr => arr.reduce((total, num) => total + num),
        avg = arr => arr.length ? sum(arr) / arr.length: 0,
        aeha_t = avg(aeha),
        sony_t = avg(sony),
        nec_t = avg(nec),
        iris_oyama_t = avg(iris_oyama)

    if (aeha_t) {
        console.log("AEHA, T =",aeha_t)
        return ["aeha", aeha_t]
    }
    if (nec_t) {
        console.log("NEC, T =",nec_t)
        return ["nec", nec_t]
    }
    if (sony_t) {
        console.log("SONY, T =",sony_t)
        return ["sony", sony_t]
    }
    if (iris_oyama_t) {
        console.log("IRIS OYAMA, T =",iris_oyama_t)
        return ["iris-oyama", iris_oyama_t]
    }

    console.log("Sorry! Unknown format and T")
    return false
}


function decode_nec(times, T) {
    let Ts = times.map(tick => Math.round(tick / T));
    let transmission = [];

    let frame_time = 0;
    const add_time = (T_val) => {
        frame_time += T_val * T;
    };

    // find leader
    let leader_index;
    for (let i = 0; i < Ts.length; ++i) {
        // linient..
        if ([15,16,17].includes(Ts[i]) && [7,8,9].includes(Ts[i + 1])) {
            // 18T high
            // 6T low
            leader_index = i;
            break;
        }
    }
    add_time(16);
    add_time(8);

    if (typeof leader_index === 'number')  {
        let i;
        let bits = [];
        for (i = leader_index + 2; i < Ts.length; i += 2) {
            const highs = Ts[i];
            const lows = Ts[i+1];
            add_time(highs);
            add_time(lows);
            const bit = (highs === 1 && lows === 1) ? 0 :
                (highs === 1 && lows === 3) ? 1 : 
                '?';
            const msec = frame_time / 1000;
            if (msec >= 108) {
                break;
            }
            bits.push(bit);
        }
        // strip trailing garbage
        for (j = bits.length - 1; j >= 0; --j) {
            if (bits[j] !== '?') break;
            if (bits[j] === '?') bits.splice(j, 1);
        }
        transmission.push(bits);
        // look for repeats
        while(i < Ts.length) {
            const highs = Ts[i];
            const lows = Ts[i+1];
            if (highs === 16 && lows === 4) {
                transmission.push('repeat');
            }
            i += 2;
        }
    }
    else {
        return;
    }
    return transmission;
}

function extract_aeha(times, T) {
    var frames = [],frame = []
    for (i=2; i<times.length; ++i) {
        var time = times[i],
            number_of_T = Math.round(time / T)
        if (i % 2 === 0) {
            // even
        }
        else {
            // odd
            if (number_of_T > 3)  { 
                // i-th time is a tracer
                // look ahead for possible another frame
                if (8 === Math.round(times[i+1] / T) &&
                    4 === Math.round(times[i+2] / T)) 
                {
                    // i+1 and i+2 are leader
                    i += 3
                    frames.push(JSON.parse(JSON.stringify(frame)))
                    frame = []
                }
                else {
                    console.warn("no leader found in i+1, i+2; continuing")
                    // skip one more so everything doesnt' get shifted one time
                    i += 1
                    continue
                }
            }
            else if (number_of_T === 3)
                frame.push(1);
            else if (number_of_T === 1) 
                frame.push(0);
            else 
                frame.push("?");
        }
    }
    if (frame.length) frames.push(frame);
    return frames
}

function extract_sony(times, T) {
    var out = [],
        customer_code = []
    throw "WIP! not implemented"
}
function ir_guess(tick_list) {
    let microsec_list = tick_list.map(n => n / 2);
    let [format, T]  = guess(microsec_list) ?? [];
    // got T and format
    switch(format) {
        case "aeha":
            frames = extract_aeha(microsec_list, T);
            break;
        case "sony":
            frames = extract_sony(microsec_list, T);
            break;
        case "nec":
            frames = decode_nec(microsec_list, T);
            break;
        default:
            console.log("unknown format")
    }
   return {format, T, frames};

}
module.exports = ir_guess;
