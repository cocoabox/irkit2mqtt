/**
 * config
 *
 * 2023-02-02 : added "array:" for converting dir/file1.json,file2.json... into [ FILE1, FILE2, ...]
 *              added keywords "merge-into-object" "merge" "merge-into-array"
 */
"use strict";
const JSON5 = require('json5');
const path = require('path');
const fs = require('fs');

class Config {
    static from_path(conf_path) {
        const base_dir = path.resolve(path.dirname(conf_path));
        const parsed = JSON5.parse(fs.readFileSync(conf_path, 'utf8'));
        return new this(parsed, base_dir);
    }

    static from_data(data, base_path) {
        return new Config(data, base_path);
    }

    #conf;

    constructor(parsed_conf_obj, base_dir) {
        this.#conf = parsed_conf_obj;
        this._base_dir = base_dir;
        this.#process_conf_strs();
    }

    #parse_conf_str(str) {
        const parsed = str.match(/^(base64|file|dir|merge-into-array|array|merge-into-object|merge):(.*)$/);
        if (parsed) {
            if (['merge-into-object', 'merge'].includes(parsed[1])) {
                const dir = path.resolve(this._base_dir, parsed[2]);
                let final_obj = {};
                for (const fn of fs.readdirSync(dir)) {
                    if (fn.match(/\.json5?$/)) {
                        try {
                            const json_path = path.join(dir, fn);
                            const json_text = fs.readFileSync(json_path, 'utf8');
                            final_obj = Object.assign(final_obj, JSON5.parse(json_text));
                        } catch (error) {
                            final_obj = Object.assign(final_obj, {__error__: error, __path__: json_path});
                        }
                    }
                }
                return final_obj;
            }
            if (['merge-into-array', 'array'].includes(parsed[1])) {
                const dir = path.resolve(this._base_dir, parsed[2]);
                return fs.readdirSync(dir).map(fn => {
                    if (fn.match(/\.json5?$/)) {
                        try {
                            const json_path = path.join(dir, fn);
                            const json_text = fs.readFileSync(json_path, 'utf8');
                            return JSON5.parse(json_text);
                        } catch (error) {
                            return {__error__: error, __path__: json_path};
                        }
                    }
                });
            } else if (parsed[1] === 'base64') {
                return Buffer.from(parsed[2], 'base64');
            } else if (parsed[1] === 'dir') {
                return path.resolve(this._base_dir, parsed[2]);
            } else if (parsed[1] === 'file') {
                const file_full_path = path.resolve(this._base_dir, parsed[2]);
                return fs.readFileSync(file_full_path, 'utf8');
            } else {
                return;
            }
        } else {
            return str;
        }
    }

    #process_conf_strs() {
        const process_obj = obj => {
            if (obj === null) return obj;
            for (const key in obj) {
                if (typeof obj[key] == 'string') {
                    obj[key] = this.#parse_conf_str(obj[key]);
                } else if (Array.isArray(obj)) {
                    for (let i = 0; i < obj.length; ++i) {
                        if (typeof obj[i] === 'string') {
                            obj[i] = this.#parse_conf_str(obj[i]);
                        } else if (typeof obj[key] === 'object') {
                            process_obj(obj[key]);
                        }
                    }
                } else if (typeof obj[key] === 'object') {
                    process_obj(obj[key]);
                }
            }
        };
        process_obj(this.#conf);
    }

    get data() {
        return this.#conf ?? {};
    }

    toString() {
        return JSON.stringify(this.data);
    }
}

module.exports = Config;

