#!/usr/bin/env node

const JSON5 = require('json5');
const path = require('path');
const fs = require('fs');



class Config {
    static from_path(conf_path) {
        const base_dir = path.resolve(path.dirname(conf_path));
        const parsed = JSON5.parse(fs.readFileSync(conf_path, 'utf8'));
        return new Config(parsed, base_dir);
    }
    #conf;
    constructor(parsed_conf_obj, base_dir) {
        this.#conf = parsed_conf_obj;
        this._base_dir = base_dir;
        this.#process_conf_strs();
    }
    #parse_conf_str(str) {
        const parsed = str.match(/^(base64|file|dir):(.*)$/);
        if (parsed) {
            if (parsed[1] === 'base64') {
                return Buffer.from(parsed[2], 'base64');
            }
            else if (parsed[1] === 'dir') {
                return path.resolve(this._base_dir, parsed[2]);
            }
            else if (parsed[1] === 'file') {
                const file_full_path = path.resolve(this._base_dir, parsed[2]);
                return fs.readFileSync(file_full_path, 'utf8');
            }
            else {
                return;
            }
        }
        else {
            return str;
        }
    }        
    #process_conf_strs() {
        const process_obj = obj => {
            if (obj === null) return obj;
            for (const key in obj) {
                if (typeof obj[key] == 'string') {
                    obj[key] = this.#parse_conf_str(obj[key]);
                }
                else if (Array.isArray(obj)) {
                    for (let i = 0; i < obj.length; ++i) {
                        if (typeof obj[i] === 'string') {
                            obj[i] = this.#parse_conf_str(obj[i]);
                        }
                        else if (typeof obj[key] === 'object') {
                            process_obj(obj[key]);
                        }
                    }
                }
                else if (typeof obj[key] === 'object') {
                    process_obj(obj[key]);
                }
            }
        };
        process_obj(this.#conf);
    }

    get data() {
        return this.#conf ?? {};
    }

}

module.exports = Config;

